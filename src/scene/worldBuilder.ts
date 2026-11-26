import * as THREE from 'three';
import { CheckpointRing, SceneId, WorldObstacle } from '../types/simulation';
import {
  getTerrainHeight,
  HOME_PAD_RADIUS,
  sampleValley,
  VALLEY_MOUTH_Z,
  WATER_LEVEL,
  WORLD_SIZE,
} from '../simulation/terrain';

const RING_COLORS: Record<SceneId, { color: number; emissive: number }> = {
  mountain: { color: 0x38bdf8, emissive: 0x0ea5e9 },
  city: { color: 0xf59e0b, emissive: 0xd97706 },
  valley: { color: 0xfb923c, emissive: 0xea580c },
};

interface TrafficCar {
  mesh: THREE.Group;
  axis: 'x' | 'z';
  lanePos: number;
  dir: 1 | -1;
  speed: number;
  limit: number;
}

export interface WorldHandles {
  worldGroup: THREE.Group;
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
  dispose: () => void;
}

/** Disposes a material together with every texture it references (map, emissiveMap, ...). */
function disposeMaterial(mat: THREE.Material): void {
  for (const value of Object.values(mat)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  mat.dispose();
}

function createHelipad(
  padY: number,
  maxAnisotropy: number
): { padGroup: THREE.Group; homeBeacon: THREE.Mesh } {
  const padGroup = new THREE.Group();
  padGroup.position.set(0, padY + 0.03, 0);

  const padBase = new THREE.Mesh(
    new THREE.CylinderGeometry(HOME_PAD_RADIUS, HOME_PAD_RADIUS + 0.5, 0.12, 32),
    new THREE.MeshStandardMaterial({ color: 0x2c323b, roughness: 0.8 })
  );
  padBase.receiveShadow = true;
  padGroup.add(padBase);

  const padCanvas = document.createElement('canvas');
  padCanvas.width = 512;
  padCanvas.height = 512;
  const ctx = padCanvas.getContext('2d')!;
  ctx.fillStyle = '#262b33';
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.arc(256, 256, 215, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 6;
  ctx.setLineDash([20, 14]);
  ctx.beginPath();
  ctx.arc(256, 256, 178, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(168, 138, 38, 236);
  ctx.fillRect(306, 138, 38, 236);
  ctx.fillRect(168, 236, 176, 38);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 34px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', 256, 74);

  const padTex = new THREE.CanvasTexture(padCanvas);
  padTex.colorSpace = THREE.SRGBColorSpace;
  padTex.anisotropy = maxAnisotropy;
  const padSurface = new THREE.Mesh(
    new THREE.CircleGeometry(HOME_PAD_RADIUS - 0.15, 32),
    new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.72 })
  );
  padSurface.rotation.x = -Math.PI / 2;
  padSurface.position.y = 0.065;
  padSurface.receiveShadow = true;
  padGroup.add(padSurface);

  const padLedMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x38bdf8,
    emissiveIntensity: 3.2,
  });
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.22, 8), padLedMat);
    post.position.set(
      Math.cos(ang) * (HOME_PAD_RADIUS - 0.35),
      0.14,
      Math.sin(ang) * (HOME_PAD_RADIUS - 0.35)
    );
    padGroup.add(post);
  }

  const homeBeacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 1.4, 96, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  homeBeacon.position.set(0, padY + 48, 0);
  homeBeacon.visible = false;

  return { padGroup, homeBeacon };
}

/**
 * Generates crisp procedural glass/window facade textures for urban skyscrapers.
 */
