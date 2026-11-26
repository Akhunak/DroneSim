import { CheckpointRing, SceneId, WorldObstacle } from '../types/simulation';

export const WORLD_SIZE = 760;
export const WATER_LEVEL = -1.6;
export const HOME_PAD_RADIUS = 7.5;

let activeSceneId: SceneId = 'mountain';

// Mountain scene structure placements (shared by the heightmap's build sites and the obstacles)
const WATCH_TOWER = { x: -32, z: -26 };
const MOUNTAIN_CABINS = [
  { id: 'cabin-1', x: 34, z: 24, w: 9, h: 6, d: 8 },
  { id: 'cabin-2', x: 48, z: 16, w: 8, h: 5.5, d: 7 },
  { id: 'cabin-3', x: -58, z: -52, w: 12, h: 8, d: 10 },
];
const MOUNTAIN_TURBINES = [
  { id: 'turbine-1', x: -85, z: -10 },
  { id: 'turbine-2', x: -102, z: -55 },
  { id: 'turbine-3', x: -75, z: -98 },
  { id: 'turbine-4', x: -115, z: 45 },
];

/**
 * Ground level for structure foundations. Where the rolling hills dip below the lake surface,
 * each structure gets a small raised island / headland at this level so nothing stands in water.
 */
const SITE_LEVEL = WATER_LEVEL + 1.4;
const MOUNTAIN_BUILD_SITES: Array<{ x: number; z: number; flat: number; blend: number }> = [
  { x: WATCH_TOWER.x, z: WATCH_TOWER.z, flat: 8, blend: 20 },
  ...MOUNTAIN_CABINS.map((c) => {
    const flat = Math.hypot(c.w, c.d) * 0.5 + 2;
    return { x: c.x, z: c.z, flat, blend: flat + 12 };
  }),
  ...MOUNTAIN_TURBINES.map((t) => ({ x: t.x, z: t.z, flat: 6, blend: 17 })),
];

// ---------------------------------------------------------------------------
// Valley (Vadi) scene: a long, deep limestone gorge in the style of Kaputaş (Antalya).
// The launch pad sits on the plateau at the rounded head of the gorge; the gorge runs
// North (-Z) for ~400 m, gently meandering, and opens onto a pebble cove and a turquoise sea.
// ---------------------------------------------------------------------------
/** Rounded head of the gorge, just north of the launch pad. */
const VALLEY_HEAD_Z = -58;
/** Where the gorge floor reaches the beach. */
export const VALLEY_MOUTH_Z = -430;
/** Average shoreline (the cove pushes it slightly inland at the gorge mouth). */
const VALLEY_COAST_Z = -468;
const VALLEY_RIM = 46;
const VALLEY_HEAD_FLOOR = 10;
const VALLEY_MOUTH_FLOOR = 0.5;
const VALLEY_SEABED = -16;
/** Kaputaş-style coast-road bridge spanning the gorge mouth. */
export const VALLEY_BRIDGE = { z: -404, deckBottom: 22, thickness: 2.2, width: 9 };

/** Flight-area rectangle for the valley (the sea beyond the cove stays flyable). */
const VALLEY_BOUNDS = { minX: -230, maxX: 230, minZ: -620, maxZ: 120 };

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Centre line of the gorge (gentle S-shaped meander, straight at the head). */
export function valleyAxisX(z: number): number {
  const t = Math.max(0, VALLEY_HEAD_Z - z);
  return Math.sin(t * 0.0125) * 24 * Math.min(1, t / 70);
}

/** Slope of the gorge centre line, dx/dz (for orienting rings and the bridge). */
function valleyAxisSlope(z: number): number {
  return (valleyAxisX(z + 0.5) - valleyAxisX(z - 0.5)) / 1;
}

export interface ValleySample {
  /** Height of the terrain (before the coastline is applied). */
  height: number;
  /** Lateral distance from the gorge centre line (rounded around the head). */
  dist: number;
  floorHalf: number;
  cliffTop: number;
  /** 0 at the head of the gorge -> 1 at the mouth. */
  progress: number;
  floorY: number;
}

function valleyPlateau(x: number, z: number): number {
  return (
    VALLEY_RIM +
    Math.sin(x * 0.021 + 0.6) * Math.cos(z * 0.017) * 3.2 +
    Math.sin(x * 0.05) * Math.sin(z * 0.043) * 1.6
  );
}

