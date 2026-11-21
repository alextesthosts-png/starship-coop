// OBJ -> GLB converter for the admin panel. Runs entirely in the browser:
// reads a .zip (or loose .obj + .mtl + textures), shows a preview, then exports a .glb that the
// game and the media library already understand. The game itself only ever loads GLB.
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { unzipSync } from 'three/addons/libs/fflate.module.js';

const IMG = /\.(png|jpe?g|webp|gif|bmp|tga)$/i;
const base = (p) => p.split(/[\\/]/).pop().toLowerCase();
const mimeOf = (n) => /\.png$/i.test(n) ? 'image/png' : /\.jpe?g$/i.test(n) ? 'image/jpeg' : /\.webp$/i.test(n) ? 'image/webp' : /\.gif$/i.test(n) ? 'image/gif' : 'application/octet-stream';
export const isObjPackage = (f) => /\.(obj|zip|mtl)$/i.test(f.name);

// Collect every file (from zips and loose files) into { lowerBasename: { name, data } }.
export async function readPackage(files) {
  const out = {};
  for (const f of files) {
    const buf = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(f.name)) {
      let entries;
      try { entries = unzipSync(buf); } catch { throw new Error(`${f.name} is not a readable zip file.`); }
      for (const [path, data] of Object.entries(entries)) {
        if (path.endsWith('/') || /(^|\/)(__MACOSX|\.)/.test(path)) continue;
        out[base(path)] = { name: path.split('/').pop(), data };
      }
    } else out[base(f.name)] = { name: f.name, data: buf };
  }
  return out;
}
export const objNames = (pkg) => Object.values(pkg).filter((f) => /\.obj$/i.test(f.name)).map((f) => f.name);

// Load one .obj with its materials and textures. Returns { root, stats }.
export async function loadObj(pkg, objName) {
  const dec = new TextDecoder();
  const obj = pkg[objName.toLowerCase()];
  if (!obj) throw new Error('No .obj file found in what you dropped.');
  // Line ("l") and point ("p") records would turn a whole object into wireframe lines in
  // OBJLoader, so drop them: the game only draws surfaces.
  const objText = dec.decode(obj.data).replace(/^[ \t]*[lp][ \t][^\n]*$/gm, '');
  const urls = {}, missing = new Set(), used = new Set();
  for (const [k, f] of Object.entries(pkg)) if (IMG.test(k)) urls[k] = URL.createObjectURL(new Blob([f.data], { type: mimeOf(k) }));
  const manager = new THREE.LoadingManager();
  let pending = 0, doneResolve;
  const done = new Promise((r) => { doneResolve = r; });
  manager.onStart = () => { pending++; };
  manager.onLoad = () => doneResolve();
  manager.onError = (u) => missing.add(base(decodeURI(u)));
  manager.setURLModifier((u) => {
    if (u.startsWith('blob:') || u.startsWith('data:')) return u;
    const b = base(decodeURI(u));
    if (urls[b]) { used.add(b); return urls[b]; }
    missing.add(b);
    return 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';   // 1px placeholder, so loading continues
  });
  const loader = new OBJLoader(manager);
  // the .obj names its material library; fall back to any .mtl in the package
  const lib = (objText.match(/^mtllib\s+(.+)$/m) || [])[1]?.trim();
  const mtl = (lib && pkg[base(lib)]) || Object.values(pkg).find((f) => /\.mtl$/i.test(f.name));
  if (mtl) {
    const mc = new MTLLoader(manager).parse(dec.decode(mtl.data), '');
    mc.preload();
    loader.setMaterials(mc);
  }
  const root = loader.parse(objText);
  if (pending) await Promise.race([done, new Promise((r) => setTimeout(r, 20000))]);
  else await new Promise((r) => setTimeout(r, 0));
  // drop lines/points, index geometry, count triangles
  const drop = [];
  let tris = 0;
  const mats = new Set();
  root.traverse((o) => {
    if (o.isLine || o.isPoints) { drop.push(o); return; }
    if (!o.isMesh) return;
    let g = o.geometry;
    if (!g.index) { try { g = mergeVertices(g, 1e-6); o.geometry.dispose(); o.geometry = g; } catch {} }
    if (!g.attributes.normal) g.computeVertexNormals();
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    for (const m of [].concat(o.material)) mats.add(m);
  });
  drop.forEach((o) => o.parent.remove(o));
  const textures = new Set();
  for (const m of mats) for (const k of ['map', 'emissiveMap', 'normalMap', 'bumpMap', 'specularMap', 'alphaMap']) if (m[k]) textures.add(m[k]);
  return {
    root,
    stats: { triangles: Math.round(tris), materials: mats.size, textures: used.size, missing: [...missing].filter((m) => m && !urls[m]), hasMtl: !!mtl },
    dispose: () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u)),
  };
}

