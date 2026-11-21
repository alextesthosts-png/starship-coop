// Admin panel extensions: media library, ships & models, feature flags, server health.
const $ = (id) => document.getElementById(id);
let V = null;               // helpers from admin.js (api, toast, esc, getDoc, changed, fillBindings)
let media = { status: null, items: [] };
const esc = (s) => V.esc(s);
const fmtBytes = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
function setPath(o, p, v) { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; }

window.addEventListener('vw-ready', () => { V = window.VW; refreshPickers(); loadMedia(); });
window.addEventListener('vw-page', (e) => {
  if (e.detail === 'media') loadMedia();
  if (e.detail === 'ships') loadMedia().then(renderShips);
  if (e.detail === 'flags') loadFlags();
  if (e.detail === 'health') startHealth(); else stopHealth();
});

// ---------------- modal ----------------
function openModal(title, html) { $('modal-title').textContent = title; $('modal-body').innerHTML = html; $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); $('modal-body').innerHTML = ''; viewer?.dispose(); viewer = null; }
$('modal-close').onclick = closeModal;
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal').classList.contains('hidden')) closeModal(); });

// ================= MEDIA LIBRARY =================
async function loadMedia() {
  try { media = await V.api('GET', 'media'); } catch (e) { media = { status: { configured: false, error: e.message }, items: [] }; }
  renderMediaStatus(); renderMediaGrid(); refreshPickers();
}
function renderMediaStatus() {
  const s = media.status || {};
  const box = $('media-status');
  if (!s.configured) {
    box.innerHTML = `<b>No bucket connected in this environment.</b> <span class="hint">Uploads need the Railway bucket variables (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY). Preview environments get their own empty bucket only if one is provisioned there.</span>`;
    $('dropzone').classList.add('disabled');
    return;
  }
  $('dropzone').classList.remove('disabled');
  const imgs = media.items.filter((m) => m.kind === 'image').length, models = media.items.length - imgs;
  box.innerHTML = `<div class="stat-row"><div><b>${media.items.length}</b><span>files</span></div><div><b>${imgs}</b><span>images</span></div><div><b>${models}</b><span>models</span></div><div><b>${fmtBytes(s.bytes || 0)}</b><span>stored</span></div><div class="grow muted small">Railway bucket <code>${esc(s.bucket)}</code></div></div>`;
}
let filter = 'all';
$('media-filter').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; filter = b.dataset.f; [...$('media-filter').children].forEach((x) => x.classList.toggle('on', x === b)); renderMediaGrid(); };
$('media-search').oninput = () => renderMediaGrid();
function usedBy(url) {
  const d = V.getDoc(); const out = [];
  if (d.announcement.image === url) out.push('announcement');
  if (d.settings.background === url) out.push('background');
  for (const [k, v] of Object.entries(d.settings.shipModels || {})) if (v === url) out.push(`${k} model`);
  if (d.sections.some((s) => s.body.includes(url))) out.push('a section');
  if (d.changelog.some((r) => r.items.some((t) => t.includes(url)))) out.push('changelog');
  return out;
}
function renderMediaGrid() {
  const q = $('media-search').value.trim().toLowerCase();
  const items = media.items.filter((m) => (filter === 'all' || m.kind === filter) && (!q || m.name.toLowerCase().includes(q)));
  $('media-grid').innerHTML = items.length ? items.map((m) => {
    const used = usedBy(m.url);
    const thumb = m.kind === 'image' ? `<img src="${esc(m.url)}" alt="" loading="lazy">` : `<div class="model-thumb">GLB<small>${m.report?.triangles ? `${(m.report.triangles / 1000).toFixed(1)}k tris` : '3D model'}</small></div>`;
    const warn = m.report?.warnings?.length ? `<span class="badge warn" title="${esc(m.report.warnings.join('\n'))}">${m.report.warnings.length} note${m.report.warnings.length > 1 ? 's' : ''}</span>` : '';
    return `<div class="media-card" data-key="${esc(m.key)}">
      <div class="media-thumb" data-act="view">${thumb}</div>
      <div class="media-meta"><div class="mname" title="${esc(m.name)}">${esc(m.name)}</div>
        <div class="hint small">${fmtBytes(m.size)}${m.width ? ` · ${m.width}×${m.height}` : ''} · ${new Date(m.uploadedAt).toLocaleDateString()}</div>
        <div class="badges">${used.map((u) => `<span class="badge">${esc(u)}</span>`).join('')}${warn}</div></div>
      <div class="media-actions"><button class="mini" data-act="view">${m.kind === 'model' ? 'Inspect' : 'View'}</button><button class="mini" data-act="copy">Copy link</button><button class="mini danger" data-act="del">Delete</button></div>
    </div>`;
  }).join('') : `<div class="card empty">${media.items.length ? 'Nothing matches.' : 'No files yet. Drop some above.'}</div>`;
}
$('media-grid').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const m = media.items.find((x) => x.key === b.closest('.media-card').dataset.key); if (!m) return;
  if (b.dataset.act === 'copy') {
    const text = m.kind === 'image' ? `![${m.name.replace(/\.[a-z]+$/i, '')}](${m.url})` : m.url;
    try { await navigator.clipboard.writeText(text); V.toast(m.kind === 'image' ? 'Copied: paste it into a section or changelog line.' : 'Link copied.'); } catch { V.toast(text); }
  } else if (b.dataset.act === 'del') {
    const used = usedBy(m.url);
    if (!confirm(`Delete ${m.name}?${used.length ? `\n\nIt is still used by: ${used.join(', ')}. Those spots will show nothing until you pick another file.` : ''}`)) return;
    try { await V.api('DELETE', `media?key=${encodeURIComponent(m.key)}`); V.toast('Deleted.'); loadMedia(); } catch (err) { V.toast(err.message); }
  } else if (b.dataset.act === 'view') {
    if (m.kind === 'image') openModal(m.name, `<img class="full-img" src="${esc(m.url)}" alt=""><p class="hint">${m.width}×${m.height} · ${fmtBytes(m.size)} · <code>${esc(m.url)}</code></p>`);
    else openModelInspector(m);
  }
});
$('btn-resync').onclick = async () => {
  try { const r = await V.api('POST', 'media/resync'); media.items = r.items; renderMediaStatus(); renderMediaGrid(); V.toast(`Bucket re-scanned: ${r.count} files.`); } catch (e) { V.toast(e.message); }
};