function createBuildingFacadeTexture(
  style: 'glass-blue' | 'glass-dark' | 'concrete-warm' | 'landmark',
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const palettes = {
    'glass-blue': { bg: '#25394f', frame: '#162433', winOn: '#a8dcff', winOff: '#365878', litRatio: 0.45 },
    'glass-dark': { bg: '#1e2530', frame: '#11161d', winOn: '#ffdca8', winOff: '#2e3c4f', litRatio: 0.38 },
    'concrete-warm': { bg: '#9ba3ad', frame: '#69727d', winOn: '#ffe5b8', winOff: '#3c4a5c', litRatio: 0.32 },
    landmark: { bg: '#18344c', frame: '#0f2233', winOn: '#7dd3fc', winOff: '#295678', litRatio: 0.62 },
  };
  const pal = palettes[style];

  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, 256, 512);

  // Horizontal floor bands & vertical mullions
  const cols = 8;
  const rows = 20;
  const padX = 5;
  const padY = 6;
  const cellW = 256 / cols;
  const cellH = 512 / rows;

  let seed = style.length * 971;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let r = 0; r < rows; r++) {
    // Structural spandrel beam
    ctx.fillStyle = pal.frame;
    ctx.fillRect(0, r * cellH, 256, 4);

    for (let c = 0; c < cols; c++) {
      const lit = rand() < pal.litRatio;
      ctx.fillStyle = lit ? pal.winOn : pal.winOff;
      ctx.fillRect(c * cellW + padX, r * cellH + padY, cellW - padX * 2, cellH - padY * 1.5);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Generates a tileable 46m x 46m urban city block & avenue intersection texture!
 */
function createCityGroundTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Asphalt avenue background
  ctx.fillStyle = '#2e343d';
  ctx.fillRect(0, 0, 512, 512);

  // Sidewalk & urban block interior (leaves ~16m road perimeter around each 46m block)
  const roadEdge = 86;
  ctx.fillStyle = '#8b939e';
  ctx.fillRect(roadEdge, roadEdge, 512 - roadEdge * 2, 512 - roadEdge * 2);

  // Inner courtyard concrete
  ctx.fillStyle = '#6f7782';
  ctx.fillRect(roadEdge + 14, roadEdge + 14, 512 - (roadEdge + 14) * 2, 512 - (roadEdge + 14) * 2);

  // Yellow double centerlines along road edges (tile borders = avenue centers!)
  ctx.fillStyle = '#eab308';
  ctx.fillRect(0, 0, 512, 4);
  ctx.fillRect(0, 508, 512, 4);
  ctx.fillRect(0, 0, 4, 512);
  ctx.fillRect(508, 0, 4, 512);

  // White dashed lane dividers
  ctx.fillStyle = 'rgba(241, 245, 249, 0.72)';
  for (let i = 96; i < 416; i += 32) {
    ctx.fillRect(i, 42, 16, 3);
    ctx.fillRect(i, 467, 16, 3);
    ctx.fillRect(42, i, 3, 16);
    ctx.fillRect(467, i, 3, 16);
  }

  // Zebra crosswalk stripes at corners
  ctx.fillStyle = 'rgba(248, 250, 252, 0.8)';
  for (let s = 0; s < 5; s++) {
    const offset = 12 + s * 14;
    ctx.fillRect(roadEdge + 6, offset, 18, 7);
    ctx.fillRect(512 - roadEdge - 24, offset, 18, 7);
    ctx.fillRect(offset, roadEdge + 6, 7, 18);
    ctx.fillRect(offset, 512 - roadEdge - 24, 7, 18);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // Repeat so each tile is exactly 46m x 46m centered on each city block!
  const repeats = WORLD_SIZE / 46;
  tex.repeat.set(repeats, repeats);
  tex.offset.set(0.5 - (repeats % 1) * 0.5, 0.5 - (repeats % 1) * 0.5);
  tex.anisotropy = maxAnisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildWorld(
  scene: THREE.Scene,
  sceneId: SceneId,
  obstacles: WorldObstacle[],
  checkpoints: CheckpointRing[],
  maxAnisotropy = 8
): WorldHandles {
  const worldGroup = new THREE.Group();
  scene.add(worldGroup);

  const turbineRotors: Array<{ nacelle: THREE.Group; rotor: THREE.Group }> = [];
  const beaconLights: THREE.MeshStandardMaterial[] = [];
  const treeGroups: THREE.Group[] = [];
  const trafficCars: TrafficCar[] = [];

  // Shared Water Plane (Lake in Mountain, River Canal in City, open sea to the horizon in Valley)
  const isValley = sceneId === 'valley';
  const waterGeom = isValley
    ? new THREE.PlaneGeometry(3200, 2000, 32, 20)
    : new THREE.PlaneGeometry(WORLD_SIZE * 0.96, WORLD_SIZE * 0.96, 24, 24);
  waterGeom.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshStandardMaterial({
    color: sceneId === 'city' ? 0x165373 : isValley ? 0x1fb0bf : 0x1e6c93,
    roughness: isValley ? 0.1 : 0.16,
    metalness: isValley ? 0.3 : 0.48,
    transparent: true,
    opacity: isValley ? 0.86 : 0.9,
  });
  const waterMesh = new THREE.Mesh(waterGeom, waterMat);
  waterMesh.position.y = WATER_LEVEL;
  // Valley sea starts under the coast and stretches north to the horizon
  if (isValley) waterMesh.position.z = -360 - 1000;
  waterMesh.receiveShadow = true;
  worldGroup.add(waterMesh);

  // Shared Helipad + RTH Beacon
  const padY = getTerrainHeight(0, 0, sceneId);
  const { padGroup, homeBeacon } = createHelipad(padY, maxAnisotropy);
  worldGroup.add(padGroup);
  worldGroup.add(homeBeacon);

  if (sceneId === 'mountain') {
    buildMountainWorld(worldGroup, obstacles, turbineRotors, beaconLights, treeGroups);
  } else if (sceneId === 'valley') {
    buildValleyWorld(worldGroup, obstacles, beaconLights);
  } else {
    buildCityWorld(worldGroup, obstacles, beaconLights, treeGroups, trafficCars, maxAnisotropy);
  }

  // Aerial Checkpoint Rings (both scenes)
  const checkpointMeshes = new Map<number, { ring: THREE.Mesh; mat: THREE.MeshStandardMaterial }>();
  for (const cp of checkpoints) {
    const mat = new THREE.MeshStandardMaterial({
      color: RING_COLORS[sceneId].color,
      emissive: RING_COLORS[sceneId].emissive,
      emissiveIntensity: 2.2,
      roughness: 0.25,
      metalness: 0.4,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(cp.radius, 0.28, 12, 36), mat);
    ring.position.set(cp.x, cp.y, cp.z);
    ring.rotation.y = cp.rotationY;
    worldGroup.add(ring);
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
    // Wind turbines (Mountain scene)
    if (turbineRotors.length > 0) {
      const targetNacelleYaw = -(windDirDeg * Math.PI) / 180;
      const rotorRadPerSec = 0.25 + windSpeed * 0.28;
      for (const t of turbineRotors) {
        t.nacelle.rotation.y = THREE.MathUtils.lerp(t.nacelle.rotation.y, targetNacelleYaw, dt * 0.8);
        t.rotor.rotation.z -= rotorRadPerSec * dt;
      }
    }

    // Animated city traffic cars (City scene)
    for (const car of trafficCars) {
      if (car.axis === 'z') {
        car.mesh.position.z += car.dir * car.speed * dt;
        if (car.mesh.position.z > car.limit) car.mesh.position.z = -car.limit;
        if (car.mesh.position.z < -car.limit) car.mesh.position.z = car.limit;
      } else {
        car.mesh.position.x += car.dir * car.speed * dt;
        if (car.mesh.position.x > car.limit) car.mesh.position.x = -car.limit;
        if (car.mesh.position.x < -car.limit) car.mesh.position.x = car.limit;
      }
    }

    // Subtle tree sway in wind
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

    // Aviation warning beacons blink on towers & skyscrapers
    const blink = Math.sin(elapsed * 3.8) > 0.35 ? 8.0 : 0.25;
    for (const m of beaconLights) {
      m.emissiveIntensity = blink;
    }

    // RTH Home Beacon
    homeBeacon.visible = rthActive;
    if (rthActive) {
      const bm = homeBeacon.material as THREE.MeshBasicMaterial;
      bm.opacity = 0.14 + Math.sin(elapsed * 5) * 0.06;
    }

    // Checkpoints
    const baseHex = RING_COLORS[sceneId].color;
    const baseEmissive = RING_COLORS[sceneId].emissive;
    for (const cp of cps) {
      const entry = checkpointMeshes.get(cp.id);
      if (!entry) continue;
      if (cp.cleared) {
        entry.mat.color.setHex(0x22c55e);
        entry.mat.emissive.setHex(0x16a34a);
        entry.mat.emissiveIntensity = 0.5;
        entry.ring.scale.setScalar(0.92);
      } else {
        entry.mat.color.setHex(baseHex);
        entry.mat.emissive.setHex(baseEmissive);
        entry.mat.emissiveIntensity = 2.1 + Math.sin(elapsed * 3 + cp.id) * 0.6;
        entry.ring.scale.setScalar(1.0);
      }
    }

    waterMesh.position.y = WATER_LEVEL + Math.sin(elapsed * 1.1) * 0.04;
  };

  const dispose = () => {
    scene.remove(worldGroup);
    // Collect unique materials first: many meshes share one material, and
    // material.dispose() does NOT free the textures it references.
    const materials = new Set<THREE.Material>();
    worldGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => materials.add(m));
      }
    });
    materials.forEach(disposeMaterial);
  };

  return {
    worldGroup,
    waterMesh,
    turbineRotors,
    checkpointMeshes,
    homeBeacon,
    beaconLights,
    treeGroups,
    update,
    dispose,
  };
}

