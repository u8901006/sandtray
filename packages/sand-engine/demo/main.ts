/**
 * sand-engine demo（G33／T12）：挖／堆／抹平、滑鼠＋觸控拖曳、放置方塊、fps／記憶體 HUD、
 * 四形狀與標準／120 cm 盤切換。e2e（test-e2e/poc.spec.ts）透過 window.__sand 驅動同一 code path。
 *
 * 互動常數（未讀 cynthiayuyu/sandtray 原始碼；僅取 REQ-016 §2/§4 摘要）：
 * 拖曳每影格最多一次 applyBrush（且 ≤60 次/s，120 Hz 螢幕不再加速）、
 * 力道預設連續按住 ≥1.0 s 才觸底（DEFAULT_STRENGTH_Q8＝896 → 60 次×3 u8）。
 */
import {
  applyBrush,
  createHeightmap,
  DEFAULT_RADIUS_CM,
  DEFAULT_STRENGTH_Q8,
  heightAtCm,
  SMOOTH_STRENGTH_Q8,
  surfaceU8,
  type BrushOp,
  type BrushTool,
  type Heightmap,
  type TrayShape,
  type TraySizeCm,
} from '../src/core';
import { SandRenderer } from '../src/render';
import * as THREE from 'three';

const STANDARD: TraySizeCm = { w: 72, h: 57, depth: 7 };
const MAX120: TraySizeCm = { w: 120, h: 120, depth: 7 };
const APPLY_MIN_INTERVAL_MS = 1000 / 60; // 節流：≥16 ms 一次（每影格最多一次）

const container = document.getElementById('app') as HTMLElement;
const hudEl = document.getElementById('hud') as HTMLElement;

let hm: Heightmap = createHeightmap('rect', STANDARD);
let tool: BrushTool | 'box' = 'dig';
let shape: TrayShape = 'rect';
let size: TraySizeCm = STANDARD;
let sceneClosed = false;

const renderer = new SandRenderer(container);
renderer.build(hm);

let pointerActive = false;
let lastCm: { x: number; z: number } | null = null;
let lastApplyTs = 0;
const applySamples: number[] = [];

function brushOp(t: BrushTool, cx: number, cz: number): BrushOp {
  return {
    tool: t,
    cx,
    cz,
    radiusCm: DEFAULT_RADIUS_CM,
    strength: t === 'smooth' ? SMOOTH_STRENGTH_Q8 : DEFAULT_STRENGTH_Q8,
  };
}

function localCm(e: PointerEvent): { x: number; z: number } | null {
  const el = renderer.renderer.domElement;
  const rect = el.getBoundingClientRect();
  const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  const hit = renderer.pickOnSand(ndcX, ndcY);
  if (!hit || !renderer.getHeightmap()) return null;
  return renderer.worldToCm(hit.xUnits, hit.zUnits);
}

function applyAt(cx: number, cz: number): number {
  const t0 = performance.now();
  const patch = applyBrush(hm, brushOp(tool === 'box' ? 'dig' : tool, cx, cz));
  renderer.applyPatch(patch);
  const ms = performance.now() - t0;
  applySamples.push(ms);
  if (applySamples.length > 600) applySamples.shift();
  return ms;
}

/* ------------------------------- 互動 ------------------------------- */

const el = renderer.renderer.domElement;
el.addEventListener('pointerdown', (e) => {
  if (sceneClosed) return;
  el.setPointerCapture(e.pointerId);
  const cm = localCm(e);
  if (!cm) return;
  if (tool === 'box') {
    renderer.placeBox(cm.x, cm.z);
    return;
  }
  pointerActive = true;
  lastCm = cm;
  if (performance.now() - lastApplyTs >= APPLY_MIN_INTERVAL_MS) {
    applyAt(cm.x, cm.z);
    lastApplyTs = performance.now();
  }
});
el.addEventListener('pointermove', (e) => {
  if (!pointerActive) return;
  const cm = localCm(e);
  if (cm) lastCm = cm;
});
const endPointer = () => {
  pointerActive = false;
};
el.addEventListener('pointerup', endPointer);
el.addEventListener('pointercancel', endPointer);

/* ------------------------------- HUD／loop ------------------------------- */

let fps = 0;
let frames = 0;
let fpsWindowStart = performance.now();

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function updateHud() {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  const sorted = [...applySamples].sort((a, b) => a - b);
  hudEl.textContent =
    `fps ${fps.toFixed(1)}\n` +
    `apply p50/p95 ${(percentile(sorted, 0.5)).toFixed(2)} / ${(percentile(sorted, 0.95)).toFixed(2)} ms\n` +
    `tray ${hm.shape} ${hm.w}×${hm.h} (${hm.sizeCm.w}×${hm.sizeCm.h}×${hm.sizeCm.depth} cm)\n` +
    `tool ${tool}${sceneClosed ? ' [scene closed]' : ''}\n` +
    (mem ? `heap ${(mem.usedJSHeapSize / 1048576).toFixed(1)} MB` : 'heap n/a');
}

function loop(now: number) {
  requestAnimationFrame(loop);
  if (!sceneClosed) {
    if (pointerActive && lastCm && tool !== 'box' && now - lastApplyTs >= APPLY_MIN_INTERVAL_MS) {
      applyAt(lastCm.x, lastCm.z);
      lastApplyTs = now;
    }
    renderer.render();
  }
  frames++;
  if (now - fpsWindowStart >= 1000) {
    fps = (frames * 1000) / (now - fpsWindowStart);
    frames = 0;
    fpsWindowStart = now;
    updateHud();
  }
}
requestAnimationFrame(loop);

window.addEventListener('resize', () => {
  renderer.resize(container.clientWidth, container.clientHeight);
});
renderer.resize(container.clientWidth, container.clientHeight);

