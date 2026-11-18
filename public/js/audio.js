// Synthesized sound effects (WebAudio) - no external assets.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.vol = 0.6;
    this.muted = false;
    try { const v = localStorage.getItem('vw_vol'); if (v != null) this.vol = +v; } catch {}
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.vol;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    // shared noise buffer
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  setVolume(v) {
    this.vol = v;
    try { localStorage.setItem('vw_vol', v); } catch {}
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }
  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : this.vol; return this.muted; }
  get ok() { return this.ctx && this.ctx.state === 'running'; }

  env(g, t, a, peak, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
  }
  laser(gain = 0.18, pitch = 1) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1400 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(180 * pitch, t + 0.13);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 3500;
    this.env(g, t, 0.005, gain, 0.14);
    o.connect(f).connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.2);
  }
  noiseBurst(gain, dur, f0, f1, type = 'lowpass', q = 0.7) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.7 + Math.random() * 0.3;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, 0.01, gain, dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.1);
  }
  explosion(size = 1, dist = 0) {
    const att = 1 / (1 + dist / 400);
    if (att < 0.03) return;
    this.noiseBurst(Math.min(1, 0.5 * size) * att, 0.6 + size * 0.5, 1800, 60);
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.6);
    this.env(g, t, 0.01, 0.5 * att * Math.min(1.5, size), 0.6);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.8);
  }
  missile() { this.noiseBurst(0.25, 0.7, 600, 3000, 'bandpass', 2); }
  bomb() { this.noiseBurst(0.3, 0.5, 300, 900, 'bandpass', 1.5); this.tone(90, 0.3, 0.3, 'square'); }
  flak() { this.noiseBurst(0.35, 0.25, 4000, 400); }
  hit() { this.noiseBurst(0.35, 0.18, 3000, 300, 'highpass'); this.tone(160, 0.12, 0.25, 'square'); }
  deflect() { this.tone(1800, 0.08, 0.06, 'triangle'); }
  tone(freq, dur, gain = 0.1, type = 'sine', when = 0) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    this.env(g, t, 0.005, gain, dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  lockTick() { this.tone(1200, 0.05, 0.05, 'square'); }
  locked() { this.tone(1600, 0.07, 0.07, 'square'); this.tone(1600, 0.07, 0.07, 'square', 0.1); }
  alarm() { this.tone(520, 0.15, 0.08, 'square'); this.tone(390, 0.15, 0.08, 'square', 0.17); }
  ui() { this.tone(880, 0.06, 0.06, 'triangle'); }
  objective() { [660, 880, 1100].forEach((f, i) => this.tone(f, 0.18, 0.08, 'triangle', i * 0.09)); }
  fanfare(win) {
    const seq = win ? [523, 659, 784, 1046] : [392, 349, 311, 262];
    seq.forEach((f, i) => this.tone(f, 0.35, 0.1, 'triangle', i * 0.18));
  }
  startEngine() {
    if (!this.ctx || this.engine) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300; f.Q.value = 3;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55;
    const of = this.ctx.createBiquadFilter(); of.type = 'lowpass'; of.frequency.value = 200;
    const og = this.ctx.createGain(); og.gain.value = 0.04;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 1);
    s.connect(f).connect(g);
    o.connect(of).connect(og).connect(g);
    g.connect(this.master);
    s.start(); o.start();
    this.engine = { s, f, o, g };
  }
  setEngine(frac, boost) {
    if (!this.engine) return;
    const t = this.ctx.currentTime;
    this.engine.f.frequency.setTargetAtTime(200 + frac * 500 + (boost ? 900 : 0), t, 0.15);
    this.engine.o.frequency.setTargetAtTime(45 + frac * 40 + (boost ? 30 : 0), t, 0.15);
  }
  engineVolume(v) { if (this.engine) this.engine.g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2); }
  stopEngine() {
    if (!this.engine) return;
    try { this.engine.s.stop(); this.engine.o.stop(); } catch {}
    this.engine.g.disconnect();
    this.engine = null;
  }
}
