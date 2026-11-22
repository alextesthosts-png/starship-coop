// Admin-made game content shared by the server and the browser: custom ships, custom missions,
// liveries, environments, sounds, model markers and scheduled events.
// sanitize*() validate what the admin panel sends; applyGameContent() rewrites the live game
// tables (SHIPS, MISSIONS, terrain) in place, the same way tuning does.
import { SHIPS, MISSIONS, MODEL_SLOTS } from './config.js';
import { applyTuning } from './tuning.js';
import { setTerrainOverride, PLANET } from './world.js';

export const BASE_SHIPS = ['lancer', 'warden', 'hammer'];
export const BASE_MISSIONS = ['siege', 'convoy', 'dread'];
export const ENEMY_TYPES = ['raider', 'bomber', 'gunship'];
export const ROLES = ['everyone', 'user', 'moderator', 'admin'];   // forum roles, lowest to highest
export const ROLE_LABEL = { everyone: 'Everyone', user: 'Pilots (forum members)', moderator: 'Wing Leaders and up', admin: 'Command only' };
export const SFX_KEYS = { laser: 'Cannon shot', explosion: 'Explosion', missile: 'Missile launch', bomb: 'Bomb drop', flak: 'Flak burst', hit: 'Taking a hit', engine: 'Engine loop' };
export const MUSIC_KEYS = { menu: 'Main menu' };   // plus one per mission, added at runtime

// ---------- small validators ----------
const HEX = /^#[0-9a-f]{6}$/i;
const str = (v, max, def = '') => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : def);
const num = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
const int = (v, min, max, def) => Math.round(num(v, min, max, def));
const bool = (v, def = false) => (typeof v === 'boolean' ? v : def);
const hex = (v, def = '') => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : def);
const id = (v, prefix) => (typeof v === 'string' && new RegExp(`^${prefix}-[a-z0-9]{3,12}$`).test(v) ? v : `${prefix}-${Math.random().toString(36).slice(2, 9)}`);
export const media = (v, kind) => (typeof v === 'string' && new RegExp(`^/media/${kind}/[\\w.-]+$`).test(v) ? v : '');
const modelRef = (v) => (typeof v === 'string' && (/^\/media\/models\/[\w.-]+$/.test(v) || /^\/models\/[\w.-]+\.glb$/.test(v)) ? v : '');
const vec = (v, lim = 4000) => (Array.isArray(v) && v.length >= 3 ? v.slice(0, 3).map((x) => +num(x, -lim, lim, 0).toFixed(3)) : null);
const iso = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : ''; };
const list = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);

// ---------- model markers (engines, guns, emblem spots) ----------
// Stored per model file, in the model's own coordinates. Applied by the game when it loads the model.
export function sanitizeMarkers(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [url, m] of Object.entries(input).slice(0, 200)) {
    if (!modelRef(url) || !m || typeof m !== 'object') continue;
    const engines = list(m.engines, 12).map((e) => ({ p: vec(e?.p), r: num(e?.r, 0.02, 500, 0), color: hex(e?.color) })).filter((e) => e.p);
    const guns = list(m.guns, 8).map((g) => vec(g)).filter(Boolean);
    const emblems = list(m.emblems, 4).map((e) => ({ p: vec(e?.p), n: vec(e?.n, 1) || [0, 1, 0], size: num(e?.size, 0.01, 1000, 1) })).filter((e) => e.p);
    if (engines.length || guns.length || emblems.length) out[url] = { engines, guns, emblems };
  }
  return out;
}

