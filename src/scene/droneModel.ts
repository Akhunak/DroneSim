import * as THREE from 'three';
import { DroneState } from '../types/simulation';
import { getGroundOrWaterHeight } from '../simulation/terrain';

export interface DroneRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  gimbalPitchGroup: THREE.Group;
  cameraMount: THREE.Object3D;
  propellers: THREE.Group[];
  propBlurDiscs: THREE.Mesh[];
  rearLedMat: THREE.MeshStandardMaterial;
  frontLedMats: THREE.MeshStandardMaterial[];
  groundShadow: THREE.Mesh;
  update: (state: DroneState, dt: number, elapsed: number) => void;
}

/**
 * Builds a high-detail procedural 3D model of the DJI Mini 5 Pro.
 * Scale: 1 unit = 1 meter (visually scaled 1.65x so it reads clearly in chase/LOS cameras while keeping true-to-life proportions).
 */
export function createMini5ProModel(): DroneRig {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  // Visual scale factor makes the 25cm drone crisp & readable from chase distance
  bodyGroup.scale.setScalar(1.65);
  root.add(bodyGroup);

  // Materials
  const shellMat = new THREE.MeshStandardMaterial({
    color: 0xd0d5dc,
    roughness: 0.42,
    metalness: 0.18,
  });
  const darkTrimMat = new THREE.MeshStandardMaterial({
    color: 0x25282e,
    roughness: 0.52,
    metalness: 0.25,
  });
  const motorMat = new THREE.MeshStandardMaterial({
    color: 0x3b4048,
    roughness: 0.3,
    metalness: 0.78,
  });
  const sensorGlassMat = new THREE.MeshStandardMaterial({
    color: 0x0b1018,
    roughness: 0.08,
    metalness: 0.85,
  });
  const lidarMat = new THREE.MeshStandardMaterial({
    color: 0x160a1e,
    emissive: 0x2a0836,
    emissiveIntensity: 0.35,
    roughness: 0.1,
    metalness: 0.9,
  });
  const propMat = new THREE.MeshStandardMaterial({
    color: 0x1f2329,
    roughness: 0.45,
    metalness: 0.15,
  });
  const orangeTipMat = new THREE.MeshStandardMaterial({
    color: 0xff6a1a,
    roughness: 0.38,
    metalness: 0.1,
  });

  // 1. Main Fuselage (sculpted aerodynamic body facing -Z)
  const mainBody = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.044, 0.155), shellMat);
  mainBody.position.set(0, 0.008, 0.004);
  mainBody.castShadow = true;
  mainBody.receiveShadow = true;
  bodyGroup.add(mainBody);

  // Sleek upper canopy dome
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.076, 0.018, 0.132), shellMat);
  canopy.position.set(0, 0.032, 0.008);
  canopy.castShadow = true;
  bodyGroup.add(canopy);

  // Tapered front nose fairing
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.034, 0.035), shellMat);
  nose.position.set(0, 0.012, -0.078);
  nose.rotation.x = 0.18;
  bodyGroup.add(nose);

  // Lower dark belly & battery bay
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.074, 0.022, 0.135), darkTrimMat);
  belly.position.set(0, -0.016, 0.01);
  bodyGroup.add(belly);

  // Side cooling vents
  for (const side of [-1, 1]) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.014, 0.055), darkTrimMat);
    vent.position.set(side * 0.043, 0.006, 0.012);
    bodyGroup.add(vent);
  }

  // 2. Signature DJI Mini 5 Pro Omnidirectional Vision + Forward LiDAR Sensors
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.SphereGeometry(0.013, 14, 12), shellMat);
    pod.position.set(side * 0.028, 0.024, -0.072);
    bodyGroup.add(pod);

    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 12, 10), sensorGlassMat);
    lens.position.set(side * 0.03, 0.025, -0.081);
    bodyGroup.add(lens);

    // Downward optical flow sensors
    const downLens = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.004, 12), sensorGlassMat);
    downLens.position.set(side * 0.018, -0.027, 0.018);
    bodyGroup.add(downLens);
  }

  // Forward LiDAR sensor window (Mini 5 Pro upgrade)
  const lidarBar = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.009, 0.008), lidarMat);
  lidarBar.position.set(0, 0.026, -0.088);
  bodyGroup.add(lidarBar);

  // 3. Articulated 3-Axis Gimbal & 1-Inch Camera Module
  const gimbalYawBracket = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.016, 0.02), darkTrimMat);
  gimbalYawBracket.position.set(0, -0.006, -0.086);
  bodyGroup.add(gimbalYawBracket);

  const gimbalPitchGroup = new THREE.Group();
  gimbalPitchGroup.position.set(0, -0.014, -0.094);
  bodyGroup.add(gimbalPitchGroup);

  const camHousing = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.028, 0.028), darkTrimMat);
  gimbalPitchGroup.add(camHousing);

  const lensRing = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.012, 0.012, 18), motorMat);
  lensRing.rotation.x = Math.PI / 2;
  lensRing.position.set(0, 0, -0.015);
  gimbalPitchGroup.add(lensRing);

  const camGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.003, 18), sensorGlassMat);
  camGlass.rotation.x = Math.PI / 2;
  camGlass.position.set(0, 0, -0.021);
  gimbalPitchGroup.add(camGlass);

  // Camera mount for authentic FPV / Gimbal Camera view
  const cameraMount = new THREE.Object3D();
  cameraMount.position.set(0, 0, -0.045);
  gimbalPitchGroup.add(cameraMount);

  // 4. Four Swept Arms, Motors, Landing Legs, LEDs & Dual-Blade Propellers
  // Motor order: 0 = FL, 1 = FR, 2 = RL, 3 = RR
  const armSpecs = [
    { x: -0.118, y: 0.018, z: -0.098, rootX: -0.038, rootY: 0.012, rootZ: -0.048, isFront: true, dir: 1 },
    { x: 0.118, y: 0.018, z: -0.098, rootX: 0.038, rootY: 0.012, rootZ: -0.048, isFront: true, dir: -1 },
    { x: -0.108, y: -0.004, z: 0.096, rootX: -0.036, rootY: -0.002, rootZ: 0.045, isFront: false, dir: -1 },
    { x: 0.108, y: -0.004, z: 0.096, rootX: 0.036, rootY: -0.002, rootZ: 0.045, isFront: false, dir: 1 },
  ];

  const propellers: THREE.Group[] = [];
  const propBlurDiscs: THREE.Mesh[] = [];
  const frontLedMats: THREE.MeshStandardMaterial[] = [];

  for (const spec of armSpecs) {
    // Tapered arm strut from fuselage root to motor hub
    const start = new THREE.Vector3(spec.rootX, spec.rootY, spec.rootZ);
    const end = new THREE.Vector3(spec.x, spec.y, spec.z);
    const armVec = new THREE.Vector3().subVectors(end, start);
    const armLen = armVec.length();

    const armGeom = new THREE.BoxGeometry(0.015, 0.012, armLen);
    const armMesh = new THREE.Mesh(armGeom, shellMat);
    armMesh.position.copy(start).addScaledVector(armVec, 0.5);
    armMesh.lookAt(end);
    armMesh.castShadow = true;
    bodyGroup.add(armMesh);

    // Brushless motor bell
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.014, 0.016, 16), motorMat);
    motor.position.set(spec.x, spec.y + 0.006, spec.z);
    motor.castShadow = true;
    bodyGroup.add(motor);

    // Front landing skids + front orientation LEDs
    if (spec.isFront) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.056, 0.013), shellMat);
      leg.position.set(spec.x, spec.y - 0.032, spec.z);
      bodyGroup.add(leg);

      const ledMat = new THREE.MeshStandardMaterial({
        color: 0xff3b30,
        emissive: 0xff3b30,
        emissiveIntensity: 5.0,
      });
      frontLedMats.push(ledMat);
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.006), ledMat);
      led.position.set(spec.x, spec.y - 0.054, spec.z - 0.006);
      bodyGroup.add(led);
    } else {
      // Short rear rubber foot
      const rearFoot = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.028, 8), darkTrimMat);
      rearFoot.position.set(spec.x, spec.y - 0.022, spec.z);
      bodyGroup.add(rearFoot);
    }

    // Propeller Assembly (dual blades with orange tips)
    const propGroup = new THREE.Group();
    propGroup.position.set(spec.x, spec.y + 0.016, spec.z);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.008, 0.006, 12), darkTrimMat);
    propGroup.add(hub);

    for (const bladeSign of [-1, 1]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.0018, 0.011), propMat);
      blade.position.set(bladeSign * 0.036, 0, 0);
      blade.rotation.x = bladeSign * spec.dir * 0.14;
      propGroup.add(blade);

      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.002, 0.011), orangeTipMat);
      tip.position.set(bladeSign * 0.071, 0, 0);
      tip.rotation.x = bladeSign * spec.dir * 0.14;
      propGroup.add(tip);
    }

    bodyGroup.add(propGroup);
    propellers.push(propGroup);

    // Translucent spinning rotor motion-blur disc
    const blurMat = new THREE.MeshBasicMaterial({
      color: 0x303844,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const blurDisc = new THREE.Mesh(new THREE.RingGeometry(0.012, 0.076, 28), blurMat);
    blurDisc.rotation.x = -Math.PI / 2;
    blurDisc.position.set(spec.x, spec.y + 0.017, spec.z);
    bodyGroup.add(blurDisc);
    propBlurDiscs.push(blurDisc);
  }

  // 5. Rear Status LED Bar (DJI characteristic blinking indicator)
  const rearLedMat = new THREE.MeshStandardMaterial({
    color: 0x22c55e,
    emissive: 0x22c55e,
    emissiveIntensity: 2.5,
  });
  const rearLed = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.007, 0.006), rearLedMat);
  rearLed.position.set(0, -0.002, 0.083);
  bodyGroup.add(rearLed);

  // 6. Altitude-Reactive Soft Ground Shadow Blob (helps immensely when landing!)
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 64;
  shadowCanvas.height = 64;
  const sCtx = shadowCanvas.getContext('2d')!;
  const grad = sCtx.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.22)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  sCtx.fillStyle = grad;
  sCtx.fillRect(0, 0, 64, 64);

  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  const groundShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 1.1),
    new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.65,
    })
  );
  groundShadow.rotation.x = -Math.PI / 2;

  const spinDirs = [1, -1, -1, 1];

  const update = (state: DroneState, dt: number, elapsed: number) => {
    // Position & Orientation (YXZ order: Yaw -> Pitch -> Roll)
    root.position.set(state.position.x, state.position.y, state.position.z);
    root.rotation.order = 'YXZ';
    root.rotation.y = state.yaw;
    root.rotation.x = state.pitch;
    root.rotation.z = state.roll;

    // 3-Axis Stabilized Gimbal counteracts drone pitch & roll so camera stays level + user gimbal tilt!
    const desiredGimbalPitchRad = (state.gimbalPitchDeg * Math.PI) / 180;
    gimbalPitchGroup.rotation.order = 'ZXY';
    gimbalPitchGroup.rotation.x = desiredGimbalPitchRad - state.pitch;
    gimbalPitchGroup.rotation.z = -state.roll;

    // Spin propellers proportional to actual RPM
    for (let i = 0; i < 4; i++) {
      const rpm = state.motorRPM[i];
      const radPerSec = (rpm / 60) * Math.PI * 2;
      // Cap visual strobe step while keeping crisp motion
      propellers[i].rotation.y += spinDirs[i] * Math.min(radPerSec, 75) * dt;

      const blurRatio = THREE.MathUtils.clamp((rpm - 2200) / 6000, 0, 1);
      const discMat = propBlurDiscs[i].material as THREE.MeshBasicMaterial;
      discMat.opacity = blurRatio * 0.34;
      propellers[i].visible = blurRatio < 0.85;
    }

    // Rear Status LED logic (authentic DJI status blinking)
    let ledHex = 0x22c55e; // Green = GPS Normal/Cine
    let blinkFreq = 2.0;
    if (state.batteryPercent <= 15) {
      ledHex = 0xef4444;
      blinkFreq = 8.0;
    } else if (state.flightPhase.startsWith('RTH_')) {
      ledHex = 0x38bdf8;
      blinkFreq = 4.5;
    } else if (state.flightMode === 'sport') {
      ledHex = 0xf97316;
      blinkFreq = 3.5;
    } else if (state.flightMode === 'atti') {
      ledHex = 0xfacc15;
      blinkFreq = 3.0;
    }
    const pulse = Math.sin(elapsed * blinkFreq * Math.PI) > -0.2 ? 6.0 : 0.25;
    rearLedMat.color.setHex(ledHex);
    rearLedMat.emissive.setHex(ledHex);
    rearLedMat.emissiveIntensity = pulse;

    // Ground / Rooftop shadow tracks effective support surface right beneath the drone
    const agl = Math.max(0, state.altitudeAGL);
    const supportY = state.position.y - agl - 0.045;
    groundShadow.position.set(state.position.x, supportY, state.position.z);
    const shadowScale = 0.85 + Math.min(agl * 0.14, 3.2);
    groundShadow.scale.setScalar(shadowScale);
    const shadowMat = groundShadow.material as THREE.MeshBasicMaterial;
    shadowMat.opacity = THREE.MathUtils.clamp(0.75 - agl * 0.025, 0.05, 0.75);
  };

  return {
    root,
    bodyGroup,
    gimbalPitchGroup,
    cameraMount,
    propellers,
    propBlurDiscs,
    rearLedMat,
    frontLedMats,
    groundShadow,
    update,
  };
}
