// Texture loading + triplanar terrain/hull shaders (textures are baked in Blender, see tools/blender_textures.py).
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map();
let maxAniso = 8;
export function setAnisotropy(n) { maxAniso = Math.min(8, n || 1); }

// Admin uploads (admin → Environments) can replace the terrain textures by name.
let OVERRIDES = {};
export function setTextureOverrides(map = {}) {
  const changed = JSON.stringify(map) !== JSON.stringify(OVERRIDES);
  OVERRIDES = { ...map };
  if (changed) for (const k of [...cache.keys()]) if (/^terrain_/.test(k)) cache.delete(k);
}
export function tex(name, color = true, repeat = 1) {
  const key = name + color + repeat;
  if (cache.has(key)) return cache.get(key);
  const t = loader.load(OVERRIDES[name] || `/textures/${name}.jpg`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  t.repeat.set(repeat, repeat);
  cache.set(key, t);
  return t;
}

const COMMON_VERT_DECL = `
varying vec3 vWPos;
varying vec3 vWNorm;
`;
const COMMON_VERT = `
{
  vec4 wp = vec4(transformed, 1.0);
  vec3 wn = objectNormal;
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
    wn = mat3(instanceMatrix) * wn;
  #endif
  vWPos = (modelMatrix * wp).xyz;
  vWNorm = normalize(mat3(modelMatrix) * wn);
}
`;
const TRI_FUNCS = `
varying vec3 vWPos;
varying vec3 vWNorm;
vec3 triW(vec3 n) { vec3 w = pow(abs(n), vec3(6.0)); return w / (w.x + w.y + w.z); }
vec3 triA(sampler2D t, vec3 p, vec3 w, float s) {
  return texture2D(t, p.zy * s).rgb * w.x + texture2D(t, p.xz * s).rgb * w.y + texture2D(t, p.xy * s).rgb * w.z;
}
// world-space normal offset from a tangent-space normal map sampled triplanar
vec3 triN(sampler2D t, vec3 p, vec3 w, float s, vec3 n) {
  vec3 tx = texture2D(t, p.zy * s).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(t, p.xz * s).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(t, p.xy * s).xyz * 2.0 - 1.0;
  vec3 sn = sign(n);
  return vec3(0.0, tx.y, tx.x * sn.x) * w.x + vec3(ty.x * sn.y, 0.0, ty.y) * w.y + vec3(tz.x * sn.z, tz.y, 0.0) * w.z;
}
`;

// ---------------- terrain ----------------
export function terrainMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const u = {
    tSandA: { value: tex('terrain_sand_albedo') }, tSandN: { value: tex('terrain_sand_normal', false) },
    tRockA: { value: tex('terrain_rock_albedo') }, tRockN: { value: tex('terrain_rock_normal', false) },
    tCliffA: { value: tex('terrain_cliff_albedo') }, tCliffN: { value: tex('terrain_cliff_normal', false) },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${COMMON_VERT_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${COMMON_VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tSandA, tSandN, tRockA, tRockN, tCliffA, tCliffN;
        ${TRI_FUNCS}
        vec3 gTerrN;`)
      .replace('#include <map_fragment>', `
        vec3 N = normalize(vWNorm);
        vec3 w = triW(N);
        vec3 p = vWPos;
        float slope = 1.0 - N.y;
        // large-scale breakup noise from the rock texture
        float brk = dot(texture2D(tRockA, p.xz * 0.00045).rgb, vec3(0.333));
        float cliffW = smoothstep(0.30, 0.48, slope + (brk - 0.5) * 0.25);
        float rockW = (1.0 - cliffW) * clamp(smoothstep(0.10, 0.24, slope + (brk - 0.5) * 0.35) + smoothstep(420.0, 650.0, p.y), 0.0, 1.0);
        float sandW = max(0.0, 1.0 - cliffW - rockW);
        // two scales per layer to hide tiling
        vec3 rock = mix(triA(tRockA, p, w, 0.022), triA(tRockA, p, w, 0.0051), 0.45);
        // the larger sand sample is rotated so its pattern never lines up with the small one
        vec3 pr = vec3(p.x * 0.799 - p.z * 0.602, p.y, p.x * 0.602 + p.z * 0.799);
        vec3 sand = mix(triA(tSandA, p, w, 0.045), triA(tSandA, pr, w, 0.0083), 0.4);
        // flat ground: large drifts and darker gravel patches so plains don't read as one flat colour
        float drift = dot(texture2D(tCliffA, p.xz * 0.00021 + 0.37).rgb, vec3(0.333));
        float gravel = smoothstep(0.5, 0.64, dot(texture2D(tRockA, p.xz * 0.0013 + 0.11).rgb, vec3(0.333)));
        float drift2 = dot(texture2D(tRockA, pr.xz * 0.00062 + 0.71).rgb, vec3(0.333));
        sand *= mix(0.7, 1.2, drift) * mix(0.88, 1.1, drift2);
        sand = mix(sand, rock * 0.8, gravel * 0.6);
        // cliffs: strata follow height, slight wobble so bands aren't perfectly flat
        vec3 cliff = mix(triA(tCliffA, p, w, 0.012), triA(tCliffA, p + vec3(0.0, sin(p.x * 0.004) * 30.0, 0.0), w, 0.004), 0.5);
        vec3 alb = sand * sandW + rock * rockW + cliff * cliffW;
        // keep some of the old height colouring as large-scale tint
        alb *= mix(vec3(1.0), vColor.rgb * 1.55, 0.35);
        // canyon floor darker, base plateau slightly paved
        alb *= mix(0.72, 1.0, smoothstep(-160.0, -40.0, p.y));
        diffuseColor.rgb *= alb;
        gTerrN = (triN(tSandN, p, w, 0.045, N) * 0.4 + triN(tSandN, pr, w, 0.0083, N) * 0.3) * sandW + triN(tRockN, p, w, 0.022, N) * rockW + triN(tCliffN, p, w, 0.012, N) * cliffW * 1.3;
      `)
      .replace('#include <color_fragment>', '')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(normal + (viewMatrix * vec4(gTerrN * 0.9, 0.0)).xyz);
      `);
  };
  return m;
}

// ---------------- generic triplanar (dreadnought hull, asteroids) ----------------
export function triplanarMaterial({ albedo, normal, scale = 0.05, color = 0xffffff, metalness = 0.4, roughness = 0.6, normalStrength = 1, emissiveMask = null, emissive = 0x000000 }) {
  const m = new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive, emissiveIntensity: emissiveMask ? 1 : 0 });
  const u = { tA: { value: tex(albedo) }, tN: { value: tex(normal, false) }, tScale: { value: scale }, tNS: { value: normalStrength } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${COMMON_VERT_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${COMMON_VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tA, tN; uniform float tScale, tNS;
        ${TRI_FUNCS}
        vec3 gTN;`)
      .replace('#include <map_fragment>', `
        vec3 N = normalize(vWNorm);
        vec3 w = triW(N);
        vec3 alb = triA(tA, vWPos, w, tScale);
        diffuseColor.rgb *= alb;
        gTN = triN(tN, vWPos, w, tScale, N) * tNS;
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (1.25 - dot(alb, vec3(0.333)) * 0.6), 0.05, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(normal + (viewMatrix * vec4(gTN, 0.0)).xyz);`);
  };
  return m;
}

// UV-mapped panel material for small ships
export function panelMaterial(color, { metalness = 0.5, roughness = 0.45, repeat = 1 } = {}) {
  const a = tex('hull_panels_albedo', true, repeat);
  const n = tex('hull_panels_normal', false, repeat);
  return new THREE.MeshStandardMaterial({ color, map: a, normalMap: n, normalScale: new THREE.Vector2(0.8, 0.8), metalness, roughness, flatShading: true });
}
