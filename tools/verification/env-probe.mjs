// G42（AGENTS §8 瀏覽器路徑探針，G30 方法產品化）：判定「真實瀏覽器 ↔ loopback HTTP」路徑是否乾淨。
// 背景：AdGuard 等本機過濾曾對 Chromium↔127.0.0.1 注入 CSP／Permissions-Policy 並間歇截斷大回應 body，
// 造成 test:runtime／test:e2e／test:endurance 假失敗；curl 乾淨不構成證據（G30，假陰性）。
// 方法：自起 ephemeral loopback 靜態伺服器（零 CSP／Permissions-Policy），真實 Chromium 於頁內 fetch
// ≥2 MB GLB 三次，斷言 got===content-length 全等、requestfailed 為零；HTML 與 GLB 回應一律以
// 瀏覽器觀察到的 header 判定——出現任何 CSP／Permissions-Policy 或 adguard 指紋即視為注入。
// 用法：node tools/verification/env-probe.mjs [--glb <path>] [--min-bytes N]
//   環境：SAND_PROBE_GLB=<path> 指定 GLB；SAND_PROBE_FAULT=truncate|inject 僅供自檢（注入故障，應得 ENV_BLOCKED）。
// 結果：exit 0=PASS、1=ENV_BLOCKED、2=SETUP_ERROR、3=TIMEOUT；末行輸出 ENV_PROBE_RESULT=<verdict>。
import {createServer} from 'node:http';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';
const {chromium} = await import('@playwright/test');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const MIN_BYTES = Number(arg('--min-bytes', 2 * 1024 * 1024));
const FAULT = process.env.SAND_PROBE_FAULT ?? '';

function findGlb() {
  const explicit = process.env.SAND_PROBE_GLB ?? arg('--glb', '');
  if (explicit) {
    const p = resolve(explicit);
    const size = statSync(p).size;
    if (size < MIN_BYTES) throw new Error(`指定的 GLB 僅 ${size} B，小於 --min-bytes=${MIN_BYTES}`);
    return p;
  }
  const dir = join(ROOT, 'apps', 'web', 'public', 'imported-assets');
  const found = [];
  const walk = d => {
    for (const e of readdirSync(d, {withFileTypes: true})) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.glb')) found.push([statSync(p).size, p]);
    }
  };
  walk(dir);
  if (!found.length) throw new Error(`找不到任何 GLB（${dir}）`);
  found.sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : 1));
  const [size, path] = found[0];
  if (size < MIN_BYTES) throw new Error(`最大的 GLB 僅 ${size} B，小於 --min-bytes=${MIN_BYTES}`);
  return path;
}

const checks = [];
const add = (name, ok, detail = '') => checks.push({name, ok, detail});
const badHeaders = headers =>
  headers.filter(([k, v]) => k === 'permissions-policy' || k === 'content-security-policy' || /adguard/i.test(k + v));

const guard = setTimeout(() => {
  console.error('env-probe：90 秒未完成（瀏覽器可能被本機過濾掛住）');
  console.error('ENV_PROBE_RESULT=TIMEOUT');
  process.exit(3);
}, 90_000);

let server;
let browser;
try {
  const glbPath = findGlb();
  const glb = readFileSync(glbPath);
  const servedGlb = FAULT === 'truncate' ? glb.subarray(0, glb.length - 1024 * 1024) : glb;
  const html = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>env-probe</title></head><body>env-probe</body></html>';
  server = createServer((req, res) => {
    if (FAULT === 'inject') {
      res.setHeader('Permissions-Policy', 'join-ad-interest-group=(), run-ad-auction=()');
      res.setHeader('Content-Security-Policy', "default-src 'self' https://local.adguard.org");
    }
    if (new URL(req.url, 'http://x').pathname === '/probe.glb') {
      res.writeHead(200, {'content-type': 'model/gltf-binary', 'content-length': String(glb.length)});
      res.end(servedGlb);
    } else {
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html)});
      res.end(html);
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  console.log(`env-probe：origin=${origin} glb=${glbPath}（${glb.length} B）fault=${FAULT || 'none'}`);

  browser = await chromium.launch();
  const page = await browser.newPage();
  const requestFailed = [];
  const consoleHits = [];
  page.on('requestfailed', r => {
    if (r.url().includes('/probe.glb')) requestFailed.push(r.failure()?.errorText ?? 'unknown');
  });
  page.on('console', m => {
    if (/Permissions-Policy header|local\.adguard\.org/i.test(m.text())) consoleHits.push(m.text());
  });

  let htmlHeaders = null;
  try {
    const resp = await page.goto(`${origin}/`, {waitUntil: 'load', timeout: 30_000});
    htmlHeaders = [...Object.entries(resp.headers())];
  } catch (e) {
    add('html-load', false, String(e).slice(0, 300));
  }
  if (htmlHeaders) {
    const bad = badHeaders(htmlHeaders);
    add('html-headers-clean', bad.length === 0, bad.length ? JSON.stringify(bad) : '無 CSP／Permissions-Policy／adguard 指紋');
  }

  const fetches = [];
  for (let i = 0; i < 3; i++) {
    try {
      fetches.push(
        await page.evaluate(async () => {
          const r = await fetch('/probe.glb');
          const buf = await r.arrayBuffer();
          return {status: r.status, cl: Number(r.headers.get('content-length')), got: buf.byteLength, headers: [...r.headers.entries()]};
        })
      );
    } catch (e) {
      fetches.push({status: 0, cl: 0, got: 0, error: String(e).slice(0, 200)});
    }
  }
  fetches.forEach((f, i) => {
    const ok = f.status === 200 && f.cl === glb.length && f.got === f.cl;
    add(`glb-fetch-${i + 1}`, ok, `status=${f.status} cl=${f.cl} got=${f.got}${f.error ? ` error=${f.error}` : ''}${ok ? '' : ` bad-headers=${JSON.stringify(badHeaders(f.headers ?? []))}`}`);
  });
  add('glb-requestfailed-zero', requestFailed.length === 0, requestFailed.join('; ') || '0');
  add('console-clean', consoleHits.length === 0, consoleHits.join(' | ') || '無 Permissions-Policy／adguard 指紋');

  const failed = checks.filter(c => !c.ok);
  const verdict = failed.length ? 'ENV_BLOCKED' : 'PASS';
  for (const c of checks) console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name} ${c.detail}`);
  console.log(`ENV_PROBE_RESULT=${verdict}`);
  process.exitCode = failed.length ? 1 : 0;
} catch (e) {
  console.error(`env-probe：設定失敗——${e?.message ?? e}`);
  console.error('ENV_PROBE_RESULT=SETUP_ERROR');
  process.exitCode = 2;
} finally {
  clearTimeout(guard);
  await browser?.close().catch(() => {});
  if (server) {
    server.closeAllConnections?.();
    await new Promise(r => server.close(r));
  }
}
