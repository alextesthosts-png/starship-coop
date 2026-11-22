// App shell: networking, menus, lobby, debrief, and the menu backdrop scene.
import * as THREE from 'three';
import { SHIPS, MISSIONS, DIFFICULTY } from '/shared/config.js';
import { buildShip, applyModelGlow, preloadShipModels, setBakedEnvironment, setShipModels, setModelMarkers, setLiveries } from './models.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { render as renderMarkup, inline as inlineMarkup, escapeHtml } from '/shared/markup.js';
import { Sfx } from './audio.js';
import { Hud, esc } from './hud.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { setAnisotropy, setTextureOverrides } from './textures.js';
import { setPanoramas } from './env.js';
import { applyGameContent, shipAllowedIn, roleRank, ROLE_LABEL } from '/shared/gamecontent.js';
import { showHangar, refreshHangar, renderList as renderHangarList } from './hangar.js';

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);

// ---------------- state ----------------
const S = {
  myId: null,
  name: localStorage.getItem('vw_name') || '',
  ship: localStorage.getItem('vw_ship') || 'lancer',
  room: null,
  game: null,
  screen: 'menu',
  pendingJoin: new URLSearchParams(location.search).get('room'),
  livery: localStorage.getItem('vw_livery') || '',
  pilot: localStorage.getItem('vw_pilot') || '',
  preview: sessionStorage.getItem('vw_preview') === '1',
  me: null,
  content: null,
};
// Pilot pass from the forum ("Sign in with your forum account" sends players back with #pilot=...)
{
  const m = location.hash.match(/^#pilot=([\w.-]+)$/);
  if (m) { S.pilot = m[1]; localStorage.setItem('vw_pilot', S.pilot); history.replaceState(null, '', location.pathname + location.search); }
}
const hello = () => net.send({ t: 'hello', name: S.name || `Pilot-${S.myId}`, ship: S.ship, livery: S.livery, pilot: S.pilot });
if (!SHIPS[S.ship]) S.ship = 'lancer';
S.flags = { missions: { siege: true, convoy: true, dread: true }, ships: { lancer: true, warden: true, hammer: true }, doubleScore: false, extraReserves: false, aiWingmates: true };
let resolveContent; const contentReady = new Promise((r) => { resolveContent = r; });

const sfx = new Sfx();
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
setAnisotropy(renderer.capabilities.getMaxAnisotropy());
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  setBakedEnvironment(pmrem.fromScene(new RoomEnvironment(), 0.04).texture);
  pmrem.dispose();
}
const hud = new Hud();
const input = new Input(canvas);

// ---------------- networking ----------------
const net = {
  ws: null,
  handlers: {},
  connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m); };
    ws.onclose = () => {
      toast('Connection lost — reconnecting…');
      if (S.game) endGame();
      S.room = null;
      setScreen('menu');
      setTimeout(() => this.connect(), 1500);
    };
  },
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); },
};

function onMessage(m) {
  switch (m.t) {
    case 'welcome':
      S.myId = m.id;
      if (m.flags) applyFlags(m.flags);
      hello();
      if (S.pendingJoin) { net.send({ t: 'join', code: S.pendingJoin }); S.pendingJoin = null; }
      break;
    case 'room': {
      const prevState = S.room?.state;
      S.room = m;
      { // the server decides which livery I fly in this wing (role, events, preview draft)
        const mine = m.players.find((q) => q.id === S.myId);
        if (mine && S.me && S.me.livery !== mine.livery) { S.me.livery = mine.livery; renderLiveries(); setPreview(S.ship); }
      }
      history.replaceState(null, '', `?room=${m.code}`);
      if (!S.game && S.screen !== 'debrief' && S.screen !== 'game') setScreen('lobby');
      renderLobby();
      if (prevState === 'playing' && m.state === 'lobby' && S.game && !S.ending) endGame();
      break;
    }
    case 'left': S.room = null; history.replaceState(null, '', '/'); setScreen('menu'); break;
    case 'error': $('menu-error').textContent = m.msg; toast(m.msg); break;
    case 'chat': addChat(m); break;
    case 'flags': applyFlags(m.flags, true); break;
    case 'tuning': break;
    case 'content': if (m.scope !== 'preview' || S.preview) loadContent(true); break;
    case 'me':
      S.me = m;
      if (m.pilot) { $('name').value = m.name; S.name = m.name; }
      else if (S.pilot && !m.pilot) { S.pilot = ''; localStorage.removeItem('vw_pilot'); }   // expired or invalid pass
      renderPilot(); renderLiveries(); setPreview(S.ship);
      break;
    case 'start': startGame(m); break;
    case 'pjoin': S.game && S.game.onPlayerJoin(m.player); break;
    case 's': if (S.game) { S.game.onSnapshot(m); if (m.ev) S.game.onEvents(m.ev); } break;
    case 'ev': if (S.game && m.ev) S.game.onEvents(m.ev); break;
    case 'end': showDebrief(m); break;
    case 'abort': endGame(); setScreen('lobby'); toast('Mission aborted by the wing leader.'); break;
    default: break;
  }
}

