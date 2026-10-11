#!/usr/bin/env node
// Procedural catalog batches (2026-10-02, Claude Opus 5.5): build + import code-defined sandtray miniatures.
//
//   node tools/assets/build_procedural_batch.mjs tools/assets/<batch>.json
//   (SML_CHROMIUM=<chrome.exe> when the playwright package's own browser build is not installed)
//
// Plan fields: batch, models (ES module exporting BUILDERS / finalize / resetMaterials), idPrefix, versionPrefix,
// color, maxBytes, maxTriangles, optional source + sourcePack (batch defaults), items[] {slug, name, category,
// optional source / sourcePack}. An item with a source records that file's sha256 as sourceSha256 (the file is only
// read); an item without one was modelled from scratch in the models file, whose sha256 is recorded instead.
// Headless Chromium runs the models with the project's own three (node_modules, no CDN) behind a routed fake origin (no
// loopback server, so local HTTP filters cannot interfere), exports each with GLTFExporter (binary) and renders a
// 480x480 thumbnail. Writes:
//   source/<batch>/{processed,thumbnails}/ + report.json        (working copies)
//   apps/web/public/imported-assets/<batch>/<ID>-<sha16>.glb + <ID>.png   (PROJECT-OWN, public)
//   packages/asset-catalog/src/<batch>.json
// Re-running with unchanged inputs must be byte-identical (checked by the evidence runs).
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync, existsSync} from 'node:fs';
import {join, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
if (!process.argv[2]) throw new Error('usage: build_procedural_batch.mjs <plan.json>');
const PLAN = JSON.parse(readFileSync(resolve(ROOT, process.argv[2]), 'utf8'));
const WORK = join(ROOT, 'source', PLAN.batch), PUBLIC = join(ROOT, 'apps/web/public/imported-assets', PLAN.batch);
const ORIGIN = 'http://sml-builder.invalid';
const sha = b => createHash('sha256').update(b).digest('hex');
const TYPES = {'.js': 'text/javascript', '.html': 'text/html'};
const SYMBOLS = {'台灣地標': '⌂', '交通': '⛴', '自然': '♣', '象徵': '✦'};

const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {BUILDERS, finalize, resetMaterials} from '/${PLAN.models}';
const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, preserveDrawingBuffer: true});
renderer.setSize(480, 480); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);
window.build = async slug => {
  resetMaterials();
  const model = finalize(BUILDERS[slug](), slug);
  const glb = await new GLTFExporter().parseAsync(model, {binary: true, onlyVisible: true});
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x6b5b45, 1.6));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6); sun.position.set(3, 6, 4); scene.add(sun);
  scene.add(model);
  const sphere = new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 1000), dir = new THREE.Vector3(1, 0.72, 1.25).normalize();
  cam.position.copy(sphere.center).addScaledVector(dir, sphere.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.02);
  cam.lookAt(sphere.center);
  renderer.render(scene, cam);
  return {glb: b64(glb), png: renderer.domElement.toDataURL('image/png').split(',')[1]};
};
window.ready = true;
</script>`;

function inspect(data) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (v.getUint32(0, true) !== 0x46546c67 || v.getUint32(4, true) !== 2 || v.getUint32(8, true) !== data.length) throw new Error('not a glTF 2.0 binary');
  const n = v.getUint32(12, true), doc = JSON.parse(Buffer.from(data.subarray(20, 20 + n)).toString('utf8'));
  if ([...(doc.buffers ?? []), ...(doc.images ?? [])].some(x => x.uri !== undefined)) throw new Error('external resource');
  let tris = 0;
  for (const mesh of doc.meshes) for (const p of mesh.primitives) {
    if ((p.mode ?? 4) !== 4) throw new Error('non-triangle primitive');
    tris += doc.accessors[p.indices ?? p.attributes.POSITION].count / 3;
  }
  return {doc, tris};
}

async function main() {
  for (const d of ['processed', 'thumbnails']) mkdirSync(join(WORK, d), {recursive: true});
  mkdirSync(PUBLIC, {recursive: true});
  const browser = await chromium.launch({executablePath: process.env.SML_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const errors = [];
  try {
    const page = await browser.newPage({viewport: {width: 480, height: 480}});
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route(ORIGIN + '/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/') return route.fulfill({contentType: 'text/html', body: PAGE});
      const file = join(ROOT, decodeURIComponent(path));
      if (!file.startsWith(ROOT) || !existsSync(file)) return route.fulfill({status: 404, body: 'missing'});
      return route.fulfill({contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file)});
    });
    await page.goto(ORIGIN + '/');
    await page.waitForFunction(() => window.ready === true, null, {timeout: 30000});
    const modelsSha = sha(readFileSync(join(ROOT, PLAN.models)));
    const rows = [], report = [];
    for (const item of PLAN.items) {
      const source = item.source ?? PLAN.source;
      const {glb, png} = await page.evaluate(slug => window.build(slug), item.slug);
      const data = Buffer.from(glb, 'base64'), thumb = Buffer.from(png, 'base64');
      const {doc, tris} = inspect(data);
      if (tris > PLAN.maxTriangles || data.length > PLAN.maxBytes) throw new Error(`${item.slug}: over budget (${tris} tris, ${data.length} bytes)`);
      if (doc.animations?.length || doc.skins?.length) throw new Error(item.slug + ': unexpected animation/skin');
      writeFileSync(join(WORK, 'processed', item.slug + '.glb'), data);
      writeFileSync(join(WORK, 'thumbnails', item.slug + '.png'), thumb);
      const digest = sha(data), id = PLAN.idPrefix + item.slug.toUpperCase(), name = `${id}-${digest.slice(0, 16)}.glb`;
      writeFileSync(join(PUBLIC, name), data); writeFileSync(join(PUBLIC, id + '.png'), thumb);
      report.push({slug: item.slug, triangles: tris, bytes: data.length, materials: doc.materials.length, meshes: doc.meshes.length, images: (doc.images ?? []).length});
      const base = `/imported-assets/${PLAN.batch}/`;
      rows.push({id, name: item.name, category: item.category, symbol: SYMBOLS[item.category] ?? '◆',
        color: PLAN.color, version: PLAN.versionPrefix + digest.slice(0, 16), thumbnail: base + id + '.png', clips: [],
        sourcePack: item.sourcePack ?? PLAN.sourcePack, origin: (source ?? PLAN.models) + '#' + item.slug,
        sourceSha256: source ? sha(readFileSync(source)) : modelsSha,
        sha256: digest, bytes: data.length, triangles: tris, materials: doc.materials.length, skins: 0,
        url: base + name, license: 'PROJECT-OWN', status: 'IMPORTED_UNREVIEWED'});
    }
    if (errors.length) throw new Error('page errors:\n' + errors.join('\n'));
    const keep = new Set(rows.flatMap(r => [r.url.split('/').pop(), r.thumbnail.split('/').pop()]));
    for (const f of readdirSync(PUBLIC)) if (!keep.has(f)) unlinkSync(join(PUBLIC, f));
    const sources = [...new Set(PLAN.items.map(i => i.source ?? PLAN.source).filter(Boolean))];
    writeFileSync(join(WORK, 'report.json'), JSON.stringify({batch: PLAN.batch, ...(sources.length === 1 && PLAN.source ? {sourceSha256: sha(readFileSync(PLAN.source))} : {sources: Object.fromEntries(sources.map(s => [s, sha(readFileSync(s))]))}), items: report}, null, 2) + '\n');
    writeFileSync(join(ROOT, 'packages/asset-catalog/src', PLAN.batch + '.json'), JSON.stringify(rows, null, 2) + '\n');
    console.log(JSON.stringify({models: rows.length, bytes: rows.reduce((s, r) => s + r.bytes, 0), maxTriangles: Math.max(...rows.map(r => r.triangles)), items: report}));
  } finally {
    await browser.close();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
