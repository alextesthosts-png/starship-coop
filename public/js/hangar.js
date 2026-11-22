// Hangar gallery on the landing page: every ship and enemy with whatever model the admin has
// assigned, slowly turning, with its stats from the live tuning.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SHIPS, ENEMIES, MODEL_SLOTS, WEAPONS } from '/shared/config.js';
import { buildShip, buildEntity, buildDreadnought, preloadShipModels } from './models.js';
import { esc } from './hud.js';

const SECONDARY = { missile: 'Seeker missiles', flak: 'Flak burst', bomb: 'Plasma bombs' };
const ENEMY_INFO = {
  wing: 'Allied AI fighter that flies with short-handed wings.',
  tower: 'Relay tower. Pirates go for these in Outpost Siege.',
  raider: 'Fast pirate fighter. Comes in packs.',
  bomber: 'Dives on towers and drops heavy bombs.',
  gunship: 'Armoured pirate heavy with turret cannons.',
  freighter: 'Convoy cargo hauler. Stop it before it escapes.',
  turret: 'Heavy cannon on the Ravager\'s hull.',
  generator: 'Shield generator. Four of them protect the Ravager\'s core.',
  core: 'The Ravager\'s reactor. Shielded until the generators fall.',
  dreadnought: 'The pirate dreadnought Ravager.',
};

let R = null;
export function initHangar() {
  if (R) return R;
  const canvas = document.getElementById('hangar-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x202430, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(4, 6, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x66aaff, 1.4); rim.position.set(-6, 2, -6); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50000);
  const pivot = new THREE.Group(); scene.add(pivot);
  R = { renderer, scene, camera, pivot, current: null, sel: 'lancer', yaw: 0.6, pitch: 0.28, drag: null, visible: false, raf: 0 };
  canvas.addEventListener('pointerdown', (e) => { R.drag = { x: e.clientX, y: e.clientY, yaw: R.yaw, pitch: R.pitch }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (!R.drag) return; R.yaw = R.drag.yaw + (e.clientX - R.drag.x) * 0.01; R.pitch = Math.max(-0.9, Math.min(1.2, R.drag.pitch + (e.clientY - R.drag.y) * 0.006)); });
  canvas.addEventListener('pointerup', () => { R.drag = null; });
  document.getElementById('hangar-list').addEventListener('click', (e) => { const b = e.target.closest('[data-h]'); if (b) select(b.dataset.h); });
  return R;
}

function groups() {
  const ships = Object.keys(SHIPS).filter((k) => !SHIPS[k].hidden);
  return [
    ['Player ships', ships],
    ['Allies', ['wing', 'tower']],
    ['Pirates', ['raider', 'bomber', 'gunship', 'freighter', 'turret', 'generator', 'core', 'dreadnought']],
  ];
}
function nameOf(k) { return SHIPS[k]?.name || MODEL_SLOTS[k]?.name || k; }

function infoHtml(k) {
  const s = SHIPS[k];
  if (s) {
    const dps = Math.round((s.laserDmg / s.laserRate) * (s.gunMode === 'together' ? s.guns.length : s.gunMode === 'pairs' ? 2 : 1));
    return `<h3>${esc(s.name)}${s.custom ? ' <span class="muted">· custom</span>' : ''}</h3><div class="muted">${esc(s.role)}</div><p>${esc(s.desc || '')}</p>
      <table><tr><td>Cruise / boost speed</td><td>${Math.round(s.speed)} / ${Math.round(s.boostSpeed)} m/s</td></tr>
      <tr><td>Hull + shield</td><td>${Math.round(s.hull)} + ${Math.round(s.shield)}</td></tr>
      <tr><td>Cannon damage / s</td><td>${dps}</td></tr>
      <tr><td>Secondary</td><td>${SECONDARY[s.secondary] || s.secondary} ×${s.secAmmo}</td></tr></table>`;
  }
  const e = ENEMIES[k];
  const rows = [];
  if (e?.hp) rows.push(`<tr><td>Toughness</td><td>${Math.round(e.hp)}</td></tr>`);
  if (e?.speed) rows.push(`<tr><td>Speed</td><td>${Math.round(e.speed)} m/s</td></tr>`);
  if (e?.score) rows.push(`<tr><td>Points</td><td>${Math.round(e.score)}</td></tr>`);
  if (k === 'dreadnought') rows.push('<tr><td>Length</td><td>about 1 km</td></tr>');
  return `<h3>${esc(nameOf(k))}</h3><div class="muted">${esc(MODEL_SLOTS[k]?.role || '')}</div><p>${esc(ENEMY_INFO[k] || '')}</p>${rows.length ? `<table>${rows.join('')}</table>` : ''}`;
}

function build(k) {
  if (SHIPS[k]) return buildShip(k, '#4fc3ff');
  if (k === 'dreadnought') return buildDreadnought();
  return buildEntity(k);
}

function select(k) {
  if (!R) return;
  R.sel = k;
  if (R.current) { R.pivot.remove(R.current); R.current = null; }
  const obj = build(k);
  // centre and frame it
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  obj.position.sub(c);
  R.pivot.add(obj);
  R.current = obj;
  R.radius = Math.max(size.x, size.y, size.z) * 0.5 || 5;
  for (const ex of obj.userData.exhausts || []) ex.userData?.setThrust?.(0.35, 1, 0);
  renderList();
  document.getElementById('hangar-info').innerHTML = infoHtml(k);
}

export function renderList() {
  const el = document.getElementById('hangar-list');
  if (!el) return;
  el.innerHTML = groups().map(([title, ks]) => `<div><h4>${title}</h4><div class="chips">${ks.map((k) => `<button data-h="${k}" class="${k === R?.sel ? 'on' : ''}">${esc(nameOf(k))}</button>`).join('')}</div></div>`).join('');
}

function frame(t) {
  if (!R.visible) { R.raf = 0; return; }
  R.raf = requestAnimationFrame(frame);
  const canvas = R.renderer.domElement, w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * R.renderer.getPixelRatio()) || canvas.height !== Math.round(h * R.renderer.getPixelRatio())) { R.renderer.setSize(w, h, false); R.camera.aspect = w / h; R.camera.updateProjectionMatrix(); }
  if (!R.drag) R.yaw += 0.004;
  const d = R.radius / Math.tan(THREE.MathUtils.degToRad(R.camera.fov / 2)) * 1.25;
  R.camera.position.set(Math.sin(R.yaw) * Math.cos(R.pitch) * d, Math.sin(R.pitch) * d, Math.cos(R.yaw) * Math.cos(R.pitch) * d);
  R.camera.near = d / 100; R.camera.far = d * 10; R.camera.updateProjectionMatrix();
  R.camera.lookAt(0, 0, 0);
  if (R.current?.userData.spin) R.current.userData.spin.rotation.y += 0.01;
  R.renderer.render(R.scene, R.camera);
}

// Called when the Hangar tab opens/closes, and after content changes (models, tuning).
export async function showHangar(on) {
  initHangar();
  R.visible = on;
  if (!on) return;
  document.getElementById('hangar-loading').classList.remove('hidden');
  await preloadShipModels();
  document.getElementById('hangar-loading').classList.add('hidden');
  if (!SHIPS[R.sel] && !MODEL_SLOTS[R.sel] && R.sel !== 'dreadnought') R.sel = 'lancer';
  select(R.sel);
  if (!R.raf) R.raf = requestAnimationFrame(frame);
}
export function refreshHangar() { if (R?.visible) select(SHIPS[R.sel] || MODEL_SLOTS[R.sel] ? R.sel : 'lancer'); }
export { WEAPONS };
