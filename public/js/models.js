// Procedural low-poly models (original designs). All ships face -Z.
import * as THREE from 'three';
import { DREAD, mulberry32 } from '/shared/world.js';
import { panelMaterial, triplanarMaterial } from './textures.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------------- GLB ship models (authored in Blender) ----------------
// Material names in the GLB decide the in-game look:
//   *Hull -> textured hull panels, *Accent -> player colour, *Dark -> dark panels,
//   *Canopy -> glass, *Glow -> engine glow. Empties named engine_* get an engine flare.
const SHIP_FILES = { lancer: '/models/lancer.glb' };
const shipModels = {};
let preloadPromise = null;
export function preloadShipModels() {
  if (preloadPromise) return preloadPromise;
  const loader = new GLTFLoader();
  preloadPromise = Promise.all(Object.entries(SHIP_FILES).map(([k, url]) =>
    loader.loadAsync(url).then((g) => { shipModels[k] = g.scene; }).catch((e) => console.warn('ship model failed', k, e))));
  return preloadPromise;
}
function buildShipFromModel(type, color) {
  const src = shipModels[type];
  const g = src.clone(true);
  const engines = [];
  const accent = panelMaterial(color, { metalness: 0.4, roughness: 0.4 });
  const hullM = panelMaterial(0xd6dbe2, { metalness: 0.5, roughness: 0.45 });
  const darkM = panelMaterial(0x50565f, { metalness: 0.6, roughness: 0.5, repeat: 2 });
  const canopy = mat(0x10243a, { emissive: 0x2a7fff, ei: 0.35, metal: 0.9, rough: 0.15 });
  const glowM = glow(color, 2.2);
  const empties = [];
  g.traverse((o) => {
    if (o.isMesh) {
      const pick = (m) => {
        const n = (m && m.name) || '';
        return n.endsWith('Accent') ? accent : n.endsWith('Dark') ? darkM : n.endsWith('Canopy') ? canopy : n.endsWith('Glow') ? glowM : hullM;
      };
      o.material = Array.isArray(o.material) ? o.material.map(pick) : pick(o.material);
    } else if (/^engine/i.test(o.name)) empties.push(o);
  });
  for (const e of empties) {
    const eg = engineGlow(color, 2.8);
    e.add(eg);
    engines.push(eg);
  }
  g.userData.engines = engines;
  return g;
}

const matCache = new Map();
export function mat(color, { emissive = 0x000000, ei = 1, metal = 0.35, rough = 0.55, flat = true, transparent = false, opacity = 1 } = {}) {
  const key = [color, emissive, ei, metal, rough, flat, transparent, opacity].join('|');
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: ei, metalness: metal, roughness: rough, flatShading: flat, transparent, opacity });
  matCache.set(key, m);
  return m;
}
const glow = (c, i = 3) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i), toneMapped: false });

let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export function engineGlow(color, size = 3) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(color).multiplyScalar(1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
  s.scale.setScalar(size);
  s.userData.baseSize = size;
  return s;
}

function mesh(geo, material, pos = [0, 0, 0], rot = [0, 0, 0], scale = null) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...pos);
  m.rotation.set(...rot);
  if (scale) m.scale.set(...scale);
  return m;
}

function wedge(w, h, l, taper = 0.3) {
  // box tapered toward -Z
  const g = new THREE.BoxGeometry(w, h, l, 1, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getZ(i) < 0) { p.setX(i, p.getX(i) * taper); p.setY(i, p.getY(i) * (0.5 + taper * 0.5)); }
  }
  g.computeVertexNormals();
  return g;
}