/** Gorge cross-section: gravel floor, scree talus, sheer limestone walls, rounded rim, plateau. */
export function sampleValley(x: number, z: number): ValleySample {
  const progress = Math.max(0, Math.min(1, (VALLEY_HEAD_Z - z) / (VALLEY_HEAD_Z - VALLEY_MOUTH_Z)));
  const dx = x - valleyAxisX(z);
  const dz = Math.max(0, z - VALLEY_HEAD_Z);
  let dist = Math.hypot(dx, dz);
  // Irregular walls: buttresses and small bays along each side
  dist += Math.sin(z * 0.047 + (dx > 0 ? 1.7 : 0)) * 4.5 + Math.sin(z * 0.13 + x * 0.03) * 2.0;
  dist = Math.max(0, dist);

  const floorHalf = 15 + 17 * progress;
  const cliffTop = floorHalf + 26 + 8 * progress;
  const floorY =
    VALLEY_HEAD_FLOOR + (VALLEY_MOUTH_FLOOR - VALLEY_HEAD_FLOOR) * progress +
    Math.sin(z * 0.07) * Math.sin(x * 0.09) * 0.35;
  const plateau = valleyPlateau(x, z);

  let height: number;
  if (dist <= floorHalf) {
    height = floorY + (dist / floorHalf) ** 2 * 2.0;
  } else if (dist <= cliffTop) {
    const u = (dist - floorHalf) / (cliffTop - floorHalf);
    const wall = smoothstep(0.12, 0.92, u);
    const base = floorY + 2.0;
    height = base + (plateau - base) * wall;
    // Horizontal limestone ledges on the mid-wall
    height += Math.sin(height * 0.9) * 0.6 * wall * (1 - wall) * 4;
  } else {
    // Plateau rising gently into hills away from the gorge
    height = plateau + Math.min(22, Math.max(0, dist - cliffTop - 40) * 0.09);
  }
  return { height, dist, floorHalf, cliffTop, progress, floorY };
}

/** Shoreline z at a given x (more negative = further out to sea). */
function valleyShoreZ(x: number): number {
  const coast = VALLEY_COAST_Z + Math.sin(x * 0.017 + 0.8) * 16 + Math.sin(x * 0.043) * 6;
  const coveX = x - valleyAxisX(VALLEY_MOUTH_Z);
  const cove = Math.exp(-(coveX * coveX) / (2 * 45 * 45)) * 14;
  return coast + cove;
}

function getValleyHeight(x: number, z: number): number {
  let h = sampleValley(x, z).height;

  // Coastline: land drops into the sea as steep sea cliffs (pebble beach in the cove)
  const seaward = valleyShoreZ(x) - z;
  if (seaward > -6) {
    const k = smoothstep(-6, 40, seaward);
    h += (VALLEY_SEABED - h) * k;
  }

  // Flat launch pad on the plateau at the head of the gorge
  const distHome = Math.hypot(x, z);
  if (distHome < 15) {
    const padH = valleyPlateau(0, 0);
    h = padH + (h - padH) * smoothstep(9, 15, distHome);
  }
  return h;
}

/** RTH climb height above home for each scene (clears the tallest obstacles). */
export function getRthAltitude(sceneId: SceneId = activeSceneId): number {
  if (sceneId === 'city') return 102;
  if (sceneId === 'valley') return 30;
  return 36;
}

/** Keeps the drone inside the scene's flight area (soft geofence). */
export function clampToFlightArea(p: { x: number; z: number }, sceneId: SceneId = activeSceneId): void {
  if (sceneId === 'valley') {
    p.x = Math.max(VALLEY_BOUNDS.minX, Math.min(VALLEY_BOUNDS.maxX, p.x));
    p.z = Math.max(VALLEY_BOUNDS.minZ, Math.min(VALLEY_BOUNDS.maxZ, p.z));
    return;
  }
  const maxRadius = 310;
  const dist = Math.hypot(p.x, p.z);
  if (dist > maxRadius) {
    p.x = (p.x / dist) * maxRadius;
    p.z = (p.z / dist) * maxRadius;
  }
}

export function setActiveScene(sceneId: SceneId): void {
  activeSceneId = sceneId;
}

export function getActiveScene(): SceneId {
  return activeSceneId;
}

