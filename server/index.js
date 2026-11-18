import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as THREE from 'three';
import { Sim } from './sim.js';
import { SHIPS, MISSIONS, DIFFICULTY, MAX_PLAYERS, PLAYER_COLORS } from '../shared/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3000;
const TICK = 1 / 30;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const STATIC = [
  { prefix: '/vendor/three/', dir: path.join(ROOT, 'node_modules/three'), allow: ['build/', 'examples/jsm/'] },
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
  if (ws.readyState === 1) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

class Room {
  constructor(isPublic = true) {
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
      t: 'room', code: this.code, hostId: this.hostId, state: this.state, missionId: this.missionId, diff: this.diff, isPublic: this.isPublic,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, ship: p.ship, color: p.color, slot: p.slot, ready: p.ready })),
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
      players: [...this.players.values()].map((q) => ({ id: q.id, name: q.name, ship: q.ship, color: q.color, slot: q.slot })),
      objectives: this.sim.objectives, time: this.sim.time, phase: this.sim.phase,
    });
  }
  joinMission(p) {
    p.inGame = true; p.alive = true; p.state = null;
    this.sim.playerJoined(p);
    this.sendStart(p);
    this.broadcast({ t: 'pjoin', player: { id: p.id, name: p.name, ship: p.ship, color: p.color, slot: p.slot } }, p.id);
  }
  tick() {
    const sim = this.sim;
    if (!sim) return;
    try {
      sim.update(TICK);
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

function handle(p, msg) {
  const room = p.room;
  switch (msg.t) {
    case 'hello':
      p.name = clean(msg.name, 16) || `Pilot-${p.id}`;
      if (SHIPS[msg.ship]) p.ship = msg.ship;
      break;
    case 'create': {
      if (room) room.remove(p);
      const r = new Room(msg.isPublic !== false);
      r.add(p);
      break;
    }
    case 'join': {
      const r = rooms.get(String(msg.code || '').toUpperCase());
      if (!r) return send(p.ws, { t: 'error', msg: 'Room not found.' });
      if (r.players.size >= MAX_PLAYERS) return send(p.ws, { t: 'error', msg: 'That wing is full (4 pilots max).' });
      if (room === r) return;
      if (room) room.remove(p);
      r.add(p);
      break;
    }
    case 'quick': {
      if (room) room.remove(p);
      let best = null;
      for (const r of rooms.values()) {
        if (r.isPublic && r.players.size < MAX_PLAYERS && (!best || r.players.size > best.players.size)) best = r;
      }
      (best || new Room(true)).add(p);
      break;
    }
    case 'leave':
      if (room) room.remove(p);
      send(p.ws, { t: 'left' });
      break;
    case 'ship':
      if (SHIPS[msg.ship] && (!room || !p.inGame)) { p.ship = msg.ship; room && room.broadcastInfo(); }
      break;
    case 'ready':
      if (room && room.state === 'lobby') { p.ready = !!msg.ready; room.broadcastInfo(); }
      break;
    case 'mission':
      if (room && room.hostId === p.id && room.state === 'lobby') {
        if (MISSIONS.find((m) => m.id === msg.missionId)) room.missionId = msg.missionId;
        if (DIFFICULTY[msg.diff]) room.diff = msg.diff;
        if (typeof msg.isPublic === 'boolean') room.isPublic = msg.isPublic;
        room.broadcastInfo();
      }
      break;
    case 'start':
      if (room && room.hostId === p.id && room.state === 'lobby') room.start();
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
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  if (pathname === '/api/rooms') {
    const list = [...rooms.values()].filter((r) => r.isPublic && r.players.size < MAX_PLAYERS).map((r) => ({
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
wss.on('connection', (ws) => {
  const p = { id: nextPlayerId++, ws, name: 'Pilot', ship: 'lancer', room: null, alive: false, inGame: false, state: null };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  send(ws, { t: 'welcome', id: p.id });
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try { handle(p, msg); } catch (err) { console.error('handle error', err); }
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

server.listen(PORT, () => console.log(`Vanguard Wing server listening on :${PORT}`));
