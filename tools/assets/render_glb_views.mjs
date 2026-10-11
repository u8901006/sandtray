#!/usr/bin/env node
// Review helper (2026-10-02, Claude Opus 5.5): render one GLB from fixed directions into a single PNG strip.
//   node tools/assets/render_glb_views.mjs <in.glb> <out.png> [dir ...]     dir = x,y,z camera direction, default four sides
// Uses the same routed fake origin and project three as build_procedural_batch.mjs (SML_CHROMIUM honoured).
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const [input, output, ...dirs] = process.argv.slice(2);
const views = (dirs.length ? dirs : ['0,0.15,1', '1,0.15,0', '0,0.15,-1', '1,0.7,1.25']).map(d => d.split(',').map(Number));
const ORIGIN = 'http://glb-view.invalid';
const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const views = ${JSON.stringify(views)}, S = 360;
const r = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true}); r.setSize(S * views.length, S); r.setPixelRatio(1);
r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.setScissorTest(true); document.body.appendChild(r.domElement);
const gltf = await new GLTFLoader().loadAsync('/model.glb');
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xd8cfbd);
scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x6b5b45, 1.6)); const sun = new THREE.DirectionalLight(0xfff1dc, 2.6); sun.position.set(3, 6, 4); scene.add(sun);
scene.add(gltf.scene);
const sph = new THREE.Box3().setFromObject(gltf.scene).getBoundingSphere(new THREE.Sphere());
views.forEach((d, i) => {
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 1000), dir = new THREE.Vector3(...d).normalize();
  cam.position.copy(sph.center).addScaledVector(dir, sph.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.02); cam.lookAt(sph.center);
  r.setViewport(i * S, 0, S, S); r.setScissor(i * S, 0, S, S); r.render(scene, cam);
});
window.png = r.domElement.toDataURL('image/png').split(',')[1];
</script>`;
const browser = await chromium.launch({executablePath: process.env.SML_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage();
  await page.route(ORIGIN + '/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({contentType: 'text/html', body: PAGE});
    if (path === '/model.glb') return route.fulfill({contentType: 'model/gltf-binary', body: readFileSync(resolve(input))});
    const file = join(ROOT, decodeURIComponent(path));
    if (!file.startsWith(ROOT) || !existsSync(file)) return route.fulfill({status: 404, body: 'missing'});
    return route.fulfill({contentType: extname(file) === '.js' ? 'text/javascript' : 'application/octet-stream', body: readFileSync(file)});
  });
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => window.png, null, {timeout: 60000});
  writeFileSync(output, Buffer.from(await page.evaluate(() => window.png), 'base64'));
} finally { await browser.close(); }
