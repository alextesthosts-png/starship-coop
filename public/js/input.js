// Keyboard + mouse (virtual-joystick style) + gamepad input.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.stick = { x: 0, y: 0 };
    this.mouseDown = [false, false, false];
    this.locked = false;
    this.pressed = new Set(); // one-shot presses this frame
    this.settings = { sens: 1, invert: false, recenter: true };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem('vw_input') || '{}')); } catch {}
    this.enabled = false;
    this.pad = null;

    this._kd = (e) => {
      if (!this.enabled) return;
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    };
    this._ku = (e) => this.keys.delete(e.code);
    this._mm = (e) => {
      if (!this.locked) return;
      const k = 0.0028 * this.settings.sens;
      this.stick.x += e.movementX * k;
      this.stick.y += e.movementY * k * (this.settings.invert ? -1 : 1);
      const l = Math.hypot(this.stick.x, this.stick.y);
      if (l > 1) { this.stick.x /= l; this.stick.y /= l; }
    };
    this._md = (e) => { if (this.locked) { this.mouseDown[e.button] = true; e.preventDefault(); } };
    this._mu = (e) => { this.mouseDown[e.button] = false; };
    this._plc = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.mouseDown = [false, false, false]; this.onUnlock && this.onUnlock(); }
    };
    this._ctx = (e) => e.preventDefault();
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    window.addEventListener('mousemove', this._mm);
    window.addEventListener('mousedown', this._md);
    window.addEventListener('mouseup', this._mu);
    document.addEventListener('pointerlockchange', this._plc);
    canvas.addEventListener('contextmenu', this._ctx);
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseDown = [false, false, false]; });
  }
  saveSettings() { try { localStorage.setItem('vw_input', JSON.stringify(this.settings)); } catch {} }
  lock() {
    try {
      const r = this.canvas.requestPointerLock({ unadjustedMovement: false });
      if (r && r.catch) r.catch(() => {});
    } catch {}
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  wasPressed(code) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); }
  key(c) { return this.keys.has(c); }

  // Returns normalized control state
  poll(dt) {
    const s = { pitch: 0, yaw: 0, roll: 0, throttle: 0, boost: false, fire: false, fire2: false, padActive: false };
    // virtual stick with gentle recentering
    const dz = 0.04;
    const sx = Math.abs(this.stick.x) < dz ? 0 : this.stick.x;
    const sy = Math.abs(this.stick.y) < dz ? 0 : this.stick.y;
    s.yaw = -sx; s.pitch = -sy;
    if (this.settings.recenter) {
      const k = Math.exp(-dt * 0.9);
      this.stick.x *= k; this.stick.y *= k;
    }
    // keyboard
    if (this.key('KeyA') || this.key('KeyQ')) s.roll += 1;
    if (this.key('KeyD') || this.key('KeyE')) s.roll -= 1;
    if (this.key('ArrowLeft')) s.yaw += 1;
    if (this.key('ArrowRight')) s.yaw -= 1;
    if (this.key('ArrowUp')) s.pitch -= this.settings.invert ? -1 : 1;
    if (this.key('ArrowDown')) s.pitch += this.settings.invert ? -1 : 1;
    if (this.key('KeyW')) s.throttle += 1;
    if (this.key('KeyS')) s.throttle -= 1;
    s.boost = this.key('ShiftLeft') || this.key('ShiftRight');
    s.fire = this.mouseDown[0] || this.key('Space');
    s.fire2 = this.mouseDown[2] || this.key('KeyF');

    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = (i) => { const v = p.axes[i] || 0; return Math.abs(v) < 0.15 ? 0 : v; };
      const bt = (i) => p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.3);
      const lx = ax(0), ly = ax(1), rx = ax(2), ry = ax(3);
      if (lx || ly || rx || ry || p.buttons.some((b) => b.pressed)) s.padActive = true;
      s.yaw += -lx;
      s.pitch += (this.settings.invert ? 1 : -1) * ly;
      s.roll += -rx;
      s.throttle += -ry;
      if (bt(7)) s.fire = true;
      if (bt(6) || bt(5)) s.fire2 = true;
      if (bt(0)) s.boost = true;
      // one-shot buttons
      const prev = this.pad || [];
      const now = p.buttons.map((b) => b.pressed);
      if (now[3] && !prev[3]) this.pressed.add('KeyT');
      if (now[2] && !prev[2]) this.pressed.add('KeyR');
      if (now[9] && !prev[9]) this.pressed.add('Escape');
      if (now[1] && !prev[1]) this.pressed.add('KeyC');
      this.pad = now;
      break;
    }
    s.pitch = Math.max(-1, Math.min(1, s.pitch));
    s.yaw = Math.max(-1, Math.min(1, s.yaw));
    s.roll = Math.max(-1, Math.min(1, s.roll));
    return s;
  }
  dispose() {
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
    window.removeEventListener('mousemove', this._mm);
    window.removeEventListener('mousedown', this._md);
    window.removeEventListener('mouseup', this._mu);
    document.removeEventListener('pointerlockchange', this._plc);
  }
}
