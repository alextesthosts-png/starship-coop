// In-browser model optimizer for the admin panel: reduces triangles with meshoptimizer's
// simplifier (keeps UVs and materials, respects texture seams) and builds a far-detail version.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from '/vendor/meshoptimizer/meshopt_simplifier.js';

export function countTriangles(root) {
  let n = 0;
  root.traverse((o) => { if (o.isMesh && o.visible !== false) { const g = o.geometry; n += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  return Math.round(n);
}

// Returns a copy of `root` with about `target` triangles. Materials are shared with the original.
export async function simplifyScene(root, target, { lockBorder = true } = {}) {
  await MeshoptSimplifier.ready;
  const total = countTriangles(root);
  const ratio = Math.min(1, Math.max(0.005, target / Math.max(1, total)));
  const out = root.clone(true);
  const meshes = [];
  out.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    let g = m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (g.attributes[k].isInterleavedBufferAttribute) g.setAttribute(k, g.attributes[k].clone());
    if (!g.index) { try { g = mergeVertices(g, 1e-6); } catch {} }
    if (!g.index || ratio >= 0.999) { m.geometry = g; continue; }
    // Flat (per-face) normals stop triangles sharing vertices, and then nothing can be collapsed.
    // Weld by position + UV instead and rebuild smooth normals afterwards.
    let rebuildNormals = false;
    if (g.attributes.normal && g.attributes.position.count > g.index.count * 0.6) {
      const w = g.clone(); w.deleteAttribute('normal');
      for (const k of Object.keys(w.attributes)) if (!['position', 'uv'].includes(k)) w.deleteAttribute(k);
      try { const merged = mergeVertices(w.index ? w.toNonIndexed() : w, 1e-5); if (merged.attributes.position.count < g.attributes.position.count * 0.8) { merged.groups = g.groups.map((x) => ({ ...x })); g = merged; rebuildNormals = true; } } catch {}
    }
    const pa = g.attributes.position;
    const pos = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) { pos[i * 3] = pa.getX(i); pos[i * 3 + 1] = pa.getY(i); pos[i * 3 + 2] = pa.getZ(i); }
    const full = Uint32Array.from(g.index.array);
    const flags = lockBorder ? ['LockBorder'] : [];
    const simp = (idx) => {
      const want = Math.max(3, Math.floor((idx.length * ratio) / 3) * 3);
      let [res] = MeshoptSimplifier.simplify(idx, pos, 3, want, 0.02, flags);
      // allow more error when the gentle pass stops well short of the target
      if (res.length > want * 1.25) [res] = MeshoptSimplifier.simplify(idx, pos, 3, want, 0.08, flags);
      if (res.length > want * 1.25) [res] = MeshoptSimplifier.simplify(idx, pos, 3, want, 0.25, flags);
      return res;
    };
    // multi-material meshes: simplify each material group on its own so every part keeps its texture
    const groups = g.groups?.length ? g.groups.map((gr) => ({ ...gr })) : [{ start: 0, count: full.length, materialIndex: 0 }];
    const parts = groups.map((gr) => ({ mi: gr.materialIndex, idx: simp(full.slice(gr.start, gr.start + Math.min(gr.count, full.length - gr.start))) }));
    const merged = new Uint32Array(parts.reduce((n, p) => n + p.idx.length, 0));
    g.clearGroups();
    let at = 0;
    for (const p of parts) { merged.set(p.idx, at); if (groups.length > 1) g.addGroup(at, p.idx.length, p.mi); at += p.idx.length; }
    g.setIndex(new THREE.BufferAttribute(merged, 1));
    if (rebuildNormals) g.computeVertexNormals();
    m.geometry = g;
  }
  return out;
}

// Wraps a model for export as two detail levels the game switches between by distance.
export function withLod(near, far) {
  const holder = new THREE.Group();
  near.name = 'LOD0'; far.name = 'LOD1';
  // the far version doesn't need engine/gun empties: they live in the near one
  const drop = []; far.traverse((o) => { if (!o.isMesh && /^(engine|gun|spin)/i.test(o.name)) drop.push(o); });
  drop.forEach((o) => o.parent?.remove(o));
  holder.add(near, far);
  return holder;
}
