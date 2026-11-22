// Deterministic world data shared by client (rendering/collision) and server (AI).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(i, j) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, z, oct = 5) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, z * f); norm += amp; f *= 2.03; amp *= 0.5; }
  return s / norm;
}

function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// ---------- Planet (Kessa Prime) ----------
export const PLANET = { size: 12000, segments: 230, arena: 3300, ceiling: 1500, baseHeight: 40 };
export const TOWERS = [[-260, -280], [300, -380], [40, 220]];

export function canyonZ(x) {
  return 900 + 480 * Math.sin(x * 0.0011) + 240 * Math.sin(x * 0.0027 + 1.3);
}

// An admin-uploaded heightmap (grey image, n×n bytes) can replace the terrain's shape.
// It covers the whole planet surface; bright = high. The arena walls stay so the map stays closed.
let HM = null;
export function setTerrainOverride(grid) { HM = grid && grid.bytes?.length === grid.n * grid.n ? grid : null; }
export const hasTerrainOverride = () => !!HM;
function heightmapSample(x, z) {
  const n = HM.n, half = PLANET.size / 2;
  const fx = Math.min(n - 1.001, Math.max(0, ((x + half) / PLANET.size) * (n - 1)));
  const fz = Math.min(n - 1.001, Math.max(0, ((z + half) / PLANET.size) * (n - 1)));
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, b = HM.bytes;
  const a = b[iz * n + ix], c = b[iz * n + ix + 1], d = b[(iz + 1) * n + ix], e = b[(iz + 1) * n + ix + 1];
  const v = (a + (c - a) * tx) + ((d + (e - d) * tx) - (a + (c - a) * tx)) * tz;
  // small noise on top so flat areas of a low-resolution map don't look like plastic
  return (v / 255) * HM.height - HM.height * 0.3 + (fbm(x * 0.004, z * 0.004, 3) - 0.5) * 18;
}

export function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  let h;
  if (HM) h = heightmapSample(x, z);
  else {
    h = fbm(x * 0.0009 + 10, z * 0.0009 - 7, 5) * 300 - 90;
    const m = 1 - Math.abs(vnoise(x * 0.0017 + 3, z * 0.0017 + 9) * 2 - 1);
    h += Math.pow(m, 5) * 260; // mesas / ridges
    // meandering canyon south of the base
    const d = Math.abs(z - canyonZ(x));
    h -= (1 - smooth(50, 240, d)) * 210;
  }
  if (HM && !HM.keepBase) return h + smooth(2700, 4300, r) * 1100 * (0.55 + 0.45 * vnoise(x * 0.002, z * 0.002));
  // flat plateau for the relay station
  const base = 1 - smooth(520, 900, r);
  h = h * (1 - base) + PLANET.baseHeight * base;
  // perimeter mountains that wall in the arena
  h += smooth(2700, 4300, r) * 1100 * (0.55 + 0.45 * vnoise(x * 0.002, z * 0.002));
  return h;
}

// ---------- Space: asteroid belt for the convoy mission ----------
export const CONVOY = {
  startZ: -2500,
  gateZ: 2700,
  lanesX: [-170, 0, 170],
  gate: [0, 0, 2800],
  arena: 3800,
};

let _asteroids = null;
export function asteroids() {
  if (_asteroids) return _asteroids;
  const rng = mulberry32(1337);
  const out = [];
  let tries = 0;
  while (out.length < 170 && tries++ < 5000) {
    const x = (rng() * 2 - 1) * 3000;
    const y = (rng() * 2 - 1) * 450 + Math.sin(x * 0.001) * 150;
    const z = (rng() * 2 - 1) * 3000;
    const big = rng() < 0.08;
    const r = big ? 110 + rng() * 90 : 12 + Math.pow(rng(), 2) * 60;
    // keep the convoy lane clear
    if (Math.abs(x) < 330 + r && Math.abs(y) < 160 + r) continue;
    // keep player spawn clear
    if (Math.hypot(x, y - 120, z - 1900) < 300 + r) continue;
    out.push({ x, y, z, r, s: Math.floor(rng() * 3), rx: rng() * 6.28, ry: rng() * 6.28 });
  }
  _asteroids = out;
  return out;
}

// ---------- Dreadnought "Ravager" ----------
// Hull boxes: c = center, h = half extents. Used for rendering AND collision.
export const DREAD = {
  arena: 3800,
  hull: [
    { c: [0, 0, 100], h: [100, 35, 300] },     // main hull
    { c: [0, 0, -300], h: [62, 26, 150] },     // fore section
    { c: [0, -4, -500], h: [30, 16, 60] },     // prow
    { c: [0, 55, 180], h: [40, 20, 120] },     // upper deck
    { c: [0, 96, 260], h: [22, 22, 30] },      // command tower
    { c: [0, -50, 120], h: [70, 15, 200] },    // ventral keel
    { c: [-62, 0, 412], h: [22, 22, 14] },     // engine blocks
    { c: [0, 0, 412], h: [22, 22, 14] },
    { c: [62, 0, 412], h: [22, 22, 14] },
    { c: [-128, 0, 200], h: [28, 10, 90] },    // side sponsons
    { c: [128, 0, 200], h: [28, 10, 90] },
  ],
  generators: [[-60, 37, 330], [60, 37, 330], [-38, 28, -360], [38, 28, -360]],
  turrets: [
    [-86, 37, 170], [86, 37, 170], [-86, 37, -90], [86, 37, -90],
    [-48, 28, -230], [48, 28, -230], [-52, -67, 40], [52, -67, 40],
  ],
  core: [0, -72, 250],
  hangar: [0, -70, -60],
};

export function insideBox(p, box, margin = 0) {
  return Math.abs(p.x - box.c[0]) < box.h[0] + margin &&
         Math.abs(p.y - box.c[1]) < box.h[1] + margin &&
         Math.abs(p.z - box.c[2]) < box.h[2] + margin;
}

export function spawnPoint(mission, slot) {
  const s = mission.spawn;
  const offs = [[0, 0, 0], [-35, 10, 25], [35, 10, 25], [0, 25, 50]];
  const o = offs[slot % 4];
  return [s[0] + o[0], s[1] + o[1], s[2] + o[2]];
}
