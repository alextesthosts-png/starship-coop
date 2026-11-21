// Server health: in-process metrics (always on) + Railway platform metrics via the public GraphQL API (with RAILWAY_TOKEN).
import fs from 'node:fs';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { DATA_DIR } from './content.js';

const FILE = path.join(DATA_DIR, 'metrics.json');
const MINUTES = 24 * 60;              // keep 24 h at 1-minute resolution
const startedAt = Date.now();

const loop = monitorEventLoopDelay({ resolution: 20 }); loop.enable();
let lastCpu = process.cpuUsage(), lastCpuAt = process.hrtime.bigint();

function emptyBucket(t) {
  return { t, req: 0, s2: 0, s3: 0, s4: 0, s5: 0, latSum: 0, latMax: 0, lat: [], wsIn: 0, wsOut: 0, bytesOut: 0, tickSum: 0, tickN: 0, tickMax: 0 };
}
let series = [];
try { series = JSON.parse(fs.readFileSync(FILE, 'utf8')).series || []; } catch {}
let cur = emptyBucket(Math.floor(Date.now() / 60000) * 60000);
let gauges = () => ({});           // filled in by index.js (players, rooms…)
export function setGauges(fn) { gauges = fn; }

function finishBucket() {
  const b = cur;
  const lat = b.lat.sort((x, y) => x - y);
  const p95 = lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] : 0;
  const mem = process.memoryUsage();
  const now = process.hrtime.bigint(); const cpu = process.cpuUsage(lastCpu);
  const cpuPct = Number(cpu.user + cpu.system) / (Number(now - lastCpuAt) / 1000) * 100;
  lastCpu = process.cpuUsage(); lastCpuAt = now;
  const g = gauges();
  series.push({
    t: b.t, req: b.req, s2: b.s2, s3: b.s3, s4: b.s4, s5: b.s5,
    latAvg: b.req ? +(b.latSum / b.req).toFixed(1) : 0, latP95: +p95.toFixed(1), latMax: +b.latMax.toFixed(1),
    rssMB: +(mem.rss / 1048576).toFixed(1), heapMB: +(mem.heapUsed / 1048576).toFixed(1), cpu: +cpuPct.toFixed(1),
    lagMs: +(loop.mean / 1e6).toFixed(2), lagMax: +(loop.max / 1e6).toFixed(1),
    wsIn: b.wsIn, wsOut: b.wsOut, mbOut: +(b.bytesOut / 1048576).toFixed(2),
    tickAvg: b.tickN ? +(b.tickSum / b.tickN).toFixed(2) : 0, tickMax: +b.tickMax.toFixed(2),
    players: g.players || 0, rooms: g.rooms || 0, playing: g.playing || 0,
  });
  loop.reset();
  if (series.length > MINUTES) series.splice(0, series.length - MINUTES);
}
setInterval(() => {
  const t = Math.floor(Date.now() / 60000) * 60000;
  if (t !== cur.t) { finishBucket(); cur = emptyBucket(t); }
}, 1000).unref();
setInterval(persist, 5 * 60000).unref();
export function persist() { try { fs.writeFileSync(FILE, JSON.stringify({ series })); } catch {} }
process.on('SIGTERM', () => { persist(); process.exit(0); });

// ---------------- recording hooks ----------------
export function trackHttp(req, res) {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    cur.req++; cur.latSum += ms; cur.latMax = Math.max(cur.latMax, ms);
    if (cur.lat.length < 2000) cur.lat.push(ms);
    const c = Math.floor(res.statusCode / 100);
    if (c >= 2 && c <= 5) cur[`s${c}`]++;
    const len = +res.getHeader('content-length') || 0; cur.bytesOut += len;
  });
}
export function trackWsIn() { cur.wsIn++; }
export function trackWsOut(bytes, n = 1) { cur.wsOut += n; cur.bytesOut += bytes; }
export function trackTick(ms) { cur.tickSum += ms; cur.tickN++; if (ms > cur.tickMax) cur.tickMax = ms; }

