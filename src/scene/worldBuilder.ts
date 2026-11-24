import * as THREE from 'three';
import { CheckpointRing, WorldObstacle } from '../types/simulation';
import {
  getTerrainHeight,
  HOME_PAD_RADIUS,
  WATER_LEVEL,
  WORLD_SIZE,
} from '../simulation/terrain';

export interface WorldHandles {
  waterMesh: THREE.Mesh;
  turbineRotors: Array<{ nacelle: THREE.Group; rotor: THREE.Group }>;
  checkpointMeshes: Map<number, { ring: THREE.Mesh; mat: THREE.MeshStandardMaterial }>;
  homeBeacon: THREE.Mesh;
  beaconLights: THREE.MeshStandardMaterial[];
  treeGroups: THREE.Group[];
  update: (
    dt: number,
    elapsed: number,
    windSpeed: number,
    windDirDeg: number,
    checkpoints: CheckpointRing[],
    rthActive: boolean
  ) => void;
}

export function buildWorld(
  scene: THREE.Scene,
  obstacles: WorldObstacle[],
  checkpoints: CheckpointRing[]
): WorldHandles {
  // 1. Procedural Vertex-Colored Terrain
  const segs = 160;
  const terrainGeom = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
  terrainGeom.rotateX(-Math.PI / 2);

  const posAttr = terrainGeom.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const y = getTerrainHeight(x, z);
    posAttr.setY(i, y);

    const distHome = Math.hypot(x, z);
    if (distHome < HOME_PAD_RADIUS + 2.5) {
      tmpColor.setHex(0x6d747d); // gravel apron around pad
    } else if (y < WATER_LEVEL + 0.6) {
      tmpColor.setHex(0xc8b896); // sandy shoreline
    } else if (y < 9) {
      const n = (Math.sin(x * 0.08) * Math.cos(z * 0.08) + 1) * 0.5;
      tmpColor.setHex(0x4c7c44).lerp(new THREE.Color(0x3a6638), n);
    } else if (y < 24) {
      const n = (Math.sin(x * 0.05) + 1) * 0.5;
      tmpColor.setHex(0x3d6139).lerp(new THREE.Color(0x5b6948), n);
    } else if (y < 42) {
      tmpColor.setHex(0x6f7378); // rocky alpine slope
    } else {
      tmpColor.setHex(0xd6dee6); // high mountain peak
    }

    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  terrainGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeom.computeVertexNormals();

  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.02,
  });
  const terrainMesh = new THREE.Mesh(terrainGeom, terrainMat);
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);

  // 2. Shimmering Water Plane (Coastal Lake)
  const waterGeom = new THREE.PlaneGeometry(WORLD_SIZE * 0.95, WORLD_SIZE * 0.95, 32, 32);
  waterGeom.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x1e6c93,
    roughness: 0.16,
    metalness: 0.45,
    transparent: true,
    opacity: 0.88,
  });
  const waterMesh = new THREE.Mesh(waterGeom, waterMat);
  waterMesh.position.y = WATER_LEVEL;
  waterMesh.receiveShadow = true;
  scene.add(waterMesh);

  // 3. DJI Helipad Home Point Launchpad at (0, 0)
  const padGroup = new THREE.Group();
  const padY = getTerrainHeight(0, 0);
  padGroup.position.set(0, padY + 0.03, 0);

  const padBase = new THREE.Mesh(
    new THREE.CylinderGeometry(HOME_PAD_RADIUS, HOME_PAD_RADIUS + 0.5, 0.12, 32),
    new THREE.MeshStandardMaterial({ color: 0x2c323b, roughness: 0.8 })
  );
  padBase.receiveShadow = true;
  padGroup.add(padBase);

  // Painted Helipad Canvas Texture ("H" + Orange Ring + Compass Ticks)
  const padCanvas = document.createElement('canvas');
  padCanvas.width = 512;
  padCanvas.height = 512;
  const ctx = padCanvas.getContext('2d')!;
  ctx.fillStyle = '#262b33';
  ctx.fillRect(0, 0, 512, 512);

  // Outer safety ring
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.arc(256, 256, 215, 0, Math.PI * 2);
  ctx.stroke();

  // Inner dashed ring
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 6;
  ctx.setLineDash([20, 14]);
  ctx.beginPath();
  ctx.arc(256, 256, 178, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Crisp "H"
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(168, 138, 38, 236);
  ctx.fillRect(306, 138, 38, 236);
  ctx.fillRect(168, 236, 176, 38);

  // North arrow "N"
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 34px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', 256, 74);

  const padTex = new THREE.CanvasTexture(padCanvas);
  const padSurface = new THREE.Mesh(
    new THREE.CircleGeometry(HOME_PAD_RADIUS - 0.15, 32),
    new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.72 })
  );
  padSurface.rotation.x = -Math.PI / 2;
  padSurface.position.y = 0.065;
  padSurface.receiveShadow = true;
  padGroup.add(padSurface);

  // Perimeter pad LED markers
  const padLedMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x38bdf8,
    emissiveIntensity: 1.8,
  });
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.22, 8), padLedMat);
    post.position.set(Math.cos(ang) * (HOME_PAD_RADIUS - 0.35), 0.14, Math.sin(ang) * (HOME_PAD_RADIUS - 0.35));
    padGroup.add(post);
  }
  scene.add(padGroup);

  // Vertical translucent RTH Home Beacon cylinder (visible when returning home)
  const homeBeacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 1.4, 48, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  homeBeacon.position.set(0, padY + 24, 0);
  homeBeacon.visible = false;
  scene.add(homeBeacon);

  // 4. Build Obstacles & Landmarks
  const turbineRotors: Array<{ nacelle: THREE.Group; rotor: THREE.Group }> = [];
  const beaconLights: THREE.MeshStandardMaterial[] = [];
  const treeGroups: THREE.Group[] = [];

  const concreteMat = new THREE.MeshStandardMaterial({ color: 0xcbd2da, roughness: 0.75 });
  const darkMetalMat = new THREE.MeshStandardMaterial({ color: 0x2c3440, roughness: 0.4, metalness: 0.65 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x6ec6ff,
    emissive: 0x1e4060,
    emissiveIntensity: 0.35,
    roughness: 0.12,
    metalness: 0.85,
  });
  const warmWindowMat = new THREE.MeshStandardMaterial({
    color: 0xffd79a,
    emissive: 0xffa63b,
    emissiveIntensity: 0.55,
    roughness: 0.25,
  });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.9 });
  const pineMatDark = new THREE.MeshStandardMaterial({ color: 0x204d2c, roughness: 0.88 });
  const pineMatMid = new THREE.MeshStandardMaterial({ color: 0x2d6338, roughness: 0.86 });
  const turbineMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.35, metalness: 0.12 });

  for (const obs of obstacles) {
    if (obs.id === 'watch-tower') {
      const g = new THREE.Group();
      g.position.set(obs.x, obs.y, obs.z);

      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.7, obs.height - 4, 12), concreteMat);
      shaft.position.y = (obs.height - 4) * 0.5;
      shaft.castShadow = true;
      shaft.receiveShadow = true;
      g.add(shaft);

      const deck = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 2.8, 3.2, 12), glassMat);
      deck.position.y = obs.height - 2.6;
      deck.castShadow = true;
      g.add(deck);

      const roof = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 3.5, 0.9, 12), darkMetalMat);
      roof.position.y = obs.height - 0.6;
      g.add(roof);

      const lightMat = new THREE.MeshStandardMaterial({
        color: 0xff2d2d,
        emissive: 0xff2d2d,
        emissiveIntensity: 2.5,
      });
      beaconLights.push(lightMat);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 10), lightMat);
      bulb.position.y = obs.height + 0.35;
      g.add(bulb);

      scene.add(g);
    } else if (obs.id === 'hangar') {
      const g = new THREE.Group();
      g.position.set(obs.x, obs.y, obs.z);

      const hall = new THREE.Mesh(new THREE.BoxGeometry(obs.width, obs.height - 1.5, obs.depth), concreteMat);
      hall.position.y = (obs.height - 1.5) * 0.5;
      hall.castShadow = true;
      hall.receiveShadow = true;
      g.add(hall);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(obs.width + 0.8, 1.5, obs.depth + 0.8), darkMetalMat);
      roof.position.y = obs.height - 0.75;
      roof.castShadow = true;
      g.add(roof);

      const door = new THREE.Mesh(new THREE.BoxGeometry(8.5, 4.4, 0.4), darkMetalMat);
      door.position.set(0, 2.2, -obs.depth * 0.5 - 0.05);
      g.add(door);

      const strip = new THREE.Mesh(new THREE.BoxGeometry(10, 0.35, 0.3), warmWindowMat);
      strip.position.set(0, 5.1, -obs.depth * 0.5 - 0.08);
      g.add(strip);

      scene.add(g);
    } else if (obs.id.startsWith('cabin-')) {
      const g = new THREE.Group();
      g.position.set(obs.x, obs.y, obs.z);

      const wall = new THREE.Mesh(new THREE.BoxGeometry(obs.width, obs.height - 1.5, obs.depth), concreteMat);
      wall.position.y = (obs.height - 1.5) * 0.5;
      wall.castShadow = true;
      wall.receiveShadow = true;
      g.add(wall);

      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(Math.max(obs.width, obs.depth) * 0.78, 2.6, 4),
        new THREE.MeshStandardMaterial({ color: 0x9b4432, roughness: 0.78 })
      );
      roof.rotation.y = Math.PI / 4;
      roof.position.y = obs.height - 0.3;
      roof.castShadow = true;
      g.add(roof);

      const win = new THREE.Mesh(new THREE.BoxGeometry(obs.width * 0.5, 1.6, obs.depth + 0.16), warmWindowMat);
      win.position.y = 2.4;
      g.add(win);

      scene.add(g);
    } else if (obs.id.startsWith('turbine-')) {
      const g = new THREE.Group();
      g.position.set(obs.x, obs.y, obs.z);

      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 1.45, obs.height, 14), turbineMat);
      mast.position.y = obs.height * 0.5;
      mast.castShadow = true;
      g.add(mast);

      const nacelle = new THREE.Group();
      nacelle.position.y = obs.height;
      g.add(nacelle);

      const pod = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 4.2), turbineMat);
      pod.castShadow = true;
      nacelle.add(pod);

      const rotor = new THREE.Group();
      rotor.position.set(0, 0, -2.25);
      nacelle.add(rotor);

      const hub = new THREE.Mesh(new THREE.ConeGeometry(0.95, 1.8, 12), turbineMat);
      hub.rotation.x = -Math.PI / 2;
      rotor.add(hub);

      for (let b = 0; b < 3; b++) {
        const bladeHolder = new THREE.Group();
        bladeHolder.rotation.z = (b * Math.PI * 2) / 3;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.85, 15.5, 0.28), turbineMat);
        blade.position.y = 7.8;
        blade.castShadow = true;
        bladeHolder.add(blade);
        rotor.add(bladeHolder);
      }

      turbineRotors.push({ nacelle, rotor });
      scene.add(g);
    } else if (obs.id === 'radio-mast') {
      const g = new THREE.Group();
      g.position.set(obs.x, obs.y, obs.z);

      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 1.8, obs.height, 6),
        new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5, wireframe: false })
      );
      tower.position.y = obs.height * 0.5;
      tower.castShadow = true;
      g.add(tower);

      const lightMat = new THREE.MeshStandardMaterial({
        color: 0xff2222,
        emissive: 0xff2222,
        emissiveIntensity: 3.0,
      });
      beaconLights.push(lightMat);
      const topLight = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 10), lightMat);
      topLight.position.y = obs.height + 0.5;
      g.add(topLight);

      scene.add(g);
    } else if (obs.id.startsWith('tree-')) {
      const g = new THREE.Group();
      g.position.set(obs.x, obs.y, obs.z);

      const trunkH = obs.height * 0.28;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.45, trunkH, 7), woodMat);
      trunk.position.y = trunkH * 0.5;
      trunk.castShadow = true;
      g.add(trunk);

      const tier1 = new THREE.Mesh(new THREE.ConeGeometry(obs.width * 0.65, obs.height * 0.46, 7), pineMatDark);
      tier1.position.y = trunkH + obs.height * 0.2;
      tier1.castShadow = true;
      g.add(tier1);

      const tier2 = new THREE.Mesh(new THREE.ConeGeometry(obs.width * 0.5, obs.height * 0.4, 7), pineMatMid);
      tier2.position.y = trunkH + obs.height * 0.44;
      tier2.castShadow = true;
      g.add(tier2);

      const tier3 = new THREE.Mesh(new THREE.ConeGeometry(obs.width * 0.32, obs.height * 0.3, 7), pineMatDark);
      tier3.position.y = trunkH + obs.height * 0.64;
      g.add(tier3);

      treeGroups.push(g);
      scene.add(g);
    }
  }

  // 5. Aerial Checkpoint Rings
  const checkpointMeshes = new Map<number, { ring: THREE.Mesh; mat: THREE.MeshStandardMaterial }>();
  for (const cp of checkpoints) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 1.4,
      roughness: 0.25,
      metalness: 0.4,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(cp.radius, 0.26, 12, 36), mat);
    ring.position.set(cp.x, cp.y, cp.z);
    ring.rotation.y = cp.rotationY;
    scene.add(ring);
    checkpointMeshes.set(cp.id, { ring, mat });
  }

  const update = (
    dt: number,
    elapsed: number,
    windSpeed: number,
    windDirDeg: number,
    cps: CheckpointRing[],
    rthActive: boolean
  ) => {
    // Rotate wind turbine blades proportional to wind speed & align nacelle into wind
    const targetNacelleYaw = -(windDirDeg * Math.PI) / 180;
    const rotorRadPerSec = 0.25 + windSpeed * 0.28;
    for (const t of turbineRotors) {
      t.nacelle.rotation.y = THREE.MathUtils.lerp(t.nacelle.rotation.y, targetNacelleYaw, dt * 0.8);
      t.rotor.rotation.z -= rotorRadPerSec * dt;
    }

    // Subtle tree sway in strong winds
    const swayAmp = Math.min(0.11, windSpeed * 0.0075);
    if (swayAmp > 0.008) {
      const windRad = (windDirDeg * Math.PI) / 180;
      const sx = -Math.sin(windRad);
      const sz = Math.cos(windRad);
      for (let i = 0; i < treeGroups.length; i++) {
        const phase = Math.sin(elapsed * (1.8 + (i % 5) * 0.25) + i * 0.7);
        const tilt = swayAmp * (0.5 + 0.5 * phase);
        treeGroups[i].rotation.z = -sx * tilt;
        treeGroups[i].rotation.x = sz * tilt;
      }
    }

    // Aviation warning beacons blink
    const blink = Math.sin(elapsed * 3.8) > 0.35 ? 3.2 : 0.25;
    for (const m of beaconLights) {
      m.emissiveIntensity = blink;
    }

    // RTH home beacon visibility & gentle pulse
    homeBeacon.visible = rthActive;
    if (rthActive) {
      const bm = homeBeacon.material as THREE.MeshBasicMaterial;
      bm.opacity = 0.14 + Math.sin(elapsed * 5) * 0.06;
    }

    // Checkpoint ring colors & pulse
    for (const cp of cps) {
      const entry = checkpointMeshes.get(cp.id);
      if (!entry) continue;
      if (cp.cleared) {
        entry.mat.color.setHex(0x22c55e);
        entry.mat.emissive.setHex(0x16a34a);
        entry.mat.emissiveIntensity = 0.5;
        entry.ring.scale.setScalar(0.92);
      } else {
        entry.mat.color.setHex(0x38bdf8);
        entry.mat.emissive.setHex(0x0ea5e9);
        entry.mat.emissiveIntensity = 1.2 + Math.sin(elapsed * 3 + cp.id) * 0.45;
        entry.ring.scale.setScalar(1.0);
      }
    }

    // Subtle water shimmer
    waterMesh.position.y = WATER_LEVEL + Math.sin(elapsed * 1.1) * 0.04;
  };

  return {
    waterMesh,
    turbineRotors,
    checkpointMeshes,
    homeBeacon,
    beaconLights,
    treeGroups,
    update,
  };
}
