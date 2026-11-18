// Headless smoke test: spins up the server, connects 2 bot pilots, plays each mission briefly.
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 3999;
const MISSION = process.argv[2];
const DURATION = +(process.argv[3] || 12) * 1000;
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));

function bot(name, ship) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { ws, name, id: null, room: null, snaps: 0, ev: {}, ents: new Map(), pos: [0, 200, 1500], n: 0, end: null, objectives: null };
  b.send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'welcome') { b.id = m.id; b.send({ t: 'hello', name, ship }); }
    if (m.t === 'room') b.room = m;
    if (m.t === 'start') { b.started = true; b.objectives = m.objectives; }
    if (m.t === 'end') b.end = m;
    if (m.t === 's') { b.snaps++; b.ents = new Map(m.e.map((e) => [e[0], e])); b.res = m.res; }
    if (m.ev) for (const e of m.ev) { b.ev[e.e] = (b.ev[e.e] || 0) + 1; if (e.e === 'obj') b.objectives = e.list; }
  });
  return new Promise((r) => ws.on('open', () => r(b)));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const missions = MISSION ? [MISSION] : ['siege', 'convoy', 'dread'];
let failures = 0;
for (const mid of missions) {
  const a = await bot('Alpha', 'lancer');
  const c = await bot('Bravo', 'hammer');
  await wait(100);
  a.send({ t: 'create' });
  await wait(100);
  c.send({ t: 'join', code: a.room.code });
  await wait(100);
  a.send({ t: 'mission', missionId: mid, diff: 'normal' });
  await wait(50);
  a.send({ t: 'start' });
  const t0 = Date.now();
  let shotN = 0;
  // bots: hover near the nearest enemy and shoot at it
  const iv = setInterval(() => {
    for (const b of [a, c]) {
      if (!b.started) continue;
      let best = null, bd = 1e9;
      for (const e of b.ents.values()) {
        if (e[1] === 'tower' || e[1] === 'wing') continue;
        if (e[10]) continue; // invulnerable
        const d = Math.hypot(e[2] - b.pos[0], e[3] - b.pos[1], e[4] - b.pos[2]);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) {
        // teleport-ish close to target (bot cheat) and fire straight at it
        const dir = [best[2] - b.pos[0], best[3] - b.pos[1], best[4] - b.pos[2]];
        const len = Math.hypot(...dir) || 1;
        const step = Math.min(len - 120, 60);
        if (step > 0) for (let i = 0; i < 3; i++) b.pos[i] += dir[i] / len * step;
        const v = dir.map((x) => (x / len) * 950);
        b.send({ t: 'fire', list: [{ id: String(shotN++), k: 'laser', o: b.pos, v }] });
        if (shotN % 15 === 0) b.send({ t: 'fire', list: [{ id: String(shotN++), k: b === a ? 'missile' : 'bomb', o: b.pos, v: v.map((x) => x * 0.3), tg: best[0] }] });
      }
      b.send({ t: 'st', s: [...b.pos, 0, 0, 0, 1, 0, 0, -100, 100, 0] });
    }
  }, 50);
  while (Date.now() - t0 < DURATION && !a.end) await wait(200);
  // simulate death/respawn
  c.send({ t: 'dead' });
  await wait(300);
  clearInterval(iv);
  console.log(`\n== ${mid} ==`);
  console.log('snapshots', a.snaps, 'entities now', a.ents.size, 'reserves', a.res);
  console.log('events', JSON.stringify(a.ev));
  console.log('objectives', (a.objectives || []).map((o) => `${o.text} [${o.progress || ''}] ${o.status}`).join(' | '));
  if (a.end) console.log('END', a.end.success, a.end.reason, a.end.medal, JSON.stringify(a.end.stats));
  if (a.snaps < 10 || !a.ev.shot) { failures++; console.log('FAIL: no snapshots/shots'); }
  a.ws.close(); c.ws.close();
  await wait(200);
}
srv.kill();
process.exit(failures ? 1 : 0);
