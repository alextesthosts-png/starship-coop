// Admin pages: custom ships, liveries, environments, sounds, scheduled events.
// (The mission editor lives in admin-missions.js.)
import { $, esc, doc, changed, rid, models, images, sounds, allMissions, pickMedia, nameOfUrl, makeViewer, getV } from './admin-studio.js';
import { SHIPS, MISSIONS, PLAYER_COLORS } from '/shared/config.js';
import { SHIP_STAT_FIELDS, SFX_KEYS, ROLES, ROLE_LABEL, BASE_SHIPS, activeEvents } from '/shared/gamecontent.js';
import { loadMedia } from './admin-ext.js';

const V = () => getV();
const page = (id) => !$(`p-${id}`).classList.contains('hidden');
const on = (el, ev, sel, fn) => el.addEventListener(ev, (e) => { const t = e.target.closest(sel); if (t && el.contains(t)) fn(e, t); });
const BASE_NAME = { lancer: 'Lancer (interceptor)', warden: 'Warden (heavy fighter)', hammer: 'Hammer (bomber)' };
const SEC_NAME = { missile: 'Seeker missiles', flak: 'Flak burst', bomb: 'Plasma bombs' };

window.addEventListener('vw-page', async (e) => {
  const p = e.detail;
  if (['cships', 'liveries', 'envs', 'sounds', 'events', 'missions'].includes(p) && !getV()) return;
  if (['cships', 'liveries', 'envs', 'sounds'].includes(p)) await loadMedia();
  if (p === 'cships') renderShips();
  if (p === 'liveries') renderLiveries();
  if (p === 'envs') renderEnvs();
  if (p === 'sounds') renderSounds();
  if (p === 'events') renderEvents();
  if (p === 'missions') (await import('./admin-missions.js')).renderMissions();
});
window.addEventListener('vw-saved', () => {
  if (page('cships')) renderShips();
  if (page('liveries')) renderLiveries();
  if (page('envs')) renderEnvs();
  if (page('sounds')) renderSounds();
  if (page('events')) renderEvents();
  if (page('missions')) import('./admin-missions.js').then((m) => m.renderMissions());
});

