// Editable site content + admin accounts, stored as JSON on the Railway volume (/data).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : path.join(ROOT, 'data'));
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const REV_DIR = path.join(DATA_DIR, 'revisions');
const MAX_REVISIONS = 30;
fs.mkdirSync(REV_DIR, { recursive: true });

// ---------------- defaults (what the page shipped with) ----------------
export const DEFAULT_CONTENT = {
  site: {
    pageTitle: 'Vanguard Wing — Co-op Starfighter',
    metaDescription: 'A co-op 3D arcade starfighter game in your browser. Fly missions with up to 4 friends.',
    title: 'VANGUARD', titleAccent: 'WING',
    tagline: 'Co-op arcade starfighter · 1–4 pilots · plays in your browser',
    step1: 'Choose your callsign', step2: 'Pick a starfighter', step3: 'Launch',
    namePlaceholder: 'e.g. Nightjar',
    quickLabel: 'Quick Play', quickSub: 'join any open wing',
    createLabel: 'Create a Wing', createSub: 'invite friends with a code',
    joinLabel: 'Join with code',
    forumUrl: process.env.FORUM_URL || 'https://vanguard-forum-production.up.railway.app',
    forumLabel: 'Community Forum',
  },
  announcement: { enabled: false, text: '', style: 'info', image: '' },
  settings: {
    accent: '#6fd6ff',
    showOpenWings: true, showHowTo: true, showChangelog: true,
    defaultTab: 'rooms',
    background: '', backgroundDim: 0.55,
    shipModels: { lancer: '', warden: '', hammer: '' },
    maintenance: { enabled: false, message: 'We are upgrading the hangar. New games are paused for a few minutes.' },
  },
  sections: [],
  changelog: [
    { id: 'v1-7', version: 'v1.7', date: '21 Nov 2026', title: '', latest: true, items: [
      '**Media library** in the admin panel, stored in a Railway bucket: upload images and 3D ship models by drag and drop, preview them, copy links and see where each file is used.',
      '**Custom ship models:** swap any ship\'s model for an uploaded GLB. A built-in inspector shows a 3D preview, triangle count, size, engine/gun markers and tips before you publish.',
      '**Announcement banner images**, a menu **background image**, and images inside custom sections (`![caption](link)`).',
      '**Feature flags:** switch missions, ships and events (double score, extra reserves, AI wingmates) on and off live, powered by Railway feature flags with admin overrides.',
      '**Server health** page: requests, error rate, response times, memory, CPU, game-loop timing, players online, forum uptime and Railway platform metrics.',
      '**Preview builds:** pull requests can get their own temporary copy of the game, clearly marked with a PREVIEW ribbon.',
    ] },
    { id: 'v1-6', version: 'v1.6', date: '21 Nov 2026', title: '', latest: false, items: [
      '**Community forum** is open: create an account with your callsign and favourite ship, find wingmates, share tactics, report bugs and suggest features.',
      'Categories for announcements, looking-for-wingmates, tactics, ships, bug reports and suggestions; search, quotes and profiles.',
      'Wing Leaders (moderators) and Command (admins) can pin, lock, move and delete threads, ban accounts and manage categories.',
      '**Community Forum** button on the main page; its link and label can be changed in the admin panel.',
    ] },
    { id: 'v1-5', version: 'v1.5', date: '21 Nov 2026', title: '', latest: false, items: [
      '**Admin panel** at `/admin`: sign in to edit the landing page texts, post an announcement banner, add custom info tabs and write the changelog. No code changes needed.',
      '**Site settings:** accent colour, which info tabs are shown and which opens first, browser title and search description.',
      '**Maintenance mode** pauses new games with a message to players while you update; missions in flight finish normally.',
      '**History:** every save keeps the previous version (last 30) and any of them can be restored with one click.',
      'Content is stored on a persistent Railway volume, so edits survive redeploys.',
    ] },
    { id: 'v1-4', version: 'v1.4', date: '21 Nov 2026', title: '', latest: false, items: [
      '**New Warden heavy fighter.** Rebuilt in Blender with about 9,000 triangles (was a few hundred): armoured body, full ring wing on four struts, four ring-mounted cannons, chin turret, a big main engine plus two side engines.',
      '**Baked materials:** slate-blue armour paint over panelled plating, chipped edges showing bare metal, grime in the recesses, hazard stripes inside the ring, scratched gunmetal, tinted canopy and amber glow strips — baked so it looks the same as in Blender.',
      '**Engine exhaust plumes.** Each engine now has a proper plume: white-hot core inside a coloured sheath, short while cruising, stretching out on boost. Replaces the glow particles that filled the screen with a white haze when boosting.',
      'Warden cannons fire from the new ring mounts; engine plume sizes come from the model.',
    ] },
    { id: 'v1-3', version: 'v1.3', date: '21 Nov 2026', title: '', latest: false, items: [
      '**New Lancer starfighter.** The interceptor now flies a detailed hull with gunmetal plating, panel wear, glass canopy, intake vents and glowing details, taken straight from its Blender scene.',
      '**Realistic metal.** Ships with authored materials now reflect a studio light environment, so metal reads as metal instead of flat grey.',
      '**Cannon positions** moved to match the new hull; engine flares sit on the real exhausts.',
      '**New landing page** with a centred, step-by-step menu, How to Play and a changelog.',
    ] },
    { id: 'v1-2', version: 'v1.2', date: '21 Nov 2026', title: '', latest: false, items: [
      'First Blender-modelled Lancer (forward-swept wings, wingtip cannons, V-tail), kept as `lancer_classic.glb`.',
      'Ships can now load from GLB model files, with engine flares placed by markers in the model and a built-in fallback ship if a file fails to load.',
    ] },
    { id: 'v1-1', version: 'v1.1', date: '18 Nov 2026', title: '', latest: false, items: [
      '**Textured terrain on Kessa Prime:** red desert sand on the flats, dry rocky ground on slopes and layered cliff strata on canyon walls, blended automatically by slope and height.',
      'Each texture is sampled at two sizes so it doesn\'t visibly repeat across the canyon.',
      'Rock textures on asteroids and spires; panelled hull plating on the dreadnought, freighters, towers, base buildings and enemy ships.',
      'Brighter dreadnought and cleaner objective labels at long range.',
    ] },
    { id: 'v1-0', version: 'v1.0', date: '18 Nov 2026', title: '', latest: false, items: [
      'Launch: online co-op for 1–4 pilots with invite codes, Quick Play and AI wingmates to fill empty slots.',
      'Three ships: Lancer (interceptor, seeker missiles), Warden (heavy fighter, flak), Hammer (bomber, plasma bombs).',
      'Three missions: Outpost Siege, Convoy Intercept, Fall of the Ravager — each with bonus objectives for bronze, silver and gold medals.',
      'Shared reserve ships, radar, lead indicator, missile lock, radio chatter, debrief stats and gamepad support.',
    ] },
  ],
  updatedAt: null,
  updatedBy: null,
};