/**
 * Deterministic terrain heightmap for the active scene.
 * - mountain: Coastal highland valley with flat helipad plateau, lake basin, rolling hills & alpine ridges.
 * - city: Level modern urban ground plane (y = 0) with a scenic waterfront river canal along the East edge.
 * - valley: Kaputaş-style limestone gorge running North from a cliff-top pad to a turquoise cove.
 */
export function getTerrainHeight(x: number, z: number, sceneId: SceneId = activeSceneId): number {
  if (sceneId === 'valley') {
    return getValleyHeight(x, z);
  }
  if (sceneId === 'city') {
    // Urban canal running North-South near x = 148
    const canalDist = Math.abs(x - 148);
    if (canalDist < 24) {
      const t = Math.cos((canalDist / 24) * Math.PI * 0.5);
      return -t * t * 4.5;
    }
    return 0;
  }

  const distFromHome = Math.hypot(x, z);

  // Smooth multi-octave hills
  let h =
    Math.sin(x * 0.014) * Math.cos(z * 0.013) * 14.0 +
    Math.sin(x * 0.031 + 1.2) * Math.sin(z * 0.027 - 0.5) * 6.5 +
    Math.cos((x + z) * 0.019) * 5.2 +
    Math.sin(x * 0.065) * Math.cos(z * 0.062) * 1.4;

  // Lake basin centered around (95, -55)
  const lakeDist = Math.hypot((x - 95) * 0.85, (z + 55) * 1.05);
  if (lakeDist < 95) {
    const lakeFactor = Math.cos((lakeDist / 95) * Math.PI * 0.5);
    h -= lakeFactor * lakeFactor * 14.5;
  }

  // Mountain ridges far from center
  const rimDist = Math.max(0, distFromHome - 170);
  h += Math.pow(rimDist / 120, 1.85) * 32;

  // Flatten launchpad plateau cleanly around Home (0, 0)
  const padFlatRadius = 18;
  const padBlendRadius = 46;
  if (distFromHome < padBlendRadius) {
    const t = Math.max(
      0,
      Math.min(1, (distFromHome - padFlatRadius) / (padBlendRadius - padFlatRadius))
    );
    const smoothT = t * t * (3 - 2 * t);
    h = h * smoothT;
  }

  // Raise submerged structure footprints to dry land (only ever lifts, never lowers terrain)
  if (h < SITE_LEVEL) {
    for (const site of MOUNTAIN_BUILD_SITES) {
      const d = Math.hypot(x - site.x, z - site.z);
      if (d >= site.blend) continue;
      const t = Math.max(0, (d - site.flat) / (site.blend - site.flat));
      const smoothT = t * t * (3 - 2 * t);
      h = Math.max(h, SITE_LEVEL + (h - SITE_LEVEL) * smoothT);
    }
  }

  return h;
}

/**
 * Returns the effective ground/water surface elevation at (x, z).
 */
export function getGroundOrWaterHeight(
  x: number,
  z: number,
  sceneId: SceneId = activeSceneId
): number {
  return Math.max(getTerrainHeight(x, z, sceneId), WATER_LEVEL);
}

/**
 * Static collidable structures and landmarks shared by Three.js world builder and Physics engine.
 */
export function createWorldObstacles(sceneId: SceneId = activeSceneId): WorldObstacle[] {
  if (sceneId === 'city') {
    return createCityObstacles();
  }
  if (sceneId === 'valley') {
    return createValleyObstacles();
  }
  return createMountainObstacles();
}