function buildMountainWorld(
  worldGroup: THREE.Group,
  obstacles: WorldObstacle[],
  turbineRotors: Array<{ nacelle: THREE.Group; rotor: THREE.Group }>,
  beaconLights: THREE.MeshStandardMaterial[],
  treeGroups: THREE.Group[]
): void {
  // Vertex-Colored Mountain Terrain
  const segs = 160;
  const terrainGeom = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
  terrainGeom.rotateX(-Math.PI / 2);

  const posAttr = terrainGeom.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const y = getTerrainHeight(x, z, 'mountain');
    posAttr.setY(i, y);

    const distHome = Math.hypot(x, z);
    if (distHome < HOME_PAD_RADIUS + 2.5) {
      tmpColor.setHex(0x6d747d);
    } else if (y < WATER_LEVEL + 0.6) {
      tmpColor.setHex(0xc8b896);
    } else if (y < 9) {
      const n = (Math.sin(x * 0.08) * Math.cos(z * 0.08) + 1) * 0.5;
      tmpColor.setHex(0x4c7c44).lerp(new THREE.Color(0x3a6638), n);
    } else if (y < 24) {
      const n = (Math.sin(x * 0.05) + 1) * 0.5;
      tmpColor.setHex(0x3d6139).lerp(new THREE.Color(0x5b6948), n);
    } else if (y < 42) {
      tmpColor.setHex(0x6f7378);
    } else {
      tmpColor.setHex(0xd6dee6);
    }

    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  terrainGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeom.computeVertexNormals();

  const terrainMesh = new THREE.Mesh(
    terrainGeom,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02 })
  );
  terrainMesh.receiveShadow = true;
  worldGroup.add(terrainMesh);

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

      worldGroup.add(g);
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

      worldGroup.add(g);
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

      worldGroup.add(g);
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
      worldGroup.add(g);
    } else if (obs.id === 'radio-mast') {
      const g = new THREE.Group();
      g.position.set(obs.x, obs.y, obs.z);

      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 1.8, obs.height, 6),
        new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5 })
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

      worldGroup.add(g);
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
      worldGroup.add(g);
    }
  }
}

