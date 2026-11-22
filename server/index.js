// Vanguard Wing game server: rooms, WebSocket co-op, admin API, media, flags, metrics.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as THREE from 'three';
import { Sim } from './sim.js';
import * as C from './content.js';
import * as F from './flags.js';
import * as M from './media.js';
import * as MET from './metrics.js';
import crypto from 'node:crypto';
import * as G from '../shared/gamecontent.js';
import { SHIPS, MISSIONS, DIFFICULTY, MAX_PLAYERS, PLAYER_COLORS } from '../shared/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3000;
const TICK = 1 / 30;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const STATIC = [
  { prefix: '/vendor/three/', dir: path.join(ROOT, 'node_modules/three'), allow: ['build/', 'examples/jsm/'] },
  { prefix: '/vendor/meshoptimizer/', dir: path.join(ROOT, 'node_modules/meshoptimizer'), allow: ['meshopt_simplifier.js'] },
  { prefix: '/shared/', dir: path.join(ROOT, 'shared') },
  { prefix: '/', dir: path.join(ROOT, 'public') },
];

// ---------------- rooms ----------------
const rooms = new Map();
let nextPlayerId = 1;

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

function send(ws, obj) {
  if (ws.readyState !== 1) return;
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
  ws.send(s); MET.trackWsOut(s.length);
}

