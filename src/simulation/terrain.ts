import { CheckpointRing, WorldObstacle } from '../types/simulation';

export const WORLD_SIZE = 760;
export const WATER_LEVEL = -1.6;
export const HOME_PAD_RADIUS = 7.5;

/**
 * Deterministic highland coastal valley heightmap.
 * Flat launch plateau around (0, 0), serene lake to the East/Southeast,
 * rolling hills & cliffs around the perimeter for realistic 3D flying.
 */
export function getTerrainHeight(x: number, z: number): number {
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
    const t = Math.max(0, Math.min(1, (distFromHome - padFlatRadius) / (padBlendRadius - padFlatRadius)));
    const smoothT = t * t * (3 - 2 * t);
    h = h * smoothT;
  }

  return h;
}

/**
 * Returns the effective ground/water surface elevation at (x, z)
 * (used for AGL altitude and collision floor).
 */
export function getGroundOrWaterHeight(x: number, z: number): number {
  return Math.max(getTerrainHeight(x, z), WATER_LEVEL);
}

/**
 * Static collidable structures and landmarks shared by both Three.js world builder and Physics engine.
 */
export function createWorldObstacles(): WorldObstacle[] {
  const obstacles: WorldObstacle[] = [];

  // Control / Observation Tower near launchpad
  const towerX = -32;
  const towerZ = -26;
  const towerY = getTerrainHeight(towerX, towerZ);
  obstacles.push({
    id: 'watch-tower',
    type: 'cylinder',
    x: towerX,
    y: towerY,
    z: towerZ,
    width: 6.2,
    height: 22,
    depth: 6.2,
  });

  // Modern Hangar / Research Station
  const hangarX = -26;
  const hangarZ = 22;
  const hangarY = getTerrainHeight(hangarX, hangarZ);
  obstacles.push({
    id: 'hangar',
    type: 'box',
    x: hangarX,
    y: hangarY,
    z: hangarZ,
    width: 18,
    height: 7.5,
    depth: 12,
  });

  // Coastal villas / cabins
  const cabins = [
    { id: 'cabin-1', x: 34, z: 24, w: 9, h: 6, d: 8 },
    { id: 'cabin-2', x: 48, z: 16, w: 8, h: 5.5, d: 7 },
    { id: 'cabin-3', x: -58, z: -52, w: 12, h: 8, d: 10 },
  ];
  for (const c of cabins) {
    obstacles.push({
      id: c.id,
      type: 'box',
      x: c.x,
      y: getTerrainHeight(c.x, c.z),
      z: c.z,
      width: c.w,
      height: c.h,
      depth: c.d,
    });
  }

  // Wind turbines along the Western ridge
  const turbines = [
    { id: 'turbine-1', x: -85, z: -10 },
    { id: 'turbine-2', x: -102, z: -55 },
    { id: 'turbine-3', x: -75, z: -98 },
    { id: 'turbine-4', x: -115, z: 45 },
  ];
  for (const t of turbines) {
    obstacles.push({
      id: t.id,
      type: 'cylinder',
      x: t.x,
      y: getTerrainHeight(t.x, t.z),
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
    y: getTerrainHeight(mastX, mastZ),
    z: mastZ,
    width: 3.0,
    height: 48,
    depth: 3.0,
  });

  // Deterministic pine tree clusters (keep clear of home pad and lake)
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
    const ty = getTerrainHeight(tx, tz);

    if (ty < WATER_LEVEL + 1.2) continue;
    // Avoid overlapping buildings
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
 * Aerial flight course checkpoint rings to practice precision piloting.
 */
export function createCheckpointRings(): CheckpointRing[] {
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
    y: getGroundOrWaterHeight(c.x, c.z) + c.agl,
    z: c.z,
    radius: 5.2,
    rotationY: c.rotY,
    cleared: false,
  }));
}