// ---------------- screens ----------------
function setScreen(name) {
  S.screen = name;
  for (const id of ['menu', 'lobby', 'debrief']) show(id, id === name);
  if (name !== 'game') { show('pause', false); input.unlock(); }
  input.enabled = name === 'game';
  if (name === 'menu') refreshRooms();
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------------- ship select ----------------
function pips(n) { return `<div class="pips">${Array.from({ length: 5 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>`; }
function renderShipSelect(el) {
  const mission = S.room?.missionId;
  el.innerHTML = Object.entries(SHIPS).filter(([k]) => S.flags.ships[k] !== undefined || !SHIPS[k].custom).map(([k, s]) => {
    const cleared = !mission || shipAllowedIn(k, mission);
    return `
    <div class="ship-card ${k === S.ship ? 'sel' : ''} ${S.flags.ships[k] ? '' : 'off'} ${cleared ? '' : 'notcleared'}" data-ship="${k}">
      <div class="nm">${esc(s.name)}${s.custom ? '<span class="custom-tag">NEW</span>' : ''}${S.flags.ships[k] ? '' : ' <span class="grounded">Grounded</span>'}</div><div class="rl">${esc(s.role)}${cleared ? '' : '<span class="cleared">Not cleared for this mission</span>'}</div>
      <div class="st"><span>SPD</span>${pips(s.stats.speed)}<span>ARM</span>${pips(s.stats.armor)}<span>FPW</span>${pips(s.stats.firepower)}<span>HDL</span>${pips(s.stats.handling)}</div>
    </div>`;
  }).join('') + `<div class="ship-desc" style="grid-column:1/-1">${esc(SHIPS[S.ship]?.desc || '')}</div>`;
  el.querySelectorAll('.ship-card').forEach((c) => c.addEventListener('click', () => selectShip(c.dataset.ship)));
}
function selectShip(k) {
  if (!S.flags.ships[k]) { toast(`The ${SHIPS[k].name} is grounded right now.`); return; }
  if (S.room && !shipAllowedIn(k, S.room.missionId)) { toast(`The ${SHIPS[k].name} isn't cleared for this mission.`); return; }
  S.ship = k;
  localStorage.setItem('vw_ship', k);
  sfx.init(); sfx.ui();
  net.send({ t: 'ship', ship: k });
  renderShipSelect($('ship-select'));
  renderShipSelect($('ship-select-lobby'));
  setPreview(k);
}

// ---------------- menu ----------------
$('name').value = S.name;
$('name').addEventListener('change', () => {
  S.name = $('name').value.trim().slice(0, 16);
  localStorage.setItem('vw_name', S.name);
  hello();
});
function ensureName() {
  S.name = $('name').value.trim().slice(0, 16) || S.name || `Pilot-${S.myId}`;
  localStorage.setItem('vw_name', S.name);
  hello();
}
// In admin preview mode, Quick Play and Create both open a private preview wing.
$('btn-quick').onclick = () => { sfx.init(); ensureName(); net.send(S.preview ? { t: 'create', preview: true } : { t: 'quick' }); };
$('btn-create').onclick = () => { sfx.init(); ensureName(); net.send({ t: 'create', isPublic: true, preview: S.preview }); };
$('btn-join').onclick = () => {
  sfx.init(); ensureName();
  const code = $('join-code').value.trim().toUpperCase();
  if (code.length !== 4) { $('menu-error').textContent = 'Enter a 4-letter wing code.'; return; }
  net.send({ t: 'join', code });
};
$('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
$('btn-refresh').onclick = refreshRooms;
async function refreshRooms() {
  try {
    const list = await (await fetch('/api/rooms')).json();
    $('room-list').innerHTML = list.length ? list.map((r) => `<div class="room" data-code="${r.code}"><span><b>${esc(r.host || '?')}</b>'s wing · ${esc(r.mission || '')}</span><span>${r.players}/4 ${r.state === 'playing' ? '· in flight' : ''}</span></div>`).join('') : '<div class="muted">No open wings — create one or hit Quick Play.</div>';
    $('room-list').querySelectorAll('.room').forEach((el) => el.addEventListener('click', () => { sfx.init(); ensureName(); net.send({ t: 'join', code: el.dataset.code }); }));
  } catch { $('room-list').innerHTML = '<div class="muted">Could not load wings.</div>'; }
}
setInterval(() => { if (S.screen === 'menu') refreshRooms(); }, 8000);

function openTab(id) {
  document.querySelectorAll('.tabs .tab').forEach((x) => x.classList.toggle('on', x.dataset.tab === id));
  document.querySelectorAll('.info-card .tab-body').forEach((b) => b.classList.toggle('hidden', b.id !== id));
  if (id === 'tab-rooms') refreshRooms();
  showHangar(id === 'tab-hangar');
}
document.querySelector('.tabs').addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (t && t.dataset.tab) openTab(t.dataset.tab); });