class Room {
  constructor(isPublic = true, preview = false) {
    this.preview = preview;   // preview rooms run on the admin's draft content
    this.code = makeCode();
    this.players = new Map();
    this.hostId = null;
    this.state = 'lobby';
    this.missionId = MISSIONS[0].id;
    this.diff = 'normal';
    this.isPublic = isPublic;
    this.sim = null;
    this.timer = null;
    this.tickN = 0;
    this.lastResult = null;
    rooms.set(this.code, this);
  }
  freeSlot() {
    const used = new Set([...this.players.values()].map((p) => p.slot));
    for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
    return -1;
  }
  add(p) {
    p.slot = this.freeSlot();
    p.color = PLAYER_COLORS[p.slot];
    p.room = this;
    p.ready = false;
    p.inGame = false;
    p.alive = false;
    p.state = null;
    this.players.set(p.id, p);
    if (this.hostId == null) this.hostId = p.id;
    this.broadcastInfo();
    this.chat(null, `${p.name} joined the wing.`);
    if (this.state === 'playing' && this.sim) this.joinMission(p);
  }
  remove(p) {
    if (!this.players.has(p.id)) return;
    this.players.delete(p.id);
    p.room = null;
    if (this.players.size === 0) return this.destroy();
    if (this.hostId === p.id) this.hostId = [...this.players.keys()][0];
    this.chat(null, `${p.name} left.`);
    if (this.sim) this.sim.emit({ e: 'pleft', pid: p.id });
    this.broadcastInfo();
  }
  destroy() {
    clearInterval(this.timer);
    rooms.delete(this.code);
  }
  info() {
    return {
      t: 'room', code: this.code, hostId: this.hostId, state: this.state, missionId: this.missionId, diff: this.diff, isPublic: this.isPublic, preview: this.preview,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, ship: p.ship, color: p.color, slot: p.slot, ready: p.ready, livery: p.livery || '', role: p.pilot?.role || '' })),
    };
  }
  broadcast(obj, exceptId = null) {
    const s = JSON.stringify(obj);
    for (const p of this.players.values()) if (p.id !== exceptId) send(p.ws, s);
  }
  broadcastInfo() { this.broadcast(this.info()); }
  chat(from, text) { this.broadcast({ t: 'chat', from: from ? from.name : null, color: from ? from.color : null, text }); }

  start() {
    if (this.state === 'playing') return;
    this.state = 'playing';
    for (const p of this.players.values()) { p.inGame = true; p.alive = true; p.state = null; }
    this.sim = new Sim(this, this.missionId, this.diff);
    for (const p of this.players.values()) this.sendStart(p);
    this.broadcastInfo();
    clearInterval(this.timer);
    this.tickN = 0;
    this.timer = setInterval(() => this.tick(), TICK * 1000);
  }
  sendStart(p) {
    send(p.ws, {
      t: 'start', missionId: this.missionId, diff: this.diff, slot: p.slot, reserves: this.sim.reserves,
      players: [...this.players.values()].map((q) => ({ id: q.id, name: q.name, ship: q.ship, color: q.color, slot: q.slot, livery: q.livery || '' })),
      objectives: this.sim.objectives, time: this.sim.time, phase: this.sim.phase, scoreMul: this.sim.scoreMul,
    });
  }
  joinMission(p) {
    p.inGame = true; p.alive = true; p.state = null;
    this.sim.playerJoined(p);
    this.sendStart(p);
    this.broadcast({ t: 'pjoin', player: { id: p.id, name: p.name, ship: p.ship, color: p.color, slot: p.slot, livery: p.livery || '' } }, p.id);
  }
  tick() { inContext(this, () => this.tickInner()); }
  tickInner() {
    const sim = this.sim;
    if (!sim) return;
    try {
      const t0 = performance.now();
      sim.update(TICK);
      MET.trackTick(performance.now() - t0);
    } catch (err) {
      console.error('sim error', err);
    }
    this.tickN++;
    if (sim.events.length || this.tickN % 2 === 0) {
      const msg = this.tickN % 2 === 0 ? sim.snapshot() : { t: 'ev' };
      msg.ev = sim.events;
      sim.events = [];
      this.broadcast(msg);
    }
    if (sim.phase === 'ending' && sim.endTimer <= 0) this.endMission();
  }
  endMission() {
    const sim = this.sim;
    sim.phase = 'done';
    clearInterval(this.timer);
    const objectives = sim.objectives;
    const bonusDone = objectives.filter((o) => o.bonus && o.status === 'done').length;
    const success = sim.result?.success;
    const medal = !success ? 'none' : bonusDone >= 2 ? 'gold' : bonusDone === 1 ? 'silver' : 'bronze';
    const stats = [...this.players.values()].map((p) => {
      const s = sim.stats.get(p.id) || { kills: 0, score: 0, deaths: 0, shots: 0, hits: 0 };
      return { id: p.id, name: p.name, color: p.color, ship: p.ship, ...s, accuracy: s.shots ? Math.min(100, Math.round((s.hits / s.shots) * 100)) : 0 };
    });
    const result = { t: 'end', success, reason: sim.result?.reason, medal, objectives, stats, time: Math.round(sim.time - 4), missionId: this.missionId, diff: this.diff };
    this.lastResult = result;
    this.state = 'lobby';
    this.sim = null;
    for (const p of this.players.values()) { p.inGame = false; p.ready = false; p.alive = false; }
    this.broadcast(result);
    this.broadcastInfo();
  }
  abort() {
    if (!this.sim) return;
    clearInterval(this.timer);
    this.sim = null;
    this.state = 'lobby';
    for (const p of this.players.values()) { p.inGame = false; p.ready = false; }
    this.broadcast({ t: 'abort' });
    this.broadcastInfo();
  }
}

