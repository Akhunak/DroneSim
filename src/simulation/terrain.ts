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
 */
export function getTerrainHeight(x: number, z: number, sceneId: SceneId = activeSceneId): number {
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
  return createMountainObstacles();
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
