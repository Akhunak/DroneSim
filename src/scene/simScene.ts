import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  CameraMode,
  CheckpointRing,
  DroneState,
  SceneId,
  WeatherConfig,
  WorldObstacle,
} from '../types/simulation';
import { createMini5ProModel, DroneRig } from './droneModel';
import { buildWorld, WorldHandles } from './worldBuilder';
import { createWeatherVisuals, WeatherVisuals } from './weatherVisuals';
import { WORLD_SIZE } from '../simulation/terrain';

const CAMERA_FAR = 900;
const SHADOW_MAP_SIZE = 2048;
const SHADOW_HALF_EXTENT = 110;
const SHADOW_TEXEL = (SHADOW_HALF_EXTENT * 2) / SHADOW_MAP_SIZE;

/**
 * Distance fade on top of the weather's FogExp2: geometry is fully fogged before it reaches
 * the camera far plane, so the edge of the world (and far-plane clipping) never shows as a
 * hard line against the sky. Clear-weather visibility inside the playable area is unchanged.
 */
function installWorldEdgeFog(): void {
  const chunk = THREE.ShaderChunk.fog_fragment;
  const anchor = 'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );';
  if (chunk.includes('worldEdgeFade') || !chunk.includes(anchor)) return;
  const fadeStart = (WORLD_SIZE * 0.47).toFixed(1);
  const fadeEnd = (CAMERA_FAR * 0.94).toFixed(1);
  THREE.ShaderChunk.fog_fragment = chunk.replace(
    anchor,
    `float worldEdgeFade = smoothstep( ${fadeStart}, ${fadeEnd}, vFogDepth );
	fogFactor = max( fogFactor, worldEdgeFade );
	${anchor}`
  );
}
installWorldEdgeFog();

const ORIGIN = new THREE.Vector3(0, 0, 0);

// Image-based lighting: the sky dome is baked into a PMREM env map so PBR materials
// (water, glass, metal, car paint) reflect the real sky and get soft sky-coloured fill light.
const ENV_INTENSITY = 0.75;
/** Hemisphere light is scaled down because the env map now supplies most of the sky fill. */
const HEMI_SCALE_WITH_ENV = 0.55;
const ENV_REFRESH_MIN_INTERVAL = 0.2; // seconds between PMREM rebuilds during weather blends
const ENV_CHANGE_EPSILON = 0.004;
const ENV_GROUND_COLOR = new THREE.Color(0x3f4a3c);

// Bloom operates on linear HDR values before tone mapping. Sun-lit white surfaces peak
// around ~1.1 luminance, so only emissive lights, the sun disc and lightning exceed this.
const BLOOM_THRESHOLD = 1.2;
const BLOOM_STRENGTH = 0.55;
const BLOOM_RADIUS = 0.45;

export class SimScene {
  public renderer: THREE.WebGLRenderer;
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public droneRig: DroneRig;
  public world: WorldHandles;
  public weatherVisuals: WeatherVisuals;
  public cameraMode: CameraMode = 'chase';

  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private fog: THREE.FogExp2;

  // Smooth chase camera state
  private chasePos = new THREE.Vector3(0, 2.2, 4.5);
  private chaseLook = new THREE.Vector3(0, 0.6, 0);

  /** Main-menu backdrop: slow cinematic orbit around the parked drone instead of the flight camera. */
  private showcase = false;
  private showcaseAngle = 0.9;

  // Orbit camera angles (user mouse-draggable in orbit mode)
  private orbitYaw = 0.55;
  private orbitPitch = 0.32;
  private orbitDist = 3.2;
  private isDraggingOrbit = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Helpers
  private tmpPos = new THREE.Vector3();
  private tmpTarget = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();
  private tmpColor = new THREE.Color();
  private sunDir = new THREE.Vector3();
  private shadowCenter = new THREE.Vector3();
  private shadowBasis = new THREE.Matrix4();
  private shadowQuat = new THREE.Quaternion();
  private shadowQuatInv = new THREE.Quaternion();
  private maxAnisotropy: number;

  // Post-processing
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;

  // Environment map (PMREM baked from the sky shader)
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envGroundMat = new THREE.MeshBasicMaterial({ color: ENV_GROUND_COLOR });
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envSignature = new Float32Array(18).fill(Number.NaN);
  private envNextSignature = new Float32Array(18);
  private envLastBuild = -Infinity;

