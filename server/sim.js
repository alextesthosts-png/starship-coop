// Authoritative mission simulation: enemies, allies, projectiles, objectives.
// Player ships are client-authoritative for movement and self-damage (snappy co-op feel);
// the server owns everything else.
import * as THREE from 'three';
import { SHIPS, WEAPONS, ENEMIES, MISSIONS, DIFFICULTY } from '../shared/config.js';
import { gameFlags } from './flags.js';
import { terrainHeight, asteroids, DREAD, TOWERS, CONVOY, PLANET, insideBox, spawnPoint } from '../shared/world.js';

const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _fwd = new THREE.Vector3(), _des = new THREE.Vector3();

const rnd = (a, b) => a + Math.random() * (b - a);
const r1 = (x) => Math.round(x * 10) / 10;
const r3 = (x) => Math.round(x * 1000) / 1000;
const arr = (v) => [r1(v.x), r1(v.y), r1(v.z)];

function segSphere(p0, p1, c, r) {
  // distance from segment p0-p1 to point c < r
  _a.subVectors(p1, p0);
  _b.subVectors(c, p0);
  const len2 = _a.lengthSq();
  let t = len2 > 0 ? _b.dot(_a) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  _c.copy(p0).addScaledVector(_a, t);
  return _c.distanceToSquared(c) < r * r;
}

export class Sim {
  constructor(room, missionId, diffKey) {
    this.room = room;
    this.def = MISSIONS.find((m) => m.id === missionId) || MISSIONS[0];
    this.env = this.def.env;
    this.diffKey = DIFFICULTY[diffKey] ? diffKey : 'normal';
    this.diff = DIFFICULTY[this.diffKey];
    this.entities = new Map();
    this.projs = new Map();
    this.nextId = 1;
    this.time = 0;
    this.phase = 'intro';
    this.introLeft = 4;
    this.events = [];
    this.result = null;
    this.endTimer = 0;
    this.objectives = [];
    this.stats = new Map(); // pid -> stats
    this.humans = Math.max(1, room.players.size);
    this.flags = gameFlags();
    this.scoreMul = this.flags.doubleScore ? 2 : 1;
    this.reserves = this.diff.reserves + (this.humans - 1) * 2 + (this.flags.extraReserves ? 2 : 0);
    this.respawns = []; // {pid, at}
    this.counters = { fighterKills: 0 };
    this.asteroids = this.env === 'space' && (this.def.id === 'convoy' || this.def.space === 'asteroids') ? asteroids() : [];
    for (const p of room.players.values()) this.ensureStats(p.id);
    this.script = (this.def.custom ? SCRIPTS.custom : SCRIPTS[this.def.id])(this);
    this.script.init();
    if (this.flags.aiWingmates) this.spawnWings();
  }

  // ---------- helpers ----------
  ensureStats(pid) {
    if (!this.stats.has(pid)) this.stats.set(pid, { kills: 0, score: 0, deaths: 0, shots: 0, hits: 0 });
    return this.stats.get(pid);
  }
  count(base) {
    const n = this.humans;
    return Math.max(1, Math.round(base * this.diff.count * (0.7 + 0.3 * n)));
  }
  emit(ev) { this.events.push(ev); }
  msg(from, text) { this.emit({ e: 'msg', from, text }); }
  banner(text, sub = '') { this.emit({ e: 'banner', text, sub }); }

  setObjectives(list) {
    this.objectives = list;
    this.emitObjectives();
  }
  obj(id) { return this.objectives.find((o) => o.id === id); }
  updObj(id, patch) {
    const o = this.obj(id);
    if (!o) return;
    let changed = false;
    for (const k in patch) if (o[k] !== patch[k]) { o[k] = patch[k]; changed = true; }
    if (changed) this.emitObjectives();
  }
  emitObjectives() { this.emit({ e: 'obj', list: this.objectives.map((o) => ({ ...o })) }); }

  spawn(type, pos, opts = {}) {
    const def = ENEMIES[type];
    const e = {
      id: this.nextId++,
      type,
      team: opts.team || def.team,
      pos: new THREE.Vector3(...pos),
      quat: new THREE.Quaternion(),
      vel: new THREE.Vector3(),
      hp: def.hp * (opts.hpMul || 1),
      maxHp: def.hp * (opts.hpMul || 1),
      radius: def.radius,
      speed: def.speed || 0,
      invuln: !!opts.invuln,
      static: !!opts.static,
      cool: rnd(0.5, 2),
      ai: { state: 'attack', timer: 0, tgt: null, retarget: 0, ...(opts.ai || {}) },
      data: opts.data || {},
    };
    if (opts.lookAt) {
      _m.lookAt(e.pos, new THREE.Vector3(...opts.lookAt), UP);
      e.quat.setFromRotationMatrix(_m);
      // lookAt from eye->target makes -Z point away from target; flip
      _m.lookAt(ZERO, _a.set(...opts.lookAt).sub(e.pos).normalize(), UP);
      e.quat.setFromRotationMatrix(_m);
    }
    this.entities.set(e.id, e);
    return e;
  }

  spawnWings() {
    const n = this.humans >= 3 ? 0 : this.humans === 2 ? 1 : 2;
    const sp = this.def.spawn;
    const names = ['Vanguard 5', 'Vanguard 6'];
    for (let i = 0; i < n; i++) {
      const w = this.spawn('wing', [sp[0] + (i ? 60 : -60), sp[1] - 15, sp[2] + 60], { lookAt: [sp[0] + (i ? 60 : -60), sp[1] - 15, sp[2] - 500] });
      w.data.name = names[i];
    }
    if (n > 0) this.emit({ e: 'msg', from: 'Vanguard 5', text: n === 2 ? 'Vanguard 5 and 6 forming up on you. We\'ve got your wings.' : 'Vanguard 5 joining the wing. Let\'s get to work.' });
  }

  livePlayers() {
    const out = [];
    for (const p of this.room.players.values()) if (p.inGame && p.alive && p.state) out.push(p);
    return out;
  }

  // Resolve a target reference to {pos, vel, radius}
  resolve(ref) {
    if (!ref) return null;
    if (ref.k === 'p') {
      const p = this.room.players.get(ref.id);
      if (!p || !p.alive || !p.state) return null;
      return { pos: p.state.pos, vel: p.state.vel, radius: 6 };
    }
    const e = this.entities.get(ref.id);
    if (!e) return null;
    return { pos: e.pos, vel: e.vel, radius: e.radius };
  }