function buildCityWorld(
  worldGroup: THREE.Group,
  obstacles: WorldObstacle[],
  beaconLights: THREE.MeshStandardMaterial[],
  treeGroups: THREE.Group[],
  trafficCars: TrafficCar[],
  maxAnisotropy: number
): void {
  // 1. Urban City Ground with Multi-Lane Avenues, Sidewalks & Canal Depression
  const segs = 128;
  const groundGeom = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
  groundGeom.rotateX(-Math.PI / 2);
  const posAttr = groundGeom.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    posAttr.setY(i, getTerrainHeight(x, z, 'city'));
  }
  groundGeom.computeVertexNormals();

  const cityGroundTex = createCityGroundTexture(maxAnisotropy);
  const cityGroundMesh = new THREE.Mesh(
    groundGeom,
    new THREE.MeshStandardMaterial({
      map: cityGroundTex,
      roughness: 0.85,
      metalness: 0.05,
    })
  );
  cityGroundMesh.receiveShadow = true;
  worldGroup.add(cityGroundMesh);

  // 2. Central Launch Plaza Decorative Pavement at (0, 0)
  const plazaSlab = new THREE.Mesh(
    new THREE.BoxGeometry(28, 0.08, 28),
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.78 })
  );
  plazaSlab.position.set(0, 0.01, 0);
  plazaSlab.receiveShadow = true;
  worldGroup.add(plazaSlab);

  // 3. Central City Park Lawn & Fountain at (-46, 46)
  const parkLawn = new THREE.Mesh(
    new THREE.BoxGeometry(30, 0.12, 30),
    new THREE.MeshStandardMaterial({ color: 0x3f7a44, roughness: 0.92 })
  );
  parkLawn.position.set(-46, 0.04, 46);
  parkLawn.receiveShadow = true;
  worldGroup.add(parkLawn);

  const fountainRim = new THREE.Mesh(
    new THREE.CylinderGeometry(4.2, 4.6, 0.8, 20),
    new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.6 })
  );
  fountainRim.position.set(-46, 0.45, 46);
  worldGroup.add(fountainRim);

  const fountainPool = new THREE.Mesh(
    new THREE.CylinderGeometry(3.6, 3.6, 0.65, 20),
    new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.12, metalness: 0.5 })
  );
  fountainPool.position.set(-46, 0.55, 46);
  worldGroup.add(fountainPool);

  // 4. Bridges crossing the East Canal (x = 148)
  const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.75 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.45, metalness: 0.4 });
  for (const bz of [-69, -23, 23, 69]) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(52, 0.9, 14), bridgeMat);
    deck.position.set(148, 0.35, bz);
    deck.castShadow = true;
    deck.receiveShadow = true;
    worldGroup.add(deck);

    for (const side of [-6.6, 6.6]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(52, 1.1, 0.4), railMat);
      rail.position.set(148, 1.2, bz + side);
      worldGroup.add(rail);
    }
  }

  // 5. Skyscrapers, Towers, Rooftops & Park Trees
  const facadeTextures = [
    createBuildingFacadeTexture('glass-blue', maxAnisotropy),
    createBuildingFacadeTexture('glass-dark', maxAnisotropy),
    createBuildingFacadeTexture('concrete-warm', maxAnisotropy),
  ];
  const landmarkTex = createBuildingFacadeTexture('landmark', maxAnisotropy);

  const roofMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.82 });
  const hvacMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.6, metalness: 0.3 });
  const spireMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3, metalness: 0.7 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f7038, roughness: 0.85 });

  let styleIdx = 0;

  for (const obs of obstacles) {
    if (obs.id.startsWith('city-tree-')) {
      const g = new THREE.Group();
      g.position.set(obs.x, obs.y, obs.z);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, obs.height * 0.42, 7), woodMat);
      trunk.position.y = obs.height * 0.21;
      trunk.castShadow = true;
      g.add(trunk);

      const canopy = new THREE.Mesh(new THREE.DodecahedronGeometry(obs.width * 0.62, 1), leafMat);
      canopy.position.y = obs.height * 0.65;
      canopy.castShadow = true;
      g.add(canopy);

      treeGroups.push(g);
      worldGroup.add(g);
      continue;
    }

    if (obs.id === 'city-cyl-tower') {
      const g = new THREE.Group();
      g.position.set(obs.x, obs.y, obs.z);

      const tex = facadeTextures[0].clone();
      tex.needsUpdate = true;
      tex.repeat.set(4, Math.max(1, Math.round(obs.height / 24)));

      const cylMat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.22,
        metalness: 0.55,
      });
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(obs.width * 0.5, obs.width * 0.5, obs.height, 28),
        [cylMat, roofMat, roofMat]
      );
      cyl.position.y = obs.height * 0.5;
      cyl.castShadow = true;
      cyl.receiveShadow = true;
      g.add(cyl);

      // Crown neon ring
      const crownMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x38bdf8,
        emissiveIntensity: 3.0,
      });
      const crown = new THREE.Mesh(new THREE.TorusGeometry(obs.width * 0.49, 0.28, 8, 32), crownMat);
      crown.rotation.x = Math.PI / 2;
      crown.position.y = obs.height - 0.4;
      g.add(crown);

      // Aviation beacon
      const lightMat = new THREE.MeshStandardMaterial({
        color: 0xff2a2a,
        emissive: 0xff2a2a,
        emissiveIntensity: 2.8,
      });
      beaconLights.push(lightMat);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 10), lightMat);
      beacon.position.y = obs.height + 1.2;
      g.add(beacon);

      worldGroup.add(g);
      continue;
    }

    // Rectangular skyscraper / landmark tower
    const isLandmark = obs.id === 'city-landmark-tower';
    const baseTex = isLandmark ? landmarkTex : facadeTextures[styleIdx++ % facadeTextures.length];
    const tex = baseTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.max(1, Math.round(obs.width / 14)), Math.max(1, Math.round(obs.height / 22)));

    const sideMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: isLandmark ? 0.18 : 0.32,
      metalness: isLandmark ? 0.62 : 0.38,
    });

    const g = new THREE.Group();
    g.position.set(obs.x, obs.y, obs.z);

    // Box with facade on 4 vertical walls & flat dark roof on top
    const bldg = new THREE.Mesh(
      new THREE.BoxGeometry(obs.width, obs.height, obs.depth),
      [sideMat, sideMat, roofMat, roofMat, sideMat, sideMat]
    );
    bldg.position.y = obs.height * 0.5;
    bldg.castShadow = true;
    bldg.receiveShadow = true;
    g.add(bldg);

    // Rooftop parapet trim
    const parapet = new THREE.Mesh(
      new THREE.BoxGeometry(obs.width + 0.4, 0.65, obs.depth + 0.4),
      hvacMat
    );
    parapet.position.y = obs.height + 0.15;
    g.add(parapet);

    // Rooftop mechanical HVAC penthouse (offset so flat roof landing space remains clear!)
    const hvac = new THREE.Mesh(
      new THREE.BoxGeometry(obs.width * 0.34, 2.2, obs.depth * 0.34),
      hvacMat
    );
    hvac.position.set(obs.width * 0.22, obs.height + 1.1, obs.depth * 0.22);
    hvac.castShadow = true;
    g.add(hvac);

    // Tall skyscrapers get an architectural spire + blinking red aviation obstruction light
    if (isLandmark || obs.height >= 54) {
      const spireH = isLandmark ? 18 : 8;
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.42, spireH, 8), spireMat);
      spire.position.set(-obs.width * 0.22, obs.height + spireH * 0.5, -obs.depth * 0.22);
      g.add(spire);

      const lightMat = new THREE.MeshStandardMaterial({
        color: 0xff2222,
        emissive: 0xff2222,
        emissiveIntensity: 3.0,
      });
      beaconLights.push(lightMat);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 10), lightMat);
      bulb.position.set(-obs.width * 0.22, obs.height + spireH + 0.35, -obs.depth * 0.22);
      g.add(bulb);
    }

    if (isLandmark) {
      // Glowing cyan sky-trim on the iconic landmark tower
      const trimMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0ea5e9,
        emissiveIntensity: 3.0,
      });
      const topTrim = new THREE.Mesh(new THREE.BoxGeometry(obs.width + 0.6, 0.55, obs.depth + 0.6), trimMat);
      topTrim.position.y = obs.height - 0.3;
      g.add(topTrim);
    }

    worldGroup.add(g);
  }

  // 6. Avenue Street Lamps around the Downtown Core
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5, metalness: 0.6 });
  const lampGlowMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: 0xfde047,
    emissiveIntensity: 2.0,
  });
  for (const lane of [-23, 23]) {
    for (let pos = -115; pos <= 115; pos += 26) {
      // Along N-S avenues
      const lampNS = new THREE.Group();
      lampNS.position.set(lane + 6.5, 0, pos);
      const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 6.2, 6), poleMat);
      p1.position.y = 3.1;
      lampNS.add(p1);
      const b1 = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), lampGlowMat);
      b1.position.set(-0.6, 6.2, 0);
      lampNS.add(b1);
      worldGroup.add(lampNS);
    }
  }

  // 7. Animated City Traffic Cars moving smoothly along main avenues!
  const carColors = [0xe11d48, 0x2563eb, 0xf8fafc, 0xf59e0b, 0x10b981, 0x64748b, 0x1e293b];
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfef9c3, emissiveIntensity: 2.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xef4444, emissiveIntensity: 4.5 });
  const cabinGlassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.15, metalness: 0.8 });

  const makeCar = (colorHex: number): THREE.Group => {
    const cg = new THREE.Group();
    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.72, 4.1),
      new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.35, metalness: 0.45 })
    );
    chassis.position.y = 0.52;
    chassis.castShadow = true;
    cg.add(chassis);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.56, 2.0), cabinGlassMat);
    cabin.position.set(0, 1.08, -0.15);
    cg.add(cabin);

    const hl = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 0.12), headMat);
    hl.position.set(0, 0.58, 2.06);
    cg.add(hl);

    const tl = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 0.12), tailMat);
    tl.position.set(0, 0.58, -2.06);
    cg.add(tl);

    return cg;
  };

  const avenueCenters = [-69, -23, 23, 69];
  let carIdx = 0;
  for (const ave of avenueCenters) {
    for (const dir of [1, -1] as const) {
      // North-South cars
      for (let k = 0; k < 2; k++) {
        const carMesh = makeCar(carColors[carIdx++ % carColors.length]);
        const laneOffset = dir === 1 ? -3.1 : 3.1;
        carMesh.position.set(ave + laneOffset, 0, -140 + k * 145 + (carIdx * 19) % 45);
        carMesh.rotation.y = dir === 1 ? 0 : Math.PI;
        worldGroup.add(carMesh);
        trafficCars.push({
          mesh: carMesh,
          axis: 'z',
          lanePos: ave + laneOffset,
          dir,
          speed: 9 + (carIdx % 5) * 1.8,
          limit: 190,
        });
      }

      // East-West cars
      const carEW = makeCar(carColors[carIdx++ % carColors.length]);
      const laneOffsetEW = dir === 1 ? 3.1 : -3.1;
      carEW.position.set(-140 + (carIdx * 37) % 260, 0, ave + laneOffsetEW);
      carEW.rotation.y = dir === 1 ? Math.PI * 0.5 : -Math.PI * 0.5;
      worldGroup.add(carEW);
      trafficCars.push({
        mesh: carEW,
        axis: 'x',
        lanePos: ave + laneOffsetEW,
        dir,
        speed: 8.5 + (carIdx % 4) * 2.1,
        limit: 190,
      });
    }
  }
}

