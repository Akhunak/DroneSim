import * as THREE from 'three';
import { CameraMode, CheckpointRing, DroneState, WeatherConfig, WorldObstacle } from '../types/simulation';
import { createMini5ProModel, DroneRig } from './droneModel';
import { buildWorld, WorldHandles } from './worldBuilder';
import { createWeatherVisuals, WeatherVisuals } from './weatherVisuals';

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

  constructor(
    canvas: HTMLCanvasElement,
    obstacles: WorldObstacle[],
    checkpoints: CheckpointRing[]
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // enables authentic Photo Shutter capture!
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene = new THREE.Scene();
    this.fog = new THREE.FogExp2(0xa8d5f5, 0.00085);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(
      62,
      window.innerWidth / window.innerHeight,
      0.08,
      900
    );

    // Lighting
    this.hemiLight = new THREE.HemisphereLight(0xb7d6f5, 0x3b4d38, 0.85);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff6e0, 2.5);
    this.sunLight.position.set(80, 120, 60);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 380;
    const d = 110;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Build World, Drone & Weather Visuals
    this.world = buildWorld(this.scene, obstacles, checkpoints);
    this.droneRig = createMini5ProModel();
    this.scene.add(this.droneRig.root);
    this.scene.add(this.droneRig.groundShadow);
    this.weatherVisuals = createWeatherVisuals(this.scene);

    this.bindEvents(canvas);
  }

  private bindEvents(canvas: HTMLCanvasElement): void {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
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
      THREE.MathUtils.lerp(this.hemiLight.intensity, weather.ambientIntensity, smooth) +
      lightningFlash * 1.6;

    // Position sun directional light relative to drone so shadows stay crisp wherever you fly
    const elev = (weather.sunElevationDeg * Math.PI) / 180;
    const azim = (weather.sunAzimuthDeg * Math.PI) / 180;
    const sunDist = 140;
    this.sunLight.position.set(
      state.position.x + Math.cos(elev) * Math.sin(azim) * sunDist,
      state.position.y + Math.sin(elev) * sunDist,
      state.position.z + Math.cos(elev) * Math.cos(azim) * sunDist
    );
    this.sunLight.target.position.set(state.position.x, state.position.y, state.position.z);
    this.sunLight.target.updateMatrixWorld();

    // 4. Update Weather VFX
    this.weatherVisuals.update(dt, weather, lightningFlash, state.position, state.windAtDrone);

    // 5. Update Camera
    this.updateCamera(state, dt);

    // 6. Render frame
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(state: DroneState, dt: number): void {
    const pos = state.position;

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
