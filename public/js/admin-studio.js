// Admin "studio": marker editor, model optimizer, custom ships, liveries, mission editor,
// environments, sounds and scheduled events. Everything edits the same content document as the
// rest of the panel (Save as preview / Save & publish).
import { makeViewer, openModal, closeModal, uploadOne, loadMedia, fmtBytes, media } from './admin-ext.js';
import { SHIPS, MISSIONS, MODEL_SLOTS, ENEMIES } from '/shared/config.js';
import { SHIP_STAT_FIELDS, SFX_KEYS, ROLES, ROLE_LABEL, ENEMY_TYPES, MISSION_LIMITS, SPACE_KINDS, BASE_SHIPS, BASE_MISSIONS, activeEvents } from '/shared/gamecontent.js';

const $ = (id) => document.getElementById(id);
let V = null;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const doc = () => V.getDoc();
const changed = () => V.changed();
const rid = (p) => `${p}-${Math.random().toString(36).slice(2, 9)}`;
const models = () => media.items.filter((m) => m.kind === 'model');
const images = () => media.items.filter((m) => m.kind === 'image');
const sounds = () => media.items.filter((m) => m.kind === 'sound');
const allMissions = () => [...BASE_MISSIONS.map((id) => ({ id, name: MISSIONS.find((m) => m.id === id)?.name || id, env: MISSIONS.find((m) => m.id === id)?.env })), ...(doc().customMissions || []).map((m) => ({ id: m.id, name: m.name, env: m.env === 'planet' ? 'planet' : 'space', custom: true }))];
window.addEventListener('vw-ready', () => { V = window.VW; });
if (window.VW) V = window.VW;

// Pick a file from the media library (images / models / sounds).
function pickMedia(kind, title, onPick) {
  const list = media.items.filter((m) => m.kind === kind);
  const body = !list.length ? `<p class="hint">No ${kind}s in the Media library yet. Upload some there first.</p>`
    : kind === 'image' ? `<div class="pick-grid">${list.map((m) => `<button class="pick-item" data-url="${esc(m.url)}"><img src="${esc(m.url)}" alt="" loading="lazy"><span>${esc(m.name)}</span></button>`).join('')}</div>`
      : `<div class="pick-list">${list.map((m) => `<button class="pick-row" data-url="${esc(m.url)}"><b>${esc(m.name)}</b><span class="hint">${fmtBytes(m.size)}${m.report?.triangles ? ` · ${m.report.triangles.toLocaleString()} triangles` : ''}</span></button>`).join('')}</div>`;
  openModal(title, body);
  $('modal-body').onclick = (e) => { const b = e.target.closest('[data-url]'); if (!b) return; closeModal(); onPick(b.dataset.url); };
}
const nameOfUrl = (url) => media.items.find((m) => m.url === url)?.name || (url ? url.split('/').pop() : '');

