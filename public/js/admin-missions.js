// Visual mission editor: a top-down map of the planet or space arena where the admin places the
// pilots' start, relay towers, turrets, enemy wave groups and a convoy route, plus a side panel
// for objectives, waves, bonus goals and radio lines.
import { $, esc, doc, changed, rid, getV } from './admin-studio.js';
import { ENEMY_TYPES, MISSION_LIMITS, SPACE_KINDS } from '/shared/gamecontent.js';
import { terrainHeight, setTerrainOverride, asteroids, PLANET } from '/shared/world.js';

const V = () => getV();
const ENEMY_LABEL = { raider: 'Raiders', bomber: 'Bombers', gunship: 'Gunships' };
const ENV_LABEL = { planet: 'Planet (Kessa Prime)', open: 'Space: open', asteroids: 'Space: asteroid belt' };
const WAVE_COL = ['#ff6b6b', '#ffb347', '#ffd84a', '#c37dff', '#ff6be0', '#7da6ff', '#ff8f5a', '#e0ff6b', '#6bffd8', '#ff4a8f', '#b0b0ff', '#ffa0a0'];
const SIZE = 600;
let selId = null;          // mission being edited
let tool = 'move';
let sel = null;            // selected map item {k, i, j}
let activeWave = 0;
let bgCache = { key: '', img: null };

function newMission() {
  return {
    id: rid('cm'), name: 'New mission', location: '', briefing: 'Describe the situation for the pilots here.', env: 'planet', enabled: false, visibility: 'always', timeLimit: 0,
    start: { pos: [0, 1500], alt: 260, heading: 0 }, towers: [], turrets: [], turretsRequired: false,
    waves: [{ trigger: 'clear', at: 0, delay: 3, title: '', message: '', groups: [{ type: 'raider', count: 5, pos: [0, -2500], alt: 420 }] }],
    route: null, bonus: { noTowerLoss: true, time: 0, noEscape: true, kills: 0, noDeaths: false },
    messages: { from: 'Control', start: '', win: '', lose: '' },
  };
}
const cur = () => (doc().customMissions || []).find((m) => m.id === selId);
const extent = (m) => (m.env === 'planet' ? 3300 : 3700);
const toPx = (m, [x, z]) => [((x / extent(m)) * 0.5 + 0.5) * SIZE, ((z / extent(m)) * 0.5 + 0.5) * SIZE];
const toWorld = (m, px, py) => [Math.round(((px / SIZE) - 0.5) * 2 * extent(m)), Math.round(((py / SIZE) - 0.5) * 2 * extent(m))];

