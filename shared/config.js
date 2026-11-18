// Shared game configuration: used by both the server simulation and the browser client.

export const GAME_TITLE = 'VANGUARD WING';
export const MAX_PLAYERS = 4;
export const PLAYER_COLORS = ['#4fc3ff', '#ffb347', '#7dff8a', '#ff6be0'];

// Player starfighters. Forward is -Z in model space.
export const SHIPS = {
  lancer: {
    name: 'Lancer',
    role: 'Interceptor',
    desc: 'Fast and nimble. Rapid twin cannons and lock-on seeker missiles. Best for dogfighting.',
    speed: 155, minSpeed: 45, boostSpeed: 250, accel: 90,
    pitch: 1.9, yaw: 1.35, roll: 3.4,
    hull: 80, shield: 70, shieldRegen: 12,
    laserDmg: 9, laserRate: 0.10, laserSpeed: 950,
    guns: [[-2.2, -0.2, -2.5], [2.2, -0.2, -2.5]], gunMode: 'alternate',
    secondary: 'missile', secAmmo: 6, secRegen: 5,
    stats: { speed: 5, armor: 2, firepower: 3, handling: 5 },
  },
  warden: {
    name: 'Warden',
    role: 'Heavy Fighter',
    desc: 'Ring-wing brawler with heavy shields and a close-range flak burst that shreds fighter packs.',
    speed: 132, minSpeed: 40, boostSpeed: 215, accel: 70,
    pitch: 1.6, yaw: 1.15, roll: 2.7,
    hull: 130, shield: 110, shieldRegen: 14,
    laserDmg: 11, laserRate: 0.15, laserSpeed: 900,
    guns: [[-2.6, 0.6, -2], [2.6, 0.6, -2], [-2.6, -0.8, -2], [2.6, -0.8, -2]], gunMode: 'pairs',
    secondary: 'flak', secAmmo: 5, secRegen: 4,
    stats: { speed: 3, armor: 4, firepower: 4, handling: 3 },
  },
  hammer: {
    name: 'Hammer',
    role: 'Bomber',
    desc: 'Slow but tough. Heavy cannons and plasma bombs that crack gunships, freighters and capital ships.',
    speed: 112, minSpeed: 35, boostSpeed: 190, accel: 55,
    pitch: 1.35, yaw: 1.0, roll: 2.2,
    hull: 170, shield: 80, shieldRegen: 10,
    laserDmg: 15, laserRate: 0.2, laserSpeed: 850,
    guns: [[-3.2, -0.4, -3], [3.2, -0.4, -3]], gunMode: 'together',
    secondary: 'bomb', secAmmo: 4, secRegen: 6,
    stats: { speed: 2, armor: 5, firepower: 5, handling: 2 },
  },
};

export const WEAPONS = {
  laser:   { life: 1.6 },
  missile: { speed: 330, life: 5, dmg: 70, turn: 2.8, splash: 0 },
  flak:    { speed: 700, life: 0.55, dmg: 8, pellets: 12, spread: 0.07 },
  bomb:    { speed: 220, life: 6, dmg: 260, splash: 70, gravity: 55 },
  // enemy weapons (damage applied client-side to players)
  elaser:  { speed: 620, life: 2.2, dmg: 5 },
  eheavy:  { speed: 480, life: 2.6, dmg: 12 },
  ebomb:   { speed: 0, life: 8, dmg: 90, splash: 50, gravity: 70 },
};

export const ENEMIES = {
  raider:    { hp: 28,  speed: 100, turn: 1.7, radius: 6,  score: 100, range: 650, breakDist: 90, fireRate: 0.55, team: 'enemy' },
  bomber:    { hp: 70,  speed: 72,  turn: 1.1, radius: 8,  score: 150, team: 'enemy' },
  gunship:   { hp: 380, speed: 34,  turn: 0.5, radius: 18, score: 400, team: 'enemy' },
  freighter: { hp: 520, speed: 30,  turn: 0,   radius: 34, score: 500, team: 'enemy' },
  turret:    { hp: 90,  radius: 9,  score: 150, range: 950, team: 'enemy' },
  generator: { hp: 360, radius: 20, score: 600, team: 'enemy' },
  core:      { hp: 1300, radius: 24, score: 2000, team: 'enemy' },
  tower:     { hp: 650, radius: 16, score: 0, team: 'ally' },
  wing:      { hp: 180,  speed: 125, turn: 1.9, radius: 6, score: 0, range: 700, breakDist: 80, fireRate: 0.45, team: 'ally' },
};

export const DIFFICULTY = {
  easy:   { label: 'Cadet',   count: 0.75, dmg: 0.6, fire: 0.75, reserves: 6 },
  normal: { label: 'Pilot',   count: 1.0,  dmg: 1.0, fire: 1.0,  reserves: 4 },
  hard:   { label: 'Ace',     count: 1.3,  dmg: 1.45, fire: 1.3, reserves: 2 },
};

export const MISSIONS = [
  {
    id: 'siege',
    name: 'Outpost Siege',
    env: 'planet',
    location: 'Kessa Prime — Relay Station Tamarin',
    briefing: 'Pirate raiders from the Crimson Fang are hitting the Tamarin relay station. Hold the line over the canyon plateau and keep the three relay towers standing until the raid breaks.',
    primary: ['Survive all three raid waves', 'At least one relay tower must survive'],
    bonus: ['Lose no relay towers', 'Complete the mission in under 6:00'],
    spawn: [0, 260, 1500],
    timeLimit: 0,
  },
  {
    id: 'convoy',
    name: 'Convoy Intercept',
    env: 'space',
    location: 'Hollow Reach — Vesk Asteroid Belt',
    briefing: 'A Crimson Fang supply convoy is running for the jump gate through the Vesk belt. Destroy the freighters before they jump. If three escape, the pirates rearm and we lose the sector.',
    primary: ['Destroy the freighters before they reach the jump gate', 'No more than two freighters may escape'],
    bonus: ['Let no freighter escape', 'Destroy 20 escort fighters'],
    spawn: [0, 120, 1900],
    timeLimit: 0,
  },
  {
    id: 'dread',
    name: 'Fall of the Ravager',
    env: 'space',
    location: 'Orinth Moon — High Orbit',
    briefing: 'The pirate dreadnought Ravager is parked over Orinth. Knock out its four shield generators to expose the reactor core on the ventral hull, then destroy the core. Expect heavy turret fire and fighters from the hangar.',
    primary: ['Destroy the four shield generators', 'Destroy the reactor core'],
    bonus: ['Destroy all eight defense turrets', 'Complete the mission in under 8:00'],
    spawn: [0, 160, 1350],
    timeLimit: 0,
  },
];

export const SCORE = { medalBonus: 1000 };
