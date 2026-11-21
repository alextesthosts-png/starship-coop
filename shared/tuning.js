// Live game tuning: every value an admin can change from the panel without a redeploy.
// The server and the browser both import this. An override map ({ key: value }) is stored with the
// site content; applyTuning() rewrites the shared config objects in place from their original
// values, so every system that reads SHIPS / ENEMIES / DIFFICULTY / ... picks the change up.
import { SHIPS, WEAPONS, ENEMIES, DIFFICULTY, MISSIONS, SCORE, PLAYER_COLORS } from './config.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const BASE = { SHIPS: clone(SHIPS), WEAPONS: clone(WEAPONS), ENEMIES: clone(ENEMIES), DIFFICULTY: clone(DIFFICULTY), MISSIONS: clone(MISSIONS), SCORE: clone(SCORE), PLAYER_COLORS: [...PLAYER_COLORS] };

// Looks the client reads when it draws. Defaults match the original hard-coded values.
export const VISUALS_DEFAULT = {
  bloomStrength: 0.85, bloomThreshold: 0.82, exposure: 1.0,
  fov: 70, boostFov: 12, shake: 1,
  plumeLength: 1, plume: { lancer: '', warden: '', hammer: '' },
  enemyLaser: '#ff2a1c', heavyLaser: '#ff661a', wingLaser: '#33ff66', missile: '#ffaa55', bomb: '#66aaff',
  planet: { skyTop: '#2b4a7a', skyHorizon: '#e8a070', fog: '#d8a080', fogFar: 7500, sun: '#ffe2b8', sunIntensity: 2.4 },
  space: { convoyA: '#3a60c0', convoyB: '#40a0a0', dreadA: '#b03a60', dreadB: '#5a30a0', sun: '#fff0e0', sunIntensity: 2.6 },
};
export const VISUALS = clone(VISUALS_DEFAULT);

const num = (label, min, max, step, get, set, unit = '') => ({ type: 'number', label, min, max, step, get, set, unit });
const color = (label, get, set, allowEmpty = false) => ({ type: 'color', label, get, set, allowEmpty });
const text = (label, max, get, set, long = false) => ({ type: 'text', label, max, get, set, long });