// ---------- custom playable ships ----------
export const SHIP_STAT_FIELDS = {
  speed: ['Cruise speed', 30, 400], boostSpeed: ['Boost speed', 50, 600], accel: ['Acceleration', 10, 300], handling: ['Handling (turn ×)', 0.3, 3],
  hull: ['Hull', 10, 1000], shield: ['Shield', 0, 1000], shieldRegen: ['Shield regen / s', 0, 100],
  laserDmg: ['Cannon damage', 1, 200], laserRate: ['Cannon delay (s)', 0.03, 1], secAmmo: ['Secondary ammo', 0, 30], secRegen: ['Secondary reload (s)', 0.5, 60],
};
export function sanitizeCustomShips(input) {
  return list(input, 8).map((s) => {
    if (!s || typeof s !== 'object') return null;
    const base = BASE_SHIPS.includes(s.base) ? s.base : 'lancer';
    const stats = {};
    for (const [k, [, lo, hi]] of Object.entries(SHIP_STAT_FIELDS)) { const d = k === 'handling' ? 1 : SHIPS[base]?.[k]; stats[k] = +num(s.stats?.[k], lo, hi, d ?? lo).toFixed(3); }
    return {
      id: id(s.id, 'cs'),
      name: str(s.name, 20) || 'New ship',
      role: str(s.role, 24) || 'Fighter',
      desc: str(s.desc, 200),
      base,
      secondary: ['missile', 'flak', 'bomb'].includes(s.secondary) ? s.secondary : SHIPS[base]?.secondary || 'missile',
      gunMode: ['alternate', 'pairs', 'together'].includes(s.gunMode) ? s.gunMode : 'alternate',
      model: modelRef(s.model),
      missions: list(s.missions, 40).filter((m) => typeof m === 'string' && /^[\w-]{2,20}$/.test(m)),
      enabled: bool(s.enabled, true),
      stats,
    };
  }).filter(Boolean);
}
// Star bars on the ship card, worked out from the numbers.
const pips = (v, lo, hi) => Math.max(1, Math.min(5, Math.round(1 + ((v - lo) / (hi - lo)) * 4)));
function customShipDef(s) {
  const b = SHIPS[s.base] || SHIPS.lancer;
  const st = s.stats;
  return {
    ...JSON.parse(JSON.stringify(b)),
    name: s.name, role: s.role, desc: s.desc || b.desc,
    speed: st.speed, minSpeed: Math.round(st.speed * 0.3), boostSpeed: Math.max(st.boostSpeed, st.speed + 10), accel: st.accel,
    pitch: b.pitch * st.handling, yaw: b.yaw * st.handling, roll: b.roll * st.handling,
    hull: st.hull, shield: st.shield, shieldRegen: st.shieldRegen,
    laserDmg: st.laserDmg, laserRate: st.laserRate, secondary: s.secondary, secAmmo: st.secAmmo, secRegen: st.secRegen, gunMode: s.gunMode,
    stats: { speed: pips(st.speed, 100, 170), armor: pips(st.hull + st.shield, 140, 260), firepower: pips(st.laserDmg / st.laserRate, 60, 90), handling: pips(st.handling, 0.6, 1.4) },
    custom: true, base: s.base, missions: s.missions, model: s.model,
  };
}

// ---------- liveries ----------
export function sanitizeLiveries(input) {
  return list(input, 24).map((l) => (!l || typeof l !== 'object' ? null : {
    id: id(l.id, 'lv'),
    name: str(l.name, 24) || 'Livery',
    hull: hex(l.hull, '#c9ced6'), accent: hex(l.accent), dark: hex(l.dark, '#2a2f36'),
    emblem: media(l.emblem, 'images'), emblemSize: num(l.emblemSize, 0.3, 3, 1),
    access: ROLES.includes(l.access) ? l.access : 'everyone',
    autoFor: ROLES.slice(1).includes(l.autoFor) ? l.autoFor : '',
    eventOnly: bool(l.eventOnly, false),
  })).filter(Boolean);
}
export const roleRank = (r) => Math.max(0, ROLES.indexOf(r || 'everyone'));

// ---------- environments ----------
export function sanitizeEnvironment(input) {
  const e = input && typeof input === 'object' ? input : {};
  const pan = {};
  for (const [k, v] of Object.entries(e.panoramas || {}).slice(0, 60)) if (/^[\w-]{2,20}$/.test(k) && media(v, 'images')) pan[k] = media(v, 'images');
  const p = e.planet || {};
  const tex = {};
  for (const k of ['sand', 'rock', 'cliff']) { tex[`${k}A`] = media(p.textures?.[`${k}A`], 'images'); tex[`${k}N`] = media(p.textures?.[`${k}N`], 'images'); }
  let heightmap = null;
  const hm = p.heightmap;
  if (hm && typeof hm === 'object' && typeof hm.data === 'string' && [128, 256].includes(hm.n)) {
    const bytes = Math.floor((hm.data.replace(/=+$/, '').length * 3) / 4);
    if (bytes === hm.n * hm.n && /^[A-Za-z0-9+/]+=*$/.test(hm.data)) heightmap = { n: hm.n, data: hm.data, height: num(hm.height, 50, 1500, 400), keepBase: bool(hm.keepBase, true), src: media(hm.src, 'images') };
  }
  return { panoramas: pan, planet: { textures: tex, heightmap, texScale: num(p.texScale, 0.25, 4, 1) } };
}