// =============================== CUSTOM SHIPS ===============================
function newShip() {
  const b = SHIPS.lancer;
  return { id: rid('cs'), name: 'New ship', role: 'Fighter', desc: '', base: 'lancer', secondary: b.secondary, gunMode: b.gunMode, model: '', missions: [], enabled: false,
    stats: { speed: b.speed, boostSpeed: b.boostSpeed, accel: b.accel, handling: 1, hull: b.hull, shield: b.shield, shieldRegen: b.shieldRegen, laserDmg: b.laserDmg, laserRate: b.laserRate, secAmmo: b.secAmmo, secRegen: b.secRegen } };
}
function renderShips() {
  const d = doc(); d.customShips ??= [];
  const ms = allMissions();
  $('cs-list').innerHTML = d.customShips.length ? d.customShips.map((s, i) => `
    <div class="card cs-card" data-i="${i}">
      <div class="row-between"><div class="cs-title"><b>${esc(s.name)}</b> <span class="hint">${esc(s.role)}</span>${s.enabled ? '<span class="badge ok">In service</span>' : '<span class="badge">Hidden</span>'}</div>
        <div><label class="switch"><input type="checkbox" data-f="enabled" ${s.enabled ? 'checked' : ''}> <span>Players can fly it</span></label> <button class="mini danger" data-act="del">Delete</button></div></div>
      <div class="grid3">
        <label class="fld"><span>Name</span><input data-f="name" maxlength="20" value="${esc(s.name)}"></label>
        <label class="fld"><span>Role</span><input data-f="role" maxlength="24" value="${esc(s.role)}"></label>
        <label class="fld"><span>Flies and fires like</span><select data-f="base">${BASE_SHIPS.map((b) => `<option value="${b}" ${s.base === b ? 'selected' : ''}>${BASE_NAME[b]}</option>`).join('')}</select></label>
      </div>
      <label class="fld"><span>Description (ship select)</span><textarea data-f="desc" maxlength="200">${esc(s.desc)}</textarea></label>
      <div class="grid3">
        <label class="fld"><span>Secondary weapon</span><select data-f="secondary">${Object.entries(SEC_NAME).map(([k, v]) => `<option value="${k}" ${s.secondary === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="fld"><span>Cannons fire</span><select data-f="gunMode"><option value="alternate" ${s.gunMode === 'alternate' ? 'selected' : ''}>One at a time</option><option value="pairs" ${s.gunMode === 'pairs' ? 'selected' : ''}>Half at a time</option><option value="together" ${s.gunMode === 'together' ? 'selected' : ''}>All together</option></select></label>
        <div class="fld"><span>3D model</span><div class="row2"><button class="mini" data-act="model">${s.model ? esc(nameOfUrl(s.model)) : `Same as the ${SHIPS[s.base]?.name || s.base}`}</button>${s.model ? '<button class="mini" data-act="markers">Markers</button><button class="mini" data-act="nomodel">✕</button>' : ''}</div></div>
      </div>
      <details class="stats-box"><summary>Flight &amp; weapon numbers</summary><div class="grid4">${Object.entries(SHIP_STAT_FIELDS).map(([k, [label, lo, hi]]) => `<label class="fld"><span>${label}</span><input type="number" min="${lo}" max="${hi}" step="${k === 'laserRate' || k === 'handling' ? 0.01 : 1}" data-stat="${k}" value="${s.stats[k]}"></label>`).join('')}</div>
        <button class="mini" data-act="copystats">Copy the numbers from the ${esc(SHIPS[s.base]?.name || s.base)}</button></details>
      <div class="fld"><span>Cleared for missions <span class="hint">(none ticked = every mission)</span></span><div class="checks">${ms.map((m) => `<label class="chk"><input type="checkbox" data-mission="${m.id}" ${s.missions.includes(m.id) ? 'checked' : ''}> ${esc(m.name)}</label>`).join('')}</div></div>
    </div>`).join('') : '<div class="card empty">No custom ships yet. Press <b>+ New ship</b>.</div>';
}
$('cs-add').onclick = () => { doc().customShips ??= []; if (doc().customShips.length >= 8) return V().toast('Up to 8 custom ships.'); doc().customShips.push(newShip()); changed(); renderShips(); };
on($('cs-list'), 'input', '[data-f],[data-stat]', (e, t) => {
  const s = doc().customShips[+t.closest('.cs-card').dataset.i];
  if (t.dataset.stat) s.stats[t.dataset.stat] = +t.value;
  else if (t.dataset.f === 'enabled') s.enabled = t.checked;
  else s[t.dataset.f] = t.value;
  if (t.dataset.f === 'base') { s.secondary = SHIPS[s.base].secondary; s.gunMode = SHIPS[s.base].gunMode; }
  changed();
  if (['base', 'enabled'].includes(t.dataset.f) || (t.dataset.f === 'name' && e.type === 'change')) renderShips();
});
on($('cs-list'), 'change', '[data-mission]', (e, t) => {
  const s = doc().customShips[+t.closest('.cs-card').dataset.i];
  s.missions = [...t.closest('.checks').querySelectorAll('[data-mission]:checked')].map((x) => x.dataset.mission);
  changed();
});
on($('cs-list'), 'click', '[data-act]', (e, t) => {
  const i = +t.closest('.cs-card').dataset.i, s = doc().customShips[i];
  const a = t.dataset.act;
  if (a === 'del' && confirm(`Delete ${s.name}?`)) { doc().customShips.splice(i, 1); changed(); renderShips(); }
  if (a === 'model') pickMedia('model', 'Choose a 3D model', (url) => { s.model = url; changed(); renderShips(); });
  if (a === 'nomodel') { s.model = ''; changed(); renderShips(); }
  if (a === 'markers') window.VWS.openMarkerEditor(s.model, nameOfUrl(s.model));
  if (a === 'copystats') { const b = SHIPS[s.base]; s.stats = { speed: b.speed, boostSpeed: b.boostSpeed, accel: b.accel, handling: 1, hull: b.hull, shield: b.shield, shieldRegen: b.shieldRegen, laserDmg: b.laserDmg, laserRate: b.laserRate, secAmmo: b.secAmmo, secRegen: b.secRegen }; changed(); renderShips(); }
});

// =============================== LIVERIES ===============================
let lvView = null, lvSel = 0, lvModels = null;
function renderLiveries() {
  const d = doc(); d.liveries ??= [];
  V().api('GET', 'pilot-link').then((r) => {
    $('lv-link').innerHTML = r.configured ? '✓ Forum sign-in is connected: role-locked liveries work. Players use "Sign in with your forum account" on the main page.'
      : '⚠ Forum sign-in isn\'t connected yet (the <code>GAME_LINK_SECRET</code> variable is missing), so only "Everyone" liveries can be picked. Signed-in admins of this panel count as Command.';
  }).catch(() => {});
  $('lv-list').innerHTML = d.liveries.length ? d.liveries.map((l, i) => `
    <div class="card lv-card ${i === lvSel ? 'sel' : ''}" data-i="${i}">
      <div class="row-between"><input class="lv-name" data-f="name" maxlength="24" value="${esc(l.name)}"><div><button class="mini" data-act="show">Preview</button> <button class="mini danger" data-act="del">Delete</button></div></div>
      <div class="lv-colors">
        <label class="fld tiny"><span>Hull</span><input type="color" data-f="hull" value="${l.hull}"></label>
        <label class="fld tiny"><span>Trim</span><div class="row2"><input type="color" data-f="accent" value="${l.accent || '#4fc3ff'}" ${l.accent ? '' : 'disabled'}><label class="chk"><input type="checkbox" data-f="pilotcol" ${l.accent ? '' : 'checked'}> pilot colour</label></div></label>
        <label class="fld tiny"><span>Dark panels</span><input type="color" data-f="dark" value="${l.dark}"></label>
      </div>
      <div class="grid3">
        <div class="fld"><span>Emblem</span><div class="row2">${l.emblem ? `<img class="lv-emb" src="${esc(l.emblem)}" alt="">` : ''}<button class="mini" data-act="emblem">${l.emblem ? 'Change' : 'Choose image'}</button>${l.emblem ? '<button class="mini" data-act="noemblem">✕</button>' : ''}</div></div>
        <label class="fld"><span>Emblem size ${Math.round(l.emblemSize * 100)}%</span><input type="range" min="0.3" max="3" step="0.05" data-f="emblemSize" value="${l.emblemSize}"></label>
        <label class="fld"><span>Who can pick it</span><select data-f="access">${ROLES.map((r) => `<option value="${r}" ${l.access === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select></label>
      </div>
      <div class="grid3">
        <label class="fld"><span>Give it automatically to</span><select data-f="autoFor"><option value="">Nobody</option>${ROLES.slice(1).map((r) => `<option value="${r}" ${l.autoFor === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select></label>
        <label class="switch"><input type="checkbox" data-f="eventOnly" ${l.eventOnly ? 'checked' : ''}> <span>Only during events that unlock it</span></label>
      </div>
    </div>`).join('') : '<div class="card empty">No liveries yet. Press <b>+ New livery</b>.</div>';
  $('lv-ship').innerHTML = Object.entries(SHIPS).map(([k, s]) => `<option value="${k}">${esc(s.name)}</option>`).join('');
  showLivery();
}
async function showLivery() {
  const l = doc().liveries?.[lvSel];
  const M = lvModels || (lvModels = await import('/js/models.js'));
  const { applyGameContent } = await import('/shared/gamecontent.js');
  applyGameContent(doc());
  M.setShipModels(doc().settings.shipModels || {}, doc().customShips || []);
  M.setModelMarkers(doc().modelMarkers || {});
  M.setLiveries(doc().liveries || []);
  await M.preloadShipModels();
  const ship = $('lv-ship').value || 'lancer';
  const obj = M.buildShip(ship, PLAYER_COLORS[0], { livery: l || null });
  lvView?.dispose();
  lvView = await makeViewer($('lv-viewer'), obj, { hideFileMarkers: true });
}
$('lv-add').onclick = () => { const d = doc(); d.liveries ??= []; d.liveries.push({ id: rid('lv'), name: 'New livery', hull: '#c9ced6', accent: '', dark: '#2a2f36', emblem: '', emblemSize: 1, access: 'everyone', autoFor: '', eventOnly: false }); lvSel = d.liveries.length - 1; changed(); renderLiveries(); };
$('lv-ship').onchange = showLivery;
let lvTimer = 0;
on($('lv-list'), 'input', '[data-f]', (e, t) => {
  const i = +t.closest('.lv-card').dataset.i, l = doc().liveries[i];
  const f = t.dataset.f;
  if (f === 'pilotcol') { l.accent = t.checked ? '' : '#4fc3ff'; changed(); renderLiveries(); return; }
  if (f === 'eventOnly') l.eventOnly = t.checked; else if (f === 'emblemSize') l.emblemSize = +t.value; else l[f] = t.value;
  changed();
  lvSel = i;
  clearTimeout(lvTimer); lvTimer = setTimeout(showLivery, 250);
});
on($('lv-list'), 'click', '[data-act]', (e, t) => {
  const i = +t.closest('.lv-card').dataset.i, l = doc().liveries[i];
  const a = t.dataset.act;
  lvSel = i;
  if (a === 'del' && confirm(`Delete ${l.name}?`)) { doc().liveries.splice(i, 1); lvSel = 0; changed(); renderLiveries(); return; }
  if (a === 'emblem') pickMedia('image', 'Choose an emblem (PNG with a transparent background works best)', (url) => { l.emblem = url; changed(); renderLiveries(); });
  if (a === 'noemblem') { l.emblem = ''; changed(); renderLiveries(); }
  if (a === 'show') { [...$('lv-list').children].forEach((c, j) => c.classList.toggle('sel', j === i)); showLivery(); }
});

// =============================== ENVIRONMENTS ===============================
function renderEnvs() {
  const d = doc();
  d.environment ??= { panoramas: {}, planet: { textures: {}, heightmap: null, texScale: 1 } };
  const E = d.environment;
  E.panoramas ??= {}; E.planet ??= { textures: {} }; E.planet.textures ??= {};
  const space = allMissions().filter((m) => m.env === 'space');
  const tex = (k, label) => { const u = E.planet.textures[k]; return `<div class="tex-slot"><div class="tex-thumb" style="${u ? `background-image:url('${esc(u)}')` : ''}">${u ? '' : 'built-in'}</div><div><b>${label}</b><div class="row2"><button class="mini" data-tex="${k}">Choose</button>${u ? `<button class="mini" data-untex="${k}">Reset</button>` : ''}</div></div></div>`; };
  const hm = E.planet.heightmap;
  $('env-body').innerHTML = `
    <div class="card"><h3>Space backdrops</h3><p class="hint">One panorama per space mission. Leave empty for the built-in nebula and stars.</p>
      <div class="pano-grid">${space.map((m) => { const u = E.panoramas[m.id]; return `<div class="pano"><div class="pano-thumb" style="${u ? `background-image:url('${esc(u)}')` : ''}">${u ? '' : 'built-in nebula'}</div><b>${esc(m.name)}</b><div class="row2"><button class="mini" data-pano="${m.id}">Choose image</button>${u ? `<button class="mini" data-unpano="${m.id}">Reset</button>` : ''}</div></div>`; }).join('')}</div></div>
    <div class="card"><h3>Planet textures (Kessa Prime)</h3><p class="hint">Square, tileable images. The game blends sand on flat ground, rock on slopes and cliff strata on steep walls. A normal map is optional; without one the built-in bumps are used.</p>
      <div class="tex-grid">${tex('sandA', 'Sand')}${tex('sandN', 'Sand normal map')}${tex('rockA', 'Rock')}${tex('rockN', 'Rock normal map')}${tex('cliffA', 'Cliff')}${tex('cliffN', 'Cliff normal map')}</div></div>
    <div class="card"><h3>Terrain shape (heightmap)</h3><p class="hint">A greyscale image of the whole planet surface seen from above: white is high, black is low. It covers 12 × 12 km; the arena is the middle 6.6 km. North (where the raiders come from) is the top edge.</p>
      <div class="hm-row"><canvas id="hm-preview" width="256" height="256"></canvas>
        <div class="hm-side">${hm ? `<p><b>${esc(nameOfUrl(hm.src) || 'Custom heightmap')}</b> · ${hm.n}×${hm.n}</p>` : '<p class="hint">Using the built-in canyon terrain.</p>'}
          <div class="row2"><button class="mini" id="hm-pick">${hm ? 'Use another image' : 'Choose an image'}</button>${hm ? '<button class="mini danger" id="hm-clear">Back to the built-in terrain</button>' : ''}</div>
          ${hm ? `<label class="fld"><span>Height range <b id="hm-hv">${hm.height} m</b></span><input type="range" id="hm-height" min="50" max="1500" step="10" value="${hm.height}"></label>
          <label class="switch"><input type="checkbox" id="hm-base" ${hm.keepBase ? 'checked' : ''}> <span>Keep the flat plateau for the relay station in the middle</span></label>` : ''}
          <p class="hint small">Pick a mission on the <b>Missions</b> page to see it over this terrain.</p></div></div></div>`;
  drawHeightmapPreview();
}
function drawHeightmapPreview() {
  const hm = doc().environment?.planet?.heightmap, c = $('hm-preview');
  if (!c) return;
  const g = c.getContext('2d');
  if (!hm) { g.fillStyle = '#0b1420'; g.fillRect(0, 0, 256, 256); g.fillStyle = '#5a7a90'; g.font = '13px sans-serif'; g.fillText('built-in terrain', 78, 132); return; }
  const bytes = Uint8Array.from(atob(hm.data), (ch) => ch.charCodeAt(0));
  const img = g.createImageData(hm.n, hm.n);
  for (let i = 0; i < hm.n * hm.n; i++) {
    const v = bytes[i], x = i % hm.n, l = x > 0 ? bytes[i - 1] : v;
    const shade = Math.max(0, Math.min(255, 140 + (v - l) * 6));
    img.data.set([v * 0.75 + shade * 0.25 + 30, v * 0.55 + shade * 0.25 + 15, v * 0.35 + shade * 0.2, 255], i * 4);
  }
  const tmp = document.createElement('canvas'); tmp.width = tmp.height = hm.n; tmp.getContext('2d').putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true; g.drawImage(tmp, 0, 0, 256, 256);
  g.strokeStyle = 'rgba(111,214,255,.7)'; g.beginPath(); g.arc(128, 128, (3300 / 12000) * 256, 0, Math.PI * 2); g.stroke();
}
// Turn an image into a 256×256 grid of heights (done here in the browser; the server only stores bytes).
async function imageToHeightmap(url) {
  const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url;
  await img.decode();
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, n, n);
  const px = g.getImageData(0, 0, n, n).data;
  const out = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) out[i] = Math.round(px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114);
  let bin = ''; for (let i = 0; i < out.length; i += 4096) bin += String.fromCharCode(...out.subarray(i, i + 4096));
  return { n, data: btoa(bin) };
}
on($('env-body'), 'click', 'button', async (e, t) => {
  const E = doc().environment;
  if (t.dataset.pano) pickMedia('image', 'Choose a panorama (2:1 equirectangular)', (u) => { E.panoramas[t.dataset.pano] = u; changed(); renderEnvs(); });
  if (t.dataset.unpano) { delete E.panoramas[t.dataset.unpano]; changed(); renderEnvs(); }
  if (t.dataset.tex) pickMedia('image', 'Choose a tileable texture', (u) => { E.planet.textures[t.dataset.tex] = u; changed(); renderEnvs(); });
  if (t.dataset.untex) { E.planet.textures[t.dataset.untex] = ''; changed(); renderEnvs(); }
  if (t.id === 'hm-pick') pickMedia('image', 'Choose a greyscale heightmap', async (u) => {
    try { const h = await imageToHeightmap(u); E.planet.heightmap = { ...h, height: E.planet.heightmap?.height || 400, keepBase: E.planet.heightmap?.keepBase ?? true, src: u }; changed(); renderEnvs(); V().toast('Heightmap read. Save as preview to fly over it.'); } catch (err) { V().toast(`Could not read that image: ${err.message}`); }
  });
  if (t.id === 'hm-clear') { E.planet.heightmap = null; changed(); renderEnvs(); }
});
on($('env-body'), 'input', '#hm-height,#hm-base', (e, t) => {
  const hm = doc().environment.planet.heightmap;
  if (t.id === 'hm-height') { hm.height = +t.value; $('hm-hv').textContent = `${hm.height} m`; } else hm.keepBase = t.checked;
  changed();
});

// =============================== SOUNDS ===============================
let previewAudio = null;
function renderSounds() {
  const d = doc(); d.sounds ??= { sfx: {}, music: {}, musicVol: 0.5, sfxVol: 1 };
  const S = d.sounds; S.sfx ??= {}; S.music ??= {};
  const row = (group, key, label) => {
    const v = S[group][key];
    return `<div class="snd-row" data-g="${group}" data-k="${key}"><span class="snd-label">${esc(label)}</span>
      <select data-sel>${['<option value="">Built-in</option>', ...sounds().map((m) => `<option value="${esc(m.url)}" ${v?.url === m.url ? 'selected' : ''}>${esc(m.name)}</option>`)].join('')}${v?.url && !sounds().some((m) => m.url === v.url) ? `<option value="${esc(v.url)}" selected>${esc(nameOfUrl(v.url))} (missing)</option>` : ''}</select>
      <input type="range" min="0" max="2" step="0.05" data-vol value="${v?.vol ?? 1}" ${v?.url ? '' : 'disabled'}><span class="snd-pct">${Math.round((v?.vol ?? 1) * 100)}%</span>
      <button class="mini" data-play ${v?.url ? '' : 'disabled'}>▶</button></div>`;
  };
  const ms = allMissions();
  $('snd-body').innerHTML = `
    <div class="card"><h3>Sound effects</h3>${Object.entries(SFX_KEYS).map(([k, l]) => row('sfx', k, l)).join('')}
      <label class="fld"><span>All effects <b>${Math.round(S.sfxVol * 100)}%</b></span><input type="range" min="0" max="1.5" step="0.05" id="sfx-all" value="${S.sfxVol}"></label></div>
    <div class="card"><h3>Music</h3>${row('music', 'menu', 'Main menu')}${ms.map((m) => row('music', m.id, m.name)).join('')}
      <label class="fld"><span>Music volume <b>${Math.round(S.musicVol * 100)}%</b></span><input type="range" min="0" max="1" step="0.05" id="music-all" value="${S.musicVol}"></label></div>
    ${sounds().length ? '' : '<div class="card empty">No sound files yet: upload MP3/OGG/WAV/M4A files in the Media library.</div>'}`;
}
on($('snd-body'), 'input', 'select,input', (e, t) => {
  const S = doc().sounds;
  if (t.id === 'sfx-all') { S.sfxVol = +t.value; t.previousElementSibling.querySelector('b').textContent = `${Math.round(S.sfxVol * 100)}%`; changed(); return; }
  if (t.id === 'music-all') { S.musicVol = +t.value; t.previousElementSibling.querySelector('b').textContent = `${Math.round(S.musicVol * 100)}%`; changed(); return; }
  const r = t.closest('.snd-row'); if (!r) return;
  const g = r.dataset.g, k = r.dataset.k;
  if (t.matches('[data-sel]')) { if (t.value) S[g][k] = { url: t.value, vol: S[g][k]?.vol ?? 1 }; else delete S[g][k]; changed(); renderSounds(); }
  if (t.matches('[data-vol]') && S[g][k]) { S[g][k].vol = +t.value; r.querySelector('.snd-pct').textContent = `${Math.round(t.value * 100)}%`; if (previewAudio) previewAudio.volume = Math.min(1, +t.value * (g === 'music' ? S.musicVol : Math.min(1, S.sfxVol))); changed(); }
});
on($('snd-body'), 'click', '[data-play]', (e, t) => {
  const r = t.closest('.snd-row'), S = doc().sounds, v = S[r.dataset.g][r.dataset.k];
  if (previewAudio) { previewAudio.pause(); const was = previewAudio.dataset.k; previewAudio = null; if (was === r.dataset.k) { t.textContent = '▶'; return; } }
  document.querySelectorAll('#snd-body [data-play]').forEach((b) => { b.textContent = '▶'; });
  if (!v?.url) return;
  previewAudio = new Audio(v.url); previewAudio.dataset.k = r.dataset.k;
  previewAudio.volume = Math.min(1, v.vol * (r.dataset.g === 'music' ? S.musicVol : Math.min(1, S.sfxVol)));
  previewAudio.play(); t.textContent = '■';
  previewAudio.onended = () => { t.textContent = '▶'; previewAudio = null; };
});

// =============================== EVENTS ===============================
let flagDefs = null;
const toLocal = (iso) => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const fromLocal = (v) => (v ? new Date(v).toISOString() : '');
async function renderEvents() {
  const d = doc(); d.events ??= [];
  if (!flagDefs) { try { flagDefs = (await V().api('GET', 'flags')).flags || (await V().api('GET', 'flags')); } catch { flagDefs = []; } }
  const defs = Array.isArray(flagDefs) ? flagDefs : flagDefs.flags || [];
  const now = Date.now();
  const eventMissions = (d.customMissions || []);
  $('ev-list').innerHTML = d.events.length ? d.events.map((ev, i) => {
    const st = !ev.start || !ev.end ? 'draft' : now < Date.parse(ev.start) ? 'scheduled' : now < Date.parse(ev.end) ? 'live' : 'ended';
    return `<div class="card ev-card" data-i="${i}">
      <div class="row-between"><div><input class="lv-name" data-f="name" maxlength="40" value="${esc(ev.name)}"> <span class="badge ${st === 'live' ? 'ok' : st === 'ended' ? '' : 'warn'}">${{ draft: 'Needs dates', scheduled: 'Scheduled', live: 'Live now', ended: 'Ended' }[st]}</span></div>
        <div><label class="switch"><input type="checkbox" data-f="enabled" ${ev.enabled ? 'checked' : ''}> <span>Enabled</span></label> <button class="mini danger" data-act="del">Delete</button></div></div>
      <div class="grid3"><label class="fld"><span>Starts (your time)</span><input type="datetime-local" data-f="start" value="${toLocal(ev.start)}"></label>
        <label class="fld"><span>Ends</span><input type="datetime-local" data-f="end" value="${toLocal(ev.end)}"></label>
        <label class="fld"><span>Announcement on the main page</span><input data-f="announcement" maxlength="200" value="${esc(ev.announcement)}" placeholder="e.g. Double score all weekend!"></label></div>
      <div class="fld"><span>Feature flags while it runs</span><div class="ev-flags">${defs.map((f) => { const v = ev.flags[f.name]; return `<label class="ev-flag"><span>${esc(f.label)}</span><select data-flag="${f.name}"><option value="" ${v === undefined ? 'selected' : ''}>no change</option><option value="1" ${v === true ? 'selected' : ''}>on</option><option value="0" ${v === false ? 'selected' : ''}>off</option></select></label>`; }).join('')}</div></div>
      <div class="grid2"><div class="fld"><span>Liveries unlocked for everyone</span><div class="checks">${(d.liveries || []).map((l) => `<label class="chk"><input type="checkbox" data-liv="${l.id}" ${ev.liveries.includes(l.id) ? 'checked' : ''}> ${esc(l.name)}</label>`).join('') || '<span class="hint small">No liveries yet.</span>'}</div></div>
        <div class="fld"><span>Missions it opens <span class="hint">(custom missions set to "event only")</span></span><div class="checks">${eventMissions.map((m) => `<label class="chk"><input type="checkbox" data-ms="${m.id}" ${ev.missions.includes(m.id) ? 'checked' : ''}> ${esc(m.name)}${m.visibility !== 'event' ? ' <span class="hint">(always on)</span>' : ''}</label>`).join('') || '<span class="hint small">No custom missions yet.</span>'}</div></div></div>
    </div>`;
  }).join('') : '<div class="card empty">No events yet. Press <b>+ New event</b>.</div>';
}
$('ev-add').onclick = () => {
  const d = doc(); d.events ??= [];
  const start = new Date(); start.setMinutes(0, 0, 0); start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 2 * 86400000);
  d.events.push({ id: rid('ev'), name: 'Weekend event', start: start.toISOString(), end: end.toISOString(), flags: { 'vw.event.double_score': true }, liveries: [], missions: [], announcement: 'Double score all weekend!', enabled: true });
  changed(); renderEvents();
};
on($('ev-list'), 'change', 'input,select', (e, t) => {
  const ev = doc().events[+t.closest('.ev-card').dataset.i];
  const f = t.dataset.f;
  if (f === 'enabled') ev.enabled = t.checked;
  else if (f === 'start' || f === 'end') ev[f] = fromLocal(t.value);
  else if (f) ev[f] = t.value;
  else if (t.dataset.flag) { if (t.value === '') delete ev.flags[t.dataset.flag]; else ev.flags[t.dataset.flag] = t.value === '1'; }
  else if (t.dataset.liv) ev.liveries = [...t.closest('.checks').querySelectorAll('[data-liv]:checked')].map((x) => x.dataset.liv);
  else if (t.dataset.ms) ev.missions = [...t.closest('.checks').querySelectorAll('[data-ms]:checked')].map((x) => x.dataset.ms);
  changed();
  if (f === 'start' || f === 'end' || f === 'enabled') renderEvents();
});
on($('ev-list'), 'click', '[data-act=del]', (e, t) => { const i = +t.closest('.ev-card').dataset.i; if (confirm('Delete this event?')) { doc().events.splice(i, 1); changed(); renderEvents(); } });
export { renderShips, renderLiveries, renderEnvs, renderSounds, renderEvents, activeEvents, MISSIONS };