// ---- the schema: groups of fields, each with a stable key ----
const shipFields = (s) => ({
  [`ship.${s}.name`]: text('Name', 20, (b) => b.SHIPS[s].name, (v) => { SHIPS[s].name = v; }),
  [`ship.${s}.role`]: text('Role', 24, (b) => b.SHIPS[s].role, (v) => { SHIPS[s].role = v; }),
  [`ship.${s}.desc`]: text('Description', 200, (b) => b.SHIPS[s].desc, (v) => { SHIPS[s].desc = v; }, true),
  [`ship.${s}.speed`]: num('Cruise speed', 30, 400, 1, (b) => b.SHIPS[s].speed, (v) => { SHIPS[s].speed = v; }),
  [`ship.${s}.boostSpeed`]: num('Boost speed', 50, 600, 1, (b) => b.SHIPS[s].boostSpeed, (v) => { SHIPS[s].boostSpeed = v; }),
  [`ship.${s}.accel`]: num('Acceleration', 10, 300, 1, (b) => b.SHIPS[s].accel, (v) => { SHIPS[s].accel = v; }),
  [`ship.${s}.handling`]: num('Handling (turn rate ×)', 0.3, 3, 0.05, () => 1, (v) => { for (const k of ['pitch', 'yaw', 'roll']) SHIPS[s][k] = BASE.SHIPS[s][k] * v; }, '×'),
  [`ship.${s}.hull`]: num('Hull', 10, 1000, 1, (b) => b.SHIPS[s].hull, (v) => { SHIPS[s].hull = v; }),
  [`ship.${s}.shield`]: num('Shield', 0, 1000, 1, (b) => b.SHIPS[s].shield, (v) => { SHIPS[s].shield = v; }),
  [`ship.${s}.shieldRegen`]: num('Shield regen / s', 0, 100, 0.5, (b) => b.SHIPS[s].shieldRegen, (v) => { SHIPS[s].shieldRegen = v; }),
  [`ship.${s}.laserDmg`]: num('Cannon damage', 1, 200, 0.5, (b) => b.SHIPS[s].laserDmg, (v) => { SHIPS[s].laserDmg = v; }),
  [`ship.${s}.laserRate`]: num('Cannon delay (s)', 0.03, 1, 0.01, (b) => b.SHIPS[s].laserRate, (v) => { SHIPS[s].laserRate = v; }, 's'),
  [`ship.${s}.secAmmo`]: num('Secondary ammo', 0, 30, 1, (b) => b.SHIPS[s].secAmmo, (v) => { SHIPS[s].secAmmo = v; }),
  [`ship.${s}.secRegen`]: num('Secondary reload (s)', 0.5, 60, 0.5, (b) => b.SHIPS[s].secRegen, (v) => { SHIPS[s].secRegen = v; }, 's'),
  [`look.plume.${s}`]: color('Engine plume colour (empty = pilot colour)', () => '', (v) => { VISUALS.plume[s] = v; }, true),
});
const diffFields = (d) => ({
  [`diff.${d}.label`]: text('Name', 16, (b) => b.DIFFICULTY[d].label, (v) => { DIFFICULTY[d].label = v; }),
  [`diff.${d}.count`]: num('Enemy count ×', 0.2, 4, 0.05, (b) => b.DIFFICULTY[d].count, (v) => { DIFFICULTY[d].count = v; }, '×'),
  [`diff.${d}.dmg`]: num('Enemy damage ×', 0.1, 5, 0.05, (b) => b.DIFFICULTY[d].dmg, (v) => { DIFFICULTY[d].dmg = v; }, '×'),
  [`diff.${d}.fire`]: num('Enemy fire rate ×', 0.2, 4, 0.05, (b) => b.DIFFICULTY[d].fire, (v) => { DIFFICULTY[d].fire = v; }, '×'),
  [`diff.${d}.reserves`]: num('Reserve ships', 0, 20, 1, (b) => b.DIFFICULTY[d].reserves, (v) => { DIFFICULTY[d].reserves = v; }),
});
const missionFields = (i) => {
  const id = BASE.MISSIONS[i].id;
  return {
    [`mission.${id}.name`]: text('Name', 40, (b) => b.MISSIONS[i].name, (v) => { MISSIONS[i].name = v; }),
    [`mission.${id}.location`]: text('Location', 80, (b) => b.MISSIONS[i].location, (v) => { MISSIONS[i].location = v; }),
    [`mission.${id}.briefing`]: text('Briefing', 600, (b) => b.MISSIONS[i].briefing, (v) => { MISSIONS[i].briefing = v; }, true),
  };
};
const enemyMul = (field) => (v) => { for (const [k, e] of Object.entries(ENEMIES)) if (e.team === 'enemy' && BASE.ENEMIES[k][field] != null) e[field] = BASE.ENEMIES[k][field] * v; };