// ---------------- feature flags (live) ----------------
function applyGameTuning(c, live = false) {
  applyGameContent(c);   // tuning, custom ships, custom missions, terrain
  for (const o of $('diff').options) if (DIFFICULTY[o.value]) o.textContent = DIFFICULTY[o.value].label;
  renderShipSelect($('ship-select'));
  renderShipSelect($('ship-select-lobby'));
  if (S.room) renderLobby();
  applyModelGlow();
  if (S.game?.applyLooks) S.game.applyLooks();
  if (live) toast(S.preview ? 'Preview draft updated.' : 'Command updated the fleet.');
}

function applyFlags(flags, live = false) {
  const before = JSON.stringify(S.flags);
  S.flags = flags;
  if (!S.flags.ships[S.ship]) {
    const next = Object.keys(S.flags.ships).find((k) => S.flags.ships[k]);
    if (next) { S.ship = next; localStorage.setItem('vw_ship', next); net.send({ t: 'ship', ship: next }); setPreview(next); }
  }
  renderShipSelect($('ship-select'));
  renderShipSelect($('ship-select-lobby'));
  if (S.room) renderLobby();
  const ev = [];
  for (const e of S.content?.events || []) ev.push(`🎉 ${escapeHtml(e.name)} · until ${escapeHtml(new Date(e.end).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }))}`);
  if (flags.doubleScore) ev.push('⚡ Double score event is live');
  if (flags.extraReserves) ev.push('🛡 +2 reserve ships per mission');
  const strip = $('event-strip');
  strip.innerHTML = ev.map((e) => `<span>${e}</span>`).join('');
  strip.classList.toggle('hidden', !ev.length);
  if (live && before !== JSON.stringify(flags)) toast('Command updated the flight roster.');
}