// =====================================================================================
// MARKER EDITOR: click the model to place engines, guns and emblem spots; drag to move.
// Markers are stored per model file (content.modelMarkers[url]) in the model's own units.
// =====================================================================================
async function openMarkerEditor(url, name) {
  const existing = doc().modelMarkers?.[url];
  const M = { engines: [], guns: [], emblems: [] };
  if (existing) { M.engines = existing.engines.map((e) => ({ ...e, p: [...e.p] })); M.guns = existing.guns.map((g) => ({ p: [...g] })); M.emblems = existing.emblems.map((e) => ({ ...e, p: [...e.p], n: [...e.n] })); }
  openModal(`Markers · ${name}`, `<div class="inspector marker-ed"><div class="viewer tall" id="mk-viewer"><div class="hint">Loading model…</div></div>
    <div class="inspect-side">
      <div class="seg mk-tools" id="mk-tools"><button data-tool="move" class="on">✥ Move</button><button data-tool="engine">+ Engine</button><button data-tool="gun">+ Gun</button><button data-tool="emblem">+ Emblem</button></div>
      <p class="hint small" id="mk-help">Pick a tool, then click on the model. Click a marker to select it, then drag its arrows.</p>
      <div id="mk-list" class="mk-list"></div>
      <div id="mk-props"></div>
      <div class="row2"><button class="mini" id="mk-import">Copy markers from the file</button><button class="mini danger" id="mk-clear">Clear all</button></div>
      <p class="hint small">Engines get an exhaust plume, guns are where the cannons fire from (in this ship's slot), emblem spots carry the livery emblem. Positions are in the model's own units.</p>
      <button class="btn" id="mk-save">Save markers</button>
    </div></div>`);
  const view = await makeViewer($('mk-viewer'), url, { hideFileMarkers: true });
  if (!view.scene) return;
  window.VWS._viewer = view;
  const { THREE, scene, cam, renderer, controls } = view;
  const root = view.root;
  const box = new THREE.Box3().setFromObject(root); const R = Math.max(...box.getSize(new THREE.Vector3()).toArray()) || 1;
  const { TransformControls } = await import('three/addons/controls/TransformControls.js');
  const tc = new TransformControls(cam, renderer.domElement);
  tc.setSize(0.7);
  scene.add(tc.getHelper());
  tc.addEventListener('dragging-changed', (e) => { controls.enabled = !e.value; if (!e.value) syncFromObjects(); });
  const group = new THREE.Group(); root.add(group);
  let tool = 'move', sel = null; // {kind, i}
  const objs = [];
  const COLORS = { engine: 0xffb347, gun: 0xff5a4a, emblem: 0x7dff8a };
  function rebuild() {
    tc.detach();
    for (const o of objs) group.remove(o);
    objs.length = 0;
    const add = (kind, i, p, extra) => {
      let o;
      if (kind === 'emblem') {
        o = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: COLORS.emblem, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthTest: false }));
        o.scale.setScalar(extra.size || R * 0.15);
        o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...extra.n).normalize());
      } else {
        o = new THREE.Mesh(new THREE.SphereGeometry(kind === 'engine' ? (extra.r || R * 0.04) : R * 0.02, 16, 10), new THREE.MeshBasicMaterial({ color: kind === 'engine' && extra.color ? extra.color : COLORS[kind], transparent: true, opacity: 0.85, depthTest: false }));
        if (kind === 'engine') { const r = extra.r || R * 0.04; const cone = new THREE.Mesh(new THREE.ConeGeometry(r, r * 6, 16, 1, true), new THREE.MeshBasicMaterial({ color: extra.color || 0x66ccff, transparent: true, opacity: 0.25, depthTest: false })); cone.rotation.x = Math.PI / 2; cone.position.z = r * 3; o.add(cone); }
      }
      o.position.set(...p); o.renderOrder = 10; o.userData.ref = { kind, i };
      group.add(o); objs.push(o);
      if (sel && sel.kind === kind && sel.i === i) tc.attach(o);
    };
    M.engines.forEach((e, i) => add('engine', i, e.p, e));
    M.guns.forEach((g, i) => add('gun', i, g.p, {}));
    M.emblems.forEach((e, i) => add('emblem', i, e.p, e));
    renderList(); renderProps();
  }
  function syncFromObjects() {
    for (const o of objs) {
      const { kind, i } = o.userData.ref; const p = o.position.toArray().map((v) => +v.toFixed(4));
      (kind === 'engine' ? M.engines : kind === 'gun' ? M.guns : M.emblems)[i].p = p;
    }
    renderProps();
  }
  const listOf = (k) => (k === 'engine' ? M.engines : k === 'gun' ? M.guns : M.emblems);
  function renderList() {
    const rows = [];
    for (const k of ['engine', 'gun', 'emblem']) listOf(k).forEach((_, i) => rows.push(`<button class="mk-item ${sel?.kind === k && sel.i === i ? 'on' : ''}" data-k="${k}" data-i="${i}"><span class="dot" style="background:#${COLORS[k].toString(16)}"></span>${k[0].toUpperCase() + k.slice(1)} ${i + 1}</button>`));
    $('mk-list').innerHTML = rows.length ? rows.join('') : '<div class="hint small">No markers yet.</div>';
  }
  function renderProps() {
    if (!sel || !listOf(sel.kind)[sel.i]) { $('mk-props').innerHTML = ''; return; }
    const m = listOf(sel.kind)[sel.i];
    const xyz = ['x', 'y', 'z'].map((a, j) => `<label class="fld tiny"><span>${a}</span><input type="number" step="${(R / 200).toPrecision(2)}" data-xyz="${j}" value="${m.p[j]}"></label>`).join('');
    let extra = '';
    if (sel.kind === 'engine') extra = `<label class="fld"><span>Plume size (radius)</span><input type="range" min="${R * 0.005}" max="${R * 0.25}" step="${R * 0.002}" data-f="r" value="${m.r || R * 0.04}"></label>
      <label class="fld"><span>Plume colour</span><div class="row2"><input type="color" class="mk-color" data-f="color" value="${m.color || '#66ccff'}"><label class="switch"><input type="checkbox" data-f="pilot" ${m.color ? '' : 'checked'}> <span>pilot colour</span></label></div></label>`;
    if (sel.kind === 'emblem') extra = `<label class="fld"><span>Emblem size</span><input type="range" min="${R * 0.02}" max="${R * 0.6}" step="${R * 0.005}" data-f="size" value="${m.size || R * 0.15}"></label>`;
    $('mk-props').innerHTML = `<div class="card mk-card"><div class="row-between"><b>${sel.kind[0].toUpperCase() + sel.kind.slice(1)} ${sel.i + 1}</b><button class="mini danger" id="mk-del">Delete</button></div><div class="row3">${xyz}</div>${extra}</div>`;
  }
  $('mk-tools').onclick = (e) => { const b = e.target.closest('[data-tool]'); if (!b) return; tool = b.dataset.tool; [...$('mk-tools').children].forEach((x) => x.classList.toggle('on', x === b)); $('mk-help').textContent = tool === 'move' ? 'Click a marker to select it, then drag its arrows.' : `Click on the model to add ${tool === 'engine' ? 'an engine (put it on a nozzle)' : tool === 'gun' ? 'a gun (on a cannon tip)' : 'an emblem spot (on a flat panel)'}.`; };
  $('mk-list').onclick = (e) => { const b = e.target.closest('.mk-item'); if (!b) return; sel = { kind: b.dataset.k, i: +b.dataset.i }; rebuild(); };
  $('mk-props').oninput = (e) => {
    if (!sel) return;
    const m = listOf(sel.kind)[sel.i];
    if (e.target.dataset.xyz != null) { m.p[+e.target.dataset.xyz] = +e.target.value; const o = objs.find((x) => x.userData.ref.kind === sel.kind && x.userData.ref.i === sel.i); if (o) o.position.set(...m.p); return; }
    const f = e.target.dataset.f;
    if (f === 'r') m.r = +(+e.target.value).toFixed(4);
    if (f === 'size') m.size = +(+e.target.value).toFixed(4);
    if (f === 'color') { m.color = e.target.value; const cb = $('mk-props').querySelector('[data-f=pilot]'); if (cb) cb.checked = false; }
    if (f === 'pilot') m.color = e.target.checked ? '' : ($('mk-props').querySelector('[data-f=color]').value);
    rebuild();
  };
  $('mk-props').onclick = (e) => { if (e.target.id === 'mk-del' && sel) { listOf(sel.kind).splice(sel.i, 1); sel = null; rebuild(); } };
  $('mk-clear').onclick = () => { if (confirm('Remove every marker?')) { M.engines = []; M.guns = []; M.emblems = []; sel = null; rebuild(); } };
  $('mk-import').onclick = () => {
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    let n = 0;
    root.traverse((o) => {
      if (o.isMesh || o.parent === group || o === group) return;
      const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv).toArray().map((v) => +v.toFixed(4));
      if (/^engine/i.test(o.name)) { M.engines.push({ p, r: o.userData?.plumeRadius || R * 0.04, color: '' }); n++; }
      if (/^gun/i.test(o.name)) { M.guns.push({ p }); n++; }
    });
    rebuild(); V.toast(n ? `Copied ${n} marker${n > 1 ? 's' : ''} from the file.` : 'This file has no engine_ or gun_ markers.');
  };
  // click to add / select
  const rc = new THREE.Raycaster(); let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || tc.dragging) { down = null; return; }
    down = null;
    const r = renderer.domElement.getBoundingClientRect();
    rc.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), cam);
    const hitMarker = rc.intersectObjects(objs, false)[0];
    if (hitMarker && tool === 'move') { sel = { ...hitMarker.object.userData.ref }; rebuild(); return; }
    if (tool === 'move') return;
    const meshes = []; root.traverse((o) => { if (o.isMesh && o.parent !== group && !objs.includes(o) && !objs.includes(o.parent)) meshes.push(o); });
    const hit = rc.intersectObjects(meshes, false)[0];
    if (!hit) return;
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const p = hit.point.clone().applyMatrix4(inv).toArray().map((v) => +v.toFixed(4));
    if (tool === 'engine') { M.engines.push({ p, r: +(R * 0.04).toFixed(4), color: '' }); sel = { kind: 'engine', i: M.engines.length - 1 }; }
    if (tool === 'gun') { M.guns.push({ p }); sel = { kind: 'gun', i: M.guns.length - 1 }; }
    if (tool === 'emblem') {
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).transformDirection(inv) : new THREE.Vector3(0, 1, 0);
      M.emblems.push({ p, n: n.toArray().map((v) => +v.toFixed(4)), size: +(R * 0.15).toFixed(4) }); sel = { kind: 'emblem', i: M.emblems.length - 1 };
    }
    rebuild();
  });
  $('mk-save').onclick = () => {
    const d = doc();
    d.modelMarkers ??= {};
    if (!M.engines.length && !M.guns.length && !M.emblems.length) delete d.modelMarkers[url];
    else d.modelMarkers[url] = { engines: M.engines.map((e) => ({ p: e.p, r: e.r || 0, color: e.color || '' })), guns: M.guns.map((g) => g.p), emblems: M.emblems.map((e) => ({ p: e.p, n: e.n, size: e.size })) };
    changed(); closeModal();
    V.toast('Markers set. Save as preview to try them, or Save & publish.');
  };
  rebuild();
}