  pickTarget(e, preferTypes = null) {
    const cands = [];
    if (e.team === 'enemy') {
      for (const p of this.livePlayers()) cands.push({ k: 'p', id: p.id, pos: p.state.pos });
      for (const o of this.entities.values()) if (o.team === 'ally' && o.type === 'wing') cands.push({ k: 'e', id: o.id, pos: o.pos });
    } else {
      for (const o of this.entities.values()) {
        if (o.team !== 'enemy') continue;
        if (preferTypes && !preferTypes.includes(o.type)) continue;
        cands.push({ k: 'e', id: o.id, pos: o.pos });
      }
      if (!cands.length && preferTypes) return this.pickTarget(e, null);
    }
    if (!cands.length) return null;
    // weighted towards nearest
    let best = null, bestScore = Infinity;
    for (const c of cands) {
      const s = c.pos.distanceTo(e.pos) * rnd(0.6, 1.4);
      if (s < bestScore) { bestScore = s; best = c; }
    }
    return { k: best.k, id: best.id };
  }

  nearestPlayer(pos, range) {
    let best = null, bd = range;
    for (const p of this.livePlayers()) {
      const d = p.state.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // ---------- projectiles ----------
  fireProj({ id, kind, team, owner = null, pos, vel, dmg, life, target = null, splash = 0, gravity = 0 }) {
    const pid = id || `s${this.nextId++}`;
    const p = { id: pid, kind, team, owner, pos: pos.clone(), vel: vel.clone(), dmg, life, target, splash, gravity, prev: pos.clone() };
    this.projs.set(pid, p);
    const ev = { e: 'shot', id: pid, k: kind, o: arr(pos), v: arr(vel), tm: team === 'enemy' ? 'e' : 'a' };
    if (owner != null) ev.own = owner;
    if (target) ev.tg = target;
    this.emit(ev);
    return p;
  }

  enemyShoot(e, targetPos, targetVel, kind = 'elaser', spread = 0.02, from = null) {
    const w = WEAPONS[kind];
    const o = from || e.pos.clone().addScaledVector(_fwd.set(0, 0, -1).applyQuaternion(e.quat), e.radius + 2);
    const dist = targetPos.distanceTo(o);
    const t = dist / w.speed;
    const aim = _d.copy(targetPos).addScaledVector(targetVel || ZERO, t * 0.85);
    const dir = aim.sub(o).normalize();
    dir.x += rnd(-spread, spread); dir.y += rnd(-spread, spread); dir.z += rnd(-spread, spread);
    dir.normalize();
    this.fireProj({
      kind, team: e.team, pos: o, vel: dir.multiplyScalar(w.speed),
      dmg: w.dmg * (e.team === 'enemy' ? this.diff.dmg : 1), life: w.life,
    });
  }

  // Called by room when a player fires
  playerFire(player, list) {
    const ship = SHIPS[player.ship];
    const st = this.ensureStats(player.id);
    for (const s of list.slice(0, 16)) {
      if (!s || typeof s.id !== 'string' || !Array.isArray(s.o) || !Array.isArray(s.v)) continue;
      let kind = s.k, dmg, life, splash = 0, gravity = 0;
      if (kind === 'laser') { dmg = ship.laserDmg; life = WEAPONS.laser.life; }
      else if (kind === ship.secondary) {
        const w = WEAPONS[kind];
        dmg = w.dmg; life = w.life; splash = w.splash || 0;
        gravity = kind === 'bomb' && this.env === 'planet' ? w.gravity : 0;
      } else continue;
      st.shots++;
      const pos = new THREE.Vector3(+s.o[0] || 0, +s.o[1] || 0, +s.o[2] || 0);
      const vel = new THREE.Vector3(+s.v[0] || 0, +s.v[1] || 0, +s.v[2] || 0);
      if (vel.length() > 2000) vel.setLength(2000);
      this.fireProj({ id: `${player.id}:${s.id}`, kind, team: 'ally', owner: player.id, pos, vel, dmg, life, target: kind === 'missile' ? (s.tg | 0) || null : null, splash, gravity });
    }
  }

  // A client reports one of our enemy bolts hit them
  projHitPlayer(id) {
    if (this.projs.delete(id)) this.emit({ e: 'rm', id });
  }

  damage(e, dmg, ownerPid, at) {
    if (e.invuln) { this.emit({ e: 'deflect', id: e.id, at: arr(at || e.pos) }); return; }
    e.hp -= dmg;
    if (ownerPid != null) {
      const st = this.ensureStats(ownerPid);
      st.hits++;
    }
    if (e.hp <= 0) this.kill(e, ownerPid);
  }

  kill(e, ownerPid) {
    if (!this.entities.has(e.id)) return;
    this.entities.delete(e.id);
    const def = ENEMIES[e.type];
    this.emit({ e: 'kill', id: e.id, type: e.type, at: arr(e.pos), by: ownerPid ?? null, team: e.team });
    if (ownerPid != null && e.team === 'enemy') {
      const st = this.ensureStats(ownerPid);
      st.kills++;
      st.score += def.score * this.scoreMul;
    }
    if (e.team === 'enemy' && (e.type === 'raider' || e.type === 'bomber')) this.counters.fighterKills++;
    if (e.type === 'wing') this.msg(e.data.name || 'Wingmate', 'I\'m hit! Ejecting!');
    this.script.onKill && this.script.onKill(e, ownerPid);
  }

  updateProjectiles(dt) {
    for (const p of this.projs.values()) {
      p.life -= dt;
      if (p.life <= 0) {
        if (p.splash) this.explode(p, p.pos);
        this.projs.delete(p.id);
        continue;
      }
      p.prev.copy(p.pos);
      if (p.kind === 'missile' && p.target) {
        const t = this.entities.get(p.target);
        if (t) {
          const want = _a.subVectors(t.pos, p.pos).normalize();
          const cur = _b.copy(p.vel).normalize();
          const ang = cur.angleTo(want);
          if (ang > 1e-4) {
            _q.setFromUnitVectors(cur, want);
            _qi.identity().slerp(_q, Math.min(1, (WEAPONS.missile.turn * dt) / ang));
            p.vel.applyQuaternion(_qi);
          }
        }
      }
      if (p.gravity) p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);

      // ground
      if (this.env === 'planet' && p.pos.y < terrainHeight(p.pos.x, p.pos.z)) {
        if (p.splash) this.explode(p, p.pos);
        this.projs.delete(p.id);
        continue;
      }
      // collide with entities of the other team
      let hit = null;
      for (const e of this.entities.values()) {
        if (e.team === p.team) continue;
        const rad = e.radius + (p.kind === 'missile' ? 4 : p.kind === 'flak' ? 3 : 1.5);
        if (segSphere(p.prev, p.pos, e.pos, rad)) { hit = e; break; }
      }
      // capital ship hull eats shots
      if (!hit && this.def.id === 'dread') {
        for (const b of DREAD.hull) if (insideBox(p.pos, b)) { hit = 'hull'; break; }
      }
      if (hit) {
        this.projs.delete(p.id);
        if (p.splash) { this.explode(p, p.pos); continue; }
        this.emit({ e: 'hit', id: p.id, at: arr(p.pos), tgt: hit === 'hull' ? 0 : hit.id });
        if (hit !== 'hull') this.damage(hit, p.dmg, p.owner, p.pos);
      }
    }
  }

  explode(p, at) {
    this.emit({ e: 'boom', id: p.id, at: arr(at), r: p.splash });
    for (const e of [...this.entities.values()]) {
      if (e.team === p.team) continue;
      const d = e.pos.distanceTo(at) - e.radius;
      if (d < p.splash) this.damage(e, p.dmg * (1 - Math.max(0, d) / p.splash * 0.6), p.owner, at);
    }
  }

  // ---------- AI ----------
  steer(e, desired, maxAngle, dt) {
    const fwd = _fwd.set(0, 0, -1).applyQuaternion(e.quat);
    const ang = fwd.angleTo(desired);
    const newFwd = _b.copy(fwd);
    if (ang > 1e-4) {
      _q.setFromUnitVectors(fwd, desired);
      _qi.identity().slerp(_q, Math.min(1, maxAngle / ang));
      newFwd.applyQuaternion(_qi);
    }
    // bank into turns
    const lateral = _c.copy(desired).addScaledVector(fwd, -fwd.dot(desired));
    const bank = Math.min(1.4, ang * 2.2);
    const up = _d.copy(UP);
    if (lateral.lengthSq() > 1e-6) up.addScaledVector(lateral.normalize(), bank);
    up.normalize();
    _m.lookAt(ZERO, newFwd, up);
    _q.setFromRotationMatrix(_m);
    e.quat.slerp(_q, Math.min(1, 10 * dt));
    const f = _a.set(0, 0, -1).applyQuaternion(e.quat);
    e.vel.copy(f).multiplyScalar(e.speed);
    e.pos.addScaledVector(e.vel, dt);
  }

  avoid(e, desired, dt) {
    const fwd = _a.set(0, 0, -1).applyQuaternion(e.quat);
    if (this.env === 'planet') {
      const ahead = _b.copy(e.pos).addScaledVector(fwd, e.speed * 1.8);
      const gh = Math.max(terrainHeight(ahead.x, ahead.z), terrainHeight(e.pos.x, e.pos.z));
      const clearance = 55;
      if (ahead.y < gh + clearance) desired.y += Math.min(3, (gh + clearance - ahead.y) / 25);
      if (e.pos.y > PLANET.ceiling - 200) desired.y -= 0.6;
      const r = Math.hypot(e.pos.x, e.pos.z);
      if (r > PLANET.arena - 300) { desired.x -= e.pos.x / r * 0.8; desired.z -= e.pos.z / r * 0.8; }
      desired.normalize();
      // hard floor
      const floor = terrainHeight(e.pos.x, e.pos.z) + 12;
      if (e.pos.y < floor) e.pos.y = floor;
    } else {
      const R = this.def.id === 'dread' ? DREAD.arena : CONVOY.arena;
      const r = e.pos.length();
      if (r > R - 300) desired.addScaledVector(e.pos, -0.9 / r);
      if (this.def.id === 'dread') {
        for (const b of DREAD.hull) {
          if (insideBox(e.pos, b, 60)) {
            _c.set(e.pos.x - b.c[0], (e.pos.y - b.c[1]) * 2.5, e.pos.z - b.c[2]).normalize();
            desired.addScaledVector(_c, 1.5);
          }
        }
      }
      for (const ast of this.asteroids) {
        const dx = e.pos.x - ast.x, dy = e.pos.y - ast.y, dz = e.pos.z - ast.z;
        const rr = ast.r + 50;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 1;
          desired.x += dx / d * 1.5; desired.y += dy / d * 1.5; desired.z += dz / d * 1.5;
        }
      }
      desired.normalize();
    }
  }