const AXES = { '-z': [0, 0, -1], '+z': [0, 0, 1], '-x': [-1, 0, 0], '+x': [1, 0, 0], '-y': [0, -1, 0], '+y': [0, 1, 0] };
// Rotation that turns the model's nose to -Z (the game's forward) and its top to +Y.
export function orientation(forward = '-z', up = '+y') {
  const f = new THREE.Vector3(...AXES[forward]), u = new THREE.Vector3(...AXES[up]);
  if (Math.abs(f.dot(u)) > 0.5) return null;
  const r = new THREE.Vector3().crossVectors(f, u);
  const src = new THREE.Matrix4().makeBasis(r, u, f);
  const dst = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
  return new THREE.Quaternion().setFromRotationMatrix(dst.multiply(src.transpose()));
}

// Build the export scene: oriented, centred, scaled so its longest side is `length` metres, with
// PBR materials. keepLook adds the "Baked" suffix so the game shows the model's own textures.
export function prepareForExport(root, { forward, up, keepLook = true, length = 14 }) {
  const q = orientation(forward, up) || new THREE.Quaternion();
  const holder = new THREE.Group();
  const model = root.clone(true);
  model.quaternion.copy(q);
  holder.add(model);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const s = length / (Math.max(size.x, size.y, size.z) || 1);
  model.position.copy(c).multiplyScalar(-s);
  model.scale.setScalar(s);
  const cache = new Map();
  model.traverse((o) => {
    if (!o.isMesh) return;
    const conv = (m) => {
      if (cache.has(m)) return cache.get(m);
      const shin = m.shininess ?? 30;
      const std = new THREE.MeshStandardMaterial({
        name: `${(m.name || 'Material').replace(/[^\w.-]/g, '_')}${keepLook ? '_Baked' : ''}`,
        color: m.color ? m.color.clone() : new THREE.Color(0xcccccc),
        map: m.map || null,
        emissive: m.emissive ? m.emissive.clone() : new THREE.Color(0),
        emissiveMap: m.emissiveMap || null,
        normalMap: m.normalMap || null,
        alphaMap: m.alphaMap || null,
        transparent: !!m.transparent && m.opacity < 1,
        opacity: m.opacity ?? 1,
        side: m.side ?? THREE.FrontSide,
        vertexColors: !!m.vertexColors,
        roughness: Math.min(1, Math.max(0.08, Math.sqrt(2 / (shin + 2)))),
        metalness: 0.25,
      });
      // emissive colours above 1 (common in .mtl "Ke") become emissive strength
      const peak = Math.max(std.emissive.r, std.emissive.g, std.emissive.b);
      if (peak > 1) { std.emissive.multiplyScalar(1 / peak); std.emissiveIntensity = peak; }
      if (std.emissiveMap && peak === 0) std.emissive.set(0xffffff);
      for (const k of ['map', 'emissiveMap', 'normalMap', 'alphaMap']) {
        const t = std[k];
        if (t?.image?.src && !t.userData.mimeType) t.userData.mimeType = /\.png|image\/png/i.test(t.image.src) ? 'image/png' : 'image/jpeg';
      }
      cache.set(m, std);
      return std;
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
  holder.userData.size = size.clone().multiplyScalar(s);
  return holder;
}

export async function exportGlb(holder, { maxTextureSize = 2048 } = {}) {
  holder.name = 'Model';
  return new GLTFExporter().parseAsync(holder, { binary: true, maxTextureSize, onlyVisible: true });
}