// ---------------- validation ----------------
const str = (v, max, def = '') => (typeof v === 'string' ? v.replace(/\u0000/g, '').slice(0, max) : def);
const bool = (v, def = false) => (typeof v === 'boolean' ? v : def);
const slug = (v, i) => (typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v) ? v : `item-${Date.now().toString(36)}-${i}`);

export function normalize(input) {
  const d = DEFAULT_CONTENT;
  const s = input?.site || {};
  const site = {};
  const limits = { forumUrl: 200, forumLabel: 40, pageTitle: 80, metaDescription: 200, title: 30, titleAccent: 30, tagline: 160, step1: 60, step2: 60, step3: 60, namePlaceholder: 30, quickLabel: 30, quickSub: 60, createLabel: 30, createSub: 60, joinLabel: 30 };
  for (const [k, max] of Object.entries(limits)) site[k] = str(s[k], max, d.site[k]);
  if (site.forumUrl && !/^https?:\/\//.test(site.forumUrl)) site.forumUrl = '';   // only real web links
  const a = input?.announcement || {};
  const mediaUrl = (v, kind) => (typeof v === 'string' && new RegExp(`^/media/${kind}/[\\w.-]+$`).test(v) ? v : '');
  const announcement = { enabled: bool(a.enabled), text: str(a.text, 500), style: ['info', 'success', 'warning'].includes(a.style) ? a.style : 'info', image: mediaUrl(a.image, 'images') };
  const st = input?.settings || {};
  const sections = (Array.isArray(input?.sections) ? input.sections : []).slice(0, 12).map((x, i) => ({
    id: slug(x?.id, i), title: str(x?.title, 40, 'Section') || 'Section', body: str(x?.body, 10000), visible: bool(x?.visible, true),
  }));
  const tabIds = ['rooms', 'howto', 'changelog', ...sections.map((x) => x.id)];
  const settings = {
    accent: typeof st.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(st.accent) ? st.accent.toLowerCase() : d.settings.accent,
    showOpenWings: bool(st.showOpenWings, true), showHowTo: bool(st.showHowTo, true), showChangelog: bool(st.showChangelog, true),
    defaultTab: tabIds.includes(st.defaultTab) ? st.defaultTab : 'rooms',
    background: mediaUrl(st.background, 'images'),
    backgroundDim: typeof st.backgroundDim === 'number' || typeof st.backgroundDim === 'string' ? Math.min(0.9, Math.max(0, +st.backgroundDim || 0)) : 0.55,
    shipModels: Object.fromEntries(['lancer', 'warden', 'hammer'].map((k) => [k, mediaUrl(st.shipModels?.[k], 'models')])),
    maintenance: { enabled: bool(st.maintenance?.enabled), message: str(st.maintenance?.message, 300, d.settings.maintenance.message) },
  };
  const changelog = (Array.isArray(input?.changelog) ? input.changelog : []).slice(0, 200).map((r, i) => ({
    id: slug(r?.id, i), version: str(r?.version, 24, 'v?'), date: str(r?.date, 40), title: str(r?.title, 100), latest: bool(r?.latest),
    items: (Array.isArray(r?.items) ? r.items : []).map((t) => str(t, 800).trim()).filter(Boolean).slice(0, 60),
  }));
  const knownReleases = (Array.isArray(input?.knownReleases) ? input.knownReleases : []).filter((x) => typeof x === 'string').slice(0, 500);
  return { site, announcement, settings, sections, changelog, knownReleases, updatedAt: input?.updatedAt || null, updatedBy: input?.updatedBy || null };
}

// ---------------- load / save ----------------
let content = null;
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
export function getContent() {
  if (content) return content;
  let stored = null;
  try { stored = JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8')); } catch {}
  content = normalize(stored || DEFAULT_CONTENT);
  // merge built-in release notes the admin hasn't seen yet (deleted ones stay deleted)
  const builtIn = DEFAULT_CONTENT.changelog.map((r) => r.id);
  if (!stored) content.knownReleases = builtIn;
  else {
    const known = new Set(content.knownReleases.length ? content.knownReleases : content.changelog.map((r) => r.id));
    const fresh = DEFAULT_CONTENT.changelog.filter((r) => !known.has(r.id) && !content.changelog.some((c) => c.id === r.id));
    if (fresh.length) {
      if (fresh.some((r) => r.latest)) content.changelog.forEach((r) => { r.latest = false; });
      content.changelog.unshift(...fresh.map((r) => ({ ...r, items: [...r.items] })));
    }
    content.knownReleases = [...new Set([...known, ...builtIn])];
    if (fresh.length) { try { writeAtomic(CONTENT_FILE, JSON.stringify(content, null, 1)); } catch (e) { console.error(e); } }
  }
  return content;
}
export function saveContent(input, by) {
  const prev = getContent();
  // keep the previous version as a revision
  const revId = new Date().toISOString().replace(/[:.]/g, '-');
  try { writeAtomic(path.join(REV_DIR, `${revId}.json`), JSON.stringify(prev)); } catch (e) { console.error('revision write failed', e); }
  const next = normalize(input);
  next.knownReleases = [...new Set([...(prev.knownReleases || []), ...DEFAULT_CONTENT.changelog.map((r) => r.id)])];
  next.updatedAt = new Date().toISOString();
  next.updatedBy = by;
  writeAtomic(CONTENT_FILE, JSON.stringify(next, null, 1));
  content = next;
  pruneRevisions();
  return next;
}
function pruneRevisions() {
  const files = fs.readdirSync(REV_DIR).filter((f) => f.endsWith('.json')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - MAX_REVISIONS))) fs.rmSync(path.join(REV_DIR, f), { force: true });
}
export function listRevisions() {
  return fs.readdirSync(REV_DIR).filter((f) => f.endsWith('.json')).sort().reverse().map((f) => {
    const full = path.join(REV_DIR, f);
    let meta = {};
    try { const j = JSON.parse(fs.readFileSync(full, 'utf8')); meta = { updatedAt: j.updatedAt, updatedBy: j.updatedBy, releases: j.changelog?.length || 0 }; } catch {}
    return { id: f.replace(/\.json$/, ''), savedAt: f.replace(/\.json$/, ''), size: fs.statSync(full).size, ...meta };
  });
}
export function restoreRevision(id, by) {
  if (!/^[0-9TZ-]+$/.test(id)) throw new Error('bad revision id');
  const doc = JSON.parse(fs.readFileSync(path.join(REV_DIR, `${id}.json`), 'utf8'));
  return saveContent(doc, by);
}