  fighterAI(e, dt) {
    const def = ENEMIES[e.type];
    e.ai.retarget -= dt;
    let t = this.resolve(e.ai.tgt);
    if (!t || e.ai.retarget <= 0) {
      e.ai.tgt = this.pickTarget(e, e.team === 'ally' ? ['raider', 'bomber'] : null);
      e.ai.retarget = rnd(4, 9);
      t = this.resolve(e.ai.tgt);
    }
    const fwd = _fwd.set(0, 0, -1).applyQuaternion(e.quat).clone();
    const desired = _des.copy(fwd);
    if (t) {
      const toT = new THREE.Vector3().subVectors(t.pos, e.pos);
      const dist = toT.length();
      if (e.ai.state === 'evade') {
        e.ai.timer -= dt;
        desired.copy(e.ai.evadeDir);
        if (e.ai.timer <= 0) e.ai.state = 'attack';
      } else {
        const tt = dist / WEAPONS.elaser.speed;
        const aim = new THREE.Vector3().copy(t.pos).addScaledVector(t.vel || ZERO, tt);
        desired.subVectors(aim, e.pos).normalize();
        if (dist < def.breakDist) {
          e.ai.state = 'evade';
          e.ai.timer = rnd(1.4, 3.2);
          const ev = fwd.clone().add(new THREE.Vector3(rnd(-1.2, 1.2), rnd(-0.5, 0.9), rnd(-1.2, 1.2))).normalize();
          e.ai.evadeDir = ev;
        }
        e.cool -= dt;
        if (dist < def.range && fwd.dot(desired) > 0.97 && e.cool <= 0) {
          this.enemyShoot(e, t.pos, t.vel, 'elaser', 0.015);
          e.ai.burst = (e.ai.burst || 0) + 1;
          if (e.ai.burst >= 3) { e.ai.burst = 0; e.cool = def.fireRate * rnd(1.8, 3.2) / (e.team === 'enemy' ? this.diff.fire : 1); }
          else e.cool = 0.13;
        }
      }
    } else {
      // no target: patrol toward the mission focus
      const focus = this.script.focus ? this.script.focus() : ZERO;
      desired.subVectors(focus, e.pos).normalize();
    }
    this.avoid(e, desired, dt);
    this.steer(e, desired, def.turn * dt, dt);
  }