// ---------- sounds ----------
export function sanitizeSounds(input) {
  const s = input && typeof input === 'object' ? input : {};
  const one = (v) => ({ url: media(v?.url, 'sounds'), vol: +num(v?.vol, 0, 2, 1).toFixed(2) });
  const sfx = {}; for (const k of Object.keys(SFX_KEYS)) { const o = one(s.sfx?.[k]); if (o.url) sfx[k] = o; }
  const music = {}; for (const [k, v] of Object.entries(s.music || {}).slice(0, 60)) if (/^[\w-]{2,20}$/.test(k)) { const o = one(v); if (o.url) music[k] = o; }
  return { sfx, music, musicVol: +num(s.musicVol, 0, 1, 0.5).toFixed(2), sfxVol: +num(s.sfxVol, 0, 1.5, 1).toFixed(2) };
}

// ---------- custom missions ----------
export const MISSION_LIMITS = { waves: 12, groups: 6, towers: 8, turrets: 16, route: 12 };
export const SPACE_KINDS = { open: 'Open space', asteroids: 'Asteroid belt' };
export function sanitizeMissions(input) {
  const xz = (v, lim = 3800) => (Array.isArray(v) ? [+num(v[0], -lim, lim, 0).toFixed(0), +num(v[1], -lim, lim, 0).toFixed(0)] : null);
  return list(input, 20).map((m) => {
    if (!m || typeof m !== 'object') return null;
    const env = ['planet', 'open', 'asteroids'].includes(m.env) ? m.env : 'open';
    const lim = env === 'planet' ? 3200 : 3600;
    const waves = list(m.waves, MISSION_LIMITS.waves).map((w) => ({
      trigger: w?.trigger === 'time' ? 'time' : 'clear',
      at: int(w?.at, 0, 3600, 0),
      delay: int(w?.delay, 0, 120, 5),
      title: str(w?.title, 60),
      message: str(w?.message, 200),
      groups: list(w?.groups, MISSION_LIMITS.groups).map((g) => ({
        type: ENEMY_TYPES.includes(g?.type) ? g.type : 'raider',
        count: int(g?.count, 1, 30, 4),
        pos: xz(g?.pos, lim) || [0, -2500],
        alt: int(g?.alt, -1500, 1400, env === 'planet' ? 420 : 0),
      })),
    }));
    const route = m.route && Array.isArray(m.route.points) && m.route.points.length >= 2 ? {
      points: list(m.route.points, MISSION_LIMITS.route).map((p) => xz(p, lim)).filter(Boolean),
      alt: int(m.route.alt, -1500, 1400, env === 'planet' ? 300 : 0),
      freighters: int(m.route.freighters, 1, 12, 3),
      maxEscape: int(m.route.maxEscape, 0, 12, 1),
      startAt: int(m.route.startAt, 0, 3600, 0),
    } : null;
    const B = m.bonus || {};
    return {
      id: id(m.id, 'cm'),
      name: str(m.name, 40) || 'Custom mission',
      location: str(m.location, 80),
      briefing: str(m.briefing, 900),
      env,
      enabled: bool(m.enabled, false),
      visibility: m.visibility === 'event' ? 'event' : 'always',
      timeLimit: int(m.timeLimit, 0, 3600, 0),
      start: { pos: xz(m.start?.pos, lim) || [0, 1500], alt: int(m.start?.alt, -1500, 1400, env === 'planet' ? 260 : 120), heading: num(m.start?.heading, -360, 360, 0) },
      towers: list(m.towers, MISSION_LIMITS.towers).map((t) => xz(t, lim)).filter(Boolean),
      turrets: list(m.turrets, MISSION_LIMITS.turrets).map((t) => ({ pos: xz(t?.pos, lim) || [0, 0], alt: int(t?.alt, -1500, 1400, 0) })),
      turretsRequired: bool(m.turretsRequired, false),
      waves, route,
      bonus: { noTowerLoss: bool(B.noTowerLoss, true), time: int(B.time, 0, 3600, 0), noEscape: bool(B.noEscape, true), kills: int(B.kills, 0, 500, 0), noDeaths: bool(B.noDeaths, false) },
      messages: { from: str(m.messages?.from, 24) || 'Control', start: str(m.messages?.start, 240), win: str(m.messages?.win, 160), lose: str(m.messages?.lose, 160) },
    };
  }).filter(Boolean);
}
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
export function missionDef(cm) {
  const primary = [];
  if (cm.waves.length) primary.push(`Repel ${cm.waves.length} attack wave${cm.waves.length > 1 ? 's' : ''}`);
  if (cm.towers.length) primary.push('At least one relay tower must survive');
  if (cm.route) primary.push(`Stop the convoy: no more than ${cm.route.maxEscape} freighter${cm.route.maxEscape === 1 ? '' : 's'} may escape`);
  if (cm.turretsRequired && cm.turrets.length) primary.push('Destroy every defense turret');
  if (cm.timeLimit) primary.push(`Finish within ${mmss(cm.timeLimit)}`);
  if (!primary.length) primary.push('Survive');
  const bonus = [];
  if (cm.bonus.noTowerLoss && cm.towers.length) bonus.push('Lose no relay towers');
  if (cm.bonus.time) bonus.push(`Complete the mission in under ${mmss(cm.bonus.time)}`);
  if (cm.bonus.noEscape && cm.route) bonus.push('Let no freighter escape');
  if (cm.bonus.kills) bonus.push(`Destroy ${cm.bonus.kills} enemies`);
  if (cm.bonus.noDeaths) bonus.push('Lose no ships');
  return {
    id: cm.id, name: cm.name, env: cm.env === 'planet' ? 'planet' : 'space', space: cm.env, location: cm.location || (cm.env === 'planet' ? 'Kessa Prime' : 'Deep space'),
    briefing: cm.briefing || 'Custom operation.', primary, bonus,
    spawn: [cm.start.pos[0], cm.start.alt, cm.start.pos[1]], heading: cm.start.heading, timeLimit: cm.timeLimit,
    towers: cm.towers, custom: cm,
  };
}