// ---------------- editable site content (from the admin panel) ----------------
S.maintenance = null;
function setText(id, v) { const el = document.getElementById(id); if (el && typeof v === 'string' && v) el.textContent = v; }
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (x) => Math.max(0, Math.min(255, Math.round(x * k)));
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
}
function applyContent(c) {
  const s = c.site || {};
  if (s.pageTitle) document.title = s.pageTitle;
  if (s.metaDescription) document.getElementById('meta-desc')?.setAttribute('content', s.metaDescription);
  setText('c-title', s.title); setText('c-accent', s.titleAccent); setText('c-tagline', s.tagline);
  setText('c-step1', s.step1); setText('c-step2', s.step2); setText('c-step3', s.step3);
  setText('c-quick', s.quickLabel); setText('c-quicksub', s.quickSub); setText('c-create', s.createLabel); setText('c-createsub', s.createSub); setText('c-join', s.joinLabel);
  if (s.namePlaceholder) $('name').placeholder = s.namePlaceholder;
  const fl = $('forum-link'), ft = $('forum-tab');
  if (s.forumUrl) { fl.href = s.forumUrl; ft.href = s.forumUrl; setText('c-forum', s.forumLabel || 'Community Forum'); }
  fl.classList.toggle('hidden', !s.forumUrl); ft.classList.toggle('hidden', !s.forumUrl);
  const st = c.settings || {};
  if (st.accent) {
    document.documentElement.style.setProperty('--cyan', st.accent);
    document.documentElement.style.setProperty('--cyan-d', shade(st.accent, 0.42));
    document.documentElement.style.setProperty('--line', shade(st.accent, 1).replace('rgb', 'rgba').replace(')', ', 0.28)'));
  }
  // announcement + maintenance banner (all text is escaped by the markup renderer)
  const an = $('announce');
  const parts = [];
  S.maintenance = st.maintenance?.enabled ? (st.maintenance.message || 'Maintenance in progress.') : null;
  if (S.maintenance) parts.push({ style: 'warning', html: `<p><b>Maintenance:</b> ${inlineMarkup(S.maintenance)}</p>` });
  if (c.announcement?.enabled && c.announcement.text) parts.push({ style: c.announcement.style, html: renderMarkup(c.announcement.text) });
  an.classList.toggle('hidden', !parts.length);
  if (c.announcement?.enabled && c.announcement.image) parts.splice(S.maintenance ? 1 : 0, 0, { style: c.announcement.style, html: `<img class="announce-img" src="${escapeHtml(c.announcement.image)}" alt="">` });
  an.classList.toggle('hidden', !parts.length);
  if (parts.length) { an.className = `announce ${parts[0].style}`; an.innerHTML = parts.map((p) => p.html).join(''); }
  const bg = $('page-bg');
  if (st.background) { bg.style.backgroundImage = `url("${encodeURI(st.background)}")`; bg.style.setProperty('--dim', st.backgroundDim ?? 0.55); bg.classList.remove('hidden'); }
  else bg.classList.add('hidden');
  S.content = c;
  setShipModels(st.shipModels || {}, c.customShips || []);
  setModelMarkers(c.modelMarkers);
  setLiveries(c.liveries || []);
  setPanoramas(c.environment?.panoramas);
  const tx = c.environment?.planet?.textures || {};
  setTextureOverrides(Object.fromEntries([['terrain_sand_albedo', tx.sandA], ['terrain_sand_normal', tx.sandN], ['terrain_rock_albedo', tx.rockA], ['terrain_rock_normal', tx.rockN], ['terrain_cliff_albedo', tx.cliffA], ['terrain_cliff_normal', tx.cliffN]].filter(([, v]) => v)));
  sfx.setSounds(c.sounds);
  if (!S.game) sfx.playMusic('menu');
  applyGameTuning(c);
  if (c.flags) applyFlags(c.flags);
  preloadShipModels().then(() => { if (S.screen === 'menu' || S.screen === 'lobby') setPreview(S.ship); refreshHangar(); });
  renderHangarList();
  renderLiveries(); renderPilot(); renderPreviewBar(c);
  const eb = $('event-banner');
  const anns = (c.events || []).filter((e) => e.announcement);
  eb.innerHTML = anns.map((e) => `<div><b>${escapeHtml(e.name)}</b> · ${inlineMarkup(e.announcement)}</div>`).join('');
  eb.classList.toggle('hidden', !anns.length);
  $('preview-ribbon').classList.toggle('hidden', !(c.env?.preview || c.preview));
  if (c.preview) $('preview-ribbon').textContent = 'ADMIN PREVIEW · draft content';
  if (c.env?.preview) {
    const rb = $('preview-ribbon');
    rb.textContent = `PREVIEW${c.env.branch ? ` · ${c.env.branch}` : ''}${c.env.commit ? ` · ${c.env.commit}` : ''}`;
    rb.classList.remove('hidden');
  }
  document.querySelector('.launch-card').classList.toggle('maint', !!S.maintenance);
  for (const id of ['btn-quick', 'btn-create', 'btn-join']) $(id).disabled = !!S.maintenance;
  // tabs: built-in visibility + custom sections
  const tabs = document.querySelector('.tabs');
  tabs.querySelectorAll('.tab.custom').forEach((t) => t.remove());
  $('custom-sections').innerHTML = '';
  $('admin-link').classList.toggle('hidden', st.showAdminLink === false);
  const vis = { rooms: st.showOpenWings !== false, howto: st.showHowTo !== false, changelog: st.showChangelog !== false, hangar: st.showHangar !== false };
  tabs.querySelectorAll('.tab[data-key]').forEach((t) => t.classList.toggle('hidden', !vis[t.dataset.key]));
  for (const sec of c.sections || []) {
    const b = document.createElement('button');
    b.className = 'tab custom'; b.dataset.tab = `tab-s-${sec.id}`; b.dataset.key = sec.id; b.setAttribute('role', 'tab'); b.textContent = sec.title;
    tabs.appendChild(b);
    const body = document.createElement('div');
    body.id = `tab-s-${sec.id}`; body.className = 'tab-body md hidden'; body.innerHTML = renderMarkup(sec.body);
    $('custom-sections').appendChild(body);
  }
  // changelog
  if (Array.isArray(c.changelog)) {
    $('changelog-list').innerHTML = c.changelog.length ? c.changelog.map((r, i) => `
      <article class="release">
        <h3>${escapeHtml(r.version)} <span class="date">${escapeHtml(r.date)}</span>${r.latest ? ' <span class="tag new">Latest</span>' : ''}${r.title ? ` <span class="rtitle">${inlineMarkup(r.title)}</span>` : ''}</h3>
        <ul>${r.items.map((t) => `<li>${inlineMarkup(t)}</li>`).join('')}</ul>
      </article>`).join('') : '<p class="muted">No releases yet.</p>';
  }
  const visibleTabs = [...tabs.querySelectorAll('.tab:not(.hidden):not(.ext)')];
  const want = visibleTabs.find((t) => t.dataset.key === st.defaultTab) || visibleTabs[0];
  document.querySelector('.info-card').classList.toggle('hidden', !visibleTabs.length);
  if (want) openTab(want.dataset.tab);
}
// Content (+ the custom terrain heightmap, fetched separately and cached by version)
const terrainCache = new Map();
async function loadContent(live = false) {
  const q = S.preview ? '?preview=1' : '';
  const c = await (await fetch(`/api/content${q}`)).json();
  if (S.preview && !c.preview) { S.preview = false; sessionStorage.removeItem('vw_preview'); }
  const hm = c.environment?.planet?.heightmap;
  if (hm?.v) {
    if (!terrainCache.has(hm.v)) terrainCache.set(hm.v, fetch(`/api/terrain${q}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    const full = await terrainCache.get(hm.v);
    c.environment.planet.heightmap = full;
  }
  applyContent(c);
  if (live) { toast(S.preview ? 'Preview draft updated.' : 'Command updated the fleet.'); if (S.room) renderLobby(); }
  return c;
}
loadContent().catch(() => {}).finally(() => resolveContent());

// ---------------- pilot pass, liveries, preview mode ----------------
function renderPilot() {
  const c = S.content || {};
  const forum = c.site?.forumUrl;
  const pilot = S.me?.pilot;
  const chip = $('pilot-chip');
  if (pilot) chip.innerHTML = `✓ ${escapeHtml(pilot.name)} <span class="role">${{ user: 'Pilot', moderator: 'Wing Leader', admin: 'Command' }[pilot.role] || ''}</span>`;
  show('pilot-chip', !!pilot);
  show('pilot-signout', !!pilot);
  $('name').disabled = !!pilot;
  const a = $('pilot-signin');
  if (forum && !pilot) a.href = `${forum.replace(/\/$/, '')}/game-link?return=${encodeURIComponent(location.origin + '/')}`;
  show('pilot-signin', !!forum && !pilot);
}
$('pilot-signout').onclick = () => { S.pilot = ''; localStorage.removeItem('vw_pilot'); $('name').disabled = false; hello(); };
function myRole() { return S.me?.isAdmin ? 'admin' : S.me?.pilot?.role || 'everyone'; }
function availableLiveries() {
  const L = S.content?.liveries || [];
  const evL = new Set((S.content?.events || []).flatMap((e) => e.liveries || []));
  const rank = roleRank(myRole());
  return L.filter((l) => evL.has(l.id) || (!l.eventOnly && rank >= roleRank(l.access)));
}
function renderLiveries() {
  const list = availableLiveries();
  const all = S.content?.liveries || [];
  show('livery-row', all.length > 0);
  if (!all.length) return;
  const sel = $('livery');
  const cur = S.me?.livery ?? '';
  sel.innerHTML = `<option value="none">Factory paint</option>${list.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}${l.autoFor ? ' ★' : ''}</option>`).join('')}`;
  sel.value = list.some((l) => l.id === cur) ? cur : 'none';
  const locked = all.filter((l) => !list.includes(l) && !l.eventOnly);
  $('livery-note').textContent = locked.length ? `${locked.length} more for ${[...new Set(locked.map((l) => ROLE_LABEL[l.access].toLowerCase()))].join(', ')}` : '';
}
$('livery').onchange = () => {
  S.livery = $('livery').value;
  localStorage.setItem('vw_livery', S.livery);
  net.send({ t: 'livery', livery: S.livery });
  setTimeout(() => setPreview(S.ship), 150);
};
function renderPreviewBar(c) {
  const has = !!c.admin?.hasPreview;
  show('preview-bar', has);
  if (has) {
    $('preview-toggle').checked = S.preview;
    $('preview-when').textContent = c.admin.previewAt ? `saved ${new Date(c.admin.previewAt).toLocaleString()}` : '';
  }
}
$('preview-toggle').onchange = () => {
  S.preview = $('preview-toggle').checked;
  sessionStorage.setItem('vw_preview', S.preview ? '1' : '0');
  if (S.room) net.send({ t: 'leave' });
  loadContent().then(() => toast(S.preview ? 'Preview mode on: new wings use the draft. Only admins can join them.' : 'Back to the live game.'));
};

// ---------------- lobby ----------------
function isHost() { return S.room && S.room.hostId === S.myId; }
function renderLobby() {
  const r = S.room;
  if (!r) return;
  $('room-code').textContent = r.code;
  const slots = [];
  for (let i = 0; i < 4; i++) {
    const p = r.players.find((q) => q.slot === i);
    if (p) slots.push(`<div class="pl"><span class="dot" style="background:${p.color}"></span><span class="nm">${esc(p.name)}${p.id === r.hostId ? ' <span title="Wing leader">★</span>' : ''}${p.id === S.myId ? ' <span class="muted">(you)</span>' : ''}</span><span class="sh">${esc(SHIPS[p.ship].name)}</span><span class="rd ${p.ready ? 'yes' : ''}">${p.ready ? 'READY' : 'NOT READY'}</span></div>`);
    else slots.push(`<div class="pl empty"><span class="dot" style="background:#333"></span><span class="nm">Open slot — AI wingmates fill in</span></div>`);
  }
  $('player-list').innerHTML = slots.join('');
  const me = r.players.find((p) => p.id === S.myId);
  $('btn-ready').textContent = me?.ready ? 'Ready ✓' : 'Ready';
  $('btn-ready').classList.toggle('on', !!me?.ready);
  const host = isHost();
  $('btn-start').classList.toggle('hidden', !host);
  $('btn-start').disabled = r.state === 'playing';
  const allReady = r.players.every((p) => p.ready || p.id === r.hostId);
  $('lobby-hint').textContent = r.state === 'playing' ? 'Mission in progress…' : host ? (allReady ? 'All pilots ready. Launch when you are.' : 'Waiting for pilots to ready up (you can launch anyway).') : 'Waiting for the wing leader to launch.';
  $('host-note').textContent = host ? '(you choose)' : '(leader chooses)';
  $('diff').value = r.diff;
  $('diff').disabled = !host;
  $('public').checked = r.isPublic;
  $('public').disabled = !host;
  $('mission-list').innerHTML = MISSIONS.map((m, i) => `
    <div class="mission ${m.id === r.missionId ? 'sel' : ''} ${host ? '' : 'locked'} ${S.flags.missions[m.id] ? '' : 'off'}" data-id="${m.id}">
      <div class="mn">${i + 1}. ${esc(m.name)}${S.flags.missions[m.id] ? '' : ' <span class="grounded">Offline</span>'}</div><div class="ml">${esc(m.location)}</div>
    </div>`).join('');
  $('mission-list').querySelectorAll('.mission').forEach((el) => el.addEventListener('click', () => {
    if (!isHost()) return;
    if (!S.flags.missions[el.dataset.id]) { toast('That mission is offline right now.'); return; }
    sfx.ui();
    net.send({ t: 'mission', missionId: el.dataset.id, diff: $('diff').value });
  }));
  const m = MISSIONS.find((x) => x.id === r.missionId);
  $('briefing').innerHTML = `<p>${esc(m.briefing)}</p><div class="sub-h">Primary objectives</div><ul>${m.primary.map((o) => `<li>${o}</li>`).join('')}</ul>
    <div class="sub-h">Bonus objectives (medals)</div><ul class="bonus">${m.bonus.map((o) => `<li>${o}</li>`).join('')}</ul>
    <div class="muted">Difficulty: ${esc(DIFFICULTY[r.diff].label)} · Reserve ships scale with wing size.</div>`;
}
$('diff').onchange = () => net.send({ t: 'mission', missionId: S.room.missionId, diff: $('diff').value });
$('public').onchange = () => net.send({ t: 'mission', missionId: S.room.missionId, diff: $('diff').value, isPublic: $('public').checked });
$('btn-ready').onclick = () => { sfx.init(); sfx.ui(); const me = S.room.players.find((p) => p.id === S.myId); net.send({ t: 'ready', ready: !me?.ready }); };
$('btn-start').onclick = () => { sfx.init(); net.send({ t: 'start' }); };
$('btn-leave').onclick = () => { net.send({ t: 'leave' }); };
$('btn-copy').onclick = async () => {
  const url = `${location.origin}/?room=${S.room.code}`;
  try { await navigator.clipboard.writeText(url); toast('Invite link copied!'); } catch { toast(url); }
};
$('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const t = e.target.value.trim(); if (t) net.send({ t: 'chat', text: t }); e.target.value = ''; }
});
function addChat(m) {
  const log = $('chat-log');
  const el = document.createElement('div');
  el.className = m.from ? 'c' : 'c sys';
  el.innerHTML = m.from ? `<b style="color:${m.color}">${esc(m.from)}:</b> ${esc(m.text)}` : esc(m.text);
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  if (S.game && m.from) hud.message(m.from, m.text, m.color);
}

// ---------------- game ----------------
function startGame(m) {
  if (S.game) endGame();
  sfx.init();
  S.ending = false;
  setScreen('game');
  show('loading', true);
  stopPreview();
  // let the loading screen paint before heavy scene construction
  contentReady.then(() => preloadShipModels()).then(() => {
    try {
      S.game = new Game({ renderer, net, sfx, hud, input, start: m, myId: S.myId });
    } catch (err) {
      console.error(err);
      toast('Failed to start mission: ' + err.message);
    }
    show('loading', false);
    input.enabled = true;
    input.lock();
    updateClickPrompt();
  });
}
function endGame() {
  if (S.game) { S.game.dispose(); S.game = null; }
  input.unlock();
  input.enabled = false;
  show('pause', false);
  show('click-to-fly', false);
  sfx.playMusic('menu');
  startPreview();
}
function updateClickPrompt() { show('click-to-fly', !!S.game && !input.locked && $('pause').classList.contains('hidden')); }

input.onUnlock = () => {
  if (S.game && !chatOpen) { show('pause', true); syncSettings(); }
  updateClickPrompt();
};
document.addEventListener('pointerlockchange', () => { if (input.locked) show('pause', false); updateClickPrompt(); });
canvas.addEventListener('click', () => { if (S.game && !input.locked) { sfx.init(); input.lock(); } });
$('btn-resume').onclick = () => { show('pause', false); input.lock(); updateClickPrompt(); };
$('btn-quit').onclick = () => { endGame(); net.send({ t: 'leave' }); };
$('btn-abort').onclick = () => { if (isHost()) net.send({ t: 'abort' }); else toast('Only the wing leader can abort.'); };

function syncSettings() {
  $('sens').value = input.settings.sens;
  $('sens-val').textContent = (+input.settings.sens).toFixed(1);
  $('invert').checked = input.settings.invert;
  $('recenter').checked = input.settings.recenter;
  $('vol').value = sfx.vol;
  $('btn-abort').classList.toggle('hidden', !isHost());
}
$('sens').oninput = () => { input.settings.sens = +$('sens').value; $('sens-val').textContent = (+$('sens').value).toFixed(1); input.saveSettings(); };
$('invert').onchange = () => { input.settings.invert = $('invert').checked; input.saveSettings(); };
$('recenter').onchange = () => { input.settings.recenter = $('recenter').checked; input.saveSettings(); };
$('vol').oninput = () => sfx.setVolume(+$('vol').value);

// in-game chat + hotkeys
let chatOpen = false;
window.addEventListener('keydown', (e) => {
  if (!S.game) return;
  if (e.key === 'Enter' && !chatOpen && document.activeElement !== $('game-chat')) {
    chatOpen = true;
    show('game-chat', true);
    input.unlock();
    $('game-chat').focus();
    e.preventDefault();
  } else if (e.code === 'KeyM' && document.activeElement?.tagName !== 'INPUT') {
    toast(sfx.toggleMute() ? 'Sound muted' : 'Sound on');
  }
});
$('game-chat').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'Escape') {
    const t = $('game-chat').value.trim();
    if (e.key === 'Enter' && t) net.send({ t: 'chat', text: t });
    $('game-chat').value = '';
    show('game-chat', false);
    $('game-chat').blur();
    chatOpen = false;
    input.lock();
    e.preventDefault();
    e.stopPropagation();
  }
});