export function renderMissions() {
  const d = doc(); d.customMissions ??= [];
  if (!cur()) selId = d.customMissions[0]?.id || null;
  $('ms-list').innerHTML = `${d.customMissions.map((m) => `<button class="ms-item ${m.id === selId ? 'on' : ''}" data-id="${m.id}"><b>${esc(m.name)}</b><span class="hint small">${ENV_LABEL[m.env]} · ${m.enabled ? (m.visibility === 'event' ? 'event only' : 'live') : 'off'}</span></button>`).join('')}${d.customMissions.length ? '' : '<div class="hint">No custom missions yet.</div>'}`;
  const m = cur();
  if (!m) { $('ms-editor').innerHTML = '<div class="card empty">Press <b>+ New mission</b> to start.</div>'; return; }
  activeWave = Math.min(activeWave, Math.max(0, m.waves.length - 1));
  const t = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  $('ms-editor').innerHTML = `
    <div class="card"><div class="grid3">
      <label class="fld"><span>Name</span><input data-f="name" maxlength="40" value="${esc(m.name)}"></label>
      <label class="fld"><span>Location</span><input data-f="location" maxlength="80" value="${esc(m.location)}" placeholder="e.g. Kessa Prime: dune sea"></label>
      <label class="fld"><span>World</span><select data-f="env">${Object.entries(ENV_LABEL).map(([k, v]) => `<option value="${k}" ${m.env === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
      <label class="fld"><span>Briefing</span><textarea data-f="briefing" maxlength="900">${esc(m.briefing)}</textarea></label>
      <div class="grid3"><label class="switch"><input type="checkbox" data-f="enabled" ${m.enabled ? 'checked' : ''}> <span>In the mission list</span></label>
        <label class="fld"><span>Shown</span><select data-f="visibility"><option value="always" ${m.visibility === 'always' ? 'selected' : ''}>Always</option><option value="event" ${m.visibility === 'event' ? 'selected' : ''}>Only during an event that opens it</option></select></label>
        <div class="row2"><button class="mini" data-act="dup">Duplicate</button><button class="mini danger" data-act="del">Delete mission</button></div></div></div>
    <div class="ms-main">
      <div class="card ms-mapcard">
        <div class="seg ms-tools" id="ms-tools">${[['move', '✥ Select / move'], ['start', '▲ Start'], ['tower', '■ Tower'], ['turret', '◆ Turret'], ['group', '● Wave group'], ['route', '➜ Route point']].map(([k, l]) => `<button data-tool="${k}" class="${tool === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <canvas id="ms-map" width="${SIZE}" height="${SIZE}"></canvas>
        <div class="hint small" id="ms-hint">${toolHint()}</div>
        <div id="ms-sel"></div>
      </div>
      <div class="ms-side">
        <div class="card"><div class="row-between"><h3>Waves</h3><button class="mini" data-act="addwave" ${m.waves.length >= MISSION_LIMITS.waves ? 'disabled' : ''}>+ Wave</button></div>
          ${m.waves.map((w, i) => `<div class="wave ${i === activeWave ? 'on' : ''}" data-w="${i}"><div class="row-between"><b style="color:${WAVE_COL[i % 12]}">Wave ${i + 1}</b><button class="mini danger" data-act="delwave">✕</button></div>
            <div class="row2"><select data-wf="trigger"><option value="clear" ${w.trigger === 'clear' ? 'selected' : ''}>after the previous wave is cleared</option><option value="time" ${w.trigger === 'time' ? 'selected' : ''}>at a set time</option></select>
            ${w.trigger === 'time' ? `<label class="fld tiny"><span>at (s)</span><input type="number" min="0" max="3600" data-wf="at" value="${w.at}"></label>` : `<label class="fld tiny"><span>+ wait (s)</span><input type="number" min="0" max="120" data-wf="delay" value="${w.delay}"></label>`}</div>
            <input data-wf="title" maxlength="60" placeholder="Banner (default: WAVE ${i + 1} / ${m.waves.length})" value="${esc(w.title)}">
            <input data-wf="message" maxlength="200" placeholder="Radio line (optional)" value="${esc(w.message)}">
            <div class="groups">${w.groups.map((g, j) => `<span class="gchip">${ENEMY_LABEL[g.type]} ×${g.count}</span>`).join('') || '<span class="hint small">No groups: select this wave and use ● Wave group on the map.</span>'}</div></div>`).join('') || '<p class="hint small">No waves.</p>'}
        </div>
        <div class="card"><h3>Convoy route</h3>
          ${m.route ? `<div class="grid2"><label class="fld"><span>Freighters</span><input type="number" min="1" max="12" data-rf="freighters" value="${m.route.freighters}"></label>
            <label class="fld"><span>May escape</span><input type="number" min="0" max="12" data-rf="maxEscape" value="${m.route.maxEscape}"></label>
            <label class="fld"><span>Sets off at (s)</span><input type="number" min="0" max="3600" data-rf="startAt" value="${m.route.startAt}"></label>
            <label class="fld"><span>Altitude (m)</span><input type="number" min="-1500" max="1400" data-rf="alt" value="${m.route.alt}"></label></div>
            <p class="hint small">${m.route.points.length} points. Freighters fly from point 1 to the last point and escape there.</p><button class="mini danger" data-act="noroute">Remove the convoy</button>`
            : '<p class="hint small">Pick ➜ Route point and click at least two points on the map to add a convoy pilots must stop.</p>'}
        </div>
        <div class="card"><h3>Rules &amp; bonus goals</h3>
          <label class="fld"><span>Time limit (mission fails after) <b>${m.timeLimit ? t(m.timeLimit) : 'none'}</b></span><input type="number" min="0" max="3600" step="10" data-f="timeLimit" value="${m.timeLimit}" placeholder="seconds, 0 = none"></label>
          ${m.turrets.length ? `<label class="switch"><input type="checkbox" data-f="turretsRequired" ${m.turretsRequired ? 'checked' : ''}> <span>Destroying every turret is required</span></label>` : ''}
          ${m.towers.length ? `<label class="switch"><input type="checkbox" data-b="noTowerLoss" ${m.bonus.noTowerLoss ? 'checked' : ''}> <span>Bonus: lose no relay towers</span></label>` : ''}
          ${m.route ? `<label class="switch"><input type="checkbox" data-b="noEscape" ${m.bonus.noEscape ? 'checked' : ''}> <span>Bonus: let no freighter escape</span></label>` : ''}
          <label class="switch"><input type="checkbox" data-b="noDeaths" ${m.bonus.noDeaths ? 'checked' : ''}> <span>Bonus: lose no ships</span></label>
          <div class="grid2"><label class="fld"><span>Bonus: finish under (s)</span><input type="number" min="0" max="3600" step="10" data-b="time" value="${m.bonus.time}"></label>
          <label class="fld"><span>Bonus: destroy N enemies</span><input type="number" min="0" max="500" data-b="kills" value="${m.bonus.kills}"></label></div>
          <p class="hint small">Two bonus goals done = gold medal, one = silver.</p></div>
        <div class="card"><h3>Radio</h3><label class="fld"><span>Callsign of mission control</span><input data-m="from" maxlength="24" value="${esc(m.messages.from)}"></label>
          <label class="fld"><span>Opening line</span><input data-m="start" maxlength="240" value="${esc(m.messages.start)}"></label>
          <label class="fld"><span>On success</span><input data-m="win" maxlength="160" value="${esc(m.messages.win)}"></label>
          <label class="fld"><span>On failure</span><input data-m="lose" maxlength="160" value="${esc(m.messages.lose)}"></label></div>
        <div class="card" id="ms-check"></div>
      </div>
    </div>`;
  drawMap(); renderSel(); renderCheck();
}
function toolHint() {
  return { move: 'Click an item to select it, drag to move it. Delete removes the selected item.', start: 'Click where the wing starts. Set its heading below.', tower: 'Click to place a relay tower pilots must protect (max 8).', turret: 'Click to place a pirate turret (max 16).', group: `Click to place an enemy group for wave ${activeWave + 1}. Pick the wave on the right first.`, route: 'Click to add convoy route points in order.' }[tool];
}
function renderCheck() {
  const m = cur(); if (!m) return;
  const issues = [];
  if (!m.waves.some((w) => w.groups.length) && !m.route) issues.push('Add at least one wave group or a convoy route, or the mission ends straight away.');
  m.waves.forEach((w, i) => { if (!w.groups.length) issues.push(`Wave ${i + 1} has no enemy groups.`); });
  if (m.route && m.route.points.length < 2) issues.push('The convoy route needs at least two points.');
  if (m.env === 'planet' && m.towers.some(([x, z]) => Math.hypot(x, z) > 3100)) issues.push('A tower is near the edge of the arena, where the mountains are.');
  $('ms-check').innerHTML = issues.length ? `<div class="warn-box small">${issues.map((x) => `<div>⚠ ${esc(x)}</div>`).join('')}</div>` : `<div class="ok-box small">✓ Ready. ${m.enabled ? 'Save as preview to fly it, then publish.' : 'Tick "In the mission list", then save as preview to fly it.'}</div>`;
}

// ---------- map ----------
function background(m) {
  const hm = doc().environment?.planet?.heightmap;
  const key = `${m.env}:${hm ? hm.data.length + hm.height + hm.keepBase : 'base'}`;
  if (bgCache.key === key) return bgCache.img;
  const c = document.createElement('canvas'); c.width = c.height = SIZE;
  const g = c.getContext('2d');
  if (m.env === 'planet') {
    if (hm) setTerrainOverride({ n: hm.n, bytes: Uint8Array.from(atob(hm.data), (ch) => ch.charCodeAt(0)), height: hm.height, keepBase: hm.keepBase });
    const N = 150, img = g.createImageData(N, N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const [x, z] = toWorld(m, (i + 0.5) * SIZE / N, (j + 0.5) * SIZE / N);
      const h = terrainHeight(x, z), hx = terrainHeight(x + 40, z);
      const shade = Math.max(-1, Math.min(1, (hx - h) / 40));
      const base = Math.max(0, Math.min(1, (h + 200) / 1100));
      img.data.set([70 + base * 150 + shade * 40, 45 + base * 105 + shade * 30, 30 + base * 70 + shade * 20, 255], (j * N + i) * 4);
    }
    setTerrainOverride(null);
    const t = document.createElement('canvas'); t.width = t.height = N; t.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true; g.drawImage(t, 0, 0, SIZE, SIZE);
  } else {
    g.fillStyle = '#070b14'; g.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.5})`; g.fillRect(Math.random() * SIZE, Math.random() * SIZE, 1.2, 1.2); }
    if (m.env === 'asteroids') { g.fillStyle = 'rgba(150,130,110,.55)'; for (const a of asteroids()) { const [px, py] = toPx(m, [a.x, a.z]); g.beginPath(); g.arc(px, py, Math.max(1.5, (a.r / extent(m)) * SIZE * 0.5), 0, Math.PI * 2); g.fill(); } }
  }
  bgCache = { key, img: c };
  return c;
}
function drawMap() {
  const m = cur(), cv = $('ms-map'); if (!m || !cv) return;
  const g = cv.getContext('2d');
  g.drawImage(background(m), 0, 0);
  // arena edge + base plateau
  g.strokeStyle = 'rgba(111,214,255,.5)'; g.setLineDash([6, 6]); g.beginPath(); g.arc(SIZE / 2, SIZE / 2, (m.env === 'planet' ? 3300 : 3800) / extent(m) * SIZE / 2, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  g.fillStyle = 'rgba(200,220,255,.5)'; g.font = '11px sans-serif'; g.fillText('N ↑', SIZE / 2 - 10, 14); g.fillText('1 km', 12, SIZE - 12);
  g.strokeStyle = 'rgba(200,220,255,.5)'; g.beginPath(); g.moveTo(12, SIZE - 22); g.lineTo(12 + 1000 / extent(m) * SIZE / 2, SIZE - 22); g.stroke();
  const isSel = (k, i, j) => sel && sel.k === k && sel.i === i && (j === undefined || sel.j === j);
  // route
  if (m.route?.points.length) {
    g.strokeStyle = '#ff9f43'; g.lineWidth = 2; g.beginPath();
    m.route.points.forEach((p, i) => { const [x, y] = toPx(m, p); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); g.lineWidth = 1;
    m.route.points.forEach((p, i) => { const [x, y] = toPx(m, p); g.fillStyle = isSel('route', i) ? '#fff' : '#ff9f43'; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); g.fillStyle = '#101'; g.font = 'bold 10px sans-serif'; g.fillText(String(i + 1), x - 3, y + 3.5); });
  }
  // towers & turrets
  m.towers.forEach((p, i) => { const [x, y] = toPx(m, p); g.fillStyle = isSel('tower', i) ? '#fff' : '#5dff8a'; g.fillRect(x - 6, y - 6, 12, 12); g.strokeStyle = '#063'; g.strokeRect(x - 6, y - 6, 12, 12); });
  m.turrets.forEach((t, i) => { const [x, y] = toPx(m, t.pos); g.fillStyle = isSel('turret', i) ? '#fff' : '#ff4a4a'; g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 7, y); g.lineTo(x, y + 7); g.lineTo(x - 7, y); g.closePath(); g.fill(); });
  // wave groups
  m.waves.forEach((w, i) => w.groups.forEach((gr, j) => {
    const [x, y] = toPx(m, gr.pos); const r = 6 + Math.sqrt(gr.count) * 2.2;
    g.globalAlpha = i === activeWave ? 1 : 0.55;
    g.fillStyle = isSel('group', i, j) ? '#fff' : WAVE_COL[i % 12]; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111'; g.font = 'bold 10px sans-serif'; g.fillText(`${i + 1}`, x - 3, y + 3.5);
    g.fillStyle = '#fff'; g.font = '10px sans-serif'; g.fillText(`${gr.type[0].toUpperCase()}${gr.type.slice(1)} ×${gr.count}`, x + r + 3, y + 3);
    g.globalAlpha = 1;
  }));
  // start
  const [sx, sy] = toPx(m, m.start.pos), a = (m.start.heading || 0) * Math.PI / 180;
  g.save(); g.translate(sx, sy); g.rotate(a); g.fillStyle = isSel('start', 0) ? '#fff' : '#6fd6ff'; g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 8); g.lineTo(0, 4); g.lineTo(-8, 8); g.closePath(); g.fill(); g.restore();
}
function hitTest(m, px, py) {
  const near = (p, r = 10) => { const [x, y] = toPx(m, p); return Math.hypot(x - px, y - py) <= r; };
  if (near(m.start.pos, 12)) return { k: 'start', i: 0 };
  for (let i = m.towers.length - 1; i >= 0; i--) if (near(m.towers[i])) return { k: 'tower', i };
  for (let i = m.turrets.length - 1; i >= 0; i--) if (near(m.turrets[i].pos)) return { k: 'turret', i };
  for (let i = m.waves.length - 1; i >= 0; i--) for (let j = m.waves[i].groups.length - 1; j >= 0; j--) if (near(m.waves[i].groups[j].pos, 12)) return { k: 'group', i, j };
  for (let i = (m.route?.points.length || 0) - 1; i >= 0; i--) if (near(m.route.points[i])) return { k: 'route', i };
  return null;
}
const posOf = (m, s) => (s.k === 'start' ? m.start.pos : s.k === 'tower' ? m.towers[s.i] : s.k === 'turret' ? m.turrets[s.i].pos : s.k === 'group' ? m.waves[s.i].groups[s.j].pos : m.route.points[s.i]);
function setPos(m, s, p) {
  if (s.k === 'start') m.start.pos = p; else if (s.k === 'tower') m.towers[s.i] = p; else if (s.k === 'turret') m.turrets[s.i].pos = p;
  else if (s.k === 'group') m.waves[s.i].groups[s.j].pos = p; else m.route.points[s.i] = p;
}
function renderSel() {
  const m = cur(), el = $('ms-sel'); if (!m || !el) return;
  if (!sel) { el.innerHTML = ''; return; }
  const p = posOf(m, sel); if (!p) { sel = null; el.innerHTML = ''; return; }
  const where = `<span class="hint small">x ${p[0]} · z ${p[1]}</span>`;
  let body = '';
  if (sel.k === 'start') body = `<b>Start</b> ${where}<div class="grid2"><label class="fld"><span>Altitude (m)</span><input type="number" data-s="alt" value="${m.start.alt}"></label><label class="fld"><span>Heading (° from north)</span><input type="number" min="-180" max="360" step="5" data-s="heading" value="${m.start.heading}"></label></div>`;
  if (sel.k === 'tower') body = `<b>Relay tower ${sel.i + 1}</b> ${where}`;
  if (sel.k === 'turret') body = `<b>Turret ${sel.i + 1}</b> ${where}${m.env === 'planet' ? '' : `<label class="fld"><span>Altitude (m)</span><input type="number" data-s="talt" value="${m.turrets[sel.i].alt}"></label>`}`;
  if (sel.k === 'group') { const gr = m.waves[sel.i].groups[sel.j]; body = `<b>Wave ${sel.i + 1} group</b> ${where}<div class="grid3"><label class="fld"><span>Type</span><select data-s="type">${ENEMY_TYPES.map((t) => `<option value="${t}" ${gr.type === t ? 'selected' : ''}>${ENEMY_LABEL[t]}</option>`).join('')}</select></label><label class="fld"><span>How many (1 pilot)</span><input type="number" min="1" max="30" data-s="count" value="${gr.count}"></label><label class="fld"><span>Altitude (m)</span><input type="number" data-s="galt" value="${gr.alt}"></label></div><p class="hint small">The count grows with the number of pilots and the difficulty.</p>`; }
  if (sel.k === 'route') body = `<b>Route point ${sel.i + 1}</b> ${where}`;
  el.innerHTML = `<div class="ms-selbox">${body}${sel.k !== 'start' ? '<button class="mini danger" id="ms-delsel">Delete</button>' : ''}</div>`;
}
function deleteSel() {
  const m = cur(); if (!m || !sel || sel.k === 'start') return;
  if (sel.k === 'tower') m.towers.splice(sel.i, 1);
  if (sel.k === 'turret') m.turrets.splice(sel.i, 1);
  if (sel.k === 'group') m.waves[sel.i].groups.splice(sel.j, 1);
  if (sel.k === 'route') { m.route.points.splice(sel.i, 1); if (m.route.points.length === 0) m.route = null; }
  sel = null; changed(); renderMissions();
}

// ---------- events ----------
const ed = $('ms-editor');
let drag = null;
ed.addEventListener('pointerdown', (e) => {
  if (e.target.id !== 'ms-map') return;
  const m = cur(); const r = e.target.getBoundingClientRect();
  const px = (e.clientX - r.left) * SIZE / r.width, py = (e.clientY - r.top) * SIZE / r.height;
  const w = toWorld(m, px, py);
  const hit = hitTest(m, px, py);
  if (tool === 'move' || hit) {
    sel = hit; drawMap(); renderSel();
    if (hit) { drag = { id: e.pointerId, moved: false }; e.target.setPointerCapture(e.pointerId); }
    return;
  }
  if (tool === 'start') { m.start.pos = w; sel = { k: 'start', i: 0 }; }
  if (tool === 'tower') { if (m.towers.length >= MISSION_LIMITS.towers) return V().toast('Up to 8 towers.'); m.towers.push(w); sel = { k: 'tower', i: m.towers.length - 1 }; }
  if (tool === 'turret') { if (m.turrets.length >= MISSION_LIMITS.turrets) return V().toast('Up to 16 turrets.'); m.turrets.push({ pos: w, alt: 0 }); sel = { k: 'turret', i: m.turrets.length - 1 }; }
  if (tool === 'group') {
    if (!m.waves.length) m.waves.push({ trigger: 'clear', at: 0, delay: 3, title: '', message: '', groups: [] });
    const wv = m.waves[activeWave];
    if (wv.groups.length >= MISSION_LIMITS.groups) return V().toast('Up to 6 groups per wave.');
    wv.groups.push({ type: wv.groups.at(-1)?.type || 'raider', count: 4, pos: w, alt: m.env === 'planet' ? 420 : 0 });
    sel = { k: 'group', i: activeWave, j: wv.groups.length - 1 };
  }
  if (tool === 'route') {
    m.route ??= { points: [], alt: m.env === 'planet' ? 300 : 0, freighters: 3, maxEscape: 1, startAt: 0 };
    if (m.route.points.length >= MISSION_LIMITS.route) return V().toast('Up to 12 route points.');
    m.route.points.push(w); sel = { k: 'route', i: m.route.points.length - 1 };
  }
  changed(); renderMissions();
});
ed.addEventListener('pointermove', (e) => {
  if (!drag || e.target.id !== 'ms-map' || !sel) return;
  const m = cur(); const r = e.target.getBoundingClientRect();
  setPos(m, sel, toWorld(m, (e.clientX - r.left) * SIZE / r.width, (e.clientY - r.top) * SIZE / r.height));
  drag.moved = true; drawMap();
});
ed.addEventListener('pointerup', () => { if (drag?.moved) { changed(); renderSel(); renderCheck(); } drag = null; });
document.addEventListener('keydown', (e) => {
  if ($('p-missions').classList.contains('hidden') || !sel || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); }
});
ed.addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t) return;
  const m = cur(); if (!m) return;
  if (t.dataset.tool) { tool = t.dataset.tool; renderMissions(); return; }
  if (t.id === 'ms-delsel') return deleteSel();
  const a = t.dataset.act;
  if (a === 'addwave') { m.waves.push({ trigger: 'clear', at: 0, delay: 5, title: '', message: '', groups: [] }); activeWave = m.waves.length - 1; tool = 'group'; changed(); renderMissions(); }
  if (a === 'delwave') { const i = +t.closest('.wave').dataset.w; if (confirm(`Delete wave ${i + 1}?`)) { m.waves.splice(i, 1); sel = null; changed(); renderMissions(); } }
  if (a === 'noroute') { m.route = null; sel = null; changed(); renderMissions(); }
  if (a === 'del' && confirm(`Delete "${m.name}"?`)) { doc().customMissions = doc().customMissions.filter((x) => x.id !== m.id); selId = null; changed(); renderMissions(); }
  if (a === 'dup') { const c = JSON.parse(JSON.stringify(m)); c.id = rid('cm'); c.name = `${m.name} (copy)`.slice(0, 40); c.enabled = false; doc().customMissions.push(c); selId = c.id; changed(); renderMissions(); }
});
ed.addEventListener('click', (e) => {
  const w = e.target.closest('.wave');
  if (w && !e.target.closest('button,input,select') && +w.dataset.w !== activeWave) { activeWave = +w.dataset.w; renderMissions(); }
});
ed.addEventListener('change', (e) => {
  const t = e.target, m = cur(); if (!m) return;
  if (t.dataset.f) {
    const f = t.dataset.f;
    if (['enabled', 'turretsRequired'].includes(f)) m[f] = t.checked;
    else if (f === 'timeLimit') m.timeLimit = Math.max(0, Math.round(+t.value || 0));
    else m[f] = t.value;
    if (f === 'env') { bgCache.key = ''; for (const g of m.waves.flatMap((w) => w.groups)) g.alt = t.value === 'planet' ? 420 : 0; m.start.alt = t.value === 'planet' ? 260 : 120; }
    changed(); renderMissions(); return;
  }
  if (t.dataset.b) { m.bonus[t.dataset.b] = t.type === 'checkbox' ? t.checked : Math.max(0, Math.round(+t.value || 0)); changed(); return; }
  if (t.dataset.m) { m.messages[t.dataset.m] = t.value; changed(); return; }
  if (t.dataset.rf) { m.route[t.dataset.rf] = Math.round(+t.value || 0); changed(); return; }
  if (t.dataset.wf) { const wv = m.waves[+t.closest('.wave').dataset.w]; wv[t.dataset.wf] = ['at', 'delay'].includes(t.dataset.wf) ? Math.max(0, Math.round(+t.value || 0)) : t.value; changed(); if (t.dataset.wf === 'trigger') renderMissions(); return; }
  if (t.dataset.s && sel) {
    const s = t.dataset.s;
    if (s === 'alt') m.start.alt = +t.value; if (s === 'heading') m.start.heading = +t.value;
    if (s === 'talt') m.turrets[sel.i].alt = +t.value;
    if (sel.k === 'group') { const gr = m.waves[sel.i].groups[sel.j]; if (s === 'type') gr.type = t.value; if (s === 'count') gr.count = Math.max(1, Math.min(30, Math.round(+t.value))); if (s === 'galt') gr.alt = +t.value; }
    changed(); renderMissions();
  }
});
ed.addEventListener('input', (e) => { const t = e.target, m = cur(); if (m && t.dataset.f === 'name') { m.name = t.value; changed(); } });
$('ms-list').addEventListener('click', (e) => { const b = e.target.closest('.ms-item'); if (!b) return; selId = b.dataset.id; sel = null; activeWave = 0; bgCache.key = ''; renderMissions(); });
$('ms-add').onclick = () => { const d = doc(); d.customMissions ??= []; if (d.customMissions.length >= 20) return V().toast('Up to 20 custom missions.'); const m = newMission(); d.customMissions.push(m); selId = m.id; sel = null; activeWave = 0; bgCache.key = ''; changed(); renderMissions(); };
export { SPACE_KINDS, PLANET };