/* ------------------------------- toolbar ------------------------------- */

function activate(group: HTMLElement, match: (b: HTMLButtonElement) => boolean) {
  for (const b of group.querySelectorAll('button')) b.classList.toggle('active', match(b as HTMLButtonElement));
}

document.getElementById('tools')?.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  tool = (b.dataset.tool as BrushTool | 'box') ?? 'dig';
  activate(b.parentElement as HTMLElement, (x) => x === b);
});
document.getElementById('shapes')?.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  shape = (b.dataset.shape as TrayShape) ?? 'rect';
  rebuild();
  activate(b.parentElement as HTMLElement, (x) => x === b);
});
document.getElementById('sizes')?.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  size = b.dataset.size === 'max' ? MAX120 : STANDARD;
  rebuild();
  activate(b.parentElement as HTMLElement, (x) => x === b);
});
document.getElementById('btn-close')?.addEventListener('click', () => {
  renderer.disposeScene();
  sceneClosed = true;
  updateHud();
});
document.getElementById('btn-open')?.addEventListener('click', () => {
  renderer.build(hm);
  sceneClosed = false;
  updateHud();
});

function rebuild() {
  hm = createHeightmap(shape, size);
  applySamples.length = 0;
  if (!sceneClosed) renderer.build(hm);
  updateHud();
}

/* ------------------------------- __sand API ------------------------------- */

export interface BenchResult {
  fps: number;
  frames: number;
  seconds: number;
  applyCount: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  heapBytes: number | null;
  webglRenderer: string;
}

const api = {
  ready: true as const,
  dims: () => ({ w: hm.w, h: hm.h, shape: hm.shape, surfaceU8: surfaceU8(hm.depthCm) }),
  heightAtCm: (x: number, z: number) => heightAtCm(hm, x, z),
  applyOps(ops: BrushOp[]) {
    let changed = 0;
    let msTotal = 0;
    for (const op of ops) {
      const t0 = performance.now();
      const p = applyBrush(hm, op);
      renderer.applyPatch(p);
      msTotal += performance.now() - t0;
      if (p.w > 0) changed++;
    }
    return { applied: ops.length, changed, msTotal };
  },
  async sha256Hex(): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', hm.data.slice());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  },
  async bench(seconds: number): Promise<BenchResult> {
    pointerActive = false;
    const wCm = hm.w / 2;
    const hCm = hm.h / 2;
    const margin = DEFAULT_RADIUS_CM + 1;
    const samples: number[] = [];
    let frames = 0;
    let applies = 0;
    let last = 0;
    const t0 = await new Promise<number>((r) => requestAnimationFrame(r));
    const dur = seconds * 1000;
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        frames++;
        const elapsed = now - t0;
        const ph = elapsed / 1000;
        const x = margin + (wCm - 2 * margin) * (0.5 + 0.45 * Math.sin((2 * Math.PI * ph) / 7));
        const z = margin + (hCm - 2 * margin) * (0.5 + 0.45 * Math.sin((2 * Math.PI * ph) / 11 + 1.3));
        if (now - last >= APPLY_MIN_INTERVAL_MS) {
          const toolNow: BrushTool = Math.floor(elapsed / 10000) % 2 === 0 ? 'dig' : 'mound';
          const s = performance.now();
          const p = applyBrush(hm, brushOp(toolNow, x, z));
          renderer.applyPatch(p);
          samples.push(performance.now() - s);
          applies++;
          last = now;
        }
        renderer.render();
        if (elapsed < dur) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    const sorted = [...samples].sort((a, b) => a - b);
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    let webglRenderer = 'n/a';
    try {
      const gl = renderer.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) webglRenderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    } catch {
      /* ignore */
    }
    return {
      fps: frames / seconds,
      frames,
      seconds,
      applyCount: applies,
      p50Ms: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      maxMs: sorted.length ? sorted[sorted.length - 1] : 0,
      heapBytes: mem ? mem.usedJSHeapSize : null,
      webglRenderer,
    };
  },
  placeBox(xCm: number, zCm: number) {
    const r = renderer.placeBox(xCm, zCm);
    const sampled = heightAtCm(hm, xCm, zCm);
    if (!r) return null;
    return {
      boxBottomCm: (r.yUnits - 0.5) * 7.2,
      sampledCm: sampled,
      diffMm: Math.abs((r.yUnits - 0.5) * 7.2 - sampled) * 10,
    };
  },
  setTray(nextShape: TrayShape, wCm: number, hCm: number, depthCm = 7) {
    shape = nextShape;
    size = { w: wCm, h: hCm, depth: depthCm };
    rebuild();
  },
  minMax(): { min: number; max: number } {
    let min = 255;
    let max = 0;
    for (const v of hm.data) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { min, max };
  },
  closeScene: () => {
    renderer.disposeScene();
    sceneClosed = true;
  },
  openScene: () => {
    renderer.build(hm);
    sceneClosed = false;
  },
  stats: () => renderer.stats(),
  /** 對照基線：同一頁面另開一個「從未建場景」的 renderer，量引擎本身持有的資源。 */
  rawBaseline(): { geometries: number; textures: number } {
    const r = new THREE.WebGLRenderer({ antialias: false });
    const s = new THREE.Scene();
    r.render(s, new THREE.PerspectiveCamera());
    const out = { geometries: r.info.memory.geometries, textures: r.info.memory.textures };
    r.dispose();
    r.domElement.remove();
    return out;
  },
  hud: () => ({ fps, tool, shape, closed: sceneClosed }),
};

export type SandApi = typeof api;
declare global {
  interface Window {
    __sand: SandApi;
  }
}
window.__sand = api;