// ---------------- message handling ----------------
const clean = (s, n) => String(s || '').replace(/[<>&"]/g, '').trim().slice(0, n);

// ---- content context: live content for everyone, the admin's draft inside preview rooms ----
const liveDoc = () => C.getContent();
const docFor = (room) => (room?.preview && C.getPreview()) || C.getContent();
function applyLive() { G.applyGameContent(C.getContent()); }
applyLive();
function inContext(room, fn) {
  if (!room?.preview || !C.getPreview()) return fn();
  G.applyGameContent(C.getPreview());
  try { return fn(); } finally { applyLive(); }
}
// Feature flags plus admin-made ships and missions (custom missions can be event-only).
function gameFlagsFull(doc = liveDoc()) {
  const f = F.gameFlags();
  const evs = G.activeEvents(doc.events);
  for (const s of doc.customShips || []) f.ships[s.id] = s.enabled;
  for (const m of doc.customMissions || []) f.missions[m.id] = m.enabled && (m.visibility === 'always' || evs.some((e) => e.missions.includes(m.id)));
  return f;
}
function allowedShip(ship, room = null) {
  const ok = gameFlagsFull(docFor(room)).ships;
  const fits = (s) => ok[s] && SHIPS[s] && (!room || G.shipAllowedIn(s, room.missionId));
  return fits(ship) ? ship : Object.keys(ok).find(fits) || 'lancer';
}
function firstMission(room = null) { const ok = gameFlagsFull(docFor(room)).missions; return Object.keys(ok).find((k) => ok[k] && MISSIONS.some((m) => m.id === k)) || 'siege'; }

// ---- pilot pass: a link signed by the forum, proving the player's forum callsign and role ----
const LINK_SECRET = process.env.GAME_LINK_SECRET || '';
function verifyPilot(tok) {
  if (!LINK_SECRET || typeof tok !== 'string' || tok.length > 800) return null;
  const [body, sig] = tok.split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', LINK_SECRET).update(body).digest('base64url');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  let d; try { d = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!d || typeof d.u !== 'string' || !['user', 'moderator', 'admin'].includes(d.r) || !(d.exp > Date.now() / 1000)) return null;
  return { name: clean(d.u, 16), role: d.r };
}
const roleOf = (p) => (p.isAdmin ? 'admin' : p.pilot?.role || 'everyone');
// Which livery a player may fly: their pick if their role allows it (or an event unlocks it),
// otherwise the livery given automatically to their role, otherwise factory paint.
function liveryFor(p, wanted, doc = docFor(p.room)) {
  if (wanted === 'none') return '';
  const rank = G.roleRank(roleOf(p));
  const evL = new Set(G.activeEvents(doc.events).flatMap((e) => e.liveries));
  const ok = (l) => l && (evL.has(l.id) || (!l.eventOnly && rank >= G.roleRank(l.access)));
  const L = doc.liveries || [];
  const w = L.find((l) => l.id === wanted);
  if (w && ok(w)) return w.id;
  const auto = L.filter((l) => l.autoFor && rank >= G.roleRank(l.autoFor) && ok(l)).sort((a, b) => G.roleRank(b.autoFor) - G.roleRank(a.autoFor))[0];
  return auto ? auto.id : '';
}
function broadcastAll(obj) { const s = JSON.stringify(obj); for (const ws of wss.clients) if (ws.readyState === 1) { ws.send(s); MET.trackWsOut(s.length); } }

function maintenanceBlocked(p) {
  const m = C.getContent().settings.maintenance;
  if (m.enabled) { send(p.ws, { t: 'error', msg: m.message || 'Maintenance in progress — new games are paused.' }); return true; }
  return false;
}

function handle(p, msg) {
  const room = p.room;
  if (['create', 'join', 'quick', 'start'].includes(msg.t) && maintenanceBlocked(p)) return;
  switch (msg.t) {
    case 'hello': {
      p.pilot = verifyPilot(msg.pilot);
      p.name = p.pilot?.name || clean(msg.name, 16) || `Pilot-${p.id}`;
      if (SHIPS[msg.ship]) p.ship = msg.ship;
      p.ship = allowedShip(p.ship, room);
      p.wantLivery = typeof msg.livery === 'string' ? msg.livery.slice(0, 20) : '';
      p.livery = liveryFor(p, p.wantLivery);
      send(p.ws, { t: 'me', name: p.name, pilot: p.pilot, livery: p.livery, isAdmin: !!p.isAdmin });
      if (room) room.broadcastInfo();
      break;
    }
    case 'livery':
      if (!room || !p.inGame) {
        p.wantLivery = typeof msg.livery === 'string' ? msg.livery.slice(0, 20) : '';
        p.livery = liveryFor(p, p.wantLivery);
        send(p.ws, { t: 'me', name: p.name, pilot: p.pilot, livery: p.livery, isAdmin: !!p.isAdmin });
        room && room.broadcastInfo();
      }
      break;
    case 'create': {
      if (room) room.remove(p);
      const preview = !!msg.preview && !!p.isAdmin && !!C.getPreview();
      const r = new Room(preview ? false : msg.isPublic !== false, preview);
      if (preview) inContext(r, () => { r.missionId = firstMission(r); });
      r.add(p);
      inContext(r, () => { p.ship = allowedShip(p.ship, r); p.livery = liveryFor(p, p.wantLivery); });
      r.broadcastInfo();
      break;
    }
    case 'join': {
      const r = rooms.get(String(msg.code || '').toUpperCase());
      if (!r) return send(p.ws, { t: 'error', msg: 'Room not found.' });
      if (r.players.size >= MAX_PLAYERS) return send(p.ws, { t: 'error', msg: 'That wing is full (4 pilots max).' });
      if (r.preview && !p.isAdmin) return send(p.ws, { t: 'error', msg: 'That is an admin preview wing.' });
      if (room === r) return;
      if (room) room.remove(p);
      r.add(p);
      inContext(r, () => { p.ship = allowedShip(p.ship, r); p.livery = liveryFor(p, p.wantLivery); });
      r.broadcastInfo();
      break;
    }
    case 'quick': {
      if (room) room.remove(p);
      let best = null;
      for (const r of rooms.values()) {
        if (r.isPublic && !r.preview && r.players.size < MAX_PLAYERS && (!best || r.players.size > best.players.size)) best = r;
      }
      const qr = best || new Room(true);
      qr.add(p);
      p.ship = allowedShip(p.ship, qr); p.livery = liveryFor(p, p.wantLivery);
      qr.broadcastInfo();
      break;
    }
    case 'leave':
      if (room) room.remove(p);
      send(p.ws, { t: 'left' });
      break;
    case 'ship':
      if (SHIPS[msg.ship] && (!room || !p.inGame)) {
        if (!gameFlagsFull(docFor(room)).ships[msg.ship]) { send(p.ws, { t: 'error', msg: `The ${SHIPS[msg.ship].name} is grounded right now.` }); break; }
        if (room && !G.shipAllowedIn(msg.ship, room.missionId)) { send(p.ws, { t: 'error', msg: `The ${SHIPS[msg.ship].name} isn't cleared for this mission.` }); break; }
        p.ship = msg.ship; room && room.broadcastInfo();
      }
      break;
    case 'ready':
      if (room && room.state === 'lobby') { p.ready = !!msg.ready; room.broadcastInfo(); }
      break;
    case 'mission':
      if (room && room.hostId === p.id && room.state === 'lobby') {
        if (MISSIONS.find((m) => m.id === msg.missionId)) {
          if (gameFlagsFull(docFor(room)).missions[msg.missionId]) {
            room.missionId = msg.missionId;
            for (const q of room.players.values()) q.ship = allowedShip(q.ship, room);   // some ships are cleared for certain missions only
          } else send(p.ws, { t: 'error', msg: 'That mission is offline right now.' });
        }
        if (DIFFICULTY[msg.diff]) room.diff = msg.diff;
        if (typeof msg.isPublic === 'boolean') room.isPublic = msg.isPublic;
        room.broadcastInfo();
      }
      break;
    case 'start':
      if (room && room.hostId === p.id && room.state === 'lobby') {
        const gf = gameFlagsFull(docFor(room));
        if (!gf.missions[room.missionId] || !MISSIONS.some((m) => m.id === room.missionId)) { send(p.ws, { t: 'error', msg: 'That mission is offline right now — pick another one.' }); break; }
        for (const q of room.players.values()) { q.ship = allowedShip(q.ship, room); q.livery = liveryFor(q, q.wantLivery); }
        room.start();
      }
      break;
    case 'abort':
      if (room && room.hostId === p.id) room.abort();
      break;
    case 'chat':
      if (room) { const text = clean(msg.text, 140); if (text) room.chat(p, text); }
      break;
    case 'st': {
      if (!room || !room.sim || !p.inGame || !p.alive) return;
      const a = msg.s;
      if (!Array.isArray(a) || a.length < 12) return;
      if (!p.state) p.state = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), hp: 100, boost: 0 };
      p.state.pos.set(+a[0] || 0, +a[1] || 0, +a[2] || 0);
      p.state.quat.set(+a[3] || 0, +a[4] || 0, +a[5] || 0, +a[6] || 1).normalize();
      p.state.vel.set(+a[7] || 0, +a[8] || 0, +a[9] || 0);
      p.state.hp = Math.max(0, Math.min(100, +a[10] || 0));
      p.state.boost = a[11] ? 1 : 0;
      break;
    }
    case 'fire':
      if (room && room.sim && p.inGame && p.alive && Array.isArray(msg.list)) room.sim.playerFire(p, msg.list);
      break;
    case 'phit':
      if (room && room.sim) room.sim.projHitPlayer(String(msg.id));
      break;
    case 'dead':
      if (room && room.sim && p.inGame) room.sim.playerDied(p);
      break;
    case 'ping':
      send(p.ws, { t: 'pong', c: msg.c });
      break;
    default: break;
  }
}