// =====================================================================================
// MODEL OPTIMIZER: fewer triangles, smaller textures, optional far-detail version.
// =====================================================================================
async function optimizerControls(el, original, { onShow }) {
  const O = await import('/js/optimize.js');
  const total = O.countTriangles(original);
  const min = Math.min(total, 1500);
  const suggested = Math.min(total, total > 120000 ? 40000 : total > 60000 ? Math.round(total * 0.5) : total);
  el.innerHTML = `<div class="opt-box"><div class="row-between"><b>Optimize</b><span class="hint small">original: ${total.toLocaleString()} triangles</span></div>
    <label class="fld"><span>Target triangles <b id="opt-n">${suggested.toLocaleString()}</b></span><input type="range" id="opt-target" min="0" max="1000" value="${Math.round(Math.log(suggested / min) / Math.log(total / min || 2) * 1000) || 1000}"></label>
    <label class="switch"><input type="checkbox" id="opt-lod" ${total > 20000 ? 'checked' : ''}> <span>Add a far-detail version (¼ of the triangles, used at a distance)</span></label>
    <label class="switch"><input type="checkbox" id="opt-border" checked> <span>Keep part edges sealed (no gaps between parts)</span></label>
    <div class="seg ab"><button id="opt-before" class="on">Before</button><button id="opt-after">After</button></div>
    <div id="opt-stat" class="hint small"></div></div>`;
  const target = () => { const v = +$('opt-target').value / 1000; return Math.max(min, Math.round(min * Math.pow(total / min || 1, v))); };
  $('opt-target').oninput = () => { $('opt-n').textContent = target().toLocaleString(); };
  let last = null;
  async function build() {
    const t = target();
    if (last && last.t === t && last.lock === $('opt-border').checked) return last;
    $('opt-stat').textContent = 'Simplifying…';
    await new Promise((r) => setTimeout(r, 20));
    const t0 = performance.now();
    const near = t >= total ? original.clone(true) : await O.simplifyScene(original, t, { lockBorder: $('opt-border').checked });
    const got = O.countTriangles(near);
    last = { t, lock: $('opt-border').checked, near, got };
    $('opt-stat').textContent = `${got.toLocaleString()} triangles (${Math.round((got / total) * 100)}% of the original) · ${Math.round(performance.now() - t0)} ms`;
    return last;
  }
  $('opt-before').onclick = () => { $('opt-before').classList.add('on'); $('opt-after').classList.remove('on'); onShow(original, total); };
  $('opt-after').onclick = async () => { $('opt-after').classList.add('on'); $('opt-before').classList.remove('on'); const b = await build(); onShow(b.near, b.got); };
  return {
    total,
    // the scene to export: optimized, plus a far-detail version when asked for
    async result() {
      const b = await build();
      if (!$('opt-lod').checked) return { root: b.near, tris: b.got, changed: b.t < total };
      const far = await O.simplifyScene(original, Math.max(400, Math.round(b.got / 4)), { lockBorder: false });
      return { root: O.withLod(b.near.clone(true), far), tris: b.got, farTris: O.countTriangles(far), changed: true };
    },
  };
}
// Optimize a GLB from the library; uploads "<name>-opt.glb" and can swap it in everywhere.
async function openOptimizer({ url, name }) {
  openModal(`Optimize · ${name}`, `<div class="inspector"><div class="viewer tall" id="op-viewer"><div class="hint">Loading model…</div></div>
    <div class="inspect-side"><div id="op-ctl"></div>
      <label class="fld"><span>Max texture size</span><select id="op-tex"><option>512</option><option>1024</option><option selected>2048</option><option>4096</option></select></label>
      <label class="switch"><input type="checkbox" id="op-swap" checked> <span>Use the optimized file wherever this one is used</span></label>
      <button class="btn" id="op-go">Optimize &amp; upload</button><div id="op-result"></div></div></div>`);
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  const original = gltf.scene;
  let view = null;
  const show = async (obj) => { view?.dispose(); view = await makeViewer($('op-viewer'), obj.clone(true)); window.VWS._viewer = view; };
  const ctl = await optimizerControls($('op-ctl'), original, { onShow: (o) => show(o) });
  await show(original);
  $('op-go').onclick = async () => {
    const btn = $('op-go'); btn.disabled = true; btn.textContent = 'Working…';
    try {
      const res = await ctl.result();
      const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
      const buf = await new GLTFExporter().parseAsync(res.root, { binary: true, maxTextureSize: +$('op-tex').value, onlyVisible: false });
      const outName = `${name.replace(/\.glb$/i, '').replace(/-opt$/, '')}-opt.glb`;
      if (buf.byteLength > 40 * 1048576) throw new Error(`Still ${fmtBytes(buf.byteLength)}: pick a smaller texture size or fewer triangles.`);
      await uploadOne(new File([buf], outName, { type: 'model/gltf-binary' }));
      await loadMedia();
      const m = media.items.filter((x) => x.name === outName).sort((a, b) => b.uploadedAt - a.uploadedAt)[0];
      if (m && $('op-swap').checked) swapModelEverywhere(url, m.url);
      $('op-result').innerHTML = `<div class="ok-box small">✓ ${esc(outName)} uploaded: ${res.tris.toLocaleString()} triangles${res.farTris ? ` + far version ${res.farTris.toLocaleString()}` : ''}, ${fmtBytes(buf.byteLength)}.${m && $('op-swap').checked ? ' Swapped in; save to publish.' : ''}</div>`;
      btn.textContent = 'Done';
    } catch (e) { $('op-result').innerHTML = `<div class="err-box small">${esc(e.message)}</div>`; btn.disabled = false; btn.textContent = 'Optimize & upload'; }
  };
}
function swapModelEverywhere(from, to) {
  const d = doc();
  for (const [k, v] of Object.entries(d.settings.shipModels || {})) if (v === from) d.settings.shipModels[k] = to;
  for (const c of d.customShips || []) if (c.model === from) c.model = to;
  if (d.modelMarkers?.[from]) d.modelMarkers[to] = JSON.parse(JSON.stringify(d.modelMarkers[from]));   // markers stay in the same model units
  changed();
}

window.VWS = { openMarkerEditor, openOptimizer, optimizerControls, _viewer: null };

// ---- the rest of the studio pages are in admin-pages.js ----
export { $, esc, doc, changed, rid, models, images, sounds, allMissions, pickMedia, nameOfUrl, makeViewer, openModal, closeModal, media, V as _V };
export const getV = () => V;
import('./admin-pages.js');