function createValleyObstacles(): WorldObstacle[] {
  const obstacles: WorldObstacle[] = [];
  let seed = 6151;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const slopeAt = (x: number, z: number) =>
    Math.hypot(
      getValleyHeight(x + 1, z) - getValleyHeight(x - 1, z),
      getValleyHeight(x, z + 1) - getValleyHeight(x, z - 1)
    ) * 0.5;

  // Coast-road bridge across the gorge mouth: deck spans wall to wall, two slender piers
  const bz = VALLEY_BRIDGE.z;
  const bAxis = valleyAxisX(bz);
  const deckTop = VALLEY_BRIDGE.deckBottom + VALLEY_BRIDGE.thickness;
  const findWall = (dir: 1 | -1) => {
    let off = 0;
    while (off < 160 && getValleyHeight(bAxis + dir * off, bz) < deckTop + 1.5) off += 1;
    return bAxis + dir * (off + 5);
  };
  const leftX = findWall(-1);
  const rightX = findWall(1);
  obstacles.push({
    id: 'valley-bridge',
    type: 'box',
    x: (leftX + rightX) / 2,
    y: VALLEY_BRIDGE.deckBottom,
    z: bz,
    width: rightX - leftX,
    height: VALLEY_BRIDGE.thickness,
    depth: VALLEY_BRIDGE.width,
  });
  for (const side of [-1, 1]) {
    const px = bAxis + side * 19;
    const py = getValleyHeight(px, bz);
    obstacles.push({
      id: `bridge-pier-${side < 0 ? 'w' : 'e'}`,
      type: 'cylinder',
      x: px,
      y: py,
      z: bz,
      width: 3.2,
      height: VALLEY_BRIDGE.deckBottom - py,
      depth: 3.2,
    });
  }

  // Boulders scattered on the gorge floor
  for (let i = 0; i < 34; i++) {
    const z = VALLEY_HEAD_Z - 25 - rand() * (VALLEY_HEAD_Z - VALLEY_MOUTH_Z - 10);
    const v = sampleValley(valleyAxisX(z), z);
    const x = valleyAxisX(z) + (rand() * 2 - 1) * v.floorHalf * 0.85;
    const w = 1.6 + rand() * 2.8;
    obstacles.push({
      id: `boulder-${i}`,
      type: 'cylinder',
      x,
      y: getValleyHeight(x, z) - 0.3,
      z,
      width: w,
      height: w * (0.55 + rand() * 0.35),
      depth: w,
    });
  }

  // Beach umbrellas in the cove
  const shoreAtAxis = valleyShoreZ(valleyAxisX(VALLEY_MOUTH_Z));
  for (let i = 0; i < 9; i++) {
    const z = VALLEY_MOUTH_Z - 4 - rand() * (VALLEY_MOUTH_Z - shoreAtAxis - 10);
    const x = valleyAxisX(z) + (rand() * 2 - 1) * 24;
    const y = getValleyHeight(x, z);
    if (y < WATER_LEVEL + 0.6) continue;
    obstacles.push({ id: `umbrella-${i}`, type: 'cylinder', x, y, z, width: 2.6, height: 2.5, depth: 2.6 });
  }

  // Pine woods: clusters on the gorge floor and along both rims
  const clusters: Array<{ x: number; z: number; r: number; n: number }> = [];
  for (const p of [0.1, 0.22, 0.35, 0.48, 0.61, 0.74, 0.86]) {
    const z = VALLEY_HEAD_Z - p * (VALLEY_HEAD_Z - VALLEY_MOUTH_Z);
    const v = sampleValley(valleyAxisX(z), z);
    const side = rand() < 0.5 ? -1 : 1;
    clusters.push({ x: valleyAxisX(z) + side * v.floorHalf * (0.2 + rand() * 0.4), z, r: 9 + rand() * 6, n: 10 + Math.floor(rand() * 8) });
  }
  for (const p of [-0.15, 0.05, 0.2, 0.38, 0.55, 0.72, 0.9]) {
    const z = VALLEY_HEAD_Z - p * (VALLEY_HEAD_Z - VALLEY_MOUTH_Z);
    const v = sampleValley(valleyAxisX(z), z);
    for (const side of [-1, 1]) {
      const off = v.cliffTop + 14 + rand() * 55;
      clusters.push({ x: valleyAxisX(z) + side * off, z: z + (rand() - 0.5) * 30, r: 16 + rand() * 12, n: 14 + Math.floor(rand() * 10) });
    }
  }

  let treeIdx = 0;
  for (const c of clusters) {
    for (let i = 0; i < c.n; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * c.r;
      const tx = c.x + Math.cos(a) * r;
      const tz = c.z + Math.sin(a) * r;
      const ty = getValleyHeight(tx, tz);
      if (ty < WATER_LEVEL + 1.5) continue;
      if (Math.hypot(tx, tz) < 16) continue; // keep the launch pad clear
      if (slopeAt(tx, tz) > 0.55) continue; // no trees on the sheer walls
      const tooClose = obstacles.some((o) => Math.hypot(o.x - tx, o.z - tz) < o.width * 0.5 + 2.2);
      if (tooClose) continue;
      const treeH = 6.5 + rand() * 6.5;
      obstacles.push({
        id: `tree-v${treeIdx++}`,
        type: 'cylinder',
        x: tx,
        y: ty,
        z: tz,
        width: 2.6 + rand() * 1.6,
        height: treeH,
        depth: 3,
      });
    }
  }

  return obstacles;
}