// ---------------- player ships ----------------
export function buildShip(type, color) {
  if (shipModels[type]) return buildShipFromModel(type, color);
  const g = new THREE.Group();
  const accent = panelMaterial(color, { metalness: 0.4, roughness: 0.4 });
  const hullM = panelMaterial(0xd6dbe2, { metalness: 0.5, roughness: 0.45 });
  const darkM = panelMaterial(0x50565f, { metalness: 0.6, roughness: 0.5, repeat: 2 });
  const canopy = mat(0x10243a, { emissive: 0x2a7fff, ei: 0.35, metal: 0.9, rough: 0.15 });
  const engines = [];
  if (type === 'lancer') {
    g.add(mesh(wedge(1.8, 1.4, 11, 0.15), hullM, [0, 0, -0.5]));
    g.add(mesh(new THREE.ConeGeometry(0.6, 3, 6), accent, [0, 0, -7], [-Math.PI / 2, 0, 0]));
    g.add(mesh(new THREE.SphereGeometry(0.75, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), canopy, [0, 0.6, -1.6], [0, 0, 0], [1, 0.8, 2.2]));
    // forward-swept wings
    for (const s of [-1, 1]) {
      const w = mesh(new THREE.BoxGeometry(5.5, 0.18, 2.2), accent, [s * 3.2, -0.2, 1.3], [0, s * -0.45, s * -0.08]);
      g.add(w);
      g.add(mesh(new THREE.BoxGeometry(0.35, 0.35, 3.2), darkM, [s * 5.6, -0.2, -0.2]));
      g.add(mesh(new THREE.CylinderGeometry(0.55, 0.7, 4, 8), darkM, [s * 1.4, -0.1, 3.4], [Math.PI / 2, 0, 0]));
      const eg = engineGlow(color, 2.8); eg.position.set(s * 1.4, -0.1, 5.6); g.add(eg); engines.push(eg);
    }
    g.add(mesh(new THREE.BoxGeometry(0.15, 1.6, 1.8), accent, [0, 1, 3.6], [0.4, 0, 0]));
  } else if (type === 'warden') {
    g.add(mesh(new THREE.CylinderGeometry(1.2, 1.6, 9, 8), hullM, [0, 0, 0], [Math.PI / 2, 0, 0]));
    g.add(mesh(new THREE.ConeGeometry(1.2, 3, 8), hullM, [0, 0, -6], [-Math.PI / 2, 0, 0]));
    g.add(mesh(new THREE.SphereGeometry(0.9, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), canopy, [0, 0.9, -2.5], [0, 0, 0], [1, 0.8, 1.8]));
    // ring wing
    const ring = mesh(new THREE.TorusGeometry(3.6, 0.35, 6, 16), accent, [0, 0, 1.6]);
    g.add(ring);
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      g.add(mesh(new THREE.BoxGeometry(0.25, 3, 1.4), darkM, [Math.cos(a) * 2.2, Math.sin(a) * 2.2, 1.6], [0, 0, a + Math.PI / 2]));
    }
    for (const [x, y] of [[-2.6, 0.6], [2.6, 0.6], [-2.6, -0.8], [2.6, -0.8]]) g.add(mesh(new THREE.BoxGeometry(0.25, 0.25, 3), darkM, [x, y, -0.6]));
    g.add(mesh(new THREE.CylinderGeometry(1.3, 1.1, 1.5, 8), darkM, [0, 0, 5], [Math.PI / 2, 0, 0]));
    const eg = engineGlow(color, 4.5); eg.position.set(0, 0, 6.2); g.add(eg); engines.push(eg);
  } else {
    // hammer bomber: broad delta with twin pods
    const body = new THREE.Shape();
    body.moveTo(0, -6); body.lineTo(6.5, 3.5); body.lineTo(2, 4.5); body.lineTo(-2, 4.5); body.lineTo(-6.5, 3.5); body.closePath();
    const bg = new THREE.ExtrudeGeometry(body, { depth: 0.8, bevelEnabled: false });
    bg.rotateX(Math.PI / 2); bg.translate(0, 0.4, 0);
    g.add(mesh(bg, accent));
    g.add(mesh(wedge(2.6, 1.8, 9, 0.35), hullM, [0, 0.7, -0.6]));
    g.add(mesh(new THREE.SphereGeometry(0.95, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), canopy, [0, 1.5, -3], [0, 0, 0], [1, 0.7, 1.8]));
    for (const s of [-1, 1]) {
      g.add(mesh(new THREE.CylinderGeometry(0.9, 1.1, 7, 8), darkM, [s * 3.2, -0.3, 0.8], [Math.PI / 2, 0, 0]));
      g.add(mesh(new THREE.ConeGeometry(0.9, 2, 8), hullM, [s * 3.2, -0.3, -3.6], [-Math.PI / 2, 0, 0]));
      const eg = engineGlow(color, 3.6); eg.position.set(s * 3.2, -0.3, 4.7); g.add(eg); engines.push(eg);
    }
    g.add(mesh(new THREE.BoxGeometry(1.2, 0.8, 2.5), darkM, [0, -0.6, 0.5]));
  }
  g.userData.engines = engines;
  return g;
}