// ---------- scheduled events ----------
export function sanitizeEvents(input) {
  return list(input, 30).map((e) => {
    if (!e || typeof e !== 'object') return null;
    const flags = {};
    for (const [k, v] of Object.entries(e.flags || {}).slice(0, 30)) if (/^vw\.[\w.]+$/.test(k) && typeof v === 'boolean') flags[k] = v;
    return {
      id: id(e.id, 'ev'), name: str(e.name, 40) || 'Event', start: iso(e.start), end: iso(e.end),
      flags, liveries: list(e.liveries, 12).filter((x) => /^lv-[a-z0-9]{3,12}$/.test(x)), missions: list(e.missions, 12).filter((x) => /^cm-[a-z0-9]{3,12}$/.test(x)),
      announcement: str(e.announcement, 200), enabled: bool(e.enabled, true),
    };
  }).filter((e) => e && e.start && e.end && e.end > e.start);
}
export function activeEvents(events = [], now = Date.now()) {
  return events.filter((e) => e.enabled && Date.parse(e.start) <= now && now < Date.parse(e.end));
}

// ---------- apply ----------
// Rebuild SHIPS / MISSIONS / terrain from the base game plus this content. Idempotent.
let hmCache = { key: '', grid: null };
function b64ToBytes(b64) {
  if (typeof atob === 'function') { const s = atob(b64); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
export function applyGameContent(c = {}) {
  applyTuning(c.tuning || {});
  for (const k of Object.keys(SHIPS)) if (!BASE_SHIPS.includes(k)) delete SHIPS[k];
  for (const k of Object.keys(MODEL_SLOTS)) if (MODEL_SLOTS[k].custom) delete MODEL_SLOTS[k];
  for (const s of c.customShips || []) {
    SHIPS[s.id] = customShipDef(s);
    MODEL_SLOTS[s.id] = { name: s.name, role: `${s.role} (custom)`, group: 'Player ships', custom: true, base: s.base };
  }
  for (let i = MISSIONS.length - 1; i >= 0; i--) if (!BASE_MISSIONS.includes(MISSIONS[i].id)) MISSIONS.splice(i, 1);
  for (const m of c.customMissions || []) MISSIONS.push(missionDef(m));
  const hm = c.environment?.planet?.heightmap;
  if (hm?.data) {
    const key = `${hm.n}:${hm.height}:${hm.keepBase}:${hm.data.length}:${hm.data.slice(0, 64)}:${hm.data.slice(-64)}`;
    if (hmCache.key !== key) hmCache = { key, grid: { n: hm.n, bytes: b64ToBytes(hm.data), height: hm.height, keepBase: hm.keepBase } };
    setTerrainOverride(hmCache.grid);
  } else setTerrainOverride(null);
}
export const shipAllowedIn = (shipId, missionId) => { const s = SHIPS[shipId]; return !s?.missions?.length || s.missions.includes(missionId); };
export { PLANET };