  bomberAI(e, dt) {
    // dive on a relay tower, release bomb, climb away
    let tower = this.entities.get(e.ai.towerId);
    if (!tower) {
      const towers = [...this.entities.values()].filter((o) => o.type === 'tower');
      if (!towers.length) return this.fighterAI(e, dt);
      tower = towers[Math.floor(Math.random() * towers.length)];
      e.ai.towerId = tower.id;
    }
    const desired = _des;
    if (e.ai.state === 'evade') {
      e.ai.timer -= dt;
      desired.copy(e.ai.evadeDir);
      if (e.ai.timer <= 0) e.ai.state = 'attack';
    } else {
      const target = _c.copy(tower.pos); target.y += 110;
      desired.subVectors(target, e.pos);
      const horiz = Math.hypot(desired.x, desired.z);
      desired.normalize();
      e.cool -= dt;
      if (horiz < 90 && e.cool <= 0) {
        this.fireProj({ kind: 'ebomb', team: 'enemy', pos: e.pos.clone().add(new THREE.Vector3(0, -6, 0)), vel: e.vel.clone().multiplyScalar(0.3), dmg: WEAPONS.ebomb.dmg * this.diff.dmg, life: WEAPONS.ebomb.life, splash: WEAPONS.ebomb.splash, gravity: WEAPONS.ebomb.gravity });
        e.cool = 5;
        e.ai.state = 'evade';
        e.ai.timer = rnd(4, 6);
        e.ai.evadeDir = new THREE.Vector3(rnd(-1, 1), 0.5, rnd(-1, 1)).normalize();
      }
    }
    this.avoid(e, desired, dt);
    this.steer(e, desired, ENEMIES.bomber.turn * dt, dt);
  }

  gunshipAI(e, dt) {
    let tower = this.entities.get(e.ai.towerId);
    if (!tower) {
      const towers = [...this.entities.values()].filter((o) => o.type === 'tower');
      tower = towers[Math.floor(Math.random() * towers.length)];
      if (tower) e.ai.towerId = tower.id;
    }
    const center = tower ? _c.copy(tower.pos).add(new THREE.Vector3(0, 170, 0)) : _c.copy(this.script.focus ? this.script.focus() : ZERO).add(new THREE.Vector3(0, 100, 0));
    const rel = _b.subVectors(e.pos, center); rel.y = 0;
    const dist = rel.length() || 1;
    const desired = _des;
    if (dist > 420) desired.copy(rel).multiplyScalar(-1).normalize();
    else {
      // orbit
      desired.set(-rel.z, 0, rel.x).normalize().addScaledVector(rel.normalize(), (330 - dist) / 300);
    }
    desired.y = (center.y - e.pos.y) / 200;
    desired.normalize();
    this.avoid(e, desired, dt);
    this.steer(e, desired, ENEMIES.gunship.turn * dt, dt);
    // turrets
    e.cool -= dt;
    if (e.cool <= 0) {
      const p = this.nearestPlayer(e.pos, 750);
      const side = (e.ai.side = -(e.ai.side || 1));
      const from = new THREE.Vector3(side * 14, -4, -6).applyQuaternion(e.quat).add(e.pos);
      if (p) { this.enemyShoot(e, p.state.pos, p.state.vel, 'eheavy', 0.025, from); e.cool = 0.32 / this.diff.fire; }
      else if (tower && tower.pos.distanceTo(e.pos) < 650) { this.enemyShoot(e, tower.pos, ZERO, 'eheavy', 0.01, from); e.cool = 0.9; }
      else e.cool = 0.5;
    }
  }

  turretAI(e, dt, range = ENEMIES.turret.range, kind = 'eheavy', rate = 1.1) {
    e.cool -= dt;
    const p = this.nearestPlayer(e.pos, range);
    let tgtPos = p && p.state.pos, tgtVel = p && p.state.vel;
    if (!p) {
      // shoot at AI wingmates too
      for (const o of this.entities.values()) if (o.type === 'wing' && o.pos.distanceTo(e.pos) < range) { tgtPos = o.pos; tgtVel = o.vel; break; }
    }
    if (!tgtPos) return;
    if (e.type === 'turret') {
      _m.lookAt(ZERO, _a.subVectors(tgtPos, e.pos).normalize(), UP);
      e.quat.setFromRotationMatrix(_m);
    }
    if (e.cool <= 0) {
      const from = e.pos.clone().addScaledVector(_a.subVectors(tgtPos, e.pos).normalize(), e.radius + 3);
      this.enemyShoot(e, tgtPos, tgtVel, kind, 0.02, from);
      e.ai.burst = (e.ai.burst || 0) + 1;
      if (e.ai.burst >= 3) { e.ai.burst = 0; e.cool = rate * rnd(1.5, 2.5) / this.diff.fire; } else e.cool = 0.18;
    }
  }

  // ---------- main update ----------
  update(dt) {
    this.time += dt;
    if (this.phase === 'intro') {
      this.introLeft -= dt;
      if (this.introLeft <= 0) {
        this.phase = 'run';
        this.banner('MISSION START', this.def.name);
        this.script.start && this.script.start();
      }
    } else if (this.phase === 'run') {
      this.script.update(dt);
    } else if (this.phase === 'ending') {
      this.endTimer -= dt;
    }

    for (const e of [...this.entities.values()]) {
      if (!this.entities.has(e.id)) continue;
      switch (e.type) {
        case 'raider': case 'wing': this.fighterAI(e, dt); break;
        case 'bomber': this.bomberAI(e, dt); break;
        case 'gunship': this.gunshipAI(e, dt); break;
        case 'turret': if (this.phase === 'run') this.turretAI(e, dt); break;
        case 'freighter': this.freighterAI(e, dt); break;
        case 'core': if (this.phase === 'run' && !e.invuln) this.turretAI(e, dt, 700, 'eheavy', 1.6); break;
        default: break;
      }
    }
    this.updateProjectiles(dt);

    // respawns
    for (let i = this.respawns.length - 1; i >= 0; i--) {
      const r = this.respawns[i];
      if (this.time >= r.at) {
        this.respawns.splice(i, 1);
        const p = this.room.players.get(r.pid);
        if (p && p.inGame) this.respawnPlayer(p);
      }
    }
  }

