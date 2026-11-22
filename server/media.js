// Media library stored in the Railway bucket (S3-compatible). Files are served same-origin via /media/<key>.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './content.js';

const INDEX_FILE = path.join(DATA_DIR, 'media-index.json');
export const LIMITS = { image: 10 * 1024 * 1024, model: 40 * 1024 * 1024, sound: 15 * 1024 * 1024 };
const FOLDER = { image: 'images', model: 'models', sound: 'sounds' };
const CACHE_MAX_BYTES = 64 * 1024 * 1024;   // in-memory cache for hot files (textures, models)
const CACHE_MAX_FILE = 12 * 1024 * 1024;

let s3 = null, S3 = null;
const cfg = {
  endpoint: process.env.S3_ENDPOINT, bucket: process.env.S3_BUCKET, region: process.env.S3_REGION || 'auto',
  key: process.env.S3_ACCESS_KEY_ID, secret: process.env.S3_SECRET_ACCESS_KEY,
};
export function configured() { return !!(cfg.endpoint && cfg.bucket && cfg.key && cfg.secret); }
async function client() {
  if (s3) return s3;
  if (!configured()) throw new Error('The media bucket is not connected (S3_* variables missing).');
  S3 = await import('@aws-sdk/client-s3');
  s3 = new S3.S3Client({
    endpoint: cfg.endpoint, region: cfg.region === 'auto' ? 'auto' : cfg.region,
    credentials: { accessKeyId: cfg.key, secretAccessKey: cfg.secret },
    forcePathStyle: process.env.S3_PATH_STYLE === '1',
  });
  return s3;
}

// ---------------- index (fast listing + metadata) ----------------
let index = [];
try { index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch {}
function saveIndex() {
  const tmp = `${INDEX_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(index));
  fs.renameSync(tmp, INDEX_FILE);
}
export function list() { return [...index].sort((a, b) => b.uploadedAt - a.uploadedAt); }
export function find(key) { return index.find((m) => m.key === key); }
export function status() {
  return { configured: configured(), bucket: cfg.bucket || null, count: index.length, bytes: index.reduce((n, m) => n + m.size, 0), limits: LIMITS };
}

// ---------------- validation ----------------
function guessType(key) {
  const ext = key.split('.').pop();
  return { glb: 'model/gltf-binary', jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4' }[ext] || 'application/octet-stream';
}
function sniff(buf) {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return { kind: 'image', type: 'image/png', ext: 'png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'image', type: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 6 && buf.toString('ascii', 0, 6).startsWith('GIF8')) return { kind: 'image', type: 'image/gif', ext: 'gif' };
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { kind: 'image', type: 'image/webp', ext: 'webp' };
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'glTF' && buf.readUInt32LE(4) === 2) return { kind: 'model', type: 'model/gltf-binary', ext: 'glb' };
  // audio: MP3 (ID3 tag or MPEG frame sync), Ogg, WAV, M4A/AAC
  if (buf.length >= 3 && buf.toString('ascii', 0, 3) === 'ID3') return { kind: 'sound', type: 'audio/mpeg', ext: 'mp3' };
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) !== 0) return { kind: 'sound', type: 'audio/mpeg', ext: 'mp3' };
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS') return { kind: 'sound', type: 'audio/ogg', ext: 'ogg' };
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return { kind: 'sound', type: 'audio/wav', ext: 'wav' };
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp' && /^(M4A|mp4|isom|M4B)/.test(buf.toString('ascii', 8, 12))) return { kind: 'sound', type: 'audio/mp4', ext: 'm4a' };
  return null;
}
function imageSize(buf, type) {
  try {
    if (type === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (type === 'image/gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (type === 'image/webp') {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    }
    if (type === 'image/jpeg') {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch {}
  return {};
}

// Read a GLB and report what the game cares about.
export function inspectGlb(buf) {
  const report = { ok: true, warnings: [], errors: [] };
  try {
    const total = buf.readUInt32LE(8);
    if (total !== buf.length) report.warnings.push(`Header says ${total} bytes but the file has ${buf.length}.`);
    const jsonLen = buf.readUInt32LE(12);
    if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error('first chunk is not JSON');
    const j = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
    const nodes = j.nodes || [], meshes = j.meshes || [], acc = j.accessors || [];
    let tris = 0, hasUv = true, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const m of meshes) for (const p of m.primitives || []) {
      const pos = acc[p.attributes?.POSITION];
      if (pos?.min && pos?.max) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos.min[k]); max[k] = Math.max(max[k], pos.max[k]); }
      const idx = p.indices != null ? acc[p.indices] : pos;
      tris += Math.floor((idx?.count || 0) / 3);
      if (!p.attributes?.TEXCOORD_0) hasUv = false;
    }
    const names = nodes.map((n) => n.name || '');
    const engines = names.filter((n) => /^engine/i.test(n));
    const guns = names.filter((n) => /^gun/i.test(n));
    const materials = (j.materials || []).map((m) => m.name || '(unnamed)');
    const size = min[0] === Infinity ? null : max.map((v, k) => +(v - min[k]).toFixed(2));
    Object.assign(report, {
      generator: j.asset?.generator || null, triangles: tris, meshes: meshes.length, nodes: nodes.length,
      materials, images: (j.images || []).length, animations: (j.animations || []).length,
      engines: engines.length, guns: guns.length, size, baked: materials.some((n) => /Baked$/.test(n)),
      extensionsRequired: j.extensionsRequired || [],
    });
    if (report.extensionsRequired.some((e) => /draco|meshopt|KHR_texture_basisu/i.test(e))) report.errors.push(`Uses compression the game can't decode yet: ${report.extensionsRequired.join(', ')}. Re-export without Draco/Meshopt compression.`);
    if (!engines.length) report.warnings.push('No engine markers yet: place them with the Markers button (or add empties named engine_* in Blender). Until then the game puts one engine at the tail.');
    if (!guns.length) report.warnings.push('No gun markers yet: place them with the Markers button, or cannons fire from the default gun positions.');
    if (tris > 150000) report.warnings.push(`${tris.toLocaleString()} triangles is heavy for a fighter (aim for under 50k).`);
    if (!hasUv && materials.length) report.warnings.push('Some meshes have no UV coordinates, so textures can\'t map onto them.');
    if (size && Math.max(...size) > 40) report.warnings.push(`The model is ${Math.max(...size)} units across. Ships are about 12–15, so check its scale.`);
    if (size && Math.max(...size) < 2) report.warnings.push(`The model is only ${Math.max(...size)} units across. Ships are about 12–15, so check its scale.`);
    if (!report.baked) report.warnings.push('No material ends in "Baked": the game will repaint it with hull panels and player colours.');
  } catch (e) {
    report.ok = false; report.errors.push(`Not a readable GLB: ${e.message}`);
  }
  if (report.errors.length) report.ok = false;
  return report;
}

