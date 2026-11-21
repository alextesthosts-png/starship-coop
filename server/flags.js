// Feature flags: built-in defaults < Railway feature flags (SDK, when RAILWAY_TOKEN is set) < admin overrides.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './content.js';

export const FLAG_DEFS = [
  { name: 'vw.mission.siege', group: 'Missions', label: 'Outpost Siege', default: true },
  { name: 'vw.mission.convoy', group: 'Missions', label: 'Convoy Intercept', default: true },
  { name: 'vw.mission.dread', group: 'Missions', label: 'Fall of the Ravager', default: true },
  { name: 'vw.ship.lancer', group: 'Ships', label: 'Lancer', default: true },
  { name: 'vw.ship.warden', group: 'Ships', label: 'Warden', default: true },
  { name: 'vw.ship.hammer', group: 'Ships', label: 'Hammer', default: true },
  { name: 'vw.event.double_score', group: 'Events', label: 'Double score weekend', desc: 'Every kill and objective pays 2×.', default: false },
  { name: 'vw.event.extra_reserves', group: 'Events', label: 'Extra reserve ships', desc: '+2 shared reserve ships per mission.', default: false },
  { name: 'vw.event.ai_wingmates', group: 'Events', label: 'AI wingmates', desc: 'AI pilots fill empty wing slots.', default: true },
];
const BY_NAME = new Map(FLAG_DEFS.map((f) => [f.name, f]));
const FILE = path.join(DATA_DIR, 'flags.json');

let overrides = {};
try { overrides = JSON.parse(fs.readFileSync(FILE, 'utf8')).overrides || {}; } catch {}

// ---------------- Railway feature flags (optional) ----------------
let rw = null;               // the SDK's flags module once initialised
let rwStatus = { enabled: false, synced: false, error: null, lastSync: null };
export async function initRailwayFlags() {
  if (!process.env.RAILWAY_TOKEN && !process.env.RAILWAY_API_TOKEN) {
    rwStatus.error = 'Add a project token as RAILWAY_TOKEN to read flags from Railway.';
    return;
  }
  try {
    const { flags } = await import('railway');
    await flags.init({ timeoutMs: 8000 });
    rw = flags;
    rwStatus = { enabled: true, synced: flags.synced, error: null, lastSync: Date.now() };
    console.log('Railway feature flags connected:', flags.list().filter((n) => n.startsWith('vw.')).length, 'game flags');
  } catch (e) {
    rwStatus = { enabled: false, synced: false, error: `Railway flags unavailable: ${e.message}`, lastSync: null };
    console.warn(rwStatus.error);
  }
}

function railwayValue(name) {
  if (!rw) return undefined;
  try {
    if (!rw.has(name)) return undefined;
    return rw.getBoolean(name, undefined, BY_NAME.get(name).default);
  } catch { return undefined; }
}

// ---------------- resolution ----------------
export function resolveAll() {
  const out = {};
  for (const f of FLAG_DEFS) {
    if (typeof overrides[f.name] === 'boolean') out[f.name] = overrides[f.name];
    else { const r = railwayValue(f.name); out[f.name] = typeof r === 'boolean' ? r : f.default; }
  }
  // safety net: never switch off every mission or every ship
  for (const prefix of ['vw.mission.', 'vw.ship.']) {
    const names = FLAG_DEFS.filter((f) => f.name.startsWith(prefix)).map((f) => f.name);
    if (!names.some((n) => out[n])) out[names[0]] = true;
  }
  return out;
}
export function describeAll() {
  const eff = resolveAll();
  return FLAG_DEFS.map((f) => {
    const r = railwayValue(f.name);
    const source = typeof overrides[f.name] === 'boolean' ? 'override' : typeof r === 'boolean' ? 'railway' : 'default';
    return { ...f, value: eff[f.name], source, railway: r ?? null, override: overrides[f.name] ?? null };
  });
}
export function railwayStatus() {
  if (rw) { rwStatus.synced = rw.synced; }
  return { ...rwStatus };
}
export function setOverride(name, value) {
  if (!BY_NAME.has(name)) throw new Error('unknown flag');
  if (value === null) delete overrides[name];
  else if (typeof value === 'boolean') overrides[name] = value;
  else throw new Error('value must be true, false or null');
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ overrides }, null, 1));
  fs.renameSync(tmp, FILE);
}
export async function refreshRailway() { if (rw) { await rw.refresh(); rwStatus.lastSync = Date.now(); } }

// ---------------- convenience for game logic ----------------
export const flagKey = { mission: (id) => `vw.mission.${id}`, ship: (id) => `vw.ship.${id}` };
export function gameFlags(all = resolveAll()) {
  return {
    missions: Object.fromEntries(['siege', 'convoy', 'dread'].map((m) => [m, all[flagKey.mission(m)]])),
    ships: Object.fromEntries(['lancer', 'warden', 'hammer'].map((s) => [s, all[flagKey.ship(s)]])),
    doubleScore: all['vw.event.double_score'],
    extraReserves: all['vw.event.extra_reserves'],
    aiWingmates: all['vw.event.ai_wingmates'],
  };
}

// Poll for changes and notify (Railway SDK refreshes itself in the background)
let last = '';
export function watchFlags(onChange, everyMs = 3000) {
  last = JSON.stringify(gameFlags());
  setInterval(() => {
    const now = JSON.stringify(gameFlags());
    if (now !== last) { last = now; onChange(JSON.parse(now)); }
  }, everyMs).unref();
}