  constructor(
    canvas: HTMLCanvasElement,
    sceneId: SceneId,
    obstacles: WorldObstacle[],
    checkpoints: CheckpointRing[]
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // MSAA is done on the composer's HDR render target instead (see setupPostProcessing)
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // enables authentic Photo Shutter capture!
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();

    this.scene = new THREE.Scene();
    this.fog = new THREE.FogExp2(0xa8d5f5, 0.00085);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(
      62,
      window.innerWidth / window.innerHeight,
      0.08,
      CAMERA_FAR
    );

    // Lighting
    this.hemiLight = new THREE.HemisphereLight(0xb7d6f5, 0x3b4d38, 0.85);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff6e0, 2.5);
    this.sunLight.position.set(80, 120, 60);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 380;
    const d = SHADOW_HALF_EXTENT;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    // Offsets lookups along the surface normal: removes acne on gently sloped terrain
    this.sunLight.shadow.normalBias = 0.03;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Build World, Drone & Weather Visuals
    this.world = buildWorld(this.scene, sceneId, obstacles, checkpoints, this.maxAnisotropy);
    this.droneRig = createMini5ProModel();
    this.scene.add(this.droneRig.root);
    this.scene.add(this.droneRig.groundShadow);
    this.weatherVisuals = createWeatherVisuals(this.scene);

    // Image-based lighting from the procedural sky
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.setupEnvironmentScene();
    this.scene.environmentIntensity = ENV_INTENSITY;

    // HDR post-processing: MSAA scene render -> bloom -> tone mapping + sRGB output
    const { composer, bloomPass } = this.setupPostProcessing();
    this.composer = composer;
    this.bloomPass = bloomPass;