function createMountainObstacles(): WorldObstacle[] {
  const obstacles: WorldObstacle[] = [];

  // Control / Observation Tower near launchpad
  obstacles.push({
    id: 'watch-tower',
    type: 'cylinder',
    x: WATCH_TOWER.x,
    y: getTerrainHeight(WATCH_TOWER.x, WATCH_TOWER.z, 'mountain'),
    z: WATCH_TOWER.z,
    width: 6.2,
    height: 22,
    depth: 6.2,
  });

  // Modern Hangar / Research Station
  const hangarX = -26;
  const hangarZ = 22;
  obstacles.push({
    id: 'hangar',
    type: 'box',
    x: hangarX,
    y: getTerrainHeight(hangarX, hangarZ, 'mountain'),
    z: hangarZ,
    width: 18,
    height: 7.5,
    depth: 12,
  });

  // Coastal villas / cabins
  for (const c of MOUNTAIN_CABINS) {
    obstacles.push({
      id: c.id,
      type: 'box',
      x: c.x,
      y: getTerrainHeight(c.x, c.z, 'mountain'),
      z: c.z,
      width: c.w,
      height: c.h,
      depth: c.d,
    });
  }

  // Wind turbines along the Western ridge
  for (const t of MOUNTAIN_TURBINES) {
    obstacles.push({
      id: t.id,
      type: 'cylinder',
      x: t.x,
      y: getTerrainHeight(t.x, t.z, 'mountain'),
      z: t.z,
      width: 3.4,
      height: 44,
      depth: 3.4,
    });
  }

  // Radio Mast on North peak
  const mastX = 8;
  const mastZ = -125;
  obstacles.push({
    id: 'radio-mast',
    type: 'cylinder',
    x: mastX,
    y: getTerrainHeight(mastX, mastZ, 'mountain'),
    z: mastZ,
    width: 3.0,
    height: 48,
    depth: 3.0,
  });

  // Deterministic pine tree clusters
  let seed = 4219;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < 110; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = 28 + rand() * 195;
    const tx = Math.cos(angle) * dist;
    const tz = Math.sin(angle) * dist;
    const ty = getTerrainHeight(tx, tz, 'mountain');

    if (ty < WATER_LEVEL + 1.2) continue;
    const tooClose = obstacles.some((o) => Math.hypot(o.x - tx, o.z - tz) < o.width * 0.75 + 7);
    if (tooClose) continue;

    const treeH = 7.5 + rand() * 8.5;
    obstacles.push({
      id: `tree-${i}`,
      type: 'cylinder',
      x: tx,
      y: ty,
      z: tz,
      width: 3.2 + rand() * 1.4,
      height: treeH,
      depth: 3.2,
    });
  }

  return obstacles;
}

/**
 * Generates a realistic downtown city grid with wide avenues, central launch plaza,
 * landmark glass skyscraper, commercial & residential towers, and park trees.
 * Grid cell spacing = 46m (avenue corridor ~18m wide, building footprint ~18-26m).
 */
function createCityObstacles(): WorldObstacle[] {
  const obstacles: WorldObstacle[] = [];

  let seed = 8831;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const blockStep = 46;
  let bIdx = 0;

  for (let gx = -4; gx <= 4; gx++) {
    for (let gz = -4; gz <= 4; gz++) {
      const cx = gx * blockStep;
      const cz = gz * blockStep;

      // Leave central block (0, 0) open as the Downtown Launchpad Plaza!
      if (gx === 0 && gz === 0) continue;

      // Leave Central Park open at (-1, 1)
      if (gx === -1 && gz === 1) {
        // Park trees inside central park block
        for (let t = 0; t < 8; t++) {
          const tx = cx + (rand() - 0.5) * 24;
          const tz = cz + (rand() - 0.5) * 24;
          obstacles.push({
            id: `city-tree-${t}`,
            type: 'cylinder',
            x: tx,
            y: 0,
            z: tz,
            width: 3.4,
            height: 7.5 + rand() * 4.0,
            depth: 3.4,
          });
        }
        continue;
      }

      // Skip river canal column (x around 148 -> gx === 3 is 138)
      if (Math.abs(cx - 148) < 30) continue;

      // Iconic Landmark Supertall Tower directly north-east of plaza at (1, -1)
      if (gx === 1 && gz === -1) {
        obstacles.push({
          id: 'city-landmark-tower',
          type: 'box',
          x: cx,
          y: 0,
          z: cz,
          width: 24,
          height: 92,
          depth: 24,
        });
        continue;
      }

      // Iconic Cylindrical Glass Spire at (-1, -1)
      if (gx === -1 && gz === -1) {
        obstacles.push({
          id: 'city-cyl-tower',
          type: 'cylinder',
          x: cx,
          y: 0,
          z: cz,
          width: 22,
          height: 74,
          depth: 22,
        });
        continue;
      }

      const distFromCore = Math.hypot(gx, gz);
      const isHighrise = distFromCore < 2.6 || rand() > 0.55;
      const w = 16 + Math.floor(rand() * 10);
      const d = 16 + Math.floor(rand() * 10);
      const h = isHighrise
        ? 34 + Math.floor(rand() * 44) // 34m - 78m skyscrapers
        : 14 + Math.floor(rand() * 20); // 14m - 34m mid-rise blocks

      obstacles.push({
        id: `city-bldg-${bIdx++}`,
        type: 'box',
        x: cx + (rand() - 0.5) * 3.5,
        y: 0,
        z: cz + (rand() - 0.5) * 3.5,
        width: w,
        height: h,
        depth: d,
      });
    }
  }

  return obstacles;
}

