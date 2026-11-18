// Particles, bolts and other visual effects.
import * as THREE from 'three';
import { glowTexture } from './models.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();

export class Particles {
  constructor(scene, max = 5000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      uniforms: { map: { value: glowTexture() }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float scale;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.a * vA, 1.0); }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  setScale(h) { this.points.material.uniforms.scale.value = h * 0.9; }
  emit(x, y, z, vx, vy, vz, life, size, r, g, b, grow = 0, drag = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.grow[i] = grow; this.drag[i] = drag;
  }
  explosion(p, scale = 1, color = [1, 0.55, 0.2]) {
    const n = Math.floor(40 * Math.min(4, scale));
    for (let i = 0; i < n; i++) {
      _v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar((20 + Math.random() * 60) * scale);
      const hot = Math.random();
      this.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, 0.5 + Math.random() * 0.9, (4 + Math.random() * 6) * scale,
        color[0] * (1.5 + hot), color[1] * (1.2 + hot), color[2] * (1 + hot * 0.5), 6 * scale, 2.2);
    }
    // sparks
    for (let i = 0; i < n; i++) {
      _v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar((80 + Math.random() * 160) * scale);
      this.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, 0.4 + Math.random() * 0.6, 1.2 * Math.sqrt(scale), 3, 2.2, 1.2, 0, 1.2);
    }
    // smoke
    for (let i = 0; i < n / 3; i++) {
      _v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).multiplyScalar(25 * scale);
      this.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, 1.5 + Math.random(), 6 * scale, 0.12, 0.1, 0.09, 8 * scale, 1);
    }
    // flash
    this.emit(p.x, p.y, p.z, 0, 0, 0, 0.25, 30 * scale, 3, 2.4, 1.6, 40 * scale, 0);
  }
  sparks(p, color = [1, 0.8, 0.4], n = 10, speed = 60) {
    for (let i = 0; i < n; i++) {
      _v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      this.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, 0.25 + Math.random() * 0.3, 1.2, color[0] * 2, color[1] * 2, color[2] * 2, 0, 3);
    }
    this.emit(p.x, p.y, p.z, 0, 0, 0, 0.12, 8, color[0] * 2, color[1] * 2, color[2] * 2, 20, 0);
  }
  update(dt) {
    const { pos, vel, life, maxLife, size, grow, drag, alpha } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) { alpha[i] = 0; continue; }
      life[i] -= dt;
      const k = Math.max(0, 1 - drag[i] * dt);
      vel[i * 3] *= k; vel[i * 3 + 1] *= k; vel[i * 3 + 2] *= k;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      size[i] += grow[i] * dt;
      const t = life[i] / maxLife[i];
      alpha[i] = life[i] > 0 ? Math.min(1, t * 1.6) : 0;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
}

// Instanced laser bolts
export class Bolts {
  constructor(scene, max = 700) {
    const geo = new THREE.BoxGeometry(0.35, 0.35, 1);
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, m, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.frustumCulled = false;
    this.max = max;
    scene.add(this.mesh);
    const glowGeo = new THREE.BoxGeometry(1.4, 1.4, 1);
    this.glow = new THREE.InstancedMesh(glowGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.25, depthWrite: false }), max);
    this.glow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.glow.frustumCulled = false;
    scene.add(this.glow);
  }
  render(list) {
    let n = 0;
    const c = new THREE.Color();
    for (const b of list) {
      if (!b.bolt || n >= this.max) continue;
      _v.copy(b.vel).normalize();
      _q.setFromUnitVectors(_z, _v);
      _s.set(b.width, b.width, b.len);
      _m.compose(b.pos, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      this.glow.setMatrixAt(n, _m);
      c.copy(b.color);
      this.mesh.setColorAt(n, c);
      this.glow.setColorAt(n, c);
      n++;
    }
    this.mesh.count = n;
    this.glow.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
  }
}