// ---------------- enemies & structures ----------------
const ENEMY_RED = 0xd8322f;
export function buildEntity(type) {
  const g = new THREE.Group();
  const engines = [];
  const dark = panelMaterial(0x6a5c62, { metalness: 0.6, roughness: 0.45 });
  const red = panelMaterial(ENEMY_RED, { metalness: 0.3, roughness: 0.5 });
  const steel = panelMaterial(0xaab0ba, { metalness: 0.6, roughness: 0.4 });
  if (type === 'raider' || type === 'bomber') {
    const sc = type === 'bomber' ? 1.45 : 1;
    // forked "pincer" fighter
    g.add(mesh(new THREE.OctahedronGeometry(1.6, 0), dark, [0, 0, 0.6], [0, 0, 0], [1.2, 0.8, 2]));
    for (const s of [-1, 1]) {
      g.add(mesh(wedge(0.9, 0.7, 7, 0.1), red, [s * 1.7, 0, -1.8], [0, s * 0.12, 0]));
      g.add(mesh(new THREE.BoxGeometry(3.6, 0.2, 2.6), dark, [s * 2.4, 0, 1.5], [0, 0, s * 0.35]));
    }
    g.add(mesh(new THREE.SphereGeometry(0.55, 8, 6), glow(0xff3020, 2.5), [0, 0.5, -0.6]));
    const eg = engineGlow(0xff4422, 3.2); eg.position.set(0, 0, 3.4); g.add(eg); engines.push(eg);
    if (type === 'bomber') g.add(mesh(new THREE.CylinderGeometry(1, 1, 3, 8), steel, [0, -1.4, 0.6], [Math.PI / 2, 0, 0]));
    g.scale.setScalar(sc);
  } else if (type === 'wing') {
    return buildShip('lancer', '#9fb4c8');
  } else if (type === 'gunship') {
    g.add(mesh(wedge(14, 6, 30, 0.3), dark, [0, 0, 0]));
    g.add(mesh(new THREE.BoxGeometry(8, 4, 10), red, [0, 4, 6]));
    g.add(mesh(new THREE.BoxGeometry(5, 2, 4), mat(0x221010, { emissive: 0xff2010, ei: 0.8 }), [0, 6.5, 4]));
    for (const s of [-1, 1]) {
      g.add(mesh(new THREE.SphereGeometry(2.4, 8, 6), steel, [s * 14, -2, -6]));
      g.add(mesh(new THREE.BoxGeometry(0.6, 0.6, 6), dark, [s * 14, -2, -9]));
      g.add(mesh(new THREE.BoxGeometry(10, 1, 7), red, [s * 9, -1, 4], [0, 0, s * -0.2]));
      const eg = engineGlow(0xff5a22, 7); eg.position.set(s * 5, -3.5, 10); g.add(eg); engines.push(eg);
    }
    const vent = mesh(new THREE.PlaneGeometry(8, 14), glow(0xff3010, 1.4), [0, -3.05, 2], [Math.PI / 2, 0, 0]);
    g.add(vent);
  } else if (type === 'freighter') {
    g.add(mesh(new THREE.BoxGeometry(18, 14, 70), triplanarMaterial({ albedo: 'hull_panels_albedo', normal: 'hull_panels_normal', scale: 0.06, color: 0x7a6e72, metalness: 0.5, roughness: 0.5 }), [0, 0, 0]));
    g.add(mesh(new THREE.BoxGeometry(10, 8, 14), steel, [0, 6, -38]));
    g.add(mesh(new THREE.BoxGeometry(14, 4, 6), mat(0x1a1010, { emissive: 0xffaa55, ei: 0.6 }), [0, 9, -42]));
    const rng = mulberry32(42);
    for (let i = 0; i < 8; i++) {
      const s = i % 2 ? 1 : -1;
      g.add(mesh(new THREE.BoxGeometry(9, 9, 12), panelMaterial([0xc06a50, 0x8a95a8, 0xb8a060][Math.floor(rng() * 3)], { metalness: 0.3, roughness: 0.6 }), [s * 13, rng() * 4 - 2, -24 + Math.floor(i / 2) * 15]));
    }
    g.add(mesh(new THREE.CylinderGeometry(8, 9, 10, 10), steel, [0, 0, 40], [Math.PI / 2, 0, 0]));
    const eg = engineGlow(0xff7733, 22); eg.position.set(0, 0, 47); g.add(eg); engines.push(eg);
  } else if (type === 'turret') {
    g.add(mesh(new THREE.SphereGeometry(5, 10, 8), steel));
    g.add(mesh(new THREE.BoxGeometry(1, 1, 9), dark, [-1.8, 0.6, -6]));
    g.add(mesh(new THREE.BoxGeometry(1, 1, 9), dark, [1.8, 0.6, -6]));
    g.add(mesh(new THREE.BoxGeometry(3, 1.2, 1.2), glow(0xff3322, 1.5), [0, 2.8, -2]));
  } else if (type === 'generator') {
    g.add(mesh(new THREE.CylinderGeometry(16, 20, 8, 12), steel, [0, -6, 0]));
    g.add(mesh(new THREE.SphereGeometry(13, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x203040, { emissive: 0x30a0ff, ei: 0.9, metal: 0.2, rough: 0.3 }), [0, -2, 0]));
    const ring = mesh(new THREE.TorusGeometry(17, 1.2, 6, 24), glow(0x40c0ff, 2), [0, -2, 0], [Math.PI / 2, 0, 0]);
    g.add(ring);
    g.userData.spin = ring;
  } else if (type === 'core') {
    const core = mesh(new THREE.IcosahedronGeometry(14, 1), glow(0xffaa33, 2.2));
    g.add(core);
    for (let i = 0; i < 3; i++) {
      const r = mesh(new THREE.TorusGeometry(20 + i * 3, 1.3, 6, 28), mat(0x555a66, { metal: 0.8 }), [0, 0, 0], [i * 1.1, i * 0.7, 0]);
      g.add(r);
    }
    const shield = mesh(new THREE.SphereGeometry(28, 20, 14), new THREE.MeshBasicMaterial({ color: 0x55aaff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.add(shield);
    g.userData.shield = shield;
    g.userData.spin = g.children[1];
  } else if (type === 'tower') {
    const blue = mat(0x2a6aa8, { metal: 0.5 });
    g.add(mesh(new THREE.CylinderGeometry(22, 26, 8, 8), steel, [0, -45, 0]));
    g.add(mesh(new THREE.CylinderGeometry(5, 9, 80, 8), panelMaterial(0xe0e4ea, { metalness: 0.4, repeat: 3 }), [0, -5, 0]));
    g.add(mesh(new THREE.CylinderGeometry(10, 10, 6, 8), blue, [0, 20, 0]));
    const dish = mesh(new THREE.SphereGeometry(12, 12, 6, 0, Math.PI * 2, 0, Math.PI / 3), mat(0xe0e4ea, { metal: 0.3, flat: false }), [0, 34, 0], [Math.PI, 0, 0]);
    g.add(dish);
    g.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 20, 6), steel, [0, 40, 0]));
    const beacon = mesh(new THREE.SphereGeometry(2, 8, 6), glow(0x55ccff, 3), [0, 51, 0]);
    g.add(beacon);
    g.userData.beacon = beacon;
    g.userData.spin = dish;
  }
  g.userData.engines = engines;
  return g;
}

