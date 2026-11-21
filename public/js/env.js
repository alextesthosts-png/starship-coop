// Environment builders: planet surface and deep space.
import { VISUALS } from '/shared/tuning.js';
import * as THREE from 'three';
import { PLANET, terrainHeight, TOWERS, asteroids, CONVOY, DREAD, insideBox, mulberry32 } from '/shared/world.js';
import { mat, buildDreadnought, buildJumpGate } from './models.js';
import { terrainMaterial, triplanarMaterial } from './textures.js';

function skyDome(top, horizon, sunDir, sunColor) {
  const geo = new THREE.SphereGeometry(20000, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, horizon: { value: new THREE.Color(horizon) }, sunDir: { value: sunDir.clone().normalize() }, sunColor: { value: new THREE.Color(sunColor) } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; varying vec3 vDir;
      void main(){ float h = clamp(vDir.y, -0.2, 1.0); vec3 c = mix(horizon, top, pow(max(h,0.0), 0.55));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.35);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const m2 = new THREE.Mesh(geo, m);
  m2.frustumCulled = false;
  m2.renderOrder = -10;
  return m2;
}

function nebulaSphere(colA, colB, seed = 1.0) {
  const geo = new THREE.SphereGeometry(19000, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { colA: { value: new THREE.Color(colA) }, colB: { value: new THREE.Color(colB) }, seed: { value: seed } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform vec3 colA; uniform vec3 colB; uniform float seed; varying vec3 vDir;
      float hash(vec3 p){ p = fract(p*0.3183099 + .1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.1; a*=0.5; } return s; }
      void main(){ vec3 d = normalize(vDir);
        float n = fbm(d*3.0 + seed); float n2 = fbm(d*6.0 - seed*2.0);
        float band = exp(-pow(d.y*2.2 + sin(d.x*2.0+seed)*0.4, 2.0));
        vec3 c = colA * pow(n, 2.5) * 1.3 * band + colB * pow(n2, 3.0) * 0.9 * band;
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const me = new THREE.Mesh(geo, m);
  me.frustumCulled = false;
  me.renderOrder = -10;
  return me;
}

function starfield(n = 3500, seed = 3) {
  const rng = mulberry32(seed);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = rng() * 2 - 1, th = rng() * Math.PI * 2, r = 15000;
    const s = Math.sqrt(1 - u * u);
    pos.set([Math.cos(th) * s * r, u * r, Math.sin(th) * s * r], i * 3);
    const b = 0.5 + rng() * 0.9;
    const tint = rng();
    col.set(tint < 0.2 ? [b, b * 0.85, b * 0.7] : tint < 0.4 ? [b * 0.8, b * 0.9, b] : [b, b, b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }));
  p.frustumCulled = false;
  p.renderOrder = -9;
  return p;
}

function bandedPlanet(radius, c1, c2, c3, atmo) {
  const m = new THREE.ShaderMaterial({
    fog: false,
    uniforms: { c1: { value: new THREE.Color(c1) }, c2: { value: new THREE.Color(c2) }, c3: { value: new THREE.Color(c3) }, atmo: { value: new THREE.Color(atmo) }, lightDir: { value: new THREE.Vector3(1, 0.4, 0.3).normalize() } },
    vertexShader: `varying vec3 vN; varying vec3 vP; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vP = position; vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 c1; uniform vec3 c2; uniform vec3 c3; uniform vec3 atmo; uniform vec3 lightDir; varying vec3 vN; varying vec3 vP; varying vec3 vV;
      void main(){ float y = normalize(vP).y; float b = sin(y*22.0 + sin(y*7.0)*2.0)*0.5+0.5; float b2 = sin(y*55.0+1.3)*0.5+0.5;
        vec3 c = mix(mix(c1, c2, b), c3, b2*0.35);
        vec3 L = normalize((viewMatrix*vec4(lightDir,0.0)).xyz);
        float d = max(dot(vN, L), 0.0);
        float rim = pow(1.0 - max(dot(vN, vV), 0.0), 3.0);
        gl_FragColor = vec4(c*(0.06+d*1.0) + atmo*rim*(0.3+d), 1.0); }`,
  });
  const me = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), m);
  me.frustumCulled = false;
  return me;
}

export function buildPlanetEnv(scene) {
  const sunDir = new THREE.Vector3(-0.5, 0.35, -0.8).normalize();
  const P = VISUALS.planet;
  scene.add(skyDome(P.skyTop, P.skyHorizon, sunDir, 0xffd9a0));
  scene.fog = new THREE.Fog(P.fog, 900, P.fogFar);
  const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x6a4a30, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(P.sun, P.sunIntensity);
  sun.position.copy(sunDir).multiplyScalar(1000);
  scene.add(sun);

  // terrain
  const { size, segments } = PLANET;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cSand = new THREE.Color(0xc8935e), cRock = new THREE.Color(0x8a5a3c), cDark = new THREE.Color(0x5a3a2a), cHigh = new THREE.Color(0xd8c0a0), cPad = new THREE.Color(0x9a8a78);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    const slope = Math.abs(terrainHeight(x + 20, z) - h) + Math.abs(terrainHeight(x, z + 20) - h);
    if (Math.hypot(x, z) < 560) c.copy(cPad).lerp(cSand, 0.4);
    else if (h < -60) c.copy(cDark).lerp(cRock, (h + 160) / 100);
    else if (h > 500) c.copy(cRock).lerp(cHigh, Math.min(1, (h - 500) / 500));
    else c.copy(cSand).lerp(cRock, Math.min(1, slope / 30));
    const j = 0.92 + Math.random() * 0.12;
    colors.set([c.r * j, c.g * j, c.b * j], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, terrainMaterial());
  scene.add(terrain);

  // rock spires
  const rng = mulberry32(5);
  const spireGeo = new THREE.CylinderGeometry(0.35, 1, 1, 6);
  const N = 140;
  const spires = new THREE.InstancedMesh(spireGeo, triplanarMaterial({ albedo: 'terrain_cliff_albedo', normal: 'terrain_cliff_normal', scale: 0.012, color: 0xd8b8a0, metalness: 0, roughness: 0.95, normalStrength: 1.2 }), N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let k = 0;
  while (k < N) {
    const x = (rng() * 2 - 1) * 3200, z = (rng() * 2 - 1) * 3200;
    if (Math.hypot(x, z) < 800) continue;
    const h = terrainHeight(x, z);
    const H = 60 + rng() * 220, R = 15 + rng() * 35;
    p.set(x, h + H / 2 - 5, z);
    q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.15, rng() * 6, (rng() - 0.5) * 0.15));
    s.set(R, H, R);
    m4.compose(p, q, s);
    spires.setMatrixAt(k++, m4);
  }
  scene.add(spires);

  // base structures (landing pads, bunkers) - towers themselves are entities
  const padM = triplanarMaterial({ albedo: 'hull_panels_albedo', normal: 'hull_panels_normal', scale: 0.02, color: 0xb8b4ac, metalness: 0.3, roughness: 0.7 });
  const bunkerM = triplanarMaterial({ albedo: 'hull_panels_albedo', normal: 'hull_panels_normal', scale: 0.03, color: 0xd8ccb8, metalness: 0.2, roughness: 0.8 });
  const lineM = new THREE.MeshBasicMaterial({ color: 0xffcc55 });
  for (const [x, z] of [[0, 0], [-420, 120], [380, 60]]) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(70, 75, 6, 16), padM);
    pad.position.set(x, PLANET.baseHeight + 2, z);
    scene.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(55, 1.5, 4, 32), lineM);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, PLANET.baseHeight + 5.2, z);
    scene.add(ring);
  }
  for (let i = 0; i < 12; i++) {
    const a = rng() * Math.PI * 2, r = 150 + rng() * 300;
    const b = new THREE.Mesh(new THREE.BoxGeometry(30 + rng() * 40, 15 + rng() * 20, 30 + rng() * 40), bunkerM);
    b.position.set(Math.cos(a) * r, PLANET.baseHeight + 8, Math.sin(a) * r);
    b.rotation.y = rng() * 3;
    scene.add(b);
  }
  return {
    update() {},
    collide(pos) {
      const h = terrainHeight(pos.x, pos.z);
      if (pos.y < h + 2.5) return { normal: new THREE.Vector3(0, 1, 0), push: h + 2.5 - pos.y };
      for (const [x, z] of TOWERS) {
        const th = terrainHeight(x, z);
        if (Math.hypot(pos.x - x, pos.z - z) < 11 && pos.y < th + 100) {
          const n = new THREE.Vector3(pos.x - x, 0, pos.z - z).normalize();
          return { normal: n, push: 11 - Math.hypot(pos.x - x, pos.z - z) };
        }
      }
      return null;
    },
    arena(pos) { return Math.hypot(pos.x, pos.z) > PLANET.arena || pos.y > PLANET.ceiling; },
    groundHeight: terrainHeight,
  };
}