export const TUNING_GROUPS = [
  ...['lancer', 'warden', 'hammer'].map((s) => ({ id: `ship-${s}`, section: 'Ships', title: BASE.SHIPS[s].name, hint: `${BASE.SHIPS[s].role}: flight, toughness and weapons.`, fields: shipFields(s) })),
  { id: 'weapons', section: 'Combat', title: 'Secondary weapons', hint: 'Missiles (Lancer), flak (Warden) and bombs (Hammer).', fields: {
    'weapon.missile.dmg': num('Missile damage', 1, 500, 1, (b) => b.WEAPONS.missile.dmg, (v) => { WEAPONS.missile.dmg = v; }),
    'weapon.missile.speed': num('Missile speed', 80, 900, 5, (b) => b.WEAPONS.missile.speed, (v) => { WEAPONS.missile.speed = v; }),
    'weapon.missile.turn': num('Missile tracking', 0.2, 8, 0.1, (b) => b.WEAPONS.missile.turn, (v) => { WEAPONS.missile.turn = v; }),
    'weapon.flak.dmg': num('Flak damage per pellet', 1, 100, 0.5, (b) => b.WEAPONS.flak.dmg, (v) => { WEAPONS.flak.dmg = v; }),
    'weapon.flak.pellets': num('Flak pellets', 1, 40, 1, (b) => b.WEAPONS.flak.pellets, (v) => { WEAPONS.flak.pellets = v; }),
    'weapon.bomb.dmg': num('Bomb damage', 10, 2000, 5, (b) => b.WEAPONS.bomb.dmg, (v) => { WEAPONS.bomb.dmg = v; }),
    'weapon.bomb.splash': num('Bomb blast radius', 5, 300, 1, (b) => b.WEAPONS.bomb.splash, (v) => { WEAPONS.bomb.splash = v; }),
  } },
  { id: 'enemies', section: 'Combat', title: 'Enemies & allies', hint: 'Multipliers apply to every pirate unit: raiders, bombers, gunships, freighters, turrets, generators and the core.', fields: {
    'enemy.hpMul': num('Enemy toughness ×', 0.1, 5, 0.05, () => 1, enemyMul('hp'), '×'),
    'enemy.speedMul': num('Enemy speed ×', 0.3, 3, 0.05, () => 1, enemyMul('speed'), '×'),
    'enemy.scoreMul': num('Points per kill ×', 0, 10, 0.1, () => 1, enemyMul('score'), '×'),
    'ally.wingHp': num('AI wingmate hull', 10, 2000, 5, (b) => b.ENEMIES.wing.hp, (v) => { ENEMIES.wing.hp = v; }),
    'ally.towerHp': num('Relay tower hull (Outpost Siege)', 50, 5000, 10, (b) => b.ENEMIES.tower.hp, (v) => { ENEMIES.tower.hp = v; }),
    'score.medalBonus': num('Medal bonus points', 0, 20000, 50, (b) => b.SCORE.medalBonus, (v) => { SCORE.medalBonus = v; }),
  } },
  ...['easy', 'normal', 'hard'].map((d) => ({ id: `diff-${d}`, section: 'Difficulty', title: BASE.DIFFICULTY[d].label, hint: 'Applies to new missions on this difficulty.', fields: diffFields(d) })),
  ...BASE.MISSIONS.map((m, i) => ({ id: `mission-${m.id}`, section: 'Missions', title: m.name, hint: 'Text shown in the lobby and debrief.', fields: missionFields(i) })),
  { id: 'look-colours', section: 'Looks', title: 'Colours', hint: 'Pilot colours apply to pilots who join a wing after you save.', fields: {
    ...Object.fromEntries([0, 1, 2, 3].map((i) => [`look.player${i + 1}`, color(`Pilot ${i + 1} colour`, (b) => b.PLAYER_COLORS[i], (v) => { PLAYER_COLORS[i] = v; })])),
    'look.enemyLaser': color('Pirate laser', () => VISUALS_DEFAULT.enemyLaser, (v) => { VISUALS.enemyLaser = v; }),
    'look.heavyLaser': color('Pirate heavy cannon', () => VISUALS_DEFAULT.heavyLaser, (v) => { VISUALS.heavyLaser = v; }),
    'look.wingLaser': color('AI wingmate laser', () => VISUALS_DEFAULT.wingLaser, (v) => { VISUALS.wingLaser = v; }),
    'look.missile': color('Missile glow', () => VISUALS_DEFAULT.missile, (v) => { VISUALS.missile = v; }),
    'look.bomb': color('Bomb glow', () => VISUALS_DEFAULT.bomb, (v) => { VISUALS.bomb = v; }),
  } },
  { id: 'look-camera', section: 'Looks', title: 'Camera & effects', hint: 'Changes reach pilots mid-flight within a second.', fields: {
    'look.bloomStrength': num('Glow (bloom) strength', 0, 3, 0.05, () => VISUALS_DEFAULT.bloomStrength, (v) => { VISUALS.bloomStrength = v; }),
    'look.bloomThreshold': num('Glow threshold', 0, 1.5, 0.01, () => VISUALS_DEFAULT.bloomThreshold, (v) => { VISUALS.bloomThreshold = v; }),
    'look.exposure': num('Brightness (exposure)', 0.3, 2.5, 0.05, () => VISUALS_DEFAULT.exposure, (v) => { VISUALS.exposure = v; }),
    'look.fov': num('Field of view', 50, 100, 1, () => VISUALS_DEFAULT.fov, (v) => { VISUALS.fov = v; }, '°'),
    'look.boostFov': num('Extra field of view when boosting', 0, 30, 1, () => VISUALS_DEFAULT.boostFov, (v) => { VISUALS.boostFov = v; }, '°'),
    'look.shake': num('Camera shake ×', 0, 3, 0.1, () => VISUALS_DEFAULT.shake, (v) => { VISUALS.shake = v; }, '×'),
    'look.plumeLength': num('Engine plume length ×', 0.3, 2, 0.05, () => VISUALS_DEFAULT.plumeLength, (v) => { VISUALS.plumeLength = v; }, '×'),
  } },
  { id: 'look-planet', section: 'Looks', title: 'Planet sky (Outpost Siege)', hint: 'Applies from the next mission launch.', fields: {
    'look.planet.skyTop': color('Sky (overhead)', () => VISUALS_DEFAULT.planet.skyTop, (v) => { VISUALS.planet.skyTop = v; }),
    'look.planet.skyHorizon': color('Sky (horizon)', () => VISUALS_DEFAULT.planet.skyHorizon, (v) => { VISUALS.planet.skyHorizon = v; }),
    'look.planet.fog': color('Haze colour', () => VISUALS_DEFAULT.planet.fog, (v) => { VISUALS.planet.fog = v; }),
    'look.planet.fogFar': num('Haze distance', 2000, 20000, 100, () => VISUALS_DEFAULT.planet.fogFar, (v) => { VISUALS.planet.fogFar = v; }),
    'look.planet.sun': color('Sunlight colour', () => VISUALS_DEFAULT.planet.sun, (v) => { VISUALS.planet.sun = v; }),
    'look.planet.sunIntensity': num('Sunlight strength', 0, 6, 0.1, () => VISUALS_DEFAULT.planet.sunIntensity, (v) => { VISUALS.planet.sunIntensity = v; }),
  } },
  { id: 'look-space', section: 'Looks', title: 'Space (Convoy & Ravager)', hint: 'Applies from the next mission launch.', fields: {
    'look.space.convoyA': color('Convoy nebula: main', () => VISUALS_DEFAULT.space.convoyA, (v) => { VISUALS.space.convoyA = v; }),
    'look.space.convoyB': color('Convoy nebula: secondary', () => VISUALS_DEFAULT.space.convoyB, (v) => { VISUALS.space.convoyB = v; }),
    'look.space.dreadA': color('Ravager nebula: main', () => VISUALS_DEFAULT.space.dreadA, (v) => { VISUALS.space.dreadA = v; }),
    'look.space.dreadB': color('Ravager nebula: secondary', () => VISUALS_DEFAULT.space.dreadB, (v) => { VISUALS.space.dreadB = v; }),
    'look.space.sun': color('Starlight colour', () => VISUALS_DEFAULT.space.sun, (v) => { VISUALS.space.sun = v; }),
    'look.space.sunIntensity': num('Starlight strength', 0, 6, 0.1, () => VISUALS_DEFAULT.space.sunIntensity, (v) => { VISUALS.space.sunIntensity = v; }),
  } },
];