/**
 * Aerial flight course checkpoint rings tailored to each scene.
 */
export function createCheckpointRings(sceneId: SceneId = activeSceneId): CheckpointRing[] {
  if (sceneId === 'city') {
    // Thrilling urban corridor course weaving down avenues & around skyscrapers!
    const cityCoords: Array<{ x: number; y: number; z: number; rotY: number }> = [
      { x: 0, y: 18, z: -26, rotY: 0 },
      { x: 0, y: 28, z: -69, rotY: 0 },
      { x: 23, y: 36, z: -92, rotY: Math.PI * 0.5 },
      { x: 69, y: 42, z: -69, rotY: 0.35 },
      { x: 69, y: 26, z: -23, rotY: 0 },
      { x: 46, y: 22, z: 23, rotY: Math.PI * 0.5 },
      { x: 0, y: 18, z: 23, rotY: Math.PI * 0.5 },
      { x: -46, y: 24, z: 23, rotY: 0.3 },
    ];
    return cityCoords.map((c, idx) => ({
      id: idx + 1,
      x: c.x,
      y: c.y,
      z: c.z,
      radius: 5.5,
      rotationY: c.rotY,
      cleared: false,
    }));
  }

  if (sceneId === 'valley') {
    // Dive off the rim, follow the meandering gorge, thread under the bridge and out to sea
    const course: Array<{ z: number; y: (floor: number) => number }> = [
      { z: -78, y: () => 38 },
      { z: -130, y: (f) => f + 20 },
      { z: -180, y: (f) => f + 12 },
      { z: -232, y: (f) => f + 8 },
      { z: -285, y: (f) => f + 15 },
      { z: -340, y: (f) => f + 8 },
      { z: VALLEY_BRIDGE.z, y: (f) => f + 10 },
      { z: -500, y: () => 12 },
    ];
    return course.map((c, idx) => {
      const x = valleyAxisX(c.z);
      return {
        id: idx + 1,
        x,
        y: c.y(sampleValley(x, c.z).floorY),
        z: c.z,
        radius: 5.4,
        rotationY: Math.atan(-valleyAxisSlope(c.z)),
        cleared: false,
      };
    });
  }

  const coords: Array<{ x: number; z: number; agl: number; rotY: number }> = [
    { x: 0, z: -36, agl: 14, rotY: 0 },
    { x: 28, z: -64, agl: 20, rotY: -0.6 },
    { x: 76, z: -56, agl: 16, rotY: -1.35 },
    { x: 112, z: -22, agl: 22, rotY: -2.5 },
    { x: 64, z: 22, agl: 18, rotY: 2.2 },
    { x: 18, z: 42, agl: 14, rotY: 1.4 },
    { x: -34, z: 4, agl: 25, rotY: 0.45 },
    { x: -64, z: -34, agl: 32, rotY: -0.3 },
  ];

  return coords.map((c, idx) => ({
    id: idx + 1,
    x: c.x,
    y: getGroundOrWaterHeight(c.x, c.z, 'mountain') + c.agl,
    z: c.z,
    radius: 5.2,
    rotationY: c.rotY,
    cleared: false,
  }));
}