  freighterAI(e, dt) {
    if (e.data.route) {
      // custom missions: follow the admin's route, escape at its last point
      const pts = e.data.route;
      const sp = ENEMIES.freighter.speed;
      const tgt = _a.set(...pts[e.data.ri]);
      const d = _b.subVectors(tgt, e.pos);
      const dist = d.length();
      if (dist < sp * dt * 1.5 + 8) {
        e.data.ri++;
        if (e.data.ri >= pts.length) { this.script.escaped(e); return; }
      }
      d.normalize();
      e.vel.copy(d).multiplyScalar(sp);
      e.pos.addScaledVector(d, sp * dt);
      _m.lookAt(ZERO, d, UP); _q.setFromRotationMatrix(_m); e.quat.slerp(_q, Math.min(1, dt * 1.5));
    } else {
      e.pos.z += ENEMIES.freighter.speed * dt;
      e.vel.set(0, 0, ENEMIES.freighter.speed);
    }
    e.cool -= dt;
    if (e.cool <= 0 && this.phase === 'run') {
      const p = this.nearestPlayer(e.pos, 520);
      if (p) {
        const side = (e.ai.side = -(e.ai.side || 1));
        const from = new THREE.Vector3(side * 16, 12, rnd(-30, 30)).applyQuaternion(e.quat).add(e.pos);
        this.enemyShoot(e, p.state.pos, p.state.vel, 'elaser', 0.03, from);
        e.cool = 0.5 / this.diff.fire;
      } else e.cool = 0.4;
    }
    if (!e.data.route && e.pos.z >= CONVOY.gateZ) this.script.escaped(e);
  }

  // ---------- players ----------
  respawnPlayer(p) {
    const slot = p.slot;
    const pos = spawnPoint(this.def, slot);
    // respawn nearer the action, behind the spawn line
    p.alive = true;
    p.state = { pos: new THREE.Vector3(...pos), vel: new THREE.Vector3(0, 0, -100), quat: new THREE.Quaternion(), hp: 100, boost: 0 };
    this.emit({ e: 'spawn', pid: p.id, pos });
  }

  playerDied(p) {
    if (!p.alive) return;
    p.alive = false;
    this.ensureStats(p.id).deaths++;
    this.emit({ e: 'pdead', pid: p.id, at: p.state ? arr(p.state.pos) : [0, 0, 0] });
    if (this.phase !== 'run' && this.phase !== 'intro') return;
    if (this.reserves > 0) {
      this.reserves--;
      this.respawns.push({ pid: p.id, at: this.time + 5 });
      this.emit({ e: 'reserves', n: this.reserves, pid: p.id, respawnIn: 5 });
    } else {
      this.emit({ e: 'reserves', n: 0, pid: p.id, respawnIn: -1 });
      const anyAlive = [...this.room.players.values()].some((q) => q.inGame && q.alive) || this.respawns.length > 0;
      if (!anyAlive) this.finish(false, 'The squadron has been wiped out.');
    }
  }

  playerJoined(p) {
    this.ensureStats(p.id);
    this.humans = Math.max(this.humans, [...this.room.players.values()].filter((q) => q.inGame).length);
  }

  finish(success, reason) {
    if (this.phase === 'ending' || this.phase === 'done') return;
    this.phase = 'ending';
    this.endTimer = 4;
    this.result = { success, reason };
    // resolve bonus objectives
    if (this.script.finalize) this.script.finalize(success);
    for (const o of this.objectives) {
      if (o.status === 'active') o.status = success ? (o.bonus ? 'failed' : 'done') : 'failed';
    }
    this.emitObjectives();
    this.banner(success ? 'MISSION COMPLETE' : 'MISSION FAILED', reason);
  }

  // ---------- snapshot ----------
  snapshot() {
    const e = [];
    for (const en of this.entities.values()) {
      e.push([en.id, en.type, r1(en.pos.x), r1(en.pos.y), r1(en.pos.z), r3(en.quat.x), r3(en.quat.y), r3(en.quat.z), r3(en.quat.w), Math.max(0, Math.round(en.hp / en.maxHp * 100)), en.invuln ? 1 : 0]);
    }
    const p = [];
    for (const pl of this.room.players.values()) {
      if (!pl.inGame || !pl.state) continue;
      const s = pl.state;
      p.push([pl.id, r1(s.pos.x), r1(s.pos.y), r1(s.pos.z), r3(s.quat.x), r3(s.quat.y), r3(s.quat.z), r3(s.quat.w), Math.round(s.hp), pl.alive ? 1 : 0, s.boost ? 1 : 0]);
    }
    return { t: 's', time: r1(this.time), res: this.reserves, e, p };
  }
}