    this.bindEvents(canvas);
  }

  private setupEnvironmentScene(): void {
    // Sky sphere sharing the live sky shader, plus a ground disc so the lower hemisphere of
    // the env map is earthy instead of fog-blue (otherwise undersides would glow blue).
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 16),
      this.weatherVisuals.skyMaterial
    );
    this.envScene.add(sky);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(45, 32), this.envGroundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    this.envScene.add(ground);
  }

  private setupPostProcessing(): { composer: EffectComposer; bloomPass: UnrealBloomPass } {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pixelRatio = this.renderer.getPixelRatio();

    const target = new THREE.WebGLRenderTarget(w * pixelRatio, h * pixelRatio, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);

    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD
    );
    composer.addPass(bloomPass);
    // Applies renderer.toneMapping (ACES) + exposure and converts to the sRGB canvas
    composer.addPass(new OutputPass());

    return { composer, bloomPass };
  }

  /**
   * Rebuilds the PMREM env map when the sky has visibly changed (weather blend, sun move).
   * Throttled so a weather transition costs only a handful of rebuilds.
   */
  private updateEnvironment(elapsed: number, weather: WeatherConfig): void {
    const u = this.weatherVisuals.skyUniforms;

    // Ground brightness follows the sun so stormy weather also darkens bounce light
    this.envGroundMat.color
      .copy(ENV_GROUND_COLOR)
      .multiplyScalar(0.45 + 0.55 * Math.min(1, weather.sunIntensity / 2.6));

    const sig = this.envNextSignature;
    let i = 0;
    for (const c of [u.uTopColor.value, u.uHorizonColor.value, u.uSunColor.value, u.uFogColor.value, this.envGroundMat.color]) {
      sig[i++] = c.r;
      sig[i++] = c.g;
      sig[i++] = c.b;
    }
    sig[i++] = u.uSunDir.value.x;
    sig[i++] = u.uSunDir.value.y;
    sig[i++] = u.uSunDir.value.z;

    let changed = this.envTarget === null;
    for (let k = 0; k < sig.length && !changed; k++) {
      if (!(Math.abs(sig[k] - this.envSignature[k]) <= ENV_CHANGE_EPSILON)) changed = true;
    }
    if (!changed || elapsed - this.envLastBuild < ENV_REFRESH_MIN_INTERVAL) return;

    // Lightning must not be baked into the reflections
    const flash = u.uFlash.value;
    u.uFlash.value = 0;
    const next = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
    u.uFlash.value = flash;

    this.envTarget?.dispose();
    this.envTarget = next;
    this.scene.environment = next.texture;
    this.envSignature.set(sig);
    this.envLastBuild = elapsed;
  }

  public switchScene(
    sceneId: SceneId,
    obstacles: WorldObstacle[],
    checkpoints: CheckpointRing[]
  ): void {
    this.world.dispose();
    this.world = buildWorld(this.scene, sceneId, obstacles, checkpoints, this.maxAnisotropy);
    this.resetCamera();
  }

  public setShowcase(active: boolean): void {
    this.showcase = active;
    if (!active) this.resetCamera();
  }

  /** Snap the chase camera back behind the home pad (after a reset) instead of swooping there. */
  public resetCamera(): void {
    this.chasePos.set(0, 2.2, 4.5);
    this.chaseLook.set(0, 0.6, 0);
  }

  private bindEvents(canvas: HTMLCanvasElement): void {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    });

    canvas.addEventListener('pointerdown', (e) => {
      if (this.cameraMode === 'orbit') {
        this.isDraggingOrbit = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      }
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.isDraggingOrbit) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.orbitYaw -= dx * 0.007;
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dy * 0.006, -0.35, 1.25);
    });

    window.addEventListener('pointerup', () => {
      this.isDraggingOrbit = false;
    });

    canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.cameraMode === 'orbit') {
          this.orbitDist = THREE.MathUtils.clamp(this.orbitDist + e.deltaY * 0.003, 1.4, 14);
        }
      },
      { passive: true }
    );
  }

  public setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    // Hide drone mesh in Gimbal FPV view so fuselage never clips the near lens
    this.droneRig.bodyGroup.visible = mode !== 'gimbal';
    this.camera.fov = mode === 'gimbal' ? 76 : 62;
    this.camera.updateProjectionMatrix();
  }

  public capturePhotoDataUrl(): string {
    return this.renderer.domElement.toDataURL('image/png');
  }

  public render(
    state: DroneState,
    weather: WeatherConfig,
    lightningFlash: number,
    checkpoints: CheckpointRing[],
    dt: number,
    elapsed: number
  ): void {
    // 1. Update Drone 3D Rig
    this.droneRig.update(state, dt, elapsed);

    // 2. Update World (wind turbines, trees, checkpoints, beacon)
    this.world.update(
      dt,
      elapsed,
      state.windSpeedAtDrone,
      state.windDirectionDeg,
      checkpoints,
      state.flightPhase.startsWith('RTH_')
    );

    // 3. Update Atmosphere, Fog & Lighting
    const smooth = Math.min(1, dt * 2.4);
    this.tmpColor.set(weather.fogColor);
    this.fog.color.lerp(this.tmpColor, smooth);
    this.fog.density = THREE.MathUtils.lerp(this.fog.density, weather.fogDensity, smooth);

    this.tmpColor.set(weather.sunColor);
    this.sunLight.color.lerp(this.tmpColor, smooth);
    this.sunLight.intensity =
      THREE.MathUtils.lerp(this.sunLight.intensity, weather.sunIntensity, smooth) +
      lightningFlash * 3.5;

    this.tmpColor.set(weather.ambientColor);
    this.hemiLight.color.lerp(this.tmpColor, smooth);
    this.hemiLight.intensity =
      THREE.MathUtils.lerp(
        this.hemiLight.intensity,
        weather.ambientIntensity * HEMI_SCALE_WITH_ENV,
        smooth
      ) + lightningFlash * 1.6;

    // Position sun directional light relative to drone so shadows stay crisp wherever you fly
    this.updateSunShadowFrame(state, weather);

    // 4. Update Weather VFX
    this.weatherVisuals.update(
      dt,
      weather,
      lightningFlash,
      state.position,
      state.windAtDrone,
      this.fog.color
    );
    this.updateEnvironment(elapsed, weather);

    // 5. Update Camera
    this.updateCamera(state, dt);

    // 6. Render frame (lightning briefly blooms the whole sky)
    this.bloomPass.strength = BLOOM_STRENGTH + lightningFlash * 0.35;
    this.composer.render(dt);
  }

  /**
   * Centres the sun's shadow frustum on the drone, snapped to whole shadow-map texels in
   * light space. Without snapping, the continuously moving frustum re-rasterises every shadow
   * edge at sub-texel offsets each frame, which shows up as crawling / shimmering shadows.
   */
  private updateSunShadowFrame(state: DroneState, weather: WeatherConfig): void {
    const elev = (weather.sunElevationDeg * Math.PI) / 180;
    const azim = (weather.sunAzimuthDeg * Math.PI) / 180;
    const sunDist = 140;
    this.sunDir.set(
      Math.cos(elev) * Math.sin(azim),
      Math.sin(elev),
      Math.cos(elev) * Math.cos(azim)
    );

    // Same orientation the DirectionalLightShadow camera uses (looks from light to target, +Y up)
    this.shadowBasis.lookAt(this.sunDir, ORIGIN, this.sunLight.shadow.camera.up);
    this.shadowQuat.setFromRotationMatrix(this.shadowBasis);
    this.shadowQuatInv.copy(this.shadowQuat).invert();

    this.shadowCenter
      .set(state.position.x, state.position.y, state.position.z)
      .applyQuaternion(this.shadowQuatInv);
    this.shadowCenter.x = Math.round(this.shadowCenter.x / SHADOW_TEXEL) * SHADOW_TEXEL;
    this.shadowCenter.y = Math.round(this.shadowCenter.y / SHADOW_TEXEL) * SHADOW_TEXEL;
    this.shadowCenter.applyQuaternion(this.shadowQuat);

    this.sunLight.position.copy(this.shadowCenter).addScaledVector(this.sunDir, sunDist);
    this.sunLight.target.position.copy(this.shadowCenter);
    this.sunLight.target.updateMatrixWorld();
  }

  private updateCamera(state: DroneState, dt: number): void {
    const pos = state.position;

    if (this.showcase) {
      // Wide, slowly circling shot; the drone sits left of centre so the menu panel doesn't hide it
      this.showcaseAngle += dt * 0.07;
      const a = this.showcaseAngle;
      const radius = 1.9 + Math.sin(a * 0.6) * 0.25;
      this.camera.position.set(
        pos.x + Math.sin(a) * radius,
        pos.y + 0.55 + Math.sin(a * 0.45) * 0.12,
        pos.z + Math.cos(a) * radius
      );
      // Aim slightly to the drone's left (screen-space) so it appears right of the menu panel
      this.tmpTarget.set(
        pos.x - Math.cos(a) * 0.55,
        pos.y + 0.3,
        pos.z + Math.sin(a) * 0.55
      );
      this.camera.lookAt(this.tmpTarget);
      return;
    }

    if (this.cameraMode === 'gimbal') {
      // True 3-axis stabilized DJI Mini 5 Pro 4K Gimbal Camera view!
      // Horizon stays rock-steady while following drone yaw + gimbal pitch tilt
      const fwdX = -Math.sin(state.yaw);
      const fwdZ = -Math.cos(state.yaw);
      this.camera.position.set(pos.x + fwdX * 0.16, pos.y - 0.02, pos.z + fwdZ * 0.16);
      const euler = new THREE.Euler(
        (state.gimbalPitchDeg * Math.PI) / 180,
        state.yaw,
        0,
        'YXZ'
      );
      this.tmpQuat.setFromEuler(euler);
      this.camera.quaternion.slerp(this.tmpQuat, Math.min(1, dt * 18));
    } else if (this.cameraMode === 'chase') {
      // Smooth dynamic 3rd-person chase camera behind the drone
      const behindDist = 2.8 + Math.min(state.horizontalSpeed * 0.1, 1.5);
      const heightOffset = 1.05 + Math.max(0, -state.pitch) * 0.6;
      const desiredX = pos.x + Math.sin(state.yaw) * behindDist;
      const desiredZ = pos.z + Math.cos(state.yaw) * behindDist;
      const desiredY = Math.max(pos.y + heightOffset, 0.65);

      this.tmpPos.set(desiredX, desiredY, desiredZ);
      this.chasePos.lerp(this.tmpPos, Math.min(1, dt * 6.5));

      const lookAheadX = pos.x - Math.sin(state.yaw) * 2.2;
      const lookAheadZ = pos.z - Math.cos(state.yaw) * 2.2;
      this.tmpTarget.set(lookAheadX, pos.y + 0.15, lookAheadZ);
      this.chaseLook.lerp(this.tmpTarget, Math.min(1, dt * 9.0));

      this.camera.position.copy(this.chasePos);
      this.camera.lookAt(this.chaseLook);
    } else if (this.cameraMode === 'los') {
      // Ground Pilot Line-of-Sight view (standing next to the Home Helipad)
      this.camera.position.set(0, 1.85, 8.8);
      this.tmpTarget.set(pos.x, pos.y + 0.1, pos.z);
      this.camera.lookAt(this.tmpTarget);
    } else if (this.cameraMode === 'orbit') {
      // User-draggable close-up orbit around the drone
      const yaw = state.yaw + this.orbitYaw;
      const cx = pos.x + Math.sin(yaw) * Math.cos(this.orbitPitch) * this.orbitDist;
      const cy = Math.max(0.35, pos.y + Math.sin(this.orbitPitch) * this.orbitDist);
      const cz = pos.z + Math.cos(yaw) * Math.cos(this.orbitPitch) * this.orbitDist;
      this.camera.position.set(cx, cy, cz);
      this.camera.lookAt(pos.x, pos.y + 0.05, pos.z);
    }
  }
}
