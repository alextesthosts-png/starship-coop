// Procedural low-poly models (original designs). All ships face -Z.
import { VISUALS } from '/shared/tuning.js';
import * as THREE from 'three';
import { DREAD, mulberry32 } from '/shared/world.js';
import { MODEL_SLOTS } from '/shared/config.js';
import { panelMaterial, triplanarMaterial } from './textures.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------------- GLB ship models (authored in Blender) ----------------
// Material names in the GLB decide the in-game look:
//   *Hull -> textured hull panels, *Accent -> player colour, *Dark -> dark panels,
//   *Canopy -> glass, *Glow -> engine glow, *Baked -> kept exactly as authored (own textures,
//   no player colour). Empties named engine_* get an engine flare.
const BUILTIN_FILES = { lancer: '/models/lancer.glb', warden: '/models/warden.glb' };
const SHIP_FILES = { ...BUILTIN_FILES };
// Models uploaded in the admin media library can replace the built-in one of any ship or structure
// (see MODEL_SLOTS). Uploaded models are scaled to the built-in model's size and centred.
const CUSTOM = new Set();
const BASE_OF = {};   // custom ship id -> built-in ship it is derived from
export function setShipModels(overrides = {}, customShips = []) {
  for (const k of Object.keys(SHIP_FILES)) if (!BUILTIN_FILES[k]) delete SHIP_FILES[k];
  Object.assign(SHIP_FILES, BUILTIN_FILES);
  CUSTOM.clear();
  for (const [k, url] of Object.entries(overrides)) {
    if (!MODEL_SLOTS[k] || typeof url !== 'string' || !/^\/media\/models\/[\w.-]+$/.test(url)) continue;
    SHIP_FILES[k] = url; CUSTOM.add(k);
  }
  for (const s of customShips) {
    BASE_OF[s.id] = s.base;
    if (s.model) { SHIP_FILES[s.id] = s.model; if (s.model.startsWith('/media/')) CUSTOM.add(s.id); }
    else if (SHIP_FILES[s.base]) { SHIP_FILES[s.id] = SHIP_FILES[s.base]; if (CUSTOM.has(s.base)) CUSTOM.add(s.id); }
  }
}
// Engine / gun / emblem markers placed in the admin's marker editor, per model file.
let MARKERS = {};
export function setModelMarkers(m) { MARKERS = m || {}; }
// Liveries: paint schemes and emblems players can pick (see admin → Liveries).
let LIVERIES = {};
export function setLiveries(list = []) { LIVERIES = Object.fromEntries(list.map((l) => [l.id, l])); }
export const liveryById = (id) => LIVERIES[id] || null;
const texLoader = new THREE.TextureLoader();
const emblemTex = new Map();
function emblemTexture(url) {
  if (!emblemTex.has(url)) { const t = texLoader.load(url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; emblemTex.set(url, t); }
  return emblemTex.get(url);
}
// A flat decal hugging the hull at p, facing along n.
function emblemDecal(url, p, n, size) {
  const m = new THREE.MeshStandardMaterial({ map: emblemTexture(url), transparent: true, alphaTest: 0.04, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.55, metalness: 0.2 });
  const d = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
  const nn = new THREE.Vector3(...n).normalize();
  d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nn);
  // keep the emblem upright relative to the ship's nose where possible
  d.position.set(...p).addScaledVector(nn, size * 0.01);
  d.renderOrder = 2;
  d.userData.decal = true;
  return d;
}
// Put the emblem on the top of the hull when the model has no emblem marker: cast a ray down
// a little behind the middle of the ship and stick the decal where it lands.
function autoEmblem(g, url, scaleMul = 1) {
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  const meshes = []; g.traverse((o) => { if (o.isMesh && !o.userData.decal && !(o.material?.blending === THREE.AdditiveBlending)) meshes.push(o); });
  const rc = new THREE.Raycaster(new THREE.Vector3(box.getCenter(new THREE.Vector3()).x, box.max.y + 5, box.min.z + size.z * 0.6), new THREE.Vector3(0, -1, 0));
  const hit = rc.intersectObjects(meshes, false)[0];
  if (!hit) return;
  const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
  if (n.y < 0.3) n.set(0, 1, 0);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const p = hit.point.clone().applyMatrix4(inv);
  g.add(emblemDecal(url, p.toArray(), n.toArray(), Math.min(size.x, size.z) * 0.28 * scaleMul));
}
// Longest side of each built-in model, in metres. Lancer/Warden are their Blender models; the
// rest are measured from the procedural builders the first time they're needed.
const REF_SIZE = { lancer: 14, warden: 12 };
const REF_CENTER = { lancer: new THREE.Vector3(), warden: new THREE.Vector3() };
function measureBuiltin(type) {
  if (BASE_OF[type]) { REF_SIZE[type] = refSize(BASE_OF[type]); REF_CENTER[type] = refCenter(BASE_OF[type]); return; }
  const g = type === 'dreadnought' ? buildDreadnought(true) : ['lancer', 'warden', 'hammer'].includes(type) ? buildShip(type, '#ffffff', { builtin: true }) : buildEntity(type, true);
  const box = new THREE.Box3().setFromObject(g);
  const s = box.getSize(new THREE.Vector3());
  REF_SIZE[type] = Math.max(s.x, s.y, s.z) || 10;
  REF_CENTER[type] = box.getCenter(new THREE.Vector3());
}
function refSize(type) { if (REF_SIZE[type] == null) measureBuiltin(type); return REF_SIZE[type]; }
function refCenter(type) { if (!REF_CENTER[type]) measureBuiltin(type); return REF_CENTER[type]; }
const PLUME_RADIUS = { lancer: 0.62, warden: 0.9, hammer: 0.8 };
// how strongly each ship's baked material reflects the studio environment
const ENV_INTENSITY = { lancer: 1.0, warden: 0.28 };
// Studio reflections for *Baked materials, so metals look like Blender's material preview
let bakedEnv = null;
export function setBakedEnvironment(tex) { bakedEnv = tex; }
const shipModels = {};          // slot -> loaded scene
const sceneByUrl = new Map();   // url -> Promise<scene|null>
const gltfLoader = new GLTFLoader();
export function preloadShipModels() {
  const jobs = Object.entries(SHIP_FILES).map(([k, url]) => {
    if (!sceneByUrl.has(url)) sceneByUrl.set(url, gltfLoader.loadAsync(url).then((g) => g.scene).catch((e) => { console.warn('model failed', url, e); return null; }));
    return sceneByUrl.get(url).then((sc) => { if (sc) shipModels[k] = sc; else delete shipModels[k]; });
  });
  for (const k of Object.keys(shipModels)) if (!SHIP_FILES[k]) delete shipModels[k];
  return Promise.all(jobs);
}
const shipModelFor = (type) => (SHIP_FILES[type] && sceneByUrl.has(SHIP_FILES[type]) ? shipModels[type] : null);
function buildShipFromModel(type, color, { enemy = false, plumes = true, fallbackEngine = true, livery = null } = {}) {
  const url = SHIP_FILES[type];
  const src = shipModels[type];
  let g = src.clone(true);
  let inner = g, scale = 1;
  // far-detail version (LOD1_* node, made by the admin's model optimizer): swap by distance
  const lod1 = g.getObjectByName('LOD1') || g.children.find((c) => /^LOD1/i.test(c.name));
  const lod0 = g.getObjectByName('LOD0') || g.children.find((c) => /^LOD0/i.test(c.name));
  if (lod1 && lod0 && lod1.parent === lod0.parent) {
    const parent = lod0.parent;
    const lod = new THREE.LOD();
    lod.position.copy(lod0.position); lod.quaternion.copy(lod0.quaternion); lod.scale.copy(lod0.scale);
    lod0.position.set(0, 0, 0); lod0.quaternion.identity(); lod0.scale.set(1, 1, 1);
    lod1.position.set(0, 0, 0); lod1.quaternion.identity(); lod1.scale.set(1, 1, 1);
    parent.add(lod);
    lod.addLevel(lod0, 0);
    lod.addLevel(lod1, refSize(type) * 22);
  }
  if (CUSTOM.has(type)) {
    // fit an uploaded model to the built-in size, centred on the origin
    const box = new THREE.Box3().setFromObject(g);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    scale = refSize(type) / (Math.max(size.x, size.y, size.z) || 1);
    g.scale.setScalar(scale);
    g.position.copy(c).multiplyScalar(-scale);
    // ships stay centred on their pivot; structures sit where the built-in one did
    if (!(['lancer', 'warden', 'hammer', 'wing', 'raider', 'bomber'].includes(type) || BASE_OF[type])) g.position.add(refCenter(type));
    const wrap = new THREE.Group(); wrap.add(g);
    wrap.userData.halfSize = size.clone().multiplyScalar(scale / 2);
    inner = g;
    g = wrap;
  }
  const engines = [];
  const L = livery;
  const accent = panelMaterial(L?.accent || color, { metalness: 0.4, roughness: 0.4 });
  const hullM = panelMaterial(L?.hull || 0xd6dbe2, { metalness: 0.5, roughness: 0.45 });
  const darkM = panelMaterial(L?.dark || 0x50565f, { metalness: 0.6, roughness: 0.5, repeat: 2 });
  const canopy = mat(0x10243a, { emissive: 0x2a7fff, ei: 0.35, metal: 0.9, rough: 0.15 });
  const glowM = glow(color, 2.2);
  const mk = MARKERS[url];
  const empties = [];
  g.traverse((o) => {
    if (o.isMesh) {
      const pick = (m) => {
        const n = (m && m.name) || '';
        // uploaded enemy/structure models keep their own materials unless they use the naming scheme
        if (enemy && !/(Hull|Accent|Dark|Canopy|Glow)$/.test(n)) return m;
        if (n.endsWith('Baked')) {
          if (bakedEnv && !m.envMap) { m.envMap = bakedEnv; m.envMapIntensity = ENV_INTENSITY[type] ?? ENV_INTENSITY[BASE_OF[type]] ?? 0.5; m.needsUpdate = true; }
          return m;
        }
        return n.endsWith('Accent') ? accent : n.endsWith('Dark') ? darkM : n.endsWith('Canopy') ? canopy : n.endsWith('Glow') ? glowM : hullM;
      };
      o.material = Array.isArray(o.material) ? o.material.map(pick) : pick(o.material);
    } else if (!mk?.engines?.length && /^engine/i.test(o.name)) empties.push(o);
    else if (/^spin/i.test(o.name) && !g.userData.spin) g.userData.spin = o;   // optional rotating part
  });
  // markers from the admin's marker editor replace the ones in the file (model coordinates)
  if (mk?.engines?.length) {
    for (const e of mk.engines) {
      const o = new THREE.Object3D(); o.position.set(...e.p);
      if (e.r) o.userData.plumeRadius = e.r;
      if (e.color) o.userData.plumeColor = e.color;
      inner.add(o); empties.push(o);
    }
  }
  if (mk?.guns?.length) g.userData.guns = mk.guns.map((p) => new THREE.Vector3(...p).multiplyScalar(scale).add(inner === g ? new THREE.Vector3() : inner.position).toArray());
  // A model with no engine markers gets one engine at the middle of its tail.
  if (!empties.length && fallbackEngine && g.userData.halfSize) {
    const e = new THREE.Object3D(); g.add(e); empties.push(e);
    const bb = new THREE.Box3().setFromObject(g); e.position.set((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, bb.max.z);
    e.userData.fallback = true;
  }
  const exhausts = [];
  const plumeCol = enemy ? 0xff5a22 : (VISUALS.plume[type] || VISUALS.plume[BASE_OF[type]] || color);
  for (const e of empties) {
    // plume sizes are in game metres: undo the fit scale for markers inside the scaled model
    const inScaled = !e.userData.fallback && e.parent !== g;
    const r = e.userData.plumeRadius ? e.userData.plumeRadius : (PLUME_RADIUS[type] || PLUME_RADIUS[BASE_OF[type]] || refSize(type) * 0.045) / (inScaled ? scale : 1);
    const col = e.userData.plumeColor || plumeCol;
    if (plumes) {
      const ex = buildExhaust(col, r);
      e.add(ex);
      exhausts.push(ex);
    }
    const eg = engineGlow(col, r * (plumes ? 1.1 : 4));   // small nozzle flare only
    e.add(eg);
    engines.push(eg);
  }
  // livery emblem: at the marker spots, or on top of the hull
  if (L?.emblem) {
    if (mk?.emblems?.length) for (const em of mk.emblems) inner.add(emblemDecal(L.emblem, em.p, em.n, em.size * (L.emblemSize || 1)));
    else autoEmblem(g, L.emblem, L.emblemSize || 1);
  }
  g.userData.engines = engines;
  if (plumes) g.userData.exhausts = exhausts;
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

// ---------------- exhaust plumes ----------------
// A nested pair of open cones pointing +Z (backwards): white-hot core inside a coloured sheath.
// group.userData.setThrust(k) scales length (0 idle .. 1 full boost).
const plumeGeo = (() => {
  const g = new THREE.CylinderGeometry(1, 0.15, 1, 20, 8, true);
  g.rotateX(Math.PI / 2);          // axis along Z
  g.translate(0, 0, 0.5);          // starts at nozzle, extends to +Z
  return g;
})();
function plumeMaterial(color, core) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uCore: { value: core ? 1 : 0 }, uTime: { value: 0 }, uPower: { value: 1 } },
    vertexShader: `varying float vT; varying vec3 vN; varying vec3 vV; varying float vEnd;
      void main(){ vT = position.z; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        vec3 axis = normalize(normalMatrix * vec3(0.0, 0.0, 1.0)); vEnd = abs(dot(axis, vV));
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uCore; uniform float uTime; uniform float uPower; varying float vT; varying vec3 vN; varying vec3 vV; varying float vEnd;
      void main(){
        float facing = abs(dot(normalize(vN), normalize(vV)));           // 1 at the centre line of the cone, 0 at its silhouette
        float along = pow(1.0 - clamp(vT, 0.0, 1.0), 1.6);                // fade towards the tail
        float flicker = 0.88 + 0.12 * sin(uTime * 55.0 + vT * 18.0);
        vec3 c = uCore > 0.5 ? mix(uColor, vec3(1.0), 0.7) : uColor * 1.15;
        float a = (uCore > 0.5 ? pow(facing, 2.0) * 1.0 : pow(facing, 1.2) * 0.5) * along * flicker * uPower * mix(1.0, 0.25, smoothstep(0.75, 0.98, vEnd));
        gl_FragColor = vec4(c * a * 2.2, 1.0);
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, toneMapped: false,
  });
}
export function buildExhaust(color, radius = 0.6) {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(plumeGeo, plumeMaterial(color, false));
  const inner = new THREE.Mesh(plumeGeo, plumeMaterial(color, true));
  outer.frustumCulled = inner.frustumCulled = false;
  g.add(outer, inner);
  const ring = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.9, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.4), toneMapped: false, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  g.add(ring);
  let k = 0;
  g.userData.setThrust = (target, dt, time) => {
    k += (target - k) * Math.min(1, dt * 6);
    const len = Math.min(radius * (3 + k * 14), 3 + k * 6.5) * VISUALS.plumeLength;   // stays well in front of the chase camera
    outer.scale.set(radius, radius, len);
    inner.scale.set(radius * 0.55, radius * 0.55, len * 0.8);
    for (const m of [outer, inner]) { m.material.uniforms.uTime.value = time; m.material.uniforms.uPower.value = 0.55 + k * 0.6; }
  };
  g.userData.setThrust(0, 1, 0);
  return g;
}

// ---------------- player ships ----------------
export function buildShip(type, color, opts = {}) {
  if (typeof opts === 'boolean') opts = { builtin: opts };
  const { builtin = false, livery = null } = opts;
  const L = typeof livery === 'string' ? liveryById(livery) : livery;
  if (!builtin && shipModelFor(type)) return buildShipFromModel(type, color, { livery: L });
  if (BASE_OF[type]) {
    // custom ship without its own model: the base ship's look
    const g = buildShip(BASE_OF[type], color, { livery: L });
    return g;
  }
  const g = buildShipProcedural(type, color, L);
  if (L?.emblem && !builtin) autoEmblem(g, L.emblem, L.emblemSize || 1);
  return g;
}
function buildShipProcedural(type, color, L = null) {
  const g = new THREE.Group();
  const accent = panelMaterial(L?.accent || color, { metalness: 0.4, roughness: 0.4 });
  const hullM = panelMaterial(L?.hull || 0xd6dbe2, { metalness: 0.5, roughness: 0.45 });
  const darkM = panelMaterial(L?.dark || 0x50565f, { metalness: 0.6, roughness: 0.5, repeat: 2 });
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
export function buildEntity(type, builtin = false) {
  if (!builtin && shipModelFor(type) && CUSTOM.has(type)) return buildEntityFromModel(type);
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

function buildEntityFromModel(type) {
  const flying = ['raider', 'bomber', 'gunship', 'freighter', 'wing'].includes(type);
  const g = buildShipFromModel(type, type === 'wing' ? '#9fb4c8' : '#d8322f', { enemy: type !== 'wing', plumes: type === 'wing', fallbackEngine: flying });
  if (type === 'core') {
    // keep the shield bubble that shows while the generators are up
    const r = Math.max(g.userData.halfSize.x, g.userData.halfSize.y, g.userData.halfSize.z) * 1.35;
    const shield = mesh(new THREE.SphereGeometry(r, 20, 14), new THREE.MeshBasicMaterial({ color: 0x55aaff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.add(shield); g.userData.shield = shield;
  }
  return g;
}

// ---------------- capital ship ----------------
export function buildDreadnought(builtin = false) {
  if (!builtin && shipModelFor('dreadnought') && CUSTOM.has('dreadnought')) return buildShipFromModel('dreadnought', '#d8322f', { enemy: true, plumes: false, fallbackEngine: false });
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
