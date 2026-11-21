// In-mission game client.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SHIPS, WEAPONS, ENEMIES, MISSIONS, DIFFICULTY } from '/shared/config.js';
import { VISUALS } from '/shared/tuning.js';
import { DREAD, insideBox, spawnPoint, terrainHeight } from '/shared/world.js';
import { buildShip, buildEntity, engineGlow } from './models.js';
import { buildPlanetEnv, buildSpaceEnv } from './env.js';
import { Particles, Bolts } from './effects.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Vector3();
const INTERP_DELAY = 110;

// Bolt colours are HDR (×3) so they bloom. Hex values come straight from the admin panel.
const hdr = (hex, k = 3) => { const n = parseInt(String(hex).slice(1), 16); return new THREE.Color(((n >> 16) & 255) / 255 * k, ((n >> 8) & 255) / 255 * k, (n & 255) / 255 * k); };
const TEAM_COLORS = { get enemy() { return hdr(VISUALS.enemyLaser); }, get heavy() { return hdr(VISUALS.heavyLaser); }, get wing() { return hdr(VISUALS.wingLaser); } };
const EXPLO_SCALE = { raider: 1.2, bomber: 1.6, wing: 1.2, gunship: 3, freighter: 4, turret: 1.8, generator: 3.5, core: 6, tower: 3.5 };

function segSphere(p0, p1, c, r) {
  _v.subVectors(p1, p0);
  _v2.subVectors(c, p0);
  const len2 = _v.lengthSq();
  let t = len2 > 0 ? _v2.dot(_v) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  _v3.copy(p0).addScaledVector(_v, t);
  return _v3.distanceToSquared(c) < r * r;
}

