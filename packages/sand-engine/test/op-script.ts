/**
 * POC-1 共用素材：固定種子整數 LCG 產生的 500 步 op 序列＋Node 端重放／sha256。
 * vitest（unit）與 Playwright（e2e，Node 側）import 同一模組，保證兩側序列逐位相同。
 * LCG 用 Lehmer minstd（×48271 mod 2^31−1）：純整數、乘積 <2^53、跨引擎一致。
 */
import { createHash } from 'node:crypto';
import {
  applyBrush,
  createHeightmap,
  DEFAULT_RADIUS_CM,
  DEFAULT_STRENGTH_Q8,
  SMOOTH_STRENGTH_Q8,
  type BrushOp,
  type Heightmap,
  type TraySizeCm,
} from '../src/core';

export const STANDARD_TRAY: TraySizeCm = { w: 72, h: 57, depth: 7 };

export function makeLcg(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 48271) % 2147483647;
    return s;
  };
}

/** POC-1 固定 op 序列：標準盤 rect、半徑 4–8 cm 輪替、預設力道、0.5 cm 網格中心。 */
export function fixedOps(count = 500): BrushOp[] {
  const rnd = makeLcg(20260918);
  const margin = 9; // 半徑最大 8 cm＋1 cm 邊距
  const ops: BrushOp[] = [];
  const tools = ['dig', 'mound', 'smooth'] as const;
  for (let k = 0; k < count; k++) {
    const tool = tools[k % 3];
    const cx = margin + (rnd() % ((STANDARD_TRAY.w - 2 * margin) * 2 + 1)) / 2;
    const cz = margin + (rnd() % ((STANDARD_TRAY.h - 2 * margin) * 2 + 1)) / 2;
    const radiusCm = 4 + (rnd() % 9) / 2; // 4.0–8.0 cm
    ops.push({
      tool,
      cx,
      cz,
      radiusCm,
      strength: tool === 'smooth' ? SMOOTH_STRENGTH_Q8 : DEFAULT_STRENGTH_Q8,
    });
  }
  return ops;
}

export function replayNode(ops: BrushOp[], tray: TraySizeCm = STANDARD_TRAY): Heightmap {
  const hm = createHeightmap('rect', tray);
  for (const op of ops) applyBrush(hm, op);
  return hm;
}

export function hashHeightmapNode(hm: Heightmap): string {
  return createHash('sha256').update(hm.data).digest('hex');
}