export function buildSpaceEnv(scene, missionId) {
  const isConvoy = missionId === 'convoy';
  const SP = VISUALS.space;
  scene.add(nebulaSphere(isConvoy ? SP.convoyA : SP.dreadA, isConvoy ? SP.convoyB : SP.dreadB, isConvoy ? 1.7 : 4.2));
  scene.add(starfield());
  scene.fog = null;
  scene.add(new THREE.AmbientLight(0x404a60, 0.9));
  scene.add(new THREE.HemisphereLight(0x8090c0, 0x302020, 0.6));
  const sun = new THREE.DirectionalLight(SP.sun, SP.sunIntensity);
  sun.position.set(1, 0.4, 0.3).multiplyScalar(1000);
  scene.add(sun);

  const updaters = [];
  const colliders = [];
  if (isConvoy) {
    const gp = bandedPlanet(5200, 0xc8a070, 0x8a5a40, 0xf0e0c0, 0xffc080);
    gp.position.set(-9000, -3000, -8000);
    scene.add(gp);
    // asteroids
    const list = asteroids();
    const geos = [0, 1, 2].map((v) => {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const r = mulberry32(100 + v);
      const p = g.attributes.position;
      const tmp = new Map();
      for (let i = 0; i < p.count; i++) {
        const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
        if (!tmp.has(key)) tmp.set(key, 0.78 + r() * 0.35);
        const f = tmp.get(key);
        p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.85, p.getZ(i) * f);
      }
      g.computeVertexNormals();
      return g;
    });
    const astMat = triplanarMaterial({ albedo: 'asteroid_albedo', normal: 'asteroid_normal', scale: 0.02, color: 0xe8dcd0, metalness: 0.05, roughness: 0.9, normalStrength: 1.5 });
    for (let v = 0; v < 3; v++) {
      const subset = list.filter((a) => a.s === v);
      const im = new THREE.InstancedMesh(geos[v], astMat, subset.length);
      const m4 = new THREE.Matrix4();
      subset.forEach((a, i) => {
        m4.compose(new THREE.Vector3(a.x, a.y, a.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(a.rx, a.ry, 0)), new THREE.Vector3(a.r, a.r, a.r));
        im.setMatrixAt(i, m4);
      });
      scene.add(im);
    }
    const gate = buildJumpGate();
    gate.position.set(...CONVOY.gate);
    gate.position.z += 120;
    scene.add(gate);
    updaters.push((t) => { gate.userData.disc.material.opacity = 0.14 + Math.sin(t * 3) * 0.05; });
    colliders.push((pos) => {
      for (const a of list) {
        const dx = pos.x - a.x, dy = pos.y - a.y, dz = pos.z - a.z;
        const rr = a.r * 0.85 + 2.5;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 1;
          return { normal: new THREE.Vector3(dx / d, dy / d, dz / d), push: rr - d };
        }
      }
      return null;
    });
  } else {
    const moon = bandedPlanet(3800, 0x8a8a90, 0x6a6a70, 0xa0a0a8, 0x8899ff);
    moon.position.set(2000, -6500, -6000);
    scene.add(moon);
    const dread = buildDreadnought();
    scene.add(dread);
    colliders.push((pos) => {
      for (const b of DREAD.hull) {
        if (!insideBox(pos, b, 2)) continue;
        // push out along the axis of least penetration
        const pen = [0, 1, 2].map((i) => b.h[i] + 2 - Math.abs([pos.x, pos.y, pos.z][i] - b.c[i]));
        const ax = pen.indexOf(Math.min(...pen));
        const n = new THREE.Vector3();
        n.setComponent(ax, Math.sign([pos.x, pos.y, pos.z][ax] - b.c[ax]) || 1);
        return { normal: n, push: pen[ax] };
      }
      return null;
    });
  }
  return {
    update(t) { for (const u of updaters) u(t); },
    collide(pos) { for (const c of colliders) { const r = c(pos); if (r) return r; } return null; },
    arena(pos) { return pos.length() > 3800; },
    groundHeight: null,
  };
}