// ----- uploads (XHR for progress) -----
const dz = $('dropzone');
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', (e) => uploadFiles([...e.dataTransfer.files]));
$('media-file').onchange = (e) => { uploadFiles([...e.target.files]); e.target.value = ''; };
function uploadFiles(files) {
  if (!media.status?.configured) { V.toast('No bucket connected here.'); return; }
  let chain = Promise.resolve();
  for (const f of files) chain = chain.then(() => uploadOne(f));
  chain.then(() => loadMedia());
}
function uploadOne(file) {
  return new Promise((resolve) => {
    const row = document.createElement('div');
    row.className = 'upload-row';
    row.innerHTML = `<span class="uname">${esc(file.name)}</span><span class="hint">${fmtBytes(file.size)}</span><div class="ubar"><i></i></div><span class="ustat">Uploading…</span>`;
    $('uploads').prepend(row);
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/admin/media');
    xhr.setRequestHeader('x-vw-admin', '1');
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) row.querySelector('i').style.width = `${(e.loaded / e.total) * 100}%`; };
    xhr.onload = () => {
      let r = {}; try { r = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status === 200) {
        row.classList.add('ok');
        const notes = r.report?.warnings?.length ? ` · ${r.report.warnings.length} note(s), see Inspect` : '';
        row.querySelector('.ustat').textContent = `Uploaded${notes}`;
      } else { row.classList.add('err'); row.querySelector('.ustat').textContent = r.error || `Failed (${xhr.status})`; }
      setTimeout(() => row.remove(), 12000);
      resolve();
    };
    xhr.onerror = () => { row.classList.add('err'); row.querySelector('.ustat').textContent = 'Network error'; resolve(); };
    xhr.send(file);
  });
}