/**
 * Kaputaş-style gorge: limestone walls with strata, scrubby plateau, gravel floor,
 * pebble cove, coast-road bridge and instanced red-pine woods.
 */
function buildValleyWorld(
  worldGroup: THREE.Group,
  obstacles: WorldObstacle[],
  beaconLights: THREE.MeshStandardMaterial[]
): void {
  // Terrain mesh: wider than the flight corridor so the rims and hills fill the view
  const sizeX = 860;
  const sizeZ = 980;
  const centerZ = -110;
  const cell = 3.4;
  const terrainGeom = new THREE.PlaneGeometry(sizeX, sizeZ, Math.round(sizeX / cell), Math.round(sizeZ / cell));
  terrainGeom.rotateX(-Math.PI / 2);
  terrainGeom.translate(0, 0, centerZ);

  const posAttr = terrainGeom.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);
  const c = new THREE.Color();
  const rockLight = new THREE.Color(0xd2c3a6);
  const rockDark = new THREE.Color(0xa38c70);
  const rockRed = new THREE.Color(0xb87a58);
  const scrub = new THREE.Color(0x5a7236);
  const scrubDry = new THREE.Color(0x8c8a56);
  const gravel = new THREE.Color(0xbdb3a0);
  const sand = new THREE.Color(0xe4d6b4);
  const seabed = new THREE.Color(0xd8d0b0);
  const padStone = new THREE.Color(0x8a8f96);

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const y = getTerrainHeight(x, z, 'valley');
    posAttr.setY(i, y);

    const slope =
      Math.hypot(
        getTerrainHeight(x + 1.2, z, 'valley') - getTerrainHeight(x - 1.2, z, 'valley'),
        getTerrainHeight(x, z + 1.2, 'valley') - getTerrainHeight(x, z - 1.2, 'valley')
      ) / 2.4;
    const v = sampleValley(x, z);
    const noise = (Math.sin(x * 0.11 + z * 0.07) * Math.cos(z * 0.13 - x * 0.05) + 1) * 0.5;

    if (Math.hypot(x, z) < HOME_PAD_RADIUS + 2.5) {
      c.copy(padStone);
    } else if (y < WATER_LEVEL - 0.2) {
      c.copy(seabed).lerp(rockDark, Math.min(1, slope * 0.6));
    } else if (y < 2.4 && z < VALLEY_MOUTH_Z + 25) {
      c.copy(sand).lerp(gravel, noise * 0.35);
    } else if (slope > 0.85) {
      // Limestone walls with horizontal strata and rusty iron streaks
      const strata = (Math.sin(y * 0.55) + Math.sin(y * 1.7 + x * 0.02) * 0.4 + 1.4) / 2.8;
      c.copy(rockLight).lerp(rockDark, strata * 0.75);
      c.lerp(rockRed, Math.max(0, Math.sin(x * 0.09 + z * 0.05) - 0.55) * 0.9);
    } else if (v.dist < v.floorHalf + 3) {
      // Gorge floor: dry gravel creek bed with green patches
      c.copy(gravel).lerp(scrub, smoothNoise(x, z) * 0.55);
    } else {
      c.copy(scrub).lerp(scrubDry, noise * 0.7);
      // Rocky outcrops showing through on moderate slopes
      c.lerp(rockLight, Math.min(1, Math.max(0, (slope - 0.45) / 0.4)) * 0.8);
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  terrainGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeom.computeVertexNormals();
  const terrainMesh = new THREE.Mesh(
    terrainGeom,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0.0 })
  );
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;
  worldGroup.add(terrainMesh);

  const concreteMat = new THREE.MeshStandardMaterial({ color: 0xd9d4ca, roughness: 0.82 });
  const asphaltMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.9 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.5, metalness: 0.4 });
  const boulderMat = new THREE.MeshStandardMaterial({ color: 0xc4b59a, roughness: 0.95, flatShading: true });

  // Instanced red-pine woods: trunk + two foliage tiers, per-tree tint
  const trees = obstacles.filter((o) => o.id.startsWith('tree-'));
  const trunkMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.22, 0.38, 1, 6),
    new THREE.MeshStandardMaterial({ color: 0x6b4a35, roughness: 0.9 }),
    trees.length
  );
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, flatShading: true });
  const crownLow = new THREE.InstancedMesh(crownGeo, crownMat, trees.length);
  const crownTop = new THREE.InstancedMesh(crownGeo, crownMat, trees.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const tint = new THREE.Color();
  trees.forEach((t, i) => {
    const r = t.width * 0.5;
    const trunkH = t.height * 0.55;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (t.x * 13.1 + t.z * 7.7) % (Math.PI * 2));
    m.compose(pos.set(t.x, t.y + trunkH * 0.5, t.z), q, sc.set(1, trunkH, 1));
    trunkMesh.setMatrixAt(i, m);
    // Umbrella-like Mediterranean pine crown: broad flat lower mass, smaller cap on top
    m.compose(pos.set(t.x, t.y + t.height * 0.68, t.z), q, sc.set(r * 1.15, t.height * 0.2, r * 1.15));
    crownLow.setMatrixAt(i, m);
    m.compose(pos.set(t.x + r * 0.2, t.y + t.height * 0.86, t.z - r * 0.15), q, sc.set(r * 0.75, t.height * 0.13, r * 0.75));
    crownTop.setMatrixAt(i, m);
    const k = ((Math.sin(t.x * 1.7) + Math.cos(t.z * 2.3)) * 0.25 + 0.5);
    tint.setHex(0x2f5a2a).lerp(new THREE.Color(0x4d6e2f), k);
    crownLow.setColorAt(i, tint);
    crownTop.setColorAt(i, tint.multiplyScalar(1.12));
  });
  for (const im of [trunkMesh, crownLow, crownTop]) {
    im.castShadow = true;
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    worldGroup.add(im);
  }

  // Low macchia shrubs (visual only) on the plateau and gorge floor
  let seed = 7331;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const shrubPositions: THREE.Vector3[] = [];
  for (let i = 0; i < 900 && shrubPositions.length < 520; i++) {
    const x = (rand() - 0.5) * 520;
    const z = 120 - rand() * 560;
    const y = getTerrainHeight(x, z, 'valley');
    if (y < 1.2 || Math.hypot(x, z) < 14) continue;
    const sl = Math.abs(getTerrainHeight(x + 1, z, 'valley') - y) + Math.abs(getTerrainHeight(x, z + 1, 'valley') - y);
    if (sl > 0.7) continue;
    shrubPositions.push(new THREE.Vector3(x, y, z));
  }
  const shrubs = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }),
    shrubPositions.length
  );
  shrubPositions.forEach((p, i) => {
    const s = 0.6 + rand() * 0.9;
    m.compose(pos.set(p.x, p.y + s * 0.3, p.z), q.identity(), sc.set(s * 1.3, s * 0.7, s * 1.2));
    shrubs.setMatrixAt(i, m);
    shrubs.setColorAt(i, tint.setHex(0x4f6a2e).lerp(new THREE.Color(0x7c7d45), rand()));
  });
  shrubs.receiveShadow = true;
  shrubs.instanceMatrix.needsUpdate = true;
  if (shrubs.instanceColor) shrubs.instanceColor.needsUpdate = true;
  worldGroup.add(shrubs);

  for (const obs of obstacles) {
    if (obs.id === 'valley-bridge') {
      const g = new THREE.Group();
      g.position.set(obs.x, obs.y, obs.z);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(obs.width, obs.height, obs.depth), concreteMat);
      deck.position.y = obs.height * 0.5;
      deck.castShadow = true;
      deck.receiveShadow = true;
      g.add(deck);
      const road = new THREE.Mesh(new THREE.BoxGeometry(obs.width, 0.08, obs.depth - 1.6), asphaltMat);
      road.position.y = obs.height + 0.04;
      g.add(road);
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(obs.width, 0.9, 0.18), railMat);
        rail.position.set(0, obs.height + 0.45, side * (obs.depth * 0.5 - 0.15));
        rail.castShadow = true;
        g.add(rail);
      }
      // Red/white warning lights at mid-span (aviation marker for low flights)
      const lightMat = new THREE.MeshStandardMaterial({ color: 0xff2d2d, emissive: 0xff2d2d, emissiveIntensity: 2.5 });
      beaconLights.push(lightMat);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), lightMat);
      bulb.position.set(0, -0.2, -obs.depth * 0.5);
      g.add(bulb);
      worldGroup.add(g);
    } else if (obs.id.startsWith('bridge-pier-')) {
      const pier = new THREE.Mesh(new THREE.CylinderGeometry(obs.width * 0.45, obs.width * 0.55, obs.height, 14), concreteMat);
      pier.position.set(obs.x, obs.y + obs.height * 0.5, obs.z);
      pier.castShadow = true;
      pier.receiveShadow = true;
      worldGroup.add(pier);
    } else if (obs.id.startsWith('boulder-')) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), boulderMat);
      rock.position.set(obs.x, obs.y + obs.height * 0.45, obs.z);
      rock.scale.set(obs.width, obs.height, obs.depth * 0.9);
      rock.rotation.set(obs.x % 1, obs.z % 3, 0);
      rock.castShadow = true;
      rock.receiveShadow = true;
      worldGroup.add(rock);
    } else if (obs.id.startsWith('umbrella-')) {
      const g = new THREE.Group();
      g.position.set(obs.x, obs.y, obs.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, obs.height, 6), railMat);
      pole.position.y = obs.height * 0.5;
      g.add(pole);
      const canopyMat = new THREE.MeshStandardMaterial({
        color: Math.abs(Math.round(obs.x * 7)) % 2 === 0 ? 0xf97316 : 0x0ea5e9,
        roughness: 0.7,
        side: THREE.DoubleSide,
      });
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(obs.width * 0.5, 0.6, 10, 1, true), canopyMat);
      canopy.position.y = obs.height - 0.2;
      canopy.castShadow = true;
      g.add(canopy);
      worldGroup.add(g);
    }
  }
}

/** Cheap smooth value noise in [0, 1] for colour variation. */
function smoothNoise(x: number, z: number): number {
  return (
    (Math.sin(x * 0.09 + Math.cos(z * 0.05) * 2) * Math.cos(z * 0.08 + Math.sin(x * 0.04) * 2) + 1) * 0.5
  );
}