// ---------------- admin accounts ----------------
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function readAdmin() {
  try { return JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8')); } catch { return null; }
}
export function adminConfigured() {
  return !!(readAdmin() || process.env.ADMIN_PASSWORD);
}
export function adminUser() {
  return readAdmin()?.user || process.env.ADMIN_USER || 'admin';
}
export function checkLogin(user, pw) {
  if (typeof user !== 'string' || typeof pw !== 'string' || pw.length > 200) return false;
  const stored = readAdmin();
  const okUser = crypto.timingSafeEqual(Buffer.from(crypto.createHash('sha256').update(user).digest()), Buffer.from(crypto.createHash('sha256').update(adminUser()).digest()));
  let okPw = false;
  if (stored) {
    const h = Buffer.from(hashPassword(pw, stored.salt).hash, 'hex');
    okPw = crypto.timingSafeEqual(h, Buffer.from(stored.hash, 'hex'));
  } else if (process.env.ADMIN_PASSWORD) {
    const a = crypto.createHash('sha256').update(pw).digest(), b = crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD).digest();
    okPw = crypto.timingSafeEqual(a, b);
  }
  return okUser && okPw;
}
export function setPassword(pw) {
  const { salt, hash } = hashPassword(pw);
  writeAtomic(ADMIN_FILE, JSON.stringify({ user: adminUser(), salt, hash, changedAt: new Date().toISOString() }));
}

// ---------------- sessions ----------------
const sessions = new Map(); // token -> { user, exp }
const SESSION_MS = 12 * 3600 * 1000;
export function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { user, exp: Date.now() + SESSION_MS });
  return token;
}
export function getSession(token) {
  const s = token && sessions.get(token);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(token); return null; }
  return s;
}
export function endSession(token) { sessions.delete(token); }
export function endAllSessions() { sessions.clear(); }
export const SESSION_SECONDS = SESSION_MS / 1000;

// ---------------- login rate limiting ----------------
const attempts = new Map(); // ip -> [timestamps]
export function loginAllowed(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  attempts.set(ip, list);
  return list.length < 8;
}
export function recordFailure(ip) { (attempts.get(ip) || attempts.set(ip, []).get(ip)).push(Date.now()); }
export function clearFailures(ip) { attempts.delete(ip); }