// ----- picking images for the announcement / background -----
document.addEventListener('click', (e) => {
  const pick = e.target.closest('[data-pick]'); const clear = e.target.closest('[data-clear]');
  if (pick) openImagePicker(pick.dataset.pick);
  if (clear) { setPath(V.getDoc(), clear.dataset.clear, ''); V.changed(); refreshPickers(); }
});
function openImagePicker(path) {
  const imgs = media.items.filter((m) => m.kind === 'image');
  openModal('Choose an image', imgs.length ? `<div class="pick-grid">${imgs.map((m) => `<button class="pick-item" data-url="${esc(m.url)}"><img src="${esc(m.url)}" alt="" loading="lazy"><span>${esc(m.name)}</span></button>`).join('')}</div>`
    : '<p class="hint">No images yet. Upload some in the Media library first.</p>');
  $('modal-body').onclick = (e) => {
    const b = e.target.closest('.pick-item'); if (!b) return;
    setPath(V.getDoc(), path, b.dataset.url); V.changed(); refreshPickers(); closeModal();
    V.toast('Image chosen. Save to publish.');
  };
}
function refreshPickers() {
  if (!V) return;
  const d = V.getDoc();
  const set = (id, url) => { const el = $(id); el.classList.toggle('hidden', !url); if (url) el.src = url; };
  set('ann-img-thumb', d.announcement.image); set('bg-thumb', d.settings.background);
  $('dim-val').textContent = `${Math.round((+d.settings.backgroundDim || 0) * 100)}%`;
}
document.addEventListener('input', (e) => { if (e.target.dataset?.bind === 'settings.backgroundDim') { V.getDoc().settings.backgroundDim = +e.target.value; refreshPickers(); } });