// ---------------- http ----------------
function json(res, code, obj, extra = {}) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https';
function sessionCookie(req, token, maxAge) {
  return `vw_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}

function envInfo() {
  const name = process.env.RAILWAY_ENVIRONMENT_NAME || 'local';
  return { name, preview: !!process.env.RAILWAY_ENVIRONMENT_NAME && name !== 'production', branch: process.env.RAILWAY_GIT_BRANCH || null, commit: (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || null };
}
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = +req.headers['content-length'] || 0;
    if (declared > limit) { reject(Object.assign(new Error(`File too large (max ${Math.round(limit / 1048576)} MB).`), { status: 413 })); req.resume(); return; }
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error(`File too large (max ${Math.round(limit / 1048576)} MB).`), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleApi(req, res, pathname) {
  if ((pathname === '/api/content' || pathname === '/api/terrain') && req.method === 'GET') {
    const admin = !!C.getSession(cookies(req).vw_admin);
    const wantPreview = new URL(req.url, 'http://x').searchParams.get('preview') === '1';
    const usePreview = admin && wantPreview && !!C.getPreview();
    const c = usePreview ? C.getPreview() : C.getContent();
    const hm = c.environment?.planet?.heightmap;
    if (pathname === '/api/terrain') return hm ? json(res, 200, hm) : json(res, 404, { error: 'No custom terrain.' });
    const env = { ...c.environment, planet: { ...c.environment.planet, heightmap: hm ? { n: hm.n, height: hm.height, keepBase: hm.keepBase, v: crypto.createHash('sha1').update(hm.data).digest('hex').slice(0, 12) } : null } };
    const events = G.activeEvents(c.events).map((e) => ({ id: e.id, name: e.name, end: e.end, announcement: e.announcement, liveries: e.liveries, missions: e.missions }));
    return json(res, 200, { site: c.site, announcement: c.announcement, settings: c.settings, sections: c.sections.filter((x) => x.visible), changelog: c.changelog, tuning: c.tuning || {}, updatedAt: c.updatedAt,
      modelMarkers: c.modelMarkers, customShips: c.customShips, liveries: c.liveries, environment: env, sounds: c.sounds, customMissions: c.customMissions, events,
      flags: gameFlagsFull(c), env: envInfo(), preview: usePreview, admin: admin ? { hasPreview: !!C.getPreview(), previewAt: C.getPreview()?.updatedAt || null } : null });
  }
  if (!pathname.startsWith('/api/admin/')) return json(res, 404, { error: 'not found' });
  const token = cookies(req).vw_admin;
  const session = C.getSession(token);
  const route = pathname.slice('/api/admin/'.length);
  // state-changing admin calls must come from our own page (SameSite cookie + custom header)
  if (req.method !== 'GET' && req.headers['x-vw-admin'] !== '1') return json(res, 403, { error: 'forbidden' });
  if (route === 'me' && req.method === 'GET') return json(res, 200, { authed: !!session, user: session?.user || null, configured: C.adminConfigured() });
  if (route === 'login' && req.method === 'POST') {
    const ip = clientIp(req);
    if (!C.adminConfigured()) return json(res, 503, { error: 'Admin is not set up yet: set the ADMIN_PASSWORD variable on the server.' });
    if (!C.loginAllowed(ip)) return json(res, 429, { error: 'Too many attempts. Try again in 10 minutes.' });
    let body; try { body = await readBody(req, 4096); } catch { return json(res, 400, { error: 'bad request' }); }
    if (!C.checkLogin(body.user, body.password)) { C.recordFailure(ip); return json(res, 401, { error: 'Wrong username or password.' }); }
    C.clearFailures(ip);
    const t = C.createSession(C.adminUser());
    return json(res, 200, { ok: true, user: C.adminUser() }, { 'set-cookie': sessionCookie(req, t, C.SESSION_SECONDS) });
  }
  if (route === 'logout' && req.method === 'POST') {
    C.endSession(token);
    return json(res, 200, { ok: true }, { 'set-cookie': sessionCookie(req, '', 0) });
  }
  if (!session) return json(res, 401, { error: 'Please log in.' });
  if (route === 'content' && req.method === 'GET') return json(res, 200, C.getContent());
  if (route === 'content' && req.method === 'PUT') {
    let body; try { body = await readBody(req, 4_000_000); } catch (e) { return json(res, 400, { error: e.message }); }
    const saved = C.saveContent(body, session.user);
    applyTuningChange(saved.tuning);
    return json(res, 200, saved);
  }
  if (route === 'revisions' && req.method === 'GET') return json(res, 200, C.listRevisions());
  if (route === 'pilot-link' && req.method === 'GET') return json(res, 200, { configured: !!LINK_SECRET, forumUrl: C.getContent().site.forumUrl || '' });
  // preview drafts: saved separately, only admins see them in the game until published
  if (route === 'preview' && req.method === 'GET') return json(res, 200, { draft: C.getPreview() });
  if (route === 'preview' && req.method === 'PUT') {
    let body; try { body = await readBody(req, 4_000_000); } catch (e) { return json(res, 400, { error: e.message }); }
    const draft = C.savePreview(body, session.user);
    broadcastAll({ t: 'content', scope: 'preview' });
    for (const r of rooms.values()) if (r.preview && r.state === 'lobby') inContext(r, () => { r.missionId = MISSIONS.some((m) => m.id === r.missionId) ? r.missionId : firstMission(r); r.broadcastInfo(); });
    return json(res, 200, draft);
  }
  if (route === 'preview' && req.method === 'DELETE') { C.discardPreview(); broadcastAll({ t: 'content', scope: 'preview' }); return json(res, 200, { ok: true }); }
  if (route === 'preview/publish' && req.method === 'POST') {
    try { const live = C.publishPreview(session.user); applyContentChange('live'); return json(res, 200, live); } catch (e) { return json(res, 409, { error: e.message }); }
  }
  if (route === 'revisions/restore' && req.method === 'POST') {
    let body; try { body = await readBody(req, 4096); } catch { return json(res, 400, { error: 'bad request' }); }
    try { const r = C.restoreRevision(String(body.id || ''), session.user); applyTuningChange(r.tuning); return json(res, 200, r); } catch { return json(res, 404, { error: 'Revision not found.' }); }
  }
  if (route === 'password' && req.method === 'POST') {
    let body; try { body = await readBody(req, 4096); } catch { return json(res, 400, { error: 'bad request' }); }
    if (!C.checkLogin(session.user, body.current)) return json(res, 400, { error: 'Current password is wrong.' });
    if (typeof body.next !== 'string' || body.next.length < 10) return json(res, 400, { error: 'New password must be at least 10 characters.' });
    C.setPassword(body.next);
    C.endAllSessions();
    const t = C.createSession(session.user);
    return json(res, 200, { ok: true }, { 'set-cookie': sessionCookie(req, t, C.SESSION_SECONDS) });
  }
  // ----- feature flags -----
  if (route === 'flags' && req.method === 'GET') return json(res, 200, { flags: F.describeAll(), railway: F.railwayStatus() });
  if (route === 'flags' && req.method === 'POST') {
    let body; try { body = await readBody(req, 4096); } catch { return json(res, 400, { error: 'bad request' }); }
    try { F.setOverride(String(body.name), body.value === undefined ? null : body.value); } catch (e) { return json(res, 400, { error: e.message }); }
    applyFlagChange();
    return json(res, 200, { flags: F.describeAll(), railway: F.railwayStatus() });
  }
  if (route === 'flags/refresh' && req.method === 'POST') { await F.refreshRailway().catch(() => {}); applyFlagChange(); return json(res, 200, { flags: F.describeAll(), railway: F.railwayStatus() }); }
  // ----- media library -----
  if (route === 'media' && req.method === 'GET') return json(res, 200, { status: M.status(), items: M.list() });
  if (route === 'media' && req.method === 'PUT') {
    if (!M.configured()) return json(res, 503, { error: 'The media bucket is not connected to this environment.' });
    try {
      const buf = await readRaw(req, Math.max(M.LIMITS.image, M.LIMITS.model));
      const name = decodeURIComponent(String(req.headers['x-file-name'] || 'upload'));
      return json(res, 200, await M.upload(buf, name, session.user));
    } catch (e) { return json(res, e.status || 500, { error: e.message }); }
  }
  if (route === 'media' && req.method === 'DELETE') {
    const key = new URL(req.url, 'http://x').searchParams.get('key') || '';
    if (!M.find(key)) return json(res, 404, { error: 'Not found' });
    try { await M.remove(key); return json(res, 200, { ok: true }); } catch (e) { return json(res, 502, { error: e.message }); }
  }
  if (route === 'inspect-builtin' && req.method === 'GET') {
    const ship = new URL(req.url, 'http://x').searchParams.get('ship');
    const file = { lancer: 'lancer.glb', warden: 'warden.glb' }[ship];
    if (!file) return json(res, 404, { error: 'No built-in model for that ship.' });
    try { return json(res, 200, M.inspectGlb(fs.readFileSync(path.join(ROOT, 'public/models', file)))); }
    catch (e) { return json(res, 500, { error: e.message }); }
  }
  if (route === 'media/resync' && req.method === 'POST') {
    try { const n = await M.resync(); return json(res, 200, { ok: true, count: n, items: M.list() }); } catch (e) { return json(res, 502, { error: e.message }); }
  }
  // ----- server health -----
  if (route === 'health' && req.method === 'GET') {
    const q = new URL(req.url, 'http://x').searchParams;
    const minutes = Math.min(1440, Math.max(15, +q.get('minutes') || 60));
    const hours = Math.max(1, Math.round(minutes / 60));
    const [game, forum] = await Promise.all([
      MET.platformMetrics(process.env.RAILWAY_SERVICE_ID, hours),
      MET.platformMetrics(process.env.FORUM_SERVICE_ID, hours),
    ]);
    return json(res, 200, { app: MET.snapshot(minutes), platform: { configured: MET.platformConfigured(), game, forum }, forum: MET.forumStatus(), media: M.status(), env: envInfo(), flags: F.railwayStatus() });
  }
  if (route === 'stats' && req.method === 'GET') {
    return json(res, 200, { rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0), playing: [...rooms.values()].filter((r) => r.state === 'playing').length, dataDir: C.DATA_DIR });
  }
  return json(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  MET.trackHttp(req, res);
  const url = new URL(req.url, 'http://x');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  if (pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  if (pathname.startsWith('/media/') && (req.method === 'GET' || req.method === 'HEAD')) {
    return M.serve(req, res, pathname.slice(7)).catch((e) => { console.error('media', e); if (!res.headersSent) { res.writeHead(500); res.end(); } });
  }
  if (pathname === '/api/flags') return json(res, 200, gameFlagsFull());
  if (pathname.startsWith('/api/') && pathname !== '/api/rooms') {
    return handleApi(req, res, pathname).catch((e) => { console.error('api error', e); json(res, 500, { error: 'server error' }); });
  }
  if (pathname === '/admin' || pathname === '/admin/') {
    pathname = '/admin.html';
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('x-robots-tag', 'noindex');
  }
  if (pathname === '/api/rooms') {
    const list = [...rooms.values()].filter((r) => r.isPublic && !r.preview && r.players.size < MAX_PLAYERS).map((r) => ({
      code: r.code, players: r.players.size, state: r.state, mission: MISSIONS.find((m) => m.id === r.missionId)?.name,
      host: r.players.get(r.hostId)?.name,
    }));
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(list));
  }
  if (pathname === '/') pathname = '/index.html';
  for (const s of STATIC) {
    if (!pathname.startsWith(s.prefix)) continue;
    const rel = pathname.slice(s.prefix.length);
    if (s.allow && !s.allow.some((a) => rel.startsWith(a))) break;
    const file = path.resolve(s.dir, rel);
    if (!file.startsWith(s.dir)) break;
    return fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
      const ext = path.extname(file);
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': s.prefix === '/vendor/three/' || ext === '.jpg' ? 'public, max-age=86400' : 'no-cache',
      });
      fs.createReadStream(file).pipe(res);
    });
  }
  res.writeHead(404); res.end('Not found');
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (ws, req) => {
  const p = { id: nextPlayerId++, ws, name: 'Pilot', ship: 'lancer', room: null, alive: false, inGame: false, state: null, livery: '', wantLivery: '', pilot: null };
  p.isAdmin = !!C.getSession(cookies(req).vw_admin);   // signed into the admin panel on this site
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  send(ws, { t: 'welcome', id: p.id, flags: gameFlagsFull() });
  ws.on('message', (data) => {
    MET.trackWsIn();
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try { inContext(p.room, () => handle(p, msg)); } catch (err) { console.error('handle error', err); }
  });
  ws.on('close', () => { if (p.room) p.room.remove(p); });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

// ---------------- flags: live updates to every player + lobby fix-ups ----------------
// Live content: rebuild the game tables in this process, then tell every connected browser to
// reload its content (ships, missions, tuning, liveries, sounds...). Running missions keep going.
function applyContentChange(scope = 'live') {
  applyLive();
  broadcastAll({ t: 'content', scope });
  applyFlagChange();
}
function applyTuningChange() { applyContentChange('live'); }

function applyFlagChange(flags = gameFlagsFull()) {
  broadcastAll({ t: 'flags', flags });
  for (const room of rooms.values()) {
    if (room.state !== 'lobby') continue;   // missions in flight finish with the rules they started with
    inContext(room, () => {
      const f = room.preview ? gameFlagsFull(docFor(room)) : flags;
      let changed = false;
      if (!f.missions[room.missionId] || !MISSIONS.some((m) => m.id === room.missionId)) { room.missionId = firstMission(room); changed = true; }
      for (const q of room.players.values()) {
        const s2 = allowedShip(q.ship, room); if (s2 !== q.ship) { q.ship = s2; changed = true; }
        const l2 = liveryFor(q, q.wantLivery); if (l2 !== q.livery) { q.livery = l2; changed = true; }
      }
      room.broadcastInfo();
    });
  }
}

// Scheduled events: every 10 s work out which are running, apply their flags, tell everyone when that changes.
let eventKey = null;
function checkEvents() {
  const act = G.activeEvents(liveDoc().events);
  F.setEventFlags(Object.assign({}, ...act.map((e) => e.flags)));
  const key = act.map((e) => e.id).join(',');
  if (eventKey !== null && key !== eventKey) {
    console.log(`events now active: ${key || 'none'}`);
    applyFlagChange();
    broadcastAll({ t: 'content', scope: 'live' });
  }
  eventKey = key;
}
checkEvents();
setInterval(checkEvents, 10000).unref();
F.watchFlags(applyFlagChange);
F.initRailwayFlags().then(() => applyFlagChange());
MET.setGauges(() => ({
  players: wss.clients.size, rooms: rooms.size,
  playing: [...rooms.values()].filter((r) => r.state === 'playing').length,
  pilotsInFlight: [...rooms.values()].reduce((n, r) => n + (r.state === 'playing' ? r.players.size : 0), 0),
}));
MET.probeForum(process.env.FORUM_URL);

server.listen(PORT, () => console.log(`Vanguard Wing server listening on :${PORT}${process.env.RAILWAY_ENVIRONMENT_NAME ? ` (${process.env.RAILWAY_ENVIRONMENT_NAME})` : ''}`));