export function snapshot(minutes = 60) {
  const mem = process.memoryUsage();
  const g = gauges();
  return {
    now: Date.now(), startedAt, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    node: process.version, memory: { rssMB: +(mem.rss / 1048576).toFixed(1), heapMB: +(mem.heapUsed / 1048576).toFixed(1) },
    lagMs: +(loop.mean / 1e6 || 0).toFixed(2), gauges: g,
    current: { req: cur.req, s5: cur.s5 },
    series: series.slice(-Math.min(MINUTES, Math.max(5, minutes))),
    deploy: {
      environment: process.env.RAILWAY_ENVIRONMENT_NAME || 'local', service: process.env.RAILWAY_SERVICE_NAME || null,
      region: process.env.RAILWAY_REPLICA_REGION || null, replica: process.env.RAILWAY_REPLICA_ID || null,
      deploymentId: process.env.RAILWAY_DEPLOYMENT_ID || null, commit: process.env.RAILWAY_GIT_COMMIT_SHA || null,
      commitMessage: (process.env.RAILWAY_GIT_COMMIT_MESSAGE || '').split('\n')[0] || null, branch: process.env.RAILWAY_GIT_BRANCH || null,
      domain: process.env.RAILWAY_PUBLIC_DOMAIN || null,
    },
  };
}

// ---------------- Railway platform metrics ----------------
const GQL = 'https://backboard.railway.com/graphql/v2';
const METRICS_QUERY = `query Metrics($environmentId: String, $serviceId: String, $startDate: DateTime!, $sampleRateSeconds: Int, $measurements: [MetricMeasurement!]!) {
  metrics(environmentId: $environmentId, serviceId: $serviceId, startDate: $startDate, sampleRateSeconds: $sampleRateSeconds, measurements: $measurements) {
    measurement values { ts value }
  }
}`;
const platformCache = new Map();
export function platformConfigured() { return !!(process.env.RAILWAY_TOKEN || process.env.RAILWAY_API_TOKEN); }
export async function platformMetrics(serviceId, hours = 1) {
  if (!platformConfigured()) return { error: 'Add a Railway project token as RAILWAY_TOKEN to see Railway\'s own CPU, memory and network graphs here.' };
  if (!serviceId) return { error: 'Unknown service id.' };
  const key = `${serviceId}:${hours}`;
  const c = platformCache.get(key);
  if (c && Date.now() - c.at < 60000) return c.data;
  const headers = { 'content-type': 'application/json' };
  if (process.env.RAILWAY_TOKEN) headers['project-access-token'] = process.env.RAILWAY_TOKEN;
  else headers.authorization = `Bearer ${process.env.RAILWAY_API_TOKEN}`;
  try {
    const res = await fetch(GQL, {
      method: 'POST', headers, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ query: METRICS_QUERY, variables: {
        environmentId: process.env.RAILWAY_ENVIRONMENT_ID, serviceId,
        startDate: new Date(Date.now() - hours * 3600e3).toISOString(),
        sampleRateSeconds: Math.max(60, Math.round(hours * 3600 / 120)),
        measurements: ['CPU_USAGE', 'MEMORY_USAGE_GB', 'NETWORK_RX_GB', 'NETWORK_TX_GB'],
      } }),
    });
    const j = await res.json();
    if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join('; '));
    const data = { series: Object.fromEntries((j.data?.metrics || []).map((m) => [m.measurement, (m.values || []).map((v) => [v.ts * 1000, v.value])])) };
    platformCache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    return { error: `Railway metrics unavailable: ${e.message}` };
  }
}

// ---------------- uptime probe for the forum ----------------
const probes = [];
export function probeForum(url) {
  if (!url) return;
  const run = async () => {
    const t0 = Date.now(); let ok = false, status = 0;
    try { const r = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(8000) }); ok = r.ok; status = r.status; } catch {}
    probes.push({ t: t0, ok, ms: Date.now() - t0, status });
    if (probes.length > 2880) probes.shift();
  };
  run(); setInterval(run, 30000).unref();
}
export function forumStatus() {
  const day = probes.filter((p) => p.t > Date.now() - 86400e3);
  const last = probes[probes.length - 1] || null;
  return { last, uptimePct: day.length ? +(day.filter((p) => p.ok).length / day.length * 100).toFixed(2) : null, checks: day.length, recent: probes.slice(-120).map((p) => [p.t, p.ok ? p.ms : -1]) };
}