export class Game {
  constructor({ renderer, net, sfx, hud, input, start, myId, onLocalEvent }) {
    this.renderer = renderer;
    this.net = net;
    this.sfx = sfx;
    this.hud = hud;
    this.input = input;
    this.myId = myId;
    this.onLocalEvent = onLocalEvent || (() => {});
    this.mission = MISSIONS.find((m) => m.id === start.missionId);
    this.diff = DIFFICULTY[start.diff];
    this.players = new Map(start.players.map((p) => [p.id, p]));
    this.slot = start.slot;
    this.reserves = start.reserves;
    this.scoreMul = start.scoreMul || 1;
    this.serverTime = start.time || 0;
    this.missionTime = this.serverTime - 4;
    this.entities = new Map();
    this.remotes = new Map();
    this.projs = new Map();
    this.localHit = new Set();
    this.targetId = null;
    this.lockT = 0;
    this.lockTime = 0.7;
    this.shotN = 0;
    this.sendT = 0;
    this.shake = 0;
    this.camMode = 0;
    this.running = true;
    this.time = 0;
    this.lastObj = new Map();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.5, 40000);
    this.env = this.mission.env === 'planet' ? buildPlanetEnv(this.scene) : buildSpaceEnv(this.scene, this.mission.id);
    this.particles = new Particles(this.scene);
    this.bolts = new Bolts(this.scene);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), VISUALS.bloomStrength, 0.5, VISUALS.bloomThreshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.renderer.toneMappingExposure = VISUALS.exposure;

    // local ship
    const me = this.players.get(myId);
    this.shipType = me.ship;
    this.def = SHIPS[me.ship];
    this.color = me.color;
    this.ship = new THREE.Group();
    this.model = buildShip(me.ship, me.color);
    this.ship.add(this.model);
    this.scene.add(this.ship);
    this.me = {
      alive: true, speed: this.def.speed * 0.7, throttle: 0.65, angVel: new THREE.Vector3(),
      hull: this.def.hull, maxHull: this.def.hull, shield: this.def.shield, maxShield: this.def.shield,
      boostEnergy: 100, boosting: false, secondary: this.def.secondary, secAmmo: this.def.secAmmo, secMax: this.def.secAmmo,
      secTimer: 0, secCool: 0, laserCool: 0, gunIdx: 0, lastDamage: -10, lastCrash: -10, score: 0, respawnAt: 0,
    };
    this.placeAtSpawn(spawnPoint(this.mission, this.slot));
    for (const p of start.players) if (p.id !== myId) this.addRemote(p);
    if (start.objectives) this.hud.objectives(start.objectives);

    this.hud.reset();
    this.hud.show(true);
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();
    this.sfx.startEngine();
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.particles.setScale(h);
  }

  placeAtSpawn(pos) {
    this.ship.position.set(...pos);
    this.ship.quaternion.identity();
    this.ship.updateMatrixWorld();
    this.camera.position.copy(this.ship.position).add(new THREE.Vector3(0, 4, 16));
    this.camera.quaternion.identity();
  }

  addRemote(p) {
    if (this.remotes.has(p.id)) return;
    const mesh = buildShip(p.ship, p.color);
    mesh.visible = false;
    this.scene.add(mesh);
    this.remotes.set(p.id, { id: p.id, name: p.name, color: p.color, ship: p.ship, mesh, buf: [], alive: true, boost: 0 });
  }
  removeRemote(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.scene.remove(r.mesh);
    this.remotes.delete(id);
  }

  // ---------------- network ----------------
  onPlayerJoin(p) { this.players.set(p.id, p); this.addRemote(p); this.hud.message(null, `${p.name} joined the mission.`); }

  onSnapshot(m) {
    const now = performance.now();
    this.serverTime = m.time;
    this.missionTime = m.time - 4;
    this.reserves = m.res;
    const seen = new Set();
    for (const a of m.e) {
      const [id, type, x, y, z, qx, qy, qz, qw, hp, inv] = a;
      seen.add(id);
      let e = this.entities.get(id);
      if (!e) {
        const mesh = buildEntity(type);
        mesh.position.set(x, y, z);
        mesh.quaternion.set(qx, qy, qz, qw);
        this.scene.add(mesh);
        e = { id, type, team: ENEMIES[type].team, radius: ENEMIES[type].radius, mesh, buf: [], hp, invuln: !!inv, vel: new THREE.Vector3() };
        this.entities.set(id, e);
      }
      e.hp = hp;
      e.invuln = !!inv;
      e.buf.push({ t: now, p: new THREE.Vector3(x, y, z), q: new THREE.Quaternion(qx, qy, qz, qw) });
      if (e.buf.length > 8) e.buf.shift();
    }
    for (const [id, e] of this.entities) if (!seen.has(id)) this.removeEntity(id);
    for (const a of m.p) {
      const [pid, x, y, z, qx, qy, qz, qw, hp, alive, boost] = a;
      if (pid === this.myId) continue;
      const r = this.remotes.get(pid);
      if (!r) continue;
      r.alive = !!alive;
      r.boost = boost;
      r.hp = hp;
      r.buf.push({ t: now, p: new THREE.Vector3(x, y, z), q: new THREE.Quaternion(qx, qy, qz, qw) });
      if (r.buf.length > 8) r.buf.shift();
    }
  }

  removeEntity(id) {
    const e = this.entities.get(id);
    if (!e) return;
    this.scene.remove(e.mesh);
    this.entities.delete(id);
    if (this.targetId === id) { this.targetId = null; this.lockT = 0; }
  }

  onEvents(list) {
    for (const ev of list) {
      try { this.handleEvent(ev); } catch (err) { console.error(err, ev); }
    }
  }

  handleEvent(ev) {
    const myPos = this.ship.position;
    switch (ev.e) {
      case 'shot': {
        if (ev.own === this.myId) return;
        const pos = new THREE.Vector3(...ev.o), vel = new THREE.Vector3(...ev.v);
        let color, len = 7, width = 1;
        if (ev.tm === 'e') { color = ev.k === 'eheavy' ? TEAM_COLORS.heavy : TEAM_COLORS.enemy; if (ev.k === 'eheavy') { len = 10; width = 2; } }
        else if (ev.own != null) color = new THREE.Color(this.players.get(ev.own)?.color || '#ffffff').multiplyScalar(2.5);
        else color = TEAM_COLORS.wing;
        this.addProj({ id: ev.id, kind: ev.k, team: ev.tm, pos, vel, color, len, width, target: ev.tg, mine: false, owner: ev.own });
        const d = pos.distanceTo(myPos);
        if (d < 500 && ev.k !== 'ebomb') this.sfx.laser(0.06 * (1 - d / 500), ev.tm === 'e' ? 0.6 : 0.8);
        break;
      }
      case 'rm': this.projs.delete(ev.id); break;
      case 'hit': {
        const at = new THREE.Vector3(...ev.at);
        const mine = typeof ev.id === 'string' && ev.id.startsWith(`${this.myId}:`);
        if (!this.localHit.has(ev.id)) this.particles.sparks(at, [1, 0.8, 0.4], 8, 50);
        this.localHit.delete(ev.id);
        this.projs.delete(ev.id);
        if (mine) { this.hitMarker = 0.15; this.sfx.tone(2400, 0.03, 0.04, 'square'); }
        break;
      }
      case 'deflect': {
        const at = new THREE.Vector3(...ev.at);
        this.particles.sparks(at, [0.4, 0.7, 1], 10, 80);
        break;
      }
      case 'kill': {
        const at = new THREE.Vector3(...ev.at);
        const sc = EXPLO_SCALE[ev.type] || 1;
        this.particles.explosion(at, sc);
        this.sfx.explosion(sc * 0.7, at.distanceTo(myPos));
        if (at.distanceTo(myPos) < 200 * sc) this.shake = Math.max(this.shake, 0.4 * sc * (1 - at.distanceTo(myPos) / (200 * sc)));
        this.removeEntity(ev.id);
        const label = ev.type.toUpperCase();
        if (ev.by === this.myId && ev.team === 'enemy') {
          const pts = ENEMIES[ev.type].score * (this.scoreMul || 1);
          this.me.score += pts;
          this.hud.popup(`+${pts}`);
          this.hud.killFeed(`You destroyed a ${label} <b>+${pts}</b>`, '#9fe8ff');
        } else if (ev.team === 'enemy' && ev.by != null) {
          const p = this.players.get(ev.by);
          if (p) this.hud.killFeed(`<span style="color:${p.color}">${p.name}</span> destroyed a ${label}`, '#cde');
        } else if (ev.team === 'ally') {
          this.hud.killFeed(`${ev.type === 'tower' ? 'Relay tower destroyed!' : 'Wingmate down!'}`, '#ff7a6a');
        }
        break;
      }
      case 'boom': {
        const at = new THREE.Vector3(...ev.at);
        this.projs.delete(ev.id);
        this.particles.explosion(at, Math.max(1.5, ev.r / 25), [0.6, 0.6, 1.2]);
        this.sfx.explosion(1.5, at.distanceTo(myPos));
        const d = at.distanceTo(myPos);
        if (d < 250) this.shake = Math.max(this.shake, 0.6 * (1 - d / 250));
        // enemy bombs damage the local player
        if (typeof ev.id === 'string' && ev.id.startsWith('s') && this.me.alive && d < ev.r + 5 && ev.r > 0 && this.isEnemyBomb(ev)) {
          this.takeDamage(WEAPONS.ebomb.dmg * this.diff.dmg * 0.5 * (1 - d / (ev.r + 5)));
        }
        break;
      }
      case 'warp': {
        const at = new THREE.Vector3(...ev.at);
        this.particles.explosion(at, 3, [0.3, 0.6, 1.4]);
        this.removeEntity(ev.id);
        this.hud.killFeed('A freighter escaped through the gate!', '#ff9a6a');
        break;
      }
      case 'bigboom': {
        const c = new THREE.Vector3(...ev.at);
        for (let i = 0; i < 14; i++) {
          setTimeout(() => {
            if (!this.running) return;
            const p = c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 220, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 800));
            this.particles.explosion(p, 4 + Math.random() * 4);
            this.sfx.explosion(2, p.distanceTo(this.ship.position) * 0.5);
          }, i * 220);
        }
        break;
      }
      case 'msg': this.hud.message(ev.from, ev.text, ev.from && ev.from.startsWith('Vanguard') ? '#9fffb0' : '#ffd27a'); break;
      case 'banner': this.hud.banner(ev.text, ev.sub); this.sfx.objective(); break;
      case 'obj': {
        this.hud.objectives(ev.list);
        for (const o of ev.list) {
          const prev = this.lastObj.get(o.id);
          if (prev && prev !== o.status && o.status === 'done') { this.sfx.objective(); this.hud.killFeed(`Objective complete: ${o.text}`, '#8fff9f'); }
          if (prev && prev !== o.status && o.status === 'failed' && o.bonus) this.hud.killFeed(`Bonus failed: ${o.text.replace('BONUS: ', '')}`, '#ffa080');
          this.lastObj.set(o.id, o.status);
        }
        break;
      }
      case 'pdead': {
        if (ev.pid === this.myId) break;
        const r = this.remotes.get(ev.pid);
        if (r) {
          r.alive = false;
          r.mesh.visible = false;
          this.particles.explosion(r.mesh.position, 1.6, [0.6, 0.8, 1.2]);
          this.sfx.explosion(1, r.mesh.position.distanceTo(myPos));
          this.hud.killFeed(`<span style="color:${r.color}">${r.name}</span> was shot down!`, '#ff9a8a');
        }
        break;
      }
      case 'spawn': {
        if (ev.pid === this.myId) this.respawn(ev.pos);
        else { const r = this.remotes.get(ev.pid); if (r) { r.alive = true; r.buf = []; } }
        break;
      }
      case 'reserves': {
        this.reserves = ev.n;
        if (ev.pid === this.myId) this.me.respawnAt = ev.respawnIn > 0 ? this.time + ev.respawnIn : -1;
        break;
      }
      case 'pleft': this.removeRemote(ev.pid); break;
      default: break;
    }
  }
  isEnemyBomb() { return true; }

  // ---------------- projectiles ----------------
  addProj(p) {
    const w = WEAPONS[p.kind] || WEAPONS.laser;
    p.life = p.life ?? w.life;
    p.prev = p.pos.clone();
    p.bolt = ['laser', 'elaser', 'eheavy', 'flak'].includes(p.kind);
    if (p.kind === 'flak') { p.len = 3; p.width = 0.8; }
    p.len = p.len || 7; p.width = p.width || 1;
    if (!p.bolt) {
      const col = p.kind === 'missile' ? VISUALS.missile : p.kind === 'bomb' ? VISUALS.bomb : 0xff4422;
      p.mesh = engineGlow(col, p.kind === 'bomb' ? 9 : p.kind === 'ebomb' ? 8 : 4);
      p.mesh.position.copy(p.pos);
      this.scene.add(p.mesh);
    }
    p.gravity = (p.kind === 'bomb' && this.mission.env === 'planet') ? WEAPONS.bomb.gravity : p.kind === 'ebomb' ? WEAPONS.ebomb.gravity : 0;
    this.projs.set(p.id, p);
  }

  updateProjectiles(dt) {
    const myPos = this.ship.position;
    for (const [id, p] of this.projs) {
      p.life -= dt;
      if (p.life <= 0) { this.dropProj(id, p); continue; }
      p.prev.copy(p.pos);
      if (p.kind === 'missile' && p.target) {
        const t = this.entities.get(p.target);
        if (t) {
          const want = _v.subVectors(t.mesh.position, p.pos).normalize();
          const cur = _v2.copy(p.vel).normalize();
          const ang = cur.angleTo(want);
          if (ang > 1e-4) {
            _q.setFromUnitVectors(cur, want);
            _q2.identity().slerp(_q, Math.min(1, (WEAPONS.missile.turn * dt) / ang));
            p.vel.applyQuaternion(_q2);
          }
        }
      }
      if (p.gravity) p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.mesh) {
        p.mesh.position.copy(p.pos);
        if (Math.random() < 0.9) {
          const c = p.kind === 'missile' ? [1.4, 0.9, 0.6] : p.kind === 'bomb' ? [0.5, 0.8, 1.6] : [1.6, 0.5, 0.3];
          this.particles.emit(p.pos.x, p.pos.y, p.pos.z, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 0.5, 2.2, c[0], c[1], c[2], 4, 1);
        }
      }
      // cosmetic environment collision
      if (this.mission.env === 'planet' && p.pos.y < terrainHeight(p.pos.x, p.pos.z)) {
        if (p.bolt) this.particles.sparks(p.pos, [1, 0.7, 0.4], 4, 30);
        this.dropProj(id, p, !p.bolt);
        continue;
      }
      if (this.mission.id === 'dread' && p.bolt) {
        let hit = false;
        for (const b of DREAD.hull) if (insideBox(p.pos, b)) { hit = true; break; }
        if (hit) { this.particles.sparks(p.pos, [1, 0.7, 0.4], 4, 30); this.dropProj(id, p); continue; }
      }
      // enemy fire vs me (client-authoritative self damage)
      if (p.team === 'e' && this.me.alive && p.kind !== 'ebomb') {
        if (segSphere(p.prev, p.pos, myPos, 4.5)) {
          const dmg = (WEAPONS[p.kind]?.dmg || 5) * this.diff.dmg;
          this.takeDamage(dmg, p.pos);
          this.particles.sparks(p.pos, this.me.shield > 0 ? [0.4, 0.7, 1.2] : [1, 0.6, 0.3], 10, 40);
          this.net.send({ t: 'phit', id });
          this.dropProj(id, p);
          continue;
        }
      }
      // my bolts: predict hits for instant feedback
      if (p.mine && p.bolt) {
        for (const e of this.entities.values()) {
          if (e.team !== 'enemy') continue;
          if (segSphere(p.prev, p.pos, e.mesh.position, e.radius + 1.5)) {
            this.localHit.add(id);
            this.particles.sparks(p.pos, e.invuln ? [0.4, 0.7, 1.2] : [1, 0.8, 0.4], 8, 50);
            this.dropProj(id, p);
            break;
          }
        }
      }
    }
    if (this.localHit.size > 300) this.localHit.clear();
  }
  dropProj(id, p, keepVisualUntilServer = false) {
    if (p.mesh && !keepVisualUntilServer) this.scene.remove(p.mesh);
    if (p.mesh && keepVisualUntilServer) this.scene.remove(p.mesh);
    this.projs.delete(id);
  }

  // ---------------- local player ----------------
  takeDamage(dmg, at) {
    if (!this.me.alive || this.missionTime < 0) return;
    const me = this.me;
    me.lastDamage = this.time;
    if (me.shield > 0) {
      const a = Math.min(me.shield, dmg);
      me.shield -= a; dmg -= a;
      this.flash('shield');
    }
    if (dmg > 0) {
      me.hull -= dmg;
      this.flash('hull');
      this.sfx.hit();
      this.shake = Math.max(this.shake, 0.25);
      if (me.hull / me.maxHull < 0.3 && !this.alarmed) { this.alarmed = true; this.sfx.alarm(); }
    } else this.sfx.tone(300, 0.06, 0.05, 'triangle');
    if (me.hull <= 0) this.die();
  }
  flash(kind) {
    const el = document.getElementById('hud-flash');
    el.className = ''; void el.offsetWidth;
    el.className = kind;
  }
  die() {
    const me = this.me;
    if (!me.alive) return;
    me.alive = false;
    me.hull = 0;
    this.deathPos = this.ship.position.clone();
    this.particles.explosion(this.ship.position, 1.8, [0.6, 0.8, 1.2]);
    this.sfx.explosion(2, 0);
    this.shake = 1;
    this.ship.visible = false;
    this.me.respawnAt = 0;
    this.net.send({ t: 'dead' });
    this.projs.forEach((p, id) => { if (p.mine && p.kind === 'missile') this.dropProj(id, p); });
    this.sfx.engineVolume(0);
  }
  respawn(pos) {
    const me = this.me;
    me.alive = true;
    me.hull = me.maxHull; me.shield = me.maxShield; me.boostEnergy = 100;
    me.speed = this.def.speed * 0.7; me.throttle = 0.65;
    me.secAmmo = me.secMax;
    me.angVel.set(0, 0, 0);
    this.alarmed = false;
    this.placeAtSpawn(pos);
    this.ship.visible = true;
    this.hud.deadScreen(false);
    this.sfx.engineVolume(0.12);
    this.hud.banner('BACK IN THE FIGHT', `${this.reserves} reserve ship${this.reserves === 1 ? '' : 's'} left`);
  }

  fly(dt, c) {
    const me = this.me, S = this.def;
    const ship = this.ship;
    const fwd = _v.set(0, 0, -1).applyQuaternion(ship.quaternion);
    const right = _v2.set(1, 0, 0).applyQuaternion(ship.quaternion);
    // auto-level assist when not rolling
    let roll = c.roll * S.roll;
    if (Math.abs(c.roll) < 0.1) {
      const up = _v3.set(0, 1, 0).applyQuaternion(ship.quaternion);
      const lvl = this.mission.env === 'planet' ? 1.6 : 0.8;
      if (up.y > -0.2 && Math.abs(fwd.y) < 0.85) roll += -right.y * lvl;
    }
    const k = 1 - Math.exp(-dt * 7);
    me.angVel.x += (c.pitch * S.pitch - me.angVel.x) * k;
    me.angVel.y += (c.yaw * S.yaw - me.angVel.y) * k;
    me.angVel.z += (roll - me.angVel.z) * k;
    _e.set(me.angVel.x * dt, me.angVel.y * dt, me.angVel.z * dt, 'YXZ');
    _q.setFromEuler(_e);
    ship.quaternion.multiply(_q).normalize();

    // throttle / boost
    me.throttle = Math.max(0, Math.min(1, me.throttle + c.throttle * 0.9 * dt));
    if (c.boost && me.boostEnergy > (me.boosting ? 0 : 15)) me.boosting = true;
    if (!c.boost || me.boostEnergy <= 0) me.boosting = false;
    me.boostEnergy = Math.max(0, Math.min(100, me.boostEnergy + (me.boosting ? -28 : 14) * dt));
    const target = me.boosting ? S.boostSpeed : S.minSpeed + (S.speed - S.minSpeed) * me.throttle;
    const diff = target - me.speed;
    me.speed += Math.max(-S.accel * 1.5 * dt, Math.min(S.accel * (me.boosting ? 2.2 : 1) * dt, diff));

    // keep in arena
    fwd.set(0, 0, -1).applyQuaternion(ship.quaternion);
    this.outOfBounds = this.env.arena(ship.position);
    if (this.outOfBounds) {
      const center = this.mission.env === 'planet' ? _v3.set(0, 300, 0) : _v3.set(0, 0, 0);
      const want = center.sub(ship.position).normalize();
      const ang = fwd.angleTo(want);
      if (ang > 0.01) {
        _q.setFromUnitVectors(fwd, want);
        _q2.identity().slerp(_q, Math.min(1, 1.2 * dt / ang));
        ship.quaternion.premultiply(_q2);
      }
    }

    fwd.set(0, 0, -1).applyQuaternion(ship.quaternion);
    ship.position.addScaledVector(fwd, me.speed * dt);
    this.vel = fwd.clone().multiplyScalar(me.speed);

    // collisions
    const col = this.env.collide(ship.position);
    if (col) {
      ship.position.addScaledVector(col.normal, col.push + 0.5);
      if (this.time - me.lastCrash > 0.6) {
        me.lastCrash = this.time;
        const impact = Math.max(0, -fwd.dot(col.normal));
        this.takeDamage(8 + me.speed * 0.25 * (0.3 + impact));
        this.shake = Math.max(this.shake, 0.7);
        this.particles.sparks(ship.position, [1, 0.7, 0.4], 25, 80);
        this.sfx.explosion(0.5, 0);
      }
      // deflect heading off the surface
      const dn = fwd.dot(col.normal);
      if (dn < 0.25) {
        const nf = fwd.clone().addScaledVector(col.normal, -dn + 0.35).normalize();
        const up = _v3.set(0, 1, 0).applyQuaternion(ship.quaternion);
        _m.lookAt(ZERO, nf, up);
        ship.quaternion.setFromRotationMatrix(_m);
      }
      me.speed *= 0.85;
    }
    // ground proximity warning
    this.groundWarn = false;
    if (this.env.groundHeight) {
      const ahead = _v3.copy(ship.position).addScaledVector(fwd, me.speed * 1.2);
      this.groundWarn = ahead.y < this.env.groundHeight(ahead.x, ahead.z) + 10 && fwd.y < -0.1;
    }

    // visual bank on yaw
    this.model.rotation.z += ((me.angVel.y * 0.45) - this.model.rotation.z) * (1 - Math.exp(-dt * 5));
    this.model.rotation.x += ((-me.angVel.x * 0.06) - this.model.rotation.x) * (1 - Math.exp(-dt * 5));

    // shields
    if (this.time - me.lastDamage > 3) me.shield = Math.min(me.maxShield, me.shield + S.shieldRegen * dt);
    if (me.hull / me.maxHull >= 0.3) this.alarmed = false;
  }

  weapons(dt, c) {
    const me = this.me, S = this.def, ship = this.ship;
    me.laserCool -= dt;
    me.secCool -= dt;
    if (me.secAmmo < me.secMax) {
      me.secTimer += dt;
      if (me.secTimer >= S.secRegen) { me.secTimer = 0; me.secAmmo++; }
    } else me.secTimer = 0;
    if (this.missionTime < 0) return;
    const fwd = _v.set(0, 0, -1).applyQuaternion(ship.quaternion).clone();
    const list = [];
    if (c.fire && me.laserCool <= 0) {
      me.laserCool = S.laserRate;
      let guns;
      if (S.gunMode === 'alternate') guns = [S.guns[me.gunIdx++ % S.guns.length]];
      else if (S.gunMode === 'pairs') { const k = (me.gunIdx++ % 2) * 2; guns = [S.guns[k], S.guns[k + 1]]; }
      else guns = S.guns;
      // aim assist: converge on the lead point when it's close to the crosshair
      let conv = ship.position.clone().addScaledVector(fwd, 400);
      const t = this.entities.get(this.targetId);
      if (t) {
        const lead = this.leadPoint(t);
        if (lead) {
          const dir = lead.clone().sub(ship.position);
          if (dir.length() < 1200 && dir.normalize().dot(fwd) > Math.cos(0.07)) conv = lead;
        }
      }
      for (const g of guns) {
        const gp = new THREE.Vector3(...g).applyMatrix4(ship.matrixWorld);
        const dir = conv.clone().sub(gp).normalize();
        const vel = dir.multiplyScalar(S.laserSpeed + me.speed);
        const id = String(this.shotN++);
        this.addProj({ id: `${this.myId}:${id}`, kind: 'laser', team: 'a', pos: gp, vel, color: new THREE.Color(this.color).multiplyScalar(2.6), mine: true });
        list.push({ id, k: 'laser', o: r1v(gp), v: r1v(vel) });
      }
      this.sfx.laser(0.13, this.shipType === 'hammer' ? 0.7 : this.shipType === 'warden' ? 0.85 : 1);
    }
    if (c.fire2 && me.secCool <= 0 && me.secAmmo > 0) {
      const kind = S.secondary;
      me.secAmmo--;
      me.secCool = kind === 'flak' ? 0.7 : 0.45;
      const base = ship.position.clone().addScaledVector(fwd, 4).add(new THREE.Vector3(0, -1.2, 0).applyQuaternion(ship.quaternion));
      if (kind === 'missile') {
        const locked = this.targetId && this.lockT >= this.lockTime;
        const vel = fwd.clone().multiplyScalar(WEAPONS.missile.speed + me.speed * 0.3);
        const id = String(this.shotN++);
        this.addProj({ id: `${this.myId}:${id}`, kind, team: 'a', pos: base, vel, mine: true, target: locked ? this.targetId : null });
        list.push({ id, k: kind, o: r1v(base), v: r1v(vel), tg: locked ? this.targetId : 0 });
        this.sfx.missile();
      } else if (kind === 'flak') {
        for (let i = 0; i < WEAPONS.flak.pellets; i++) {
          const d = fwd.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2).multiplyScalar(WEAPONS.flak.spread)).normalize();
          const vel = d.multiplyScalar(WEAPONS.flak.speed + me.speed);
          const id = String(this.shotN++);
          this.addProj({ id: `${this.myId}:${id}`, kind, team: 'a', pos: base.clone(), vel, color: new THREE.Color(3, 2.2, 0.8), mine: true });
          list.push({ id, k: kind, o: r1v(base), v: r1v(vel) });
        }
        this.sfx.flak();
        this.shake = Math.max(this.shake, 0.15);
      } else if (kind === 'bomb') {
        const vel = fwd.clone().multiplyScalar(WEAPONS.bomb.speed + me.speed * 0.6);
        const id = String(this.shotN++);
        this.addProj({ id: `${this.myId}:${id}`, kind, team: 'a', pos: base, vel, mine: true });
        list.push({ id, k: kind, o: r1v(base), v: r1v(vel) });
        this.sfx.bomb();
      }
    }
    if (list.length) this.net.send({ t: 'fire', list });
  }

  // ---------------- targeting ----------------
  entityVel(e) {
    const b = e.buf;
    if (b.length < 2) return ZERO;
    const a = b[b.length - 2], c = b[b.length - 1];
    const dt = (c.t - a.t) / 1000;
    if (dt <= 0) return ZERO;
    return e.vel.subVectors(c.p, a.p).divideScalar(dt);
  }
  leadPoint(e) {
    const dist = e.mesh.position.distanceTo(this.ship.position);
    const t = dist / (this.def.laserSpeed + this.me.speed);
    return e.mesh.position.clone().addScaledVector(this.entityVel(e), t);
  }
  pickTarget(mode) {
    const fwd = _v.set(0, 0, -1).applyQuaternion(this.ship.quaternion).clone();
    let best = null, bs = Infinity;
    const cands = [...this.entities.values()].filter((e) => e.team === 'enemy');
    for (const e of cands) {
      const d = _v2.subVectors(e.mesh.position, this.ship.position);
      const dist = d.length();
      const ang = fwd.angleTo(d.normalize());
      const s = mode === 'near' ? dist : ang * 1000 + dist * 0.05;
      if (mode === 'cycle' && e.id === this.targetId) continue;
      if (s < bs) { bs = s; best = e; }
    }
    if (best) { this.targetId = best.id; this.lockT = 0; this.sfx.ui(); }
  }
  updateTargeting(dt) {
    if (this.input.wasPressed('KeyT')) this.pickTarget('crosshair');
    if (this.input.wasPressed('KeyR')) this.pickTarget('near');
    this.autoT = (this.autoT || 0) - dt;
    if (!this.targetId && this.autoT <= 0) {
      this.autoT = 0.3;
      const fwd = _v.set(0, 0, -1).applyQuaternion(this.ship.quaternion).clone();
      let best = null, ba = 0.3;
      for (const e of this.entities.values()) {
        if (e.team !== 'enemy') continue;
        const d = _v2.subVectors(e.mesh.position, this.ship.position);
        if (d.length() > 1600) continue;
        const a = fwd.angleTo(d.normalize());
        if (a < ba) { ba = a; best = e; }
      }
      if (best) this.targetId = best.id;
    }
    const t = this.entities.get(this.targetId);
    if (t && this.me.secondary === 'missile' && this.me.alive) {
      const fwd = _v.set(0, 0, -1).applyQuaternion(this.ship.quaternion).clone();
      const d = _v2.subVectors(t.mesh.position, this.ship.position);
      const inCone = d.length() < 1500 && fwd.angleTo(d.normalize()) < 0.4;
      const before = this.lockT;
      this.lockT = inCone ? this.lockT + dt : Math.max(0, this.lockT - dt * 2);
      if (inCone && before < this.lockTime && this.lockT >= this.lockTime) this.sfx.locked();
      else if (inCone && this.lockT < this.lockTime && Math.floor(this.lockT * 8) !== Math.floor(before * 8)) this.sfx.lockTick();
    } else this.lockT = 0;
  }

  // ---------------- interpolation ----------------
  interp(obj, renderT) {
    const b = obj.buf;
    if (!b.length) return false;
    if (b.length === 1 || renderT <= b[0].t) { obj.mesh.position.copy(b[0].p); obj.mesh.quaternion.copy(b[0].q); return true; }
    for (let i = b.length - 1; i > 0; i--) {
      const a = b[i - 1], c = b[i];
      if (renderT >= a.t) {
        const k = Math.min(1.5, (renderT - a.t) / Math.max(1, c.t - a.t));
        obj.mesh.position.lerpVectors(a.p, c.p, k);
        obj.mesh.quaternion.slerpQuaternions(a.q, c.q, Math.min(1, k));
        return true;
      }
    }
    return true;
  }

  // ---------------- camera ----------------
  updateCamera(dt) {
    const cam = this.camera;
    if (this.me.alive) {
      const far = this.camMode === 1;
      const sc = this.shipType === 'hammer' ? 1.25 : this.shipType === 'warden' ? 1.2 : 1;
      const off = new THREE.Vector3(0, (far ? 7 : 4.2) * sc, (far ? 30 : 16) * sc).applyQuaternion(this.ship.quaternion);
      const desired = this.ship.position.clone().add(off);
      cam.position.lerp(desired, 1 - Math.exp(-dt * 14));
      cam.quaternion.slerp(this.ship.quaternion, 1 - Math.exp(-dt * 9));
      const fov = VISUALS.fov + (this.me.boosting ? VISUALS.boostFov : 0) + (this.me.speed / this.def.boostSpeed) * 4;
      cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 4));
      cam.updateProjectionMatrix();
    } else {
      // spectate: follow a living teammate, otherwise orbit the wreck
      const mate = [...this.remotes.values()].find((r) => r.alive && r.mesh.visible);
      if (mate && this.time - (this.deathTime || 0) > 2) {
        const off = new THREE.Vector3(0, 8, 35).applyQuaternion(mate.mesh.quaternion);
        cam.position.lerp(mate.mesh.position.clone().add(off), 1 - Math.exp(-dt * 4));
        _m.lookAt(cam.position, mate.mesh.position, UP);
        _q.setFromRotationMatrix(_m);
        cam.quaternion.slerp(_q, 1 - Math.exp(-dt * 5));
      } else if (this.deathPos) {
        const a = this.time * 0.3;
        cam.position.lerp(this.deathPos.clone().add(new THREE.Vector3(Math.cos(a) * 80, 30, Math.sin(a) * 80)), 1 - Math.exp(-dt * 2));
        _m.lookAt(cam.position, this.deathPos, UP);
        _q.setFromRotationMatrix(_m);
        cam.quaternion.slerp(_q, 1 - Math.exp(-dt * 4));
      }
    }
    if (this.shake > 0) {
      const s = this.shake * 1.2 * VISUALS.shake;
      cam.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
      this.shake = Math.max(0, this.shake - dt * 1.8);
    }
  }

  // ---------------- main loop ----------------
  loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.missionTime += dt;
    const c = this.input.poll(dt);
    if (this.input.wasPressed('KeyC')) this.camMode = (this.camMode + 1) % 2;

    if (this.me.alive) {
      this.fly(dt, c);
      this.weapons(dt, c);
      this.sfx.setEngine(this.me.speed / this.def.boostSpeed, this.me.boosting);
    } else {
      if (!this.deathTime || this.deathTime < this.time - 1000) this.deathTime = this.deathTime || this.time;
      const left = this.me.respawnAt > 0 ? Math.max(0, Math.ceil(this.me.respawnAt - this.time)) : null;
      this.hud.deadScreen(true, left == null ? (this.me.respawnAt < 0 ? '<b>SHOT DOWN</b><br>No reserve ships left — spectating your wing' : '<b>SHOT DOWN</b><br>Waiting for respawn…') : `<b>SHOT DOWN</b><br>Reserve ship launching in ${left}…`);
    }
    if (this.me.alive) this.deathTime = 0;
    this.updateTargeting(dt);

    // send state
    this.sendT -= dt;
    if (this.sendT <= 0 && this.me.alive) {
      this.sendT = 0.05;
      const p = this.ship.position, q = this.ship.quaternion, v = this.vel || ZERO;
      this.net.send({ t: 'st', s: [r1(p.x), r1(p.y), r1(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w), r1(v.x), r1(v.y), r1(v.z), Math.round(this.me.hull / this.me.maxHull * 100), this.me.boosting ? 1 : 0] });
    }

    // remote interpolation
    const renderT = performance.now() - INTERP_DELAY;
    for (const e of this.entities.values()) {
      this.interp(e, renderT);
      const ud = e.mesh.userData;
      if (ud.spin) ud.spin.rotation.z += dt * (e.type === 'tower' ? 0.3 : 1.2);
      if (ud.shield) ud.shield.visible = e.invuln;
      if (ud.beacon) ud.beacon.visible = Math.floor(this.time * 2) % 2 === 0;
      if (e.hp < 40 && Math.random() < 0.3 && ['gunship', 'freighter', 'generator', 'tower'].includes(e.type)) {
        const p = e.mesh.position;
        this.particles.emit(p.x + (Math.random() - 0.5) * e.radius, p.y + e.radius * 0.5, p.z + (Math.random() - 0.5) * e.radius, 0, 10, 0, 2, 8, 0.15, 0.12, 0.1, 10, 0.5);
        if (Math.random() < 0.3) this.particles.emit(p.x, p.y + e.radius * 0.3, p.z, 0, 8, 0, 0.6, 5, 2, 0.8, 0.2, 6, 0.5);
      }
      for (const eg of ud.engines || []) eg.scale.setScalar(eg.userData.baseSize * (0.9 + Math.random() * 0.2));
    }
    for (const r of this.remotes.values()) {
      if (!r.alive) { r.mesh.visible = false; continue; }
      r.mesh.visible = this.interp(r, renderT);
      const rex = r.mesh.userData.exhausts;
      if (rex) for (const ex of rex) ex.userData.setThrust(r.boost ? 1 : 0.2, dt, this.time);
      for (const eg of r.mesh.userData.engines) eg.scale.setScalar(eg.userData.baseSize * (rex ? 1 : (r.boost ? 1.8 : 1)) * (0.9 + Math.random() * 0.2));
    }
    // my engines
    const exh = this.model.userData.exhausts;
    const thrust = this.me.alive ? (this.me.boosting ? 1 : Math.max(0, (this.me.speed - this.def.minSpeed) / (this.def.speed - this.def.minSpeed)) * 0.25) : 0;
    if (exh) for (const ex of exh) ex.userData.setThrust(thrust, dt, this.time);
    for (const eg of this.model.userData.engines) eg.scale.setScalar(eg.userData.baseSize * (exh ? 1 : (0.35 + this.me.speed / this.def.speed * 0.3 + (this.me.boosting ? 0.45 : 0))) * (0.92 + Math.random() * 0.16));
    if (this.me.alive) {
      if (this.me.hull / this.me.maxHull < 0.4 && Math.random() < 0.5) {
        const p = this.ship.position;
        this.particles.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 5, 4, (Math.random() - 0.5) * 5, 1.4, 3, 0.15, 0.13, 0.12, 6, 0.5);
      }
    }

    this.updateProjectiles(dt);
    this.particles.update(dt);
    this.bolts.render(this.projs.values());
    this.env.update(this.time);
    this.updateCamera(dt);
    this.hitMarker = Math.max(0, (this.hitMarker || 0) - dt);
    this.hud.draw(this);
    if (this.hitMarker > 0) this.drawHitMarker();
    if (this.missionTime < 0) this.hud.centerText(`LAUNCH IN ${Math.ceil(-this.missionTime)}`, '#bfe8ff', this.hud.h * 0.4);
    this.composer.render();
    this.input.endFrame();
  }

  drawHitMarker() {
    const ctx = this.hud.ctx;
    const fwd = _v.set(0, 0, -1).applyQuaternion(this.ship.quaternion);
    const p = this.hud.project(this.ship.position.clone().addScaledVector(fwd, 400), this.camera);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(p.x + sx * 6, p.y + sy * 6); ctx.lineTo(p.x + sx * 12, p.y + sy * 12); }
    ctx.stroke();
  }

  // Called when an admin saves new tuning while this mission is running.
  applyLooks() {
    this.bloom.strength = VISUALS.bloomStrength;
    this.bloom.threshold = VISUALS.bloomThreshold;
    this.renderer.toneMappingExposure = VISUALS.exposure;
  }

  dispose() {
    this.renderer.toneMappingExposure = 1;
    this.running = false;
    window.removeEventListener('resize', this.onResize);
    this.sfx.stopEngine();
    this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.composer.dispose && this.composer.dispose();
    this.hud.show(false);
  }
}

function r1(x) { return Math.round(x * 10) / 10; }
function r3(x) { return Math.round(x * 1000) / 1000; }
function r1v(v) { return [r1(v.x), r1(v.y), r1(v.z)]; }