export const TUNING_FIELDS = Object.fromEntries(TUNING_GROUPS.flatMap((g) => Object.entries(g.fields)));
export const tuningDefault = (key) => TUNING_FIELDS[key]?.get(BASE);

const HEX = /^#[0-9a-f]{6}$/i;
// Keep only known keys with valid values. Values equal to the default are dropped.
export function sanitizeTuning(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, raw] of Object.entries(input)) {
    const f = TUNING_FIELDS[k];
    if (!f) continue;
    let v;
    if (f.type === 'number') {
      v = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      if (!Number.isFinite(v)) continue;
      v = Math.min(f.max, Math.max(f.min, v));
      v = Math.round(v / f.step) * f.step;
      v = +v.toFixed(4);
    } else if (f.type === 'color') {
      if (typeof raw !== 'string') continue;
      v = raw.trim().toLowerCase();
      if (!(HEX.test(v) || (f.allowEmpty && v === ''))) continue;
    } else {
      if (typeof raw !== 'string') continue;
      v = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, f.max);
      if (!v) continue;
    }
    if (v === tuningDefault(k)) continue;
    out[k] = v;
  }
  return out;
}

// Reset everything to the shipped values, then apply the overrides.
export function applyTuning(overrides = {}) {
  const restore = (target, base) => { for (const k of Object.keys(base)) { if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) Object.assign(target[k], clone(base[k])); else target[k] = clone(base[k]); } };
  restore(SHIPS, BASE.SHIPS); restore(WEAPONS, BASE.WEAPONS); restore(ENEMIES, BASE.ENEMIES); restore(DIFFICULTY, BASE.DIFFICULTY); Object.assign(SCORE, BASE.SCORE);
  BASE.MISSIONS.forEach((m, i) => Object.assign(MISSIONS[i], clone(m)));
  BASE.PLAYER_COLORS.forEach((c, i) => { PLAYER_COLORS[i] = c; });
  const v = clone(VISUALS_DEFAULT);
  for (const k of Object.keys(v)) VISUALS[k] = v[k];
  const clean = sanitizeTuning(overrides);
  for (const [k, val] of Object.entries(clean)) TUNING_FIELDS[k].set(val);
  return clean;
}
