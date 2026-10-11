/** E2 asset-parallel stress: GET static assets at fixed concurrency for a fixed duration; report timing and first failure. Reads only; no retry, no restart. */
import {readdirSync} from 'node:fs';
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const i = a.indexOf('=');
  return [a.slice(2, i), a.slice(i + 1)];
}));
const base = args.base ?? 'http://127.0.0.1:8788';
const seconds = Number(args.seconds ?? 120);
const concurrency = Number(args.concurrency ?? 64);
const dir = args.dir ?? 'apps/web/dist/imported-assets/v1';
const files = readdirSync(dir).filter(f => f.endsWith('.png')).map(f => `/imported-assets/v1/${encodeURIComponent(f)}`);
if (files.length === 0) { console.error('no png files under ' + dir); process.exit(2); }
const deadline = Date.now() + seconds * 1000;
let ok = 0, fail = 0, firstFail = null;
const latencies = [];
const worker = async () => {
  let i = Math.floor(Math.random() * files.length);
  while (Date.now() < deadline) {
    const path = files[i = (i + 1) % files.length];
    const t0 = Date.now();
    try {
      const res = await fetch(base + path);
      const body = await res.arrayBuffer();
      const ms = Date.now() - t0;
      if (res.status === 200 && body.byteLength > 0) { ok++; latencies.push(ms); }
      else { fail++; if (!firstFail) firstFail = {time: new Date().toISOString(), path, status: res.status, bytes: body.byteLength, ms}; }
    } catch (error) {
      fail++;
      if (!firstFail) firstFail = {time: new Date().toISOString(), path, error: String(error && error.cause && error.cause.code || error.message), ms: Date.now() - t0};
      return; // stop this worker on connection failure; do not hammer a dead server
    }
  }
};
const t0 = Date.now();
await Promise.all(Array.from({length: concurrency}, worker));
latencies.sort((a, b) => a - b);
const pct = p => latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p / 100))] : null;
const result = {base, seconds, concurrency, files: files.length, ok, fail, firstFail, wallMs: Date.now() - t0, p50: pct(50), p95: pct(95), p99: pct(99), max: latencies.length ? latencies[latencies.length - 1] : null};
console.log(JSON.stringify(result, null, 1));