// ---------------- capital ship ----------------
export function buildDreadnought() {
  const g = new THREE.Group();
  const hullM = triplanarMaterial({ albedo: 'hull_panels_albedo', normal: 'hull_panels_normal', scale: 0.018, color: 0xb0b4bc, metalness: 0.5, roughness: 0.55, normalStrength: 1.2 });
  const darkM = triplanarMaterial({ albedo: 'hull_panels_albedo', normal: 'hull_panels_normal', scale: 0.07, color: 0x6a6e76, metalness: 0.6, roughness: 0.6 });
  const redM = triplanarMaterial({ albedo: 'hull_panels_albedo', normal: 'hull_panels_normal', scale: 0.07, color: 0xa03030, metalness: 0.4, roughness: 0.5 });
  const winM = glow(0xffd28a, 1.6);
  const rng = mulberry32(99);
  for (const b of DREAD.hull) {
    const m = mesh(new THREE.BoxGeometry(b.h[0] * 2, b.h[1] * 2, b.h[2] * 2), hullM, b.c);
    g.add(m);
    // greebles on top
    const area = b.h[0] * b.h[2];
    const n = Math.min(40, Math.floor(area / 600));
    for (let i = 0; i < n; i++) {
      const w = 4 + rng() * 14, h = 2 + rng() * 6, l = 4 + rng() * 20;
      const x = b.c[0] + (rng() * 2 - 1) * (b.h[0] - w / 2);
      const z = b.c[2] + (rng() * 2 - 1) * (b.h[2] - l / 2);
      const top = rng() < 0.75;
      g.add(mesh(new THREE.BoxGeometry(w, h, l), rng() < 0.15 ? redM : darkM, [x, b.c[1] + (top ? b.h[1] + h / 2 : -b.h[1] - h / 2), z]));
    }
    // window strips on the sides
    for (const s of [-1, 1]) {
      if (b.h[2] < 40) continue;
      g.add(mesh(new THREE.BoxGeometry(0.5, 1.2, b.h[2] * 1.6), winM, [b.c[0] + s * (b.h[0] + 0.3), b.c[1] + b.h[1] * 0.3, b.c[2]]));
    }
  }
  for (const x of [-62, 0, 62]) {
    const eg = engineGlow(0xff7a33, 70);
    eg.position.set(x, 0, 432);
    g.add(eg);
    g.add(mesh(new THREE.CircleGeometry(18, 16), glow(0xffaa66, 1.8), [x, 0, 426.5]));
  }
  // hangar mouth
  g.add(mesh(new THREE.PlaneGeometry(60, 40), glow(0xff8844, 0.8), [0, -65.2, -60], [Math.PI / 2, 0, 0]));
  return g;
}

export function buildJumpGate() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.TorusGeometry(260, 22, 8, 40), triplanarMaterial({ albedo: 'hull_panels_albedo', normal: 'hull_panels_normal', scale: 0.03, color: 0x9aa0aa, metalness: 0.7, roughness: 0.45 })));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(mesh(new THREE.BoxGeometry(40, 60, 50), mat(0x3d4048, { metal: 0.6 }), [Math.cos(a) * 270, Math.sin(a) * 270, 0], [0, 0, a]));
    g.add(mesh(new THREE.SphereGeometry(8, 8, 6), glow(0x66ddff, 2.5), [Math.cos(a) * 240, Math.sin(a) * 240, 0]));
  }
  const disc = mesh(new THREE.CircleGeometry(240, 48), new THREE.MeshBasicMaterial({ color: 0x3399ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  g.add(disc);
  g.userData.disc = disc;
  return g;
}