// ================= 3D MODEL INSPECTOR =================
let viewer = null;
async function openModelInspector(m, onUse) {
  const r = m.report || {};
  const rows = [['Triangles', r.triangles?.toLocaleString()], ['Size (W × H × L)', r.size ? r.size.join(' × ') : '?'], ['Engine markers', r.engines], ['Gun markers', r.guns],
    ['Materials', (r.materials || []).join(', ')], ['Textures', r.images], ['Keeps own look (…Baked)', r.baked ? 'yes' : 'no'], ['Made with', r.generator]];
  openModal(m.name, `<div class="inspector"><div class="viewer" id="viewer"><div class="hint">Loading model…</div></div>
    <div class="inspect-side"><table class="kv">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${esc(v ?? '—')}</td></tr>`).join('')}</table>
    ${(r.warnings || []).length ? `<div class="warn-box">${r.warnings.map((w) => `<div>⚠ ${esc(w)}</div>`).join('')}</div>` : '<div class="ok-box">✓ Looks game-ready</div>'}
    <p class="hint small">Drag to orbit, scroll to zoom. The cyan arrow is the game's forward direction; amber dots are engine markers, red dots are gun markers.</p>
    ${onUse ? '<div id="use-slot"></div>' : ''}</div></div>`);
  if (onUse) onUse($('use-slot'));
  viewer = await makeViewer($('viewer'), m.url);
}
async function makeViewer(el, url) {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
  const w = el.clientWidth || 520, h = el.clientHeight || 380;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(w, h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
  el.innerHTML = ''; el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.DirectionalLight(0xffffff, 2).translateX(5).translateY(8).translateZ(6));
  const cam = new THREE.PerspectiveCamera(40, w / h, 0.05, 2000);
  const controls = new OrbitControls(cam, renderer.domElement); controls.enableDamping = true;
  let running = true;
  const disposeAll = () => { running = false; controls.dispose(); renderer.dispose(); pmrem.dispose(); };
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene; scene.add(root);
    const box = new THREE.Box3().setFromObject(root); const size = box.getSize(new THREE.Vector3()); const c = box.getCenter(new THREE.Vector3());
    const R = Math.max(size.x, size.y, size.z) || 1;
    root.traverse((o) => {
      const col = /^engine/i.test(o.name) ? 0xffb347 : /^gun/i.test(o.name) ? 0xff5a4a : null;
      if (col && !o.isMesh) o.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.025, 12, 8), new THREE.MeshBasicMaterial({ color: col, depthTest: false })));
    });
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(c.x, c.y, box.min.z), R * 0.35, 0x6fd6ff, R * 0.08, R * 0.05);
    scene.add(arrow);
    scene.add(new THREE.Box3Helper(box, 0x2a7aa0));
    cam.position.set(c.x + R * 0.9, c.y + R * 0.6, c.z + R * 1.1); controls.target.copy(c); controls.update();
  } catch (e) { el.innerHTML = `<div class="err-box">Could not load this model: ${esc(e.message)}</div>`; disposeAll(); return { dispose() {} }; }
  (function loop() { if (!running) return; requestAnimationFrame(loop); controls.update(); renderer.render(scene, cam); })();
  return { dispose: disposeAll };
}

// ================= SHIPS & MODELS =================
const SHIP_INFO = { lancer: ['Lancer', 'Interceptor', '/models/lancer.glb'], warden: ['Warden', 'Heavy fighter', '/models/warden.glb'], hammer: ['Hammer', 'Bomber', null] };
function renderShips() {
  const d = V.getDoc(); const models = media.items.filter((m) => m.kind === 'model');
  $('ship-models').innerHTML = Object.entries(SHIP_INFO).map(([k, [name, role, builtin]]) => {
    const cur = d.settings.shipModels?.[k] || '';
    const m = models.find((x) => x.url === cur);
    const opts = [`<option value="">Built-in ${builtin ? 'model' : '(procedural)'}</option>`, ...models.map((x) => `<option value="${esc(x.url)}" ${x.url === cur ? 'selected' : ''}>${esc(x.name)}</option>`)].join('');
    const notes = m?.report?.warnings?.length ? `<div class="warn-box small">${m.report.warnings.map((w) => `<div>⚠ ${esc(w)}</div>`).join('')}</div>` : cur ? '<div class="ok-box small">✓ Ready</div>' : '';
    return `<div class="card ship-row" data-ship="${k}"><div class="ship-name"><b>${name}</b><span class="hint">${role}</span></div>
      <label class="fld grow"><span>3D model</span><select data-ship-model="${k}">${opts}</select></label>
      <div class="ship-btns">${cur ? '<button class="mini" data-act="inspect">Inspect</button>' : builtin ? '<button class="mini" data-act="inspect-builtin">View built-in</button>' : ''}</div>
      <div class="ship-notes">${notes}${cur && !m ? '<div class="warn-box small">⚠ This file is no longer in the library.</div>' : ''}</div></div>`;
  }).join('') + (models.length ? '' : '<p class="hint">Upload a .glb in the Media library to offer it here.</p>');
}
$('ship-models').addEventListener('change', (e) => {
  const k = e.target.dataset.shipModel; if (!k) return;
  const d = V.getDoc(); d.settings.shipModels = { ...(d.settings.shipModels || {}), [k]: e.target.value };
  V.changed(); renderShips(); V.toast('Model chosen. Save to publish; players get it on their next visit.');
});
$('ship-models').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const k = b.closest('.ship-row').dataset.ship; const d = V.getDoc();
  if (b.dataset.act === 'inspect') { const m = media.items.find((x) => x.url === d.settings.shipModels[k]); if (m) openModelInspector(m); }
  if (b.dataset.act === 'inspect-builtin') {
    let report = {};
    try { report = await V.api('GET', `inspect-builtin?ship=${k}`); } catch (err) { report = { warnings: [`Couldn't read the model's details: ${err.message}`] }; }
    openModelInspector({ name: `${SHIP_INFO[k][0]} (built-in)`, url: SHIP_INFO[k][2], report });
  }
});

// ================= FEATURE FLAGS =================
async function loadFlags() {
  try { renderFlags(await V.api('GET', 'flags')); } catch (e) { $('flags-list').innerHTML = `<div class="card err-box">${esc(e.message)}</div>`; }
}
function renderFlags({ flags, railway }) {
  $('flags-source').innerHTML = railway.enabled
    ? `<b class="ok-text">● Connected to Railway feature flags</b> <span class="hint">Values come from your Railway project (Settings → Feature Flags) and refresh about every 10 s. An override here wins over Railway until you clear it.</span> <button class="mini" id="flags-refresh">Refresh now</button>`
    : `<b class="warn-text">● Railway flags not connected</b> <span class="hint">${esc(railway.error || '')} The switches below still work instantly as overrides stored on the game server.</span>`;
  const groups = {};
  for (const f of flags) (groups[f.group] ||= []).push(f);
  $('flags-list').innerHTML = Object.entries(groups).map(([g, list]) => `<div class="card"><h3>${esc(g)}</h3>${list.map((f) => `
    <div class="flag-row">
      <label class="toggle"><input type="checkbox" data-flag="${esc(f.name)}" ${f.value ? 'checked' : ''}><span></span></label>
      <div class="grow"><b>${esc(f.label)}</b> <code class="hint">${esc(f.name)}</code>${f.desc ? `<div class="hint small">${esc(f.desc)}</div>` : ''}</div>
      <span class="src ${f.source}">${f.source === 'override' ? 'Admin override' : f.source === 'railway' ? 'From Railway' : 'Default'}</span>
      ${f.source === 'override' ? `<button class="mini" data-clear-flag="${esc(f.name)}" title="Go back to the Railway/default value">Clear override</button>` : ''}
    </div>`).join('')}</div>`).join('');
}
$('flags-list').addEventListener('change', async (e) => {
  const name = e.target.dataset.flag; if (!name) return;
  try { renderFlags(await V.api('POST', 'flags', { name, value: e.target.checked })); V.toast('Updated: every player sees it within seconds.'); } catch (err) { V.toast(err.message); loadFlags(); }
});
$('flags-list').addEventListener('click', async (e) => {
  const name = e.target.dataset.clearFlag; if (!name) return;
  try { renderFlags(await V.api('POST', 'flags', { name, value: null })); V.toast('Override cleared.'); } catch (err) { V.toast(err.message); }
});
$('flags-source').addEventListener('click', async (e) => {
  if (e.target.id !== 'flags-refresh') return;
  try { renderFlags(await V.api('POST', 'flags/refresh')); V.toast('Refreshed from Railway.'); } catch (err) { V.toast(err.message); }
});

// ================= SERVER HEALTH =================
let healthTimer = null, minutes = 60;
$('health-range').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; minutes = +b.dataset.m; [...$('health-range').children].forEach((x) => x.classList.toggle('on', x === b)); loadHealth(); };
function startHealth() { loadHealth(); clearInterval(healthTimer); healthTimer = setInterval(loadHealth, 15000); }
function stopHealth() { clearInterval(healthTimer); healthTimer = null; }
const dur = (s) => s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
async function loadHealth() {
  let h; try { h = await V.api('GET', `health?minutes=${minutes}`); } catch (e) { $('health-cards').innerHTML = `<div class="card err-box">${esc(e.message)}</div>`; return; }
  const a = h.app, S = a.series, last = S[S.length - 1] || {};
  const totReq = S.reduce((n, x) => n + x.req, 0), tot5 = S.reduce((n, x) => n + x.s5, 0);
  const errRate = totReq ? (tot5 / totReq) * 100 : 0;
  const card = (label, value, sub, cls = '') => `<div class="hcard ${cls}"><span>${label}</span><b>${value}</b><small>${sub || ''}</small></div>`;
  $('health-cards').innerHTML = [
    card('Status', errRate > 5 ? 'Degraded' : 'Healthy', `up ${dur(a.uptimeSec)}`, errRate > 5 ? 'bad' : 'good'),
    card('Pilots online', a.gauges.players ?? 0, `${a.gauges.rooms ?? 0} wings · ${a.gauges.playing ?? 0} in flight`),
    card('Requests', totReq.toLocaleString(), `last ${minutes >= 60 ? minutes / 60 + ' h' : minutes + ' min'}`),
    card('Error rate', `${errRate.toFixed(2)}%`, `${tot5} server errors (5xx)`, errRate > 1 ? 'bad' : 'good'),
    card('Latency p95', `${last.latP95 ?? 0} ms`, `avg ${last.latAvg ?? 0} ms`),
    card('Memory', `${a.memory.rssMB} MB`, `heap ${a.memory.heapMB} MB`),
    card('CPU', `${last.cpu ?? 0}%`, `event loop lag ${a.lagMs} ms`),
    card('Game loop', `${last.tickAvg ?? 0} ms`, `max ${last.tickMax ?? 0} ms per 33 ms tick`, (last.tickMax || 0) > 25 ? 'bad' : ''),
  ].join('');
  const t = S.map((x) => x.t);
  const charts = [
    { title: 'Requests per minute', sets: [['2xx', S.map((x) => x.s2), '#6cff9a'], ['3xx', S.map((x) => x.s3), '#6fd6ff'], ['4xx', S.map((x) => x.s4), '#ffd36a'], ['5xx', S.map((x) => x.s5), '#ff5a4a']], stacked: true },
    { title: 'Error rate (5xx %)', sets: [['errors', S.map((x) => (x.req ? (x.s5 / x.req) * 100 : 0)), '#ff5a4a']], unit: '%' },
    { title: 'Response time (ms)', sets: [['p95', S.map((x) => x.latP95), '#ffb347'], ['average', S.map((x) => x.latAvg), '#6fd6ff']], unit: 'ms' },
    { title: 'Memory (MB)', sets: [['RSS', S.map((x) => x.rssMB), '#b18cff'], ['heap', S.map((x) => x.heapMB), '#6fd6ff']], unit: 'MB' },
    { title: 'CPU (% of one core)', sets: [['CPU', S.map((x) => x.cpu), '#6cff9a']], unit: '%' },
    { title: 'Pilots & wings', sets: [['pilots', S.map((x) => x.players), '#6fd6ff'], ['wings in flight', S.map((x) => x.playing), '#ffd36a']] },
    { title: 'Realtime messages / min', sets: [['to players', S.map((x) => x.wsOut), '#6fd6ff'], ['from players', S.map((x) => x.wsIn), '#6cff9a']] },
    { title: 'Game loop & event loop (ms)', sets: [['tick max', S.map((x) => x.tickMax), '#ff5a4a'], ['tick avg', S.map((x) => x.tickAvg), '#ffb347'], ['event loop lag', S.map((x) => x.lagMs), '#b18cff']], unit: 'ms' },
  ];
  drawChartGrid($('charts-app'), charts, t);
  // Railway platform
  const P = h.platform;
  if (!P.configured) {
    $('platform').innerHTML = `<div class="card"><b>Connect Railway's own metrics</b><p class="hint">Railway measures CPU, memory and network for every service. To show them here, create a <b>project token</b> (Railway → this project → Settings → Tokens, environment “production”) and add it to the <b>vanguard-wing</b> service as the variable <code>RAILWAY_TOKEN</code>. The same token also connects Railway feature flags.</p></div>`;
  } else {
    const block = (name, d) => {
      if (d.error) return `<div class="card"><b>${name}</b><p class="hint">${esc(d.error)}</p></div>`;
      const ser = d.series || {};
      const pick = (k) => (ser[k] || []);
      const tt = pick('MEMORY_USAGE_GB').map((p) => p[0]);
      const wrap = document.createElement('div');
      wrap.innerHTML = `<h4>${name}</h4><div class="chart-grid"></div>`;
      drawChartGrid(wrap.querySelector('.chart-grid'), [
        { title: 'CPU (vCPU)', sets: [['CPU', pick('CPU_USAGE').map((p) => p[1]), '#6cff9a']] },
        { title: 'Memory (MB)', sets: [['memory', pick('MEMORY_USAGE_GB').map((p) => p[1] * 1024), '#b18cff']], unit: 'MB' },
        { title: 'Network (MB)', sets: [['in', pick('NETWORK_RX_GB').map((p) => p[1] * 1024), '#6fd6ff'], ['out', pick('NETWORK_TX_GB').map((p) => p[1] * 1024), '#ffd36a']], unit: 'MB' },
      ], tt);
      return wrap;
    };
    $('platform').innerHTML = '';
    for (const [name, d] of [['Game server (vanguard-wing)', P.game], ['Forum (vanguard-forum)', P.forum]]) {
      const b = block(name, d);
      if (typeof b === 'string') $('platform').insertAdjacentHTML('beforeend', b); else $('platform').appendChild(b);
    }
  }
  // forum
  const f = h.forum;
  $('forum-health').innerHTML = f.last ? `<div class="stat-row"><div><b class="${f.last.ok ? 'ok-text' : 'bad-text'}">${f.last.ok ? 'Up' : 'Down'}</b><span>now</span></div><div><b>${f.uptimePct ?? '—'}%</b><span>uptime, 24 h</span></div><div><b>${f.last.ms} ms</b><span>last check</span></div><div><b>${f.checks}</b><span>checks</span></div></div><canvas class="spark" id="forum-spark"></canvas>`
    : '<p class="hint">Waiting for the first check (every 30 s)…</p>';
  if (f.recent?.length) drawSpark($('forum-spark'), f.recent);
  // deployment
  const d = a.deploy;
  $('deploy-info').innerHTML = `<table class="kv">${[
    ['Environment', d.environment + (h.env.preview ? ' (preview)' : '')], ['Region', d.region], ['Commit', d.commit ? `${d.commit.slice(0, 7)}: ${d.commitMessage || ''}` : null],
    ['Branch', d.branch], ['Deployment', d.deploymentId], ['Started', new Date(a.startedAt).toLocaleString()], ['Node.js', a.node],
    ['Media bucket', h.media.configured ? `${h.media.bucket} · ${h.media.count} files · ${fmtBytes(h.media.bytes)}` : 'not connected'],
    ['Feature flags', h.flags.enabled ? 'Railway (connected)' : 'local overrides only'],
  ].map(([k, v]) => `<tr><td>${k}</td><td>${esc(v ?? '—')}</td></tr>`).join('')}</table>`;
}

