#!/usr/bin/env node
// Thumbnails for megakits-v1 (2026-10-06, Claude Opus 5.5): one 256x256 transparent PNG per catalog GLB, written next to it
// as <ID>.png. Same routed fake origin and project three as render_glb_views.mjs (SML_CHROMIUM honoured). Decals and other
// near-flat pieces are framed by their bounding sphere like everything else, so a flat decal is a thin sliver by design.
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PUBLIC = join(ROOT, 'apps/web/public');
// 2026-10-10: optional catalog name argument (adventure-v1 reuses this renderer); default stays megakits-v1.
const catalog = JSON.parse(readFileSync(join(ROOT, `packages/asset-catalog/src/${process.argv[2] || 'megakits-v1'}.json`), 'utf8'));
const ORIGIN = 'http://glb-view.invalid';
const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const S = 256;
const r = new THREE.WebGLRenderer({antialias: true, alpha: true, preserveDrawingBuffer: true}); r.setSize(S, S); r.setPixelRatio(1);
r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.setClearColor(0x000000, 0);
const loader = new GLTFLoader();
window.render = async url => {
  const gltf = await loader.loadAsync(url);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x6b5b45, 1.7)); const sun = new THREE.DirectionalLight(0xfff1dc, 2.6); sun.position.set(3, 6, 4); scene.add(sun);
  scene.add(gltf.scene);
  const sph = new THREE.Box3().setFromObject(gltf.scene).getBoundingSphere(new THREE.Sphere());
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 10000), dir = new THREE.Vector3(1, 0.75, 1.25).normalize();
  cam.position.copy(sph.center).addScaledVector(dir, Math.max(sph.radius, 1e-4) / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05); cam.lookAt(sph.center);
  r.clear(); r.render(scene, cam);
  const png = r.domElement.toDataURL('image/png').split(',')[1];
  scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { for (const v of Object.values(o.material)) if (v && v.isTexture) v.dispose(); o.material.dispose(); } });
  return png;
};
window.ready = true;
</script>`;
const browser = await chromium.launch({executablePath: process.env.SML_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
let done = 0, failed = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('pageerror', e.message));
  await page.route(ORIGIN + '/**', route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path === '/') return route.fulfill({contentType: 'text/html', body: PAGE});
    const file = path.startsWith('/imported-assets/') ? join(PUBLIC, path) : join(ROOT, path);
    if (!file.startsWith(ROOT) || !existsSync(file)) return route.fulfill({status: 404, body: 'missing'});
    return route.fulfill({contentType: extname(file) === '.js' ? 'text/javascript' : 'application/octet-stream', body: readFileSync(file)});
  });
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => window.ready, null, {timeout: 60000});
  for (const asset of catalog) {
    try {
      const png = await page.evaluate(url => window.render(url), asset.url);
      writeFileSync(join(PUBLIC, asset.thumbnail), Buffer.from(png, 'base64'));
      done++;
    } catch (error) { failed.push({id: asset.id, error: String(error.message || error).slice(0, 160)}); }
  }
} finally { await browser.close(); }
console.log(JSON.stringify({rendered: done, failed: failed.length}));
for (const f of failed) console.log('FAILED', JSON.stringify(f));
process.exit(failed.length ? 1 : 0);
