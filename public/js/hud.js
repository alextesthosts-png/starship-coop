// HUD: 2D canvas overlay (reticle, brackets, markers, radar) + DOM panels.
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();
const _inv = new THREE.Matrix4();

const TYPE_LABEL = {
  raider: 'RAIDER', bomber: 'BOMBER', gunship: 'GUNSHIP', freighter: 'FREIGHTER', turret: 'TURRET',
  generator: 'SHIELD GEN', core: 'REACTOR CORE', tower: 'RELAY TOWER', wing: 'WINGMATE',
};

export class Hud {
  constructor() {
    this.canvas = $('hud-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.radar = $('radar');
    this.rctx = this.radar.getContext('2d');
    this.msgs = [];
    this.feed = [];
    this.bannerT = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.canvas.width = this.w * dpr; this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.radar.width = 180 * dpr; this.radar.height = 180 * dpr;
    this.rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  show(on) { $('hud').classList.toggle('hidden', !on); }
  reset() {
    $('hud-msgs').innerHTML = '';
    $('hud-feed').innerHTML = '';
    $('hud-banner').classList.remove('show');
    $('hud-dead').classList.add('hidden');
    this.msgs = [];
  }

  project(pos, camera) {
    _v.copy(pos).project(camera);
    const behind = _v.z > 1;
    let x = (_v.x * 0.5 + 0.5) * this.w, y = (-_v.y * 0.5 + 0.5) * this.h;
    if (behind) { x = this.w - x; y = this.h - y; }
    const on = !behind && x > 0 && x < this.w && y > 0 && y < this.h;
    return { x, y, on, behind };
  }

  edge(p) {
    // clamp to screen edge for off-screen indicator
    const cx = this.w / 2, cy = this.h / 2;
    let dx = p.x - cx, dy = p.y - cy;
    if (p.behind && Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = 1;
    const m = 60;
    const sx = (cx - m) / Math.abs(dx || 1e-6), sy = (cy - m) / Math.abs(dy || 1e-6);
    const s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s, ang: Math.atan2(dy, dx) };
  }

  message(from, text, color = '#9fd8ff') {
    const el = document.createElement('div');
    el.className = 'msg';
    el.innerHTML = `${from ? `<b style="color:${color}">${esc(from)}:</b> ` : ''}${esc(text)}`;
    const box = $('hud-msgs');
    box.appendChild(el);
    while (box.children.length > 5) box.removeChild(box.firstChild);
    setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 800); }, 9000);
  }
  killFeed(text, color = '#fff') {
    const el = document.createElement('div');
    el.className = 'feed';
    el.innerHTML = text;
    el.style.color = color;
    const box = $('hud-feed');
    box.prepend(el);
    while (box.children.length > 5) box.removeChild(box.lastChild);
    setTimeout(() => el.remove(), 4000);
  }
  banner(text, sub = '') {
    const b = $('hud-banner');
    b.innerHTML = `<div class="b1">${esc(text)}</div>${sub ? `<div class="b2">${esc(sub)}</div>` : ''}`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }
  objectives(list) {
    $('hud-obj').innerHTML = list.map((o) => {
      const icon = o.status === 'done' ? '✔' : o.status === 'failed' ? '✖' : o.bonus ? '◇' : '▸';
      return `<div class="obj ${o.status} ${o.bonus ? 'bonus' : ''} ${o.locked ? 'locked' : ''}"><span class="i">${icon}</span>${esc(o.text)}${o.progress ? ` <span class="p">${esc(o.progress)}</span>` : ''}</div>`;
    }).join('');
  }
  deadScreen(show, text = '') {
    $('hud-dead').classList.toggle('hidden', !show);
    $('hud-dead').innerHTML = text;
  }
  popup(text) {
    const el = document.createElement('div');
    el.className = 'popup';
    el.textContent = text;
    $('hud').appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  // ---- per-frame ----
  draw(g) {
    const ctx = this.ctx;
    const { camera, ship, me } = g;
    ctx.clearRect(0, 0, this.w, this.h);
    const cyan = 'rgba(120,220,255,0.9)';

    // stats panel
    const sh = me.shield / me.maxShield, hu = me.hull / me.maxHull;
    $('bar-shield').style.width = `${Math.max(0, sh) * 100}%`;
    $('bar-hull').style.width = `${Math.max(0, hu) * 100}%`;
    $('bar-hull').classList.toggle('crit', hu < 0.3);
    $('bar-boost').style.width = `${me.boostEnergy}%`;
    $('bar-throttle').style.height = `${me.throttle * 100}%`;
    $('spd').textContent = Math.round(me.speed);
    $('sec-name').textContent = { missile: 'SEEKERS', flak: 'FLAK', bomb: 'PLASMA BOMBS' }[me.secondary];
    $('sec-ammo').innerHTML = Array.from({ length: me.secMax }, (_, i) => `<i class="${i < me.secAmmo ? 'on' : ''}"></i>`).join('');
    const tsec = Math.max(0, Math.floor(g.missionTime));
    $('hud-time').textContent = `${Math.floor(tsec / 60)}:${String(tsec % 60).padStart(2, '0')}`;
    $('hud-score').textContent = me.score;
    $('hud-kills').textContent = me.kills || 0;
    $('hud-res').textContent = g.reserves;

    if (!me.alive) { this.drawRadar(g); return; }

    // reticle at aim convergence point
    const fwd = _v.set(0, 0, -1).applyQuaternion(ship.quaternion);
    const aimP = ship.position.clone().addScaledVector(fwd, 400);
    const ap = this.project(aimP, camera);
    if (ap.on) {
      ctx.strokeStyle = cyan; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(ap.x, ap.y, 14, 0, Math.PI * 2); ctx.stroke();
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        ctx.beginPath(); ctx.moveTo(ap.x + Math.cos(a) * 18, ap.y + Math.sin(a) * 18); ctx.lineTo(ap.x + Math.cos(a) * 26, ap.y + Math.sin(a) * 26); ctx.stroke();
      }
      ctx.fillStyle = cyan; ctx.fillRect(ap.x - 1, ap.y - 1, 2, 2);
    }
    // virtual stick indicator
    if (g.input.locked) {
      const cx = this.w / 2, cy = this.h / 2, R = 90;
      ctx.strokeStyle = 'rgba(120,220,255,0.18)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(160,230,255,0.75)';
      ctx.beginPath(); ctx.arc(cx + g.input.stick.x * R, cy + g.input.stick.y * R, 3.5, 0, Math.PI * 2); ctx.fill();
    }

    // entity markers
    for (const e of g.entities.values()) {
      if (!e.mesh.visible) continue;
      const isTarget = g.targetId === e.id;
      const enemy = e.team === 'enemy';
      const objective = ['freighter', 'generator', 'core', 'tower', 'gunship'].includes(e.type);
      const p = this.project(e.mesh.position, camera);
      const dist = e.mesh.position.distanceTo(ship.position);
      const col = enemy ? (isTarget ? '#ff5050' : 'rgba(255,90,80,0.85)') : 'rgba(110,255,160,0.9)';
      if (p.on) {
        const sz = Math.max(8, Math.min(60, (e.radius * 900) / Math.max(dist, 1)));
        if (isTarget) {
          this.brackets(p.x, p.y, sz + 6, col, 2);
          ctx.fillStyle = col; ctx.font = '600 11px Rajdhani, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(`${TYPE_LABEL[e.type]} ${Math.round(dist)}m`, p.x, p.y - sz - 14);
          // hp bar
          ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(p.x - 22, p.y + sz + 9, 44, 4);
          ctx.fillStyle = col; ctx.fillRect(p.x - 22, p.y + sz + 9, 44 * e.hp / 100, 4);
          if (e.invuln) { ctx.fillStyle = '#7fc8ff'; ctx.fillText('SHIELDED', p.x, p.y + sz + 26); }
          // lead indicator
          const lead = g.leadPoint(e);
          if (lead) {
            const lp = this.project(lead, camera);
            if (lp.on) {
              ctx.strokeStyle = col; ctx.lineWidth = 1.5;
              ctx.beginPath(); ctx.moveTo(lp.x, lp.y - 7); ctx.lineTo(lp.x + 7, lp.y); ctx.lineTo(lp.x, lp.y + 7); ctx.lineTo(lp.x - 7, lp.y); ctx.closePath(); ctx.stroke();
            }
          }
          // missile lock
          if (me.secondary === 'missile' && g.lockT > 0) {
            const k = Math.min(1, g.lockT / g.lockTime);
            ctx.strokeStyle = k >= 1 ? '#ff3030' : '#ffcc40'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(p.x, p.y, sz + 18 - k * 8, 0, Math.PI * 2 * k); ctx.stroke();
            if (k >= 1) { ctx.fillStyle = '#ff3030'; ctx.fillText('LOCKED', p.x, p.y + sz + (e.invuln ? 40 : 28)); }
          }
        } else if (dist < 2500 || objective) {
          ctx.strokeStyle = col; ctx.lineWidth = 1;
          if (enemy) { ctx.beginPath(); ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x + 5, p.y); ctx.lineTo(p.x, p.y + 5); ctx.lineTo(p.x - 5, p.y); ctx.closePath(); ctx.stroke(); }
          else this.brackets(p.x, p.y, 10, col, 1);
          if (objective && dist < 1100) { ctx.fillStyle = col; ctx.font = '600 10px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(TYPE_LABEL[e.type], p.x, p.y - 12); }
        }
      } else if (isTarget || (objective && enemy) || e.type === 'tower') {
        const ed = this.edge(p);
        this.arrow(ed.x, ed.y, ed.ang, isTarget ? '#ff4040' : col, isTarget ? 12 : 8);
      }
    }
    // teammates
    for (const r of g.remotes.values()) {
      if (!r.alive || !r.mesh.visible) continue;
      const p = this.project(r.mesh.position, camera);
      const dist = r.mesh.position.distanceTo(ship.position);
      if (p.on) {
        ctx.fillStyle = r.color; ctx.font = '700 12px Rajdhani, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`${r.name}`, p.x, p.y - 16);
        ctx.font = '500 10px Rajdhani, sans-serif'; ctx.fillText(`${Math.round(dist)}m`, p.x, p.y + 22);
        ctx.strokeStyle = r.color; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.stroke();
      } else {
        const ed = this.edge(p);
        this.arrow(ed.x, ed.y, ed.ang, r.color, 9);
      }
    }
    // warnings
    if (g.outOfBounds) this.centerText('RETURN TO THE COMBAT AREA', '#ffcc40', this.h * 0.3);
    if (me.hull / me.maxHull < 0.3 && Math.floor(performance.now() / 400) % 2) this.centerText('HULL CRITICAL', '#ff4040', this.h * 0.36);
    if (g.groundWarn) this.centerText('PULL UP', '#ff8040', this.h * 0.66);

    this.drawRadar(g);
  }
  centerText(t, c, y) {
    const ctx = this.ctx;
    ctx.fillStyle = c; ctx.font = '700 18px Rajdhani, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(t, this.w / 2, y);
  }
  brackets(x, y, s, col, lw) {
    const ctx = this.ctx, l = s * 0.45;
    ctx.strokeStyle = col; ctx.lineWidth = lw;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.moveTo(x + sx * s, y + sy * s - sy * l); ctx.lineTo(x + sx * s, y + sy * s); ctx.lineTo(x + sx * s - sx * l, y + sy * s);
    }
    ctx.stroke();
  }
  arrow(x, y, ang, col, s) {
    const ctx = this.ctx;
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(-s * 0.7, -s * 0.7); ctx.lineTo(-s * 0.3, 0); ctx.lineTo(-s * 0.7, s * 0.7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  drawRadar(g) {
    const ctx = this.rctx, R = 88, cx = 90, cy = 90;
    ctx.clearRect(0, 0, 180, 180);
    ctx.fillStyle = 'rgba(5,20,35,0.55)';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(120,220,255,0.35)'; ctx.lineWidth = 1;
    for (const r of [R, R * 0.66, R * 0.33]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
    const range = 2200;
    _inv.copy(g.ship.matrixWorld).invert();
    const plot = (pos, col, size, square = false) => {
      _v.copy(pos).applyMatrix4(_inv);
      let x = _v.x / range, y = _v.z / range;
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; size *= 0.7; }
      ctx.fillStyle = col;
      const px = cx + x * R, py = cy + y * R;
      if (square) ctx.fillRect(px - size, py - size, size * 2, size * 2);
      else { ctx.beginPath(); ctx.arc(px, py, size, 0, Math.PI * 2); ctx.fill(); }
      // altitude tick
      if (Math.abs(_v.y) > 60 && l <= 1) { ctx.fillRect(px - 0.5, py, 1, Math.max(-8, Math.min(8, -_v.y / 60))); }
    };
    for (const e of g.entities.values()) {
      const big = ['freighter', 'generator', 'core', 'tower', 'gunship'].includes(e.type);
      plot(e.mesh.position, e.id === g.targetId ? '#ffffff' : e.team === 'enemy' ? '#ff5a4a' : '#6cff9a', big ? 3.5 : 2, big);
    }
    for (const r of g.remotes.values()) if (r.alive) plot(r.mesh.position, r.color, 3);
    ctx.fillStyle = '#cfefff';
    ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx + 4, cy + 4); ctx.lineTo(cx - 4, cy + 4); ctx.closePath(); ctx.fill();
  }
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