// ---------------- tiny canvas charts ----------------
function drawChartGrid(container, charts, times) {
  container.innerHTML = charts.map((c, i) => `<div class="chart card"><div class="chart-h"><b>${esc(c.title)}</b><span class="legend">${c.sets.map(([n, , col]) => `<i style="background:${col}"></i>${esc(n)}`).join(' ')}</span></div><canvas data-i="${i}"></canvas><div class="tip"></div></div>`).join('');
  container.querySelectorAll('canvas').forEach((cv) => drawChart(cv, charts[+cv.dataset.i], times));
}
function drawChart(cv, c, times) {
  const dpr = devicePixelRatio || 1, W = cv.clientWidth || 300, H = 150;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.height = `${H}px`;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const n = times.length, padL = 40, padB = 18, padT = 6, w = W - padL - 6, h = H - padB - padT;
  const totals = c.stacked ? times.map((_, i) => c.sets.reduce((s, [, v]) => s + (v[i] || 0), 0)) : null;
  let max = c.stacked ? Math.max(1, ...totals) : Math.max(1e-9, ...c.sets.flatMap(([, v]) => v));
  if (!c.unit && max < 1) max = 1;
  else if (max < 1 && c.unit !== '%') max = Math.max(max, 0.01);
  const nice = niceMax(max);
  g.font = '11px Rajdhani, sans-serif'; g.fillStyle = '#7d97a8'; g.strokeStyle = 'rgba(111,214,255,0.12)'; g.lineWidth = 1;
  for (let k = 0; k <= 3; k++) {
    const y = padT + h - (h * k) / 3; g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + w, y); g.stroke();
    g.fillText(fmtNum((nice * k) / 3), 4, y + 4);
  }
  if (n < 2) { g.fillStyle = '#9ab3c3'; g.fillText('Collecting… a point is added every minute.', padL + 10, padT + h / 2); return; }
  const X = (i) => padL + (n === 1 ? w / 2 : (i / (n - 1)) * w), Y = (v) => padT + h - (v / nice) * h;
  if (n > 1) { g.fillText(new Date(times[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), padL, H - 4); const lbl = new Date(times[n - 1]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); g.fillText(lbl, padL + w - g.measureText(lbl).width, H - 4); }
  if (c.stacked) {
    const base = new Array(n).fill(0);
    for (const [, vals, col] of c.sets) {
      g.beginPath(); for (let i = 0; i < n; i++) g.lineTo(X(i), Y(base[i] + (vals[i] || 0)));
      for (let i = n - 1; i >= 0; i--) g.lineTo(X(i), Y(base[i]));
      g.closePath(); g.fillStyle = col + 'aa'; g.fill();
      for (let i = 0; i < n; i++) base[i] += vals[i] || 0;
    }
  } else {
    for (const [, vals, col] of c.sets) {
      g.beginPath(); vals.forEach((v, i) => (i ? g.lineTo(X(i), Y(v || 0)) : g.moveTo(X(i), Y(v || 0))));
      g.strokeStyle = col; g.lineWidth = 1.8; g.stroke();
      g.lineTo(X(n - 1), padT + h); g.lineTo(X(0), padT + h); g.closePath(); g.fillStyle = col + '22'; g.fill();
    }
  }
  const tip = cv.nextElementSibling;
  cv.onmousemove = (e) => {
    const i = Math.max(0, Math.min(n - 1, Math.round(((e.offsetX - padL) / w) * (n - 1))));
    tip.style.display = 'block'; tip.style.left = `${Math.min(W - 150, Math.max(0, X(i) - 60))}px`;
    tip.innerHTML = `<b>${new Date(times[i]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b>${c.sets.map(([nm, v, col]) => `<div><i style="background:${col}"></i>${esc(nm)}: ${fmtNum(v[i] || 0)}${c.unit ? ' ' + c.unit : ''}</div>`).join('')}`;
  };
  cv.onmouseleave = () => { tip.style.display = 'none'; };
}
function drawSpark(cv, pts) {
  const dpr = devicePixelRatio || 1, W = cv.clientWidth || 600, H = 46;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.height = `${H}px`;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const max = Math.max(50, ...pts.map((p) => p[1]));
  const bw = W / pts.length;
  pts.forEach(([, ms], i) => { const hgt = ms < 0 ? H : Math.max(2, (ms / max) * (H - 4)); g.fillStyle = ms < 0 ? '#ff5a4a' : '#6cff9a99'; g.fillRect(i * bw, H - hgt, Math.max(1, bw - 1), hgt); });
}
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
function fmtNum(v) { return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.abs(v) >= 10 ? Math.round(v).toString() : (+v.toFixed(2)).toString(); }