// ======================= Mission scripts =======================
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
const SCRIPTS = {
  // Missions built in the admin panel's mission editor: waves, towers, turrets, a convoy route,
  // a time limit and bonus goals, all described by data.
  custom(sim) {
    const cm = sim.def.custom;
    const planet = cm.env === 'planet';
    const W = cm.waves, T = cm.towers.length, route = cm.route, F = route ? route.freighters : 0;
    const from = cm.messages.from || 'Control';
    const air = (x, z, alt) => (planet ? Math.max(terrainHeight(x, z) + 70, alt) : alt);
    let clock = 0, wi = 0, waveActive = false, clearT = 0, towersLost = 0, escaped = 0, destroyed = 0, kills = 0, convoyOut = false, turretsLeft = 0;
    const focusV = (() => {
      if (T) { const c = cm.towers.reduce((a, t) => [a[0] + t[0] / T, a[1] + t[1] / T], [0, 0]); return new THREE.Vector3(c[0], planet ? terrainHeight(c[0], c[1]) + 120 : 0, c[1]); }
      if (route) { const p = route.points[Math.floor(route.points.length / 2)]; return new THREE.Vector3(p[0], air(p[0], p[1], route.alt), p[1]); }
      return new THREE.Vector3(0, planet ? 200 : 0, 0);
    })();
    const waveEnemies = () => { let n = 0; for (const e of sim.entities.values()) if (e.team === 'enemy' && e.data.wave) n++; return n; };
    function spawnWave(w, idx) {
      for (const g of w.groups) {
        const n = sim.count(g.count);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2, r = 25 + n * 7;
          const x = g.pos[0] + Math.cos(a) * r, z = g.pos[1] + Math.sin(a) * r;
          sim.spawn(g.type, [x, air(x, z, g.alt) + rnd(-25, 25), z], { lookAt: focusV.toArray(), data: { wave: idx + 1 } });
        }
      }
      sim.banner(w.title || `WAVE ${idx + 1} / ${W.length}`, w.message || '');
      if (w.message) sim.msg(from, w.message);
    }
    function launchConvoy() {
      convoyOut = true;
      const pts = route.points.map(([x, z]) => [x, air(x, z, route.alt), z]);
      for (let i = 0; i < F; i++) {
        const [x, y, z] = pts[0];
        const back = new THREE.Vector3(pts[0][0] - pts[1][0], 0, pts[0][2] - pts[1][2]).normalize().multiplyScalar(i * 140);
        const side = (i % 2 ? 1 : -1) * 40;
        sim.spawn('freighter', [x + back.x + side, y + rnd(-15, 15), z + back.z], { lookAt: pts[1], hpMul: 0.75 + 0.25 * sim.humans, data: { route: pts, ri: 1 } });
      }
      sim.banner('CONVOY SIGHTED', `${F} freighter${F > 1 ? 's' : ''} on the move`);
      sim.msg(from, 'Convoy is moving. Stop those freighters before they reach the end of their route!');
    }
    function check() {
      if (sim.phase !== 'run') return;
      const wavesDone = wi >= W.length && waveEnemies() === 0;
      const convoyDone = !route || (convoyOut && destroyed + escaped >= F);
      const turretsDone = !cm.turretsRequired || !cm.turrets.length || turretsLeft === 0;
      if (wavesDone && convoyDone && turretsDone) sim.finish(true, cm.messages.win || 'Mission accomplished.');
    }
    return {
      init() {
        for (const [x, z] of cm.towers) sim.spawn('tower', [x, (planet ? terrainHeight(x, z) : 0) + 45, z], { static: true });
        for (const t of cm.turrets) {
          const [x, z] = t.pos;
          sim.spawn('turret', [x, planet ? terrainHeight(x, z) + 6 : t.alt, z], { static: true, data: { custom: true } });
          turretsLeft++;
        }
        const objs = [];
        if (W.length) objs.push({ id: 'waves', text: 'Repel the attack waves', progress: `0/${W.length}`, status: 'active' });
        if (T) objs.push({ id: 'towers', text: 'Protect the relay towers', progress: `${T}/${T}`, status: 'active' });
        if (route) {
          objs.push({ id: 'freighters', text: 'Stop the convoy freighters', progress: `0/${F}`, status: 'active' });
          objs.push({ id: 'escape', text: `Escaped (max ${route.maxEscape})`, progress: '0', status: 'active' });
        }
        if (cm.turretsRequired && cm.turrets.length) objs.push({ id: 'turrets', text: 'Destroy the defense turrets', progress: `0/${cm.turrets.length}`, status: 'active' });
        if (cm.timeLimit) objs.push({ id: 'time', text: `Finish within ${mmss(cm.timeLimit)}`, status: 'active' });
        const B = cm.bonus;
        if (B.noTowerLoss && T) objs.push({ id: 'b_towers', text: 'BONUS: Lose no relay towers', status: 'active', bonus: true });
        if (B.time) objs.push({ id: 'b_time', text: `BONUS: Finish in under ${mmss(B.time)}`, status: 'active', bonus: true });
        if (B.noEscape && route) objs.push({ id: 'b_noescape', text: 'BONUS: Let no freighter escape', status: 'active', bonus: true });
        if (B.kills) objs.push({ id: 'b_kills', text: `BONUS: Destroy ${B.kills} enemies`, progress: `0/${B.kills}`, status: 'active', bonus: true });
        if (B.noDeaths) objs.push({ id: 'b_deaths', text: 'BONUS: Lose no ships', status: 'active', bonus: true });
        if (!objs.length) objs.push({ id: 'survive', text: 'Survive', status: 'active' });
        sim.setObjectives(objs);
        sim.msg(from, cm.messages.start || `Vanguard Wing, ${cm.name} is a go. Good hunting.`);
      },
      start() {},
      focus() { return focusV; },
      update(dt) {
        clock += dt;
        // waves: "after the previous wave is cleared (+ delay)" or "at a fixed time"
        while (wi < W.length) {
          const w = W[wi];
          let go;
          if (w.trigger === 'time') go = clock >= w.at;
          else { if (!waveActive) clearT += dt; go = !waveActive && clearT >= w.delay; }
          if (!go) break;
          spawnWave(w, wi);
          wi++; waveActive = true; clearT = 0;
        }
        if (waveActive && waveEnemies() === 0) {
          waveActive = false; clearT = 0;
          sim.updObj('waves', { progress: `${wi}/${W.length}` });
          if (wi >= W.length) sim.updObj('waves', { status: 'done' });
          else if (W[wi].trigger === 'clear') sim.msg(from, `Wave ${wi} down. More contacts inbound.`);
        }
        if (route && !convoyOut && clock >= route.startAt) launchConvoy();
        if (cm.timeLimit && clock > cm.timeLimit) { sim.updObj('time', { status: 'failed' }); sim.finish(false, cm.messages.lose || 'Out of time.'); return; }
        if (cm.bonus.time && clock > cm.bonus.time) sim.updObj('b_time', { status: 'failed' });
        if (cm.bonus.noDeaths && [...sim.stats.values()].some((st) => st.deaths > 0)) sim.updObj('b_deaths', { status: 'failed' });
        check();
      },
      escaped(e) {
        sim.entities.delete(e.id);
        sim.emit({ e: 'warp', id: e.id, at: arr(e.pos) });
        escaped++;
        sim.updObj('escape', { progress: `${escaped}` });
        sim.updObj('freighters', { progress: `${destroyed + escaped}/${F}` });
        sim.updObj('b_noescape', { status: 'failed' });
        if (escaped > route.maxEscape) { sim.updObj('freighters', { status: 'failed' }); sim.finish(false, cm.messages.lose || 'Too many freighters escaped.'); return; }
        sim.msg(from, 'A freighter got away!');
        check();
      },
      onKill(e) {
        if (e.team === 'enemy') {
          kills++;
          if (cm.bonus.kills) { sim.updObj('b_kills', { progress: `${Math.min(kills, cm.bonus.kills)}/${cm.bonus.kills}` }); if (kills >= cm.bonus.kills) sim.updObj('b_kills', { status: 'done' }); }
        }
        if (e.type === 'freighter') { destroyed++; sim.updObj('freighters', { progress: `${destroyed + escaped}/${F}` }); sim.msg(from, `Freighter destroyed! ${F - destroyed - escaped} left.`); }
        if (e.type === 'turret' && e.data.custom) { turretsLeft--; sim.updObj('turrets', { progress: `${cm.turrets.length - turretsLeft}/${cm.turrets.length}` }); }
        if (e.type === 'tower') {
          towersLost++;
          sim.updObj('towers', { progress: `${T - towersLost}/${T}` });
          sim.updObj('b_towers', { status: 'failed' });
          if (towersLost >= T) { sim.updObj('towers', { status: 'failed' }); sim.finish(false, cm.messages.lose || 'All relay towers were destroyed.'); return; }
          sim.msg(from, `Relay tower down! ${T - towersLost} remaining!`);
        }
        check();
      },
      finalize(success) {
        if (!success) return;
        if (T && towersLost === 0) sim.updObj('b_towers', { status: 'done' });
        if (cm.bonus.time && clock <= cm.bonus.time) sim.updObj('b_time', { status: 'done' });
        if (route && escaped === 0) sim.updObj('b_noescape', { status: 'done' });
        if (route) sim.updObj('escape', { status: 'done' });
        if (cm.timeLimit) sim.updObj('time', { status: 'done' });
        if (cm.bonus.noDeaths && ![...sim.stats.values()].some((st) => st.deaths > 0)) sim.updObj('b_deaths', { status: 'done' });
        sim.updObj('survive', { status: 'done' });
      },
    };
  },

  siege(sim) {
    let wave = 0, waveActive = false, waveDelay = 0;
    let towersLost = 0;
    const waveDefs = [
      () => { spawnRaiders(sim.count(6)); },
      () => { spawnRaiders(sim.count(7)); spawnBombers(sim.count(3)); },
      () => { spawnRaiders(sim.count(6)); spawnBombers(sim.count(2)); spawnGunships(Math.max(1, Math.round(sim.count(2) * 0.8))); },
    ];
    function edgePos(i, n, alt = 420) {
      const ang = -Math.PI / 2 + (i - (n - 1) / 2) * 0.12 + rnd(-0.05, 0.05);
      const R = 2700;
      return [Math.cos(ang) * R + rnd(-80, 80), alt + rnd(-60, 120), Math.sin(ang) * R];
    }
    function spawnRaiders(n) { for (let i = 0; i < n; i++) sim.spawn('raider', edgePos(i, n), { lookAt: [0, 200, 0] }); }
    function spawnBombers(n) { for (let i = 0; i < n; i++) sim.spawn('bomber', edgePos(i, n, 520), { lookAt: [0, 200, 0] }); }
    function spawnGunships(n) { for (let i = 0; i < n; i++) sim.spawn('gunship', edgePos(i, n, 380), { lookAt: [0, 200, 0] }); }
    const enemiesLeft = () => [...sim.entities.values()].filter((e) => e.team === 'enemy').length;
    return {
      init() {
        for (const [x, z] of TOWERS) sim.spawn('tower', [x, terrainHeight(x, z) + 45, z], { static: true });
        sim.setObjectives([
          { id: 'waves', text: 'Repel the raid waves', progress: '0/3', status: 'active' },
          { id: 'towers', text: 'Protect the relay towers', progress: '3/3', status: 'active' },
          { id: 'b_towers', text: 'BONUS: Lose no relay towers', status: 'active', bonus: true },
          { id: 'b_time', text: 'BONUS: Finish in under 6:00', status: 'active', bonus: true },
        ]);
        sim.msg('Tamarin Control', 'Vanguard Wing, this is Tamarin Control. Long-range scopes show raiders inbound from the north. Protect those towers!');
      },
      start() { waveDelay = 2; },
      focus() { return new THREE.Vector3(0, 150, 0); },
      update(dt) {
        if (!waveActive) {
          waveDelay -= dt;
          if (waveDelay <= 0 && wave < 3) {
            waveDefs[wave]();
            wave++;
            waveActive = true;
            sim.banner(`WAVE ${wave} / 3`, wave === 2 ? 'Bombers inbound — protect the towers!' : wave === 3 ? 'Gunships detected!' : 'Raiders inbound from the north');
            if (wave === 2) sim.msg('Tamarin Control', 'Bombers in the mix! They\'re going for the towers — intercept them!');
            if (wave === 3) sim.msg('Tamarin Control', 'Heavy gunships on approach. Bombers and heavy cannons will crack their armor.');
          }
        } else if (enemiesLeft() === 0) {
          waveActive = false;
          sim.updObj('waves', { progress: `${wave}/3` });
          if (wave >= 3) {
            sim.updObj('waves', { status: 'done' });
            sim.updObj('towers', { status: 'done' });
            sim.finish(true, 'The raid has been broken. Tamarin station is secure.');
          } else {
            waveDelay = 6;
            sim.msg('Tamarin Control', `Wave ${wave} down. Regroup — more contacts forming up.`);
          }
        }
        if (sim.time > 360 + 4) sim.updObj('b_time', { status: 'failed' });
      },
      onKill(e) {
        if (e.type === 'tower') {
          towersLost++;
          sim.updObj('towers', { progress: `${3 - towersLost}/3` });
          sim.updObj('b_towers', { status: 'failed' });
          sim.msg('Tamarin Control', towersLost >= 3 ? 'We\'ve lost the last tower...' : `Relay tower down! ${3 - towersLost} remaining!`);
          if (towersLost >= 3) { sim.updObj('towers', { status: 'failed' }); sim.finish(false, 'All relay towers were destroyed.'); }
        }
      },
      finalize(success) {
        if (success) {
          if (towersLost === 0) sim.updObj('b_towers', { status: 'done' });
          if (sim.time <= 360 + 4) sim.updObj('b_time', { status: 'done' });
        }
      },
    };
  },

  convoy(sim) {
    const total = 6;
    let destroyed = 0, escaped = 0, groupTwo = false, reinforce = 30;
    function spawnGroup(zOff) {
      for (const x of CONVOY.lanesX) sim.spawn('freighter', [x, rnd(-20, 20), CONVOY.startZ + zOff + rnd(-40, 40)], { lookAt: [x, 0, 5000], hpMul: 0.75 + 0.25 * sim.humans });
    }
    function escorts(n, z) {
      for (let i = 0; i < n; i++) sim.spawn('raider', [rnd(-500, 500), rnd(-150, 200), z + rnd(-200, 200)], { lookAt: [0, 0, 2000] });
    }
    function checkEnd() {
      sim.updObj('freighters', { progress: `${destroyed + escaped}/${total}` });
      if (escaped >= 3) { sim.updObj('freighters', { status: 'failed' }); sim.finish(false, 'Too many freighters reached the jump gate.'); return; }
      if (destroyed + escaped >= total) {
        sim.updObj('freighters', { status: 'done' });
        sim.finish(true, escaped ? `Convoy broken — ${escaped} freighter${escaped > 1 ? 's' : ''} slipped away.` : 'The entire convoy has been destroyed!');
      }
    }
    return {
      init() {
        sim.setObjectives([
          { id: 'freighters', text: 'Destroy the convoy freighters', progress: `0/${total}`, status: 'active' },
          { id: 'escape', text: 'Escaped (max 2)', progress: '0', status: 'active' },
          { id: 'b_noescape', text: 'BONUS: Let no freighter escape', status: 'active', bonus: true },
          { id: 'b_kills', text: 'BONUS: Destroy 20 escort fighters', progress: '0/20', status: 'active', bonus: true },
        ]);
        sim.msg('Overwatch', 'Convoy has entered the Vesk belt. Freighters are heading straight for the gate behind you. Hit them hard and fast.');
      },
      start() {
        spawnGroup(0);
        escorts(sim.count(6), CONVOY.startZ + 300);
      },
      focus() { return new THREE.Vector3(0, 0, 0); },
      update(dt) {
        if (!groupTwo && sim.time > 40) {
          groupTwo = true;
          spawnGroup(-250);
          escorts(sim.count(4), CONVOY.startZ);
          sim.banner('SECOND CONVOY GROUP', 'Three more freighters entering the belt');
          sim.msg('Overwatch', 'Second freighter group has jumped in behind the first. Don\'t let up!');
        }
        reinforce -= dt;
        const fighters = [...sim.entities.values()].filter((e) => e.type === 'raider').length;
        if (reinforce <= 0) {
          reinforce = 28;
          if (fighters < sim.count(8)) {
            escorts(sim.count(3), CONVOY.startZ + sim.time * 20);
            sim.msg('Overwatch', 'More escort fighters launching from the convoy.');
          }
        }
        sim.updObj('b_kills', { progress: `${Math.min(20, sim.counters.fighterKills)}/20` });
        if (sim.counters.fighterKills >= 20) sim.updObj('b_kills', { status: 'done' });
      },
      escaped(e) {
        sim.entities.delete(e.id);
        sim.emit({ e: 'warp', id: e.id, at: arr(e.pos) });
        escaped++;
        sim.updObj('escape', { progress: `${escaped}` });
        sim.updObj('b_noescape', { status: 'failed' });
        sim.msg('Overwatch', escaped >= 3 ? 'Third freighter has jumped. We\'ve lost this one.' : `A freighter made the jump! ${3 - escaped - 1 >= 0 ? 'We can\'t afford another!' : ''}`);
        checkEnd();
      },
      onKill(e) {
        if (e.type === 'freighter') {
          destroyed++;
          sim.msg('Overwatch', `Freighter destroyed! ${total - destroyed - escaped} remaining.`);
          checkEnd();
        }
      },
      finalize(success) {
        if (success && escaped === 0) sim.updObj('b_noescape', { status: 'done' });
        if (sim.counters.fighterKills >= 20) sim.updObj('b_kills', { status: 'done' });
        sim.updObj('escape', { status: escaped < 3 ? 'done' : 'failed' });
      },
    };
  },

  dread(sim) {
    let gens = 4, turrets = 8, coreId = null, hangarTimer = 8, coreExposedAt = 0;
    return {
      init() {
        for (const g of DREAD.generators) sim.spawn('generator', [g[0], g[1] + 10, g[2]], { static: true, hpMul: 0.8 + 0.2 * sim.humans });
        for (const t of DREAD.turrets) {
          const e = sim.spawn('turret', [t[0], t[1] + (t[1] < 0 ? -5 : 5), t[2]], { static: true });
          e.data.under = t[1] < 0;
        }
        const core = sim.spawn('core', DREAD.core, { static: true, invuln: true, hpMul: 0.7 + 0.3 * sim.humans });
        coreId = core.id;
        sim.setObjectives([
          { id: 'gens', text: 'Destroy the shield generators', progress: '0/4', status: 'active' },
          { id: 'core', text: 'Destroy the reactor core (ventral hull)', status: 'active', locked: true },
          { id: 'b_turrets', text: 'BONUS: Destroy all 8 defense turrets', progress: '0/8', status: 'active', bonus: true },
          { id: 'b_time', text: 'BONUS: Finish in under 8:00', status: 'active', bonus: true },
        ]);
        sim.msg('Admiral Toren', 'There she is — the Ravager. Generators are on the dorsal hull, fore and aft. Bring them down and the core is yours.');
      },
      start() {
        for (let i = 0; i < sim.count(5); i++) sim.spawn('raider', [rnd(-300, 300), rnd(-150, 150), rnd(-300, 200)], { lookAt: [0, 100, 1800] });
      },
      focus() { return new THREE.Vector3(0, 60, 200); },
      update(dt) {
        hangarTimer -= dt;
        if (hangarTimer <= 0) {
          hangarTimer = 22;
          const fighters = [...sim.entities.values()].filter((e) => e.type === 'raider').length;
          if (fighters < sim.count(7)) {
            const n = sim.count(3);
            for (let i = 0; i < n; i++) sim.spawn('raider', [DREAD.hangar[0] + rnd(-20, 20), DREAD.hangar[1] - 40, DREAD.hangar[2] + rnd(-40, 40)], { lookAt: [rnd(-500, 500), -400, rnd(-500, 800)] });
            sim.msg('Admiral Toren', 'Fighters launching from the Ravager\'s hangar!');
          }
        }
        if (sim.time > 480 + 4) sim.updObj('b_time', { status: 'failed' });
      },
      onKill(e) {
        if (e.type === 'generator') {
          gens--;
          sim.updObj('gens', { progress: `${4 - gens}/4` });
          if (gens > 0) sim.msg('Admiral Toren', `Generator down! ${gens} to go.`);
          else {
            sim.updObj('gens', { status: 'done' });
            sim.updObj('core', { locked: false });
            const core = sim.entities.get(coreId);
            if (core) core.invuln = false;
            coreExposedAt = sim.time;
            sim.banner('SHIELDS DOWN', 'Reactor core exposed on the ventral hull!');
            sim.msg('Admiral Toren', 'Her shields are down! The reactor core is exposed under the hull — all fighters, attack!');
          }
        } else if (e.type === 'turret') {
          turrets--;
          sim.updObj('b_turrets', { progress: `${8 - turrets}/8` });
          if (turrets === 0) sim.updObj('b_turrets', { status: 'done' });
        } else if (e.type === 'core') {
          sim.updObj('core', { status: 'done' });
          sim.emit({ e: 'bigboom', at: [0, 0, 100] });
          sim.finish(true, 'The Ravager is breaking apart. Outstanding work, Vanguard Wing!');
        }
      },
      finalize(success) {
        if (success && sim.time <= 480 + 4) sim.updObj('b_time', { status: 'done' });
        if (turrets === 0) sim.updObj('b_turrets', { status: 'done' });
      },
    };
  },
};