// ---------------- debrief ----------------
function showDebrief(m) {
  S.ending = true;
  setTimeout(() => {
    endGame();
    setScreen('debrief');
    const mission = MISSIONS.find((x) => x.id === m.missionId);
    $('deb-title').textContent = m.success ? 'MISSION COMPLETE' : 'MISSION FAILED';
    $('deb-title').className = `deb-title ${m.success ? 'win' : 'lose'}`;
    $('deb-reason').textContent = `${mission.name} · ${DIFFICULTY[m.diff].label} · ${Math.floor(m.time / 60)}:${String(m.time % 60).padStart(2, '0')} — ${m.reason || ''}`;
    $('deb-medal').className = `medal ${m.medal}`;
    $('deb-medal').textContent = m.medal.toUpperCase();
    $('deb-obj').innerHTML = m.objectives.map((o) => `<div class="obj ${o.status} ${o.bonus ? 'bonus' : ''}"><span class="i">${o.status === 'done' ? '✔' : '✖'}</span>${esc(o.text)} ${o.progress ? `<span class="p">${esc(o.progress)}</span>` : ''}</div>`).join('');
    const rows = [...m.stats].sort((a, b) => b.score - a.score);
    $('deb-stats').innerHTML = `<tr><th>Pilot</th><th>Ship</th><th>Kills</th><th>Accuracy</th><th>Shot down</th><th>Score</th></tr>` +
      rows.map((s, i) => `<tr><td style="color:${s.color};font-weight:700">${i === 0 && s.score > 0 ? '🏆 ' : ''}${esc(s.name)}</td><td>${esc(SHIPS[s.ship].name)}</td><td>${s.kills}</td><td>${s.accuracy}%</td><td>${s.deaths}</td><td><b>${s.score}</b></td></tr>`).join('');
    sfx.fanfare(m.success);
  }, 600);
}
$('btn-deb-continue').onclick = () => { sfx.ui(); setScreen(S.room ? 'lobby' : 'menu'); renderLobby(); };