function cleanName(name) {
  const base = path.basename(String(name || 'file')).replace(/\.[a-z0-9]+$/i, '');
  return base.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'file';
}

// ---------------- operations ----------------
export async function upload(buf, originalName, by) {
  const t = sniff(buf);
  if (!t) throw Object.assign(new Error('Unsupported file. Upload PNG, JPEG, WebP or GIF images, or GLB models.'), { status: 415 });
  if (buf.length > LIMITS[t.kind]) throw Object.assign(new Error(`Too large: ${t.kind}s can be up to ${LIMITS[t.kind] / 1048576} MB.`), { status: 413 });
  const meta = { ...(t.kind === 'image' ? imageSize(buf, t.type) : {}) };
  let report = null;
  if (t.kind === 'model') { report = inspectGlb(buf); if (!report.ok) throw Object.assign(new Error(report.errors.join(' ')), { status: 422 }); }
  const id = crypto.randomBytes(6).toString('hex');
  const key = `${FOLDER[t.kind]}/${id}-${cleanName(originalName)}.${t.ext}`;
  const etag = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
  const c = await client();
  await c.send(new S3.PutObjectCommand({
    Bucket: cfg.bucket, Key: key, Body: buf, ContentType: t.type,
    CacheControl: 'public, max-age=31536000, immutable',
    Metadata: { originalname: encodeURIComponent(String(originalName).slice(0, 200)), uploadedby: String(by || '').slice(0, 40) },
  }));
  const item = { key, url: `/media/${key}`, name: String(originalName).slice(0, 120), kind: t.kind, type: t.type, size: buf.length, etag, uploadedAt: Date.now(), by, ...meta, report };
  index.push(item); saveIndex();
  cachePut(key, { buf, type: t.type, etag });
  return item;
}

export async function remove(key) {
  const c = await client();
  await c.send(new S3.DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
  index = index.filter((m) => m.key !== key); saveIndex();
  cache.delete(key);
}

export async function resync() {
  // Rebuild the index from what's actually in the bucket (keeps metadata we already know).
  const c = await client();
  const known = new Map(index.map((m) => [m.key, m]));
  const fresh = [];
  let token;
  do {
    const r = await c.send(new S3.ListObjectsV2Command({ Bucket: cfg.bucket, ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of r.Contents || []) {
      if (!/^(images|models|sounds)\//.test(o.Key)) continue;
      fresh.push(known.get(o.Key) || { key: o.Key, url: `/media/${o.Key}`, name: o.Key.split('/').pop(), kind: o.Key.startsWith('models/') ? 'model' : o.Key.startsWith('sounds/') ? 'sound' : 'image', type: guessType(o.Key), size: o.Size, uploadedAt: +new Date(o.LastModified), by: '?', report: null });
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  index = fresh; saveIndex();
  return index.length;
}

// ---------------- serving (same origin, so three.js can load models/textures without CORS) ----------------
const cache = new Map(); let cacheBytes = 0;
function cachePut(key, v) {
  if (v.buf.length > CACHE_MAX_FILE) return;
  if (cache.has(key)) { cacheBytes -= cache.get(key).buf.length; cache.delete(key); }
  cache.set(key, v); cacheBytes += v.buf.length;
  for (const [k, old] of cache) { if (cacheBytes <= CACHE_MAX_BYTES) break; cache.delete(k); cacheBytes -= old.buf.length; }
}
export async function serve(req, res, key) {
  if (!/^(images|models|sounds)\/[\w.-]+$/.test(key)) { res.writeHead(404); return res.end(); }
  let hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); }   // LRU touch
  else {
    try {
      const c = await client();
      const r = await c.send(new S3.GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      const buf = Buffer.from(await r.Body.transformToByteArray());
      hit = { buf, type: r.ContentType || 'application/octet-stream', etag: (r.ETag || '').replace(/"/g, '').slice(0, 16) || crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) };
      cachePut(key, hit);
    } catch (e) {
      const notFound = e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
      res.writeHead(notFound ? 404 : 502, { 'content-type': 'text/plain' });
      return res.end(notFound ? 'Not found' : 'Media storage unavailable');
    }
  }
  const etag = `"${hit.etag}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag }); return res.end(); }
  res.writeHead(200, {
    'content-type': hit.type, 'content-length': hit.buf.length, etag,
    'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
  });
  res.end(req.method === 'HEAD' ? undefined : hit.buf);
}
