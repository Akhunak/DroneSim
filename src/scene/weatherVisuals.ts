import * as THREE from 'three';
import { Vec3, WeatherConfig } from '../types/simulation';

export interface SkyUniforms extends Record<string, THREE.IUniform> {
  uTopColor: { value: THREE.Color };
  uHorizonColor: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uFogColor: { value: THREE.Color };
  uFlash: { value: number };
}

export interface WeatherVisuals {
  skyMesh: THREE.Mesh;
  /** Shared sky shader: also rendered into the PMREM environment map for image-based lighting. */
  skyMaterial: THREE.ShaderMaterial;
  skyUniforms: SkyUniforms;
  /** Lifts the cloud layer with the scene's ground level (e.g. the valley's high plateau). */
  setCloudBase: (groundY: number) => void;
  update: (
    dt: number,
    weather: WeatherConfig,
    lightningFlash: number,
    focusPos: Vec3,
    windVec: Vec3,
    fogColor: THREE.Color
  ) => void;
}

export function createWeatherVisuals(scene: THREE.Scene): WeatherVisuals {
  // 1. Dynamic Gradient Sky Dome with Sun Disc & Lightning Flash
  const skyUniforms: SkyUniforms = {
    uTopColor: { value: new THREE.Color('#1d5fa8') },
    uHorizonColor: { value: new THREE.Color('#a8d5f5') },
    uSunDir: { value: new THREE.Vector3(0.4, 0.6, -0.5).normalize() },
    uSunColor: { value: new THREE.Color('#fff6e0') },
    uFogColor: { value: new THREE.Color('#a8d5f5') },
    uFlash: { value: 0.0 },
  };

  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorldDirection;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldDirection = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTopColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uFogColor;
      uniform float uFlash;
      varying vec3 vWorldDirection;

      void main() {
        vec3 dir = normalize(vWorldDirection);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 col = mix(uHorizonColor, uTopColor, pow(h, 0.55));

        float sunAmt = max(dot(dir, normalize(uSunDir)), 0.0);
        col += uSunColor * pow(sunAmt, 16.0) * 0.25;
        col += uSunColor * pow(sunAmt, 360.0) * 1.1;

        // Blend the horizon band (and everything below it) into the scene fog colour
        // so distant fogged terrain melts seamlessly into the sky.
        float horizonFog = 1.0 - smoothstep(-0.02, 0.14, dir.y);
        col = mix(col, uFogColor, horizonFog);

        // Lightning flash illumination
        col = mix(col, vec3(0.88, 0.94, 1.0), uFlash * 0.72);
        gl_FragColor = vec4(col, 1.0);

        // Match the renderer pipeline (ACES tone mapping + sRGB output) used by every other material
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(540, 28, 18), skyMat);
  scene.add(skyMesh);

  // 2. Soft Procedural Clouds
  const cloudGroup = new THREE.Group();
  const cloudMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });

  const cloudPuffs: Array<{ group: THREE.Group; speedFactor: number }> = [];
  let cSeed = 9182;
  const cRand = () => {
    cSeed = (cSeed * 16807) % 2147483647;
    return (cSeed - 1) / 2147483646;
  };

  for (let i = 0; i < 34; i++) {
    const cg = new THREE.Group();
    const cx = (cRand() - 0.5) * 620;
    const cy = 78 + cRand() * 48;
    const cz = (cRand() - 0.5) * 620;
    cg.position.set(cx, cy, cz);

    const puffCount = 3 + Math.floor(cRand() * 3);
    for (let p = 0; p < puffCount; p++) {
      const r = 9 + cRand() * 14;
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), cloudMat);
      puff.position.set((p - 1.5) * 11, (cRand() - 0.5) * 3.5, (cRand() - 0.5) * 9);
      puff.scale.set(1.4, 0.48, 1.1);
      cg.add(puff);
    }

    cloudGroup.add(cg);
    cloudPuffs.push({ group: cg, speedFactor: 0.7 + cRand() * 0.6 });
  }
  scene.add(cloudGroup);

  // 3. 3D Rain Streak System (follows around drone/camera volume)
  const RAIN_COUNT = 1400;
  const RAIN_BOX = 56;
  const rainPositions = new Float32Array(RAIN_COUNT * 2 * 3);
  const rainOffsets = new Float32Array(RAIN_COUNT * 3);
  for (let i = 0; i < RAIN_COUNT; i++) {
    rainOffsets[i * 3] = (Math.random() - 0.5) * RAIN_BOX;
    rainOffsets[i * 3 + 1] = (Math.random() - 0.5) * 38;
    rainOffsets[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BOX;
  }
  const rainGeom = new THREE.BufferGeometry();
  rainGeom.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
  const rainMat = new THREE.LineBasicMaterial({
    color: 0xcbe3ff,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
  });
  const rainLines = new THREE.LineSegments(rainGeom, rainMat);
  rainLines.frustumCulled = false;
  scene.add(rainLines);

  // 4. 3D Wind Streak Ribbons (visualizes gusts & wind direction in mid-air!)
  const WIND_COUNT = 160;
  const WIND_BOX = 48;
  const windPositions = new Float32Array(WIND_COUNT * 2 * 3);
  const windOffsets = new Float32Array(WIND_COUNT * 3);
  for (let i = 0; i < WIND_COUNT; i++) {
    windOffsets[i * 3] = (Math.random() - 0.5) * WIND_BOX;
    windOffsets[i * 3 + 1] = (Math.random() - 0.5) * 24;
    windOffsets[i * 3 + 2] = (Math.random() - 0.5) * WIND_BOX;
  }
  const windGeom = new THREE.BufferGeometry();
  windGeom.setAttribute('position', new THREE.BufferAttribute(windPositions, 3));
  const windMat = new THREE.LineBasicMaterial({
    color: 0xe6f2ff,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
  });
  const windLines = new THREE.LineSegments(windGeom, windMat);
  windLines.frustumCulled = false;
  scene.add(windLines);

  // Smooth target colors
  const targetTop = new THREE.Color();
  const targetHor = new THREE.Color();
  const targetSun = new THREE.Color();
  const targetCloud = new THREE.Color();

  const update = (
    dt: number,
    weather: WeatherConfig,
    lightningFlash: number,
    focusPos: Vec3,
    windVec: Vec3,
    fogColor: THREE.Color
  ) => {
    const smooth = Math.min(1, dt * 2.5);

    // Keep sky dome centered on viewer/drone so horizon never clips
    skyMesh.position.set(focusPos.x, 0, focusPos.z);

    // Interpolate sky colors
    targetTop.set(weather.skyTopColor);
    targetHor.set(weather.skyHorizonColor);
    targetSun.set(weather.sunColor);
    skyUniforms.uTopColor.value.lerp(targetTop, smooth);
    skyUniforms.uHorizonColor.value.lerp(targetHor, smooth);
    skyUniforms.uSunColor.value.lerp(targetSun, smooth);
    // Use the scene fog's already-smoothed colour so sky horizon and fogged terrain always agree
    skyUniforms.uFogColor.value.copy(fogColor);
    skyUniforms.uFlash.value = lightningFlash;

    // Sun direction vector
    const elev = (weather.sunElevationDeg * Math.PI) / 180;
    const azim = (weather.sunAzimuthDeg * Math.PI) / 180;
    skyUniforms.uSunDir.value
      .set(Math.cos(elev) * Math.sin(azim), Math.sin(elev), Math.cos(elev) * Math.cos(azim))
      .normalize();

    // Clouds drift with wind & darken in storms
    targetCloud.set(weather.rainIntensity > 0.3 ? '#4c5969' : weather.id === 'sunset' ? '#f5b895' : '#ffffff');
    cloudMat.color.lerp(targetCloud, smooth);
    cloudMat.opacity = THREE.MathUtils.lerp(cloudMat.opacity, 0.25 + weather.cloudCoverage * 0.65, smooth);

    for (const c of cloudPuffs) {
      c.group.position.x += windVec.x * dt * 0.45 * c.speedFactor;
      c.group.position.z += windVec.z * dt * 0.45 * c.speedFactor;
      if (c.group.position.x > 310) c.group.position.x -= 620;
      if (c.group.position.x < -310) c.group.position.x += 620;
      if (c.group.position.z > 310) c.group.position.z -= 620;
      if (c.group.position.z < -310) c.group.position.z += 620;
    }

    // Update 3D Rain streaks
    rainLines.visible = weather.rainIntensity > 0.02;
    if (rainLines.visible) {
      rainMat.opacity = THREE.MathUtils.clamp(weather.rainIntensity * 0.55, 0, 0.65);
      const posArr = rainGeom.attributes.position.array as Float32Array;
      const fallVy = -26 - weather.rainIntensity * 12;
      const streakDt = 0.036;

      for (let i = 0; i < RAIN_COUNT; i++) {
        const idx3 = i * 3;
        rainOffsets[idx3] += windVec.x * dt;
        rainOffsets[idx3 + 1] += fallVy * dt;
        rainOffsets[idx3 + 2] += windVec.z * dt;

        // Wrap around drone focus volume
        const halfB = RAIN_BOX * 0.5;
        if (rainOffsets[idx3] > halfB) rainOffsets[idx3] -= RAIN_BOX;
        if (rainOffsets[idx3] < -halfB) rainOffsets[idx3] += RAIN_BOX;
        if (rainOffsets[idx3 + 2] > halfB) rainOffsets[idx3 + 2] -= RAIN_BOX;
        if (rainOffsets[idx3 + 2] < -halfB) rainOffsets[idx3 + 2] += RAIN_BOX;
        if (rainOffsets[idx3 + 1] < -19) rainOffsets[idx3 + 1] += 38;

        const wx = focusPos.x + rainOffsets[idx3];
        const wy = Math.max(0.2, focusPos.y + rainOffsets[idx3 + 1]);
        const wz = focusPos.z + rainOffsets[idx3 + 2];

        const vIdx = i * 6;
        posArr[vIdx] = wx;
        posArr[vIdx + 1] = wy;
        posArr[vIdx + 2] = wz;
        posArr[vIdx + 3] = wx + windVec.x * streakDt;
        posArr[vIdx + 4] = wy + fallVy * streakDt;
        posArr[vIdx + 5] = wz + windVec.z * streakDt;
      }
      rainGeom.attributes.position.needsUpdate = true;
    }

    // Update 3D Wind Streaks (visible when wind > 4.5 m/s)
    const windSpeed = Math.hypot(windVec.x, windVec.z);
    windLines.visible = windSpeed > 4.2;
    if (windLines.visible) {
      windMat.opacity = THREE.MathUtils.clamp((windSpeed - 4.2) / 14, 0, 0.38);
      const posArr = windGeom.attributes.position.array as Float32Array;
      const streakLen = 0.14;
      const halfW = WIND_BOX * 0.5;

      for (let i = 0; i < WIND_COUNT; i++) {
        const idx3 = i * 3;
        windOffsets[idx3] += windVec.x * dt * 1.4;
        windOffsets[idx3 + 1] += windVec.y * dt;
        windOffsets[idx3 + 2] += windVec.z * dt * 1.4;

        if (windOffsets[idx3] > halfW) windOffsets[idx3] -= WIND_BOX;
        if (windOffsets[idx3] < -halfW) windOffsets[idx3] += WIND_BOX;
        if (windOffsets[idx3 + 2] > halfW) windOffsets[idx3 + 2] -= WIND_BOX;
        if (windOffsets[idx3 + 2] < -halfW) windOffsets[idx3 + 2] += WIND_BOX;
        if (windOffsets[idx3 + 1] > 12) windOffsets[idx3 + 1] -= 24;
        if (windOffsets[idx3 + 1] < -12) windOffsets[idx3 + 1] += 24;

        const wx = focusPos.x + windOffsets[idx3];
        const wy = Math.max(1.0, focusPos.y + windOffsets[idx3 + 1]);
        const wz = focusPos.z + windOffsets[idx3 + 2];

        const vIdx = i * 6;
        posArr[vIdx] = wx;
        posArr[vIdx + 1] = wy;
        posArr[vIdx + 2] = wz;
        posArr[vIdx + 3] = wx - windVec.x * streakLen;
        posArr[vIdx + 4] = wy - windVec.y * streakLen;
        posArr[vIdx + 5] = wz - windVec.z * streakLen;
      }
      windGeom.attributes.position.needsUpdate = true;
    }
  };

  const setCloudBase = (groundY: number) => {
    cloudGroup.position.y = Math.max(0, groundY);
  };

  return { skyMesh, skyMaterial: skyMat, skyUniforms, setCloudBase, update };
}