// ---------------- menu backdrop ----------------
let preview = null;
function setPreview(k) {
  if (!preview) return;
  if (preview.ship) preview.scene.remove(preview.ship);
  preview.ship = buildShip(k, '#4fc3ff', { livery: S.me?.livery || '' });
  // show every ship at about the same size, whatever model it uses
  const sz = new THREE.Box3().setFromObject(preview.ship).getSize(new THREE.Vector3());
  preview.ship.scale.setScalar(8.5 / (Math.max(sz.x, sz.z) || 8.5));
  preview.ship.position.x = -3.5;
  preview.scene.add(preview.ship);
}
function startPreview() {
  if (preview) { preview.running = true; requestAnimationFrame(preview.loop); return; }
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 30000);
  cam.position.set(-6, 3, 26);
  scene.add(new THREE.AmbientLight(0x6080a0, 0.8));
  const key = new THREE.DirectionalLight(0xffffff, 2.5); key.position.set(10, 8, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0x4fc3ff, 2); rim.position.set(-8, -2, -10); scene.add(rim);
  const pos = new Float32Array(3000 * 3);
  for (let i = 0; i < 3000; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(4000 + Math.random() * 4000); pos.set([v.x, v.y, v.z], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xbfd8ff, size: 1.5, sizeAttenuation: false }));
  scene.add(stars);
  const planet = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 32), new THREE.MeshStandardMaterial({ color: 0xc8935e, roughness: 1 }));
  planet.position.set(1400, -700, -2600);
  scene.add(planet);
  preview = { scene, cam, ship: null, running: true, t: 0 };
  preview.loop = (now) => {
    if (!preview.running) return;
    requestAnimationFrame(preview.loop);
    preview.t = now / 1000;
    const w = window.innerWidth, h = window.innerHeight;
    if (renderer.domElement.width !== Math.floor(w * renderer.getPixelRatio())) renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
    cam.setViewOffset(w, h, w > 1250 ? -w * 0.29 : 0, w > 1250 ? h * 0.04 : 0, w, h);
    if (preview.ship) preview.ship.visible = w > 1250;
    if (preview.ship) {
      preview.ship.rotation.y = preview.t * 0.4 + 0.6;
      preview.ship.rotation.z = Math.sin(preview.t * 0.7) * 0.15;
      preview.ship.position.y = 4.2 + Math.sin(preview.t * 1.1) * 0.4;
    }
    stars.rotation.y = preview.t * 0.005;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.render(scene, cam);
  };
  setPreview(S.ship);
  requestAnimationFrame(preview.loop);
}
function stopPreview() { if (preview) { preview.running = false; preview.cam.clearViewOffset(); } }

// ---------------- boot ----------------
renderShipSelect($('ship-select'));
renderShipSelect($('ship-select-lobby'));
startPreview();
contentReady.then(() => preloadShipModels()).then(() => setPreview(S.ship));
setScreen('menu');
net.connect();
window.__vw = S; // debug handle
