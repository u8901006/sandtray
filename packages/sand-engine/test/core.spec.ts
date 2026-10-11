/**
 * sand-engine unit（G33／T12）：POC-1 Node 端、POC-4 mask 邊界、POC-5 clamp／守恆、
 * encode／decode 往返、建圖尺寸與原面量化、預設力道 1.0 s 觸底。
 * 全部結果如實寫進 evidence report；POC-1 的瀏覽器側在 test-e2e。
 */
import { describe, expect, it } from 'vitest';
import {
  applyBrush,
  base64ToBytes,
  bytesToBase64,
  createHeightmap,
  decodeHeightmap,
  DEFAULT_RADIUS_CM,
  DEFAULT_STRENGTH_Q8,
  encodeHeightmap,
  heightAtCm,
  surfaceU8,
  type Heightmap,
} from '../src/core';
import { fixedOps, hashHeightmapNode, makeLcg, replayNode, STANDARD_TRAY } from './op-script';

const STD = { ...STANDARD_TRAY };

function sum(hm: Heightmap): number {
  let s = 0;
  for (const v of hm.data) s += v;
  return s;
}

function minMax(hm: Heightmap): { min: number; max: number } {
  let min = 255;
  let max = 0;
  for (const v of hm.data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

describe('createHeightmap', () => {
  it('標準盤 72×57×7 → 144×114、全格原面 179、mask 全 1', () => {
    const hm = createHeightmap('rect', STD);
    expect(hm.w).toBe(144);
    expect(hm.h).toBe(114);
    expect(surfaceU8(7)).toBe(179);
    expect(hm.data.every((v) => v === 179)).toBe(true);
    expect(hm.mask.every((m) => m === 1)).toBe(true);
  });

  it('解析度 clamp：30 cm→60、200 cm→240', () => {
    expect(createHeightmap('rect', { w: 30, h: 30, depth: 7 }).w).toBe(60);
    expect(createHeightmap('rect', { w: 200, h: 200, depth: 7 }).w).toBe(240);
  });

  it('square／circle／octagon 以 w 為邊長／直徑／對邊距（h＝w）', () => {
    for (const s of ['square', 'circle', 'octagon'] as const) {
      const hm = createHeightmap(s, { w: 72, h: 57, depth: 7 });
      expect(hm.h).toBe(hm.w);
      expect(hm.h).toBe(144);
    }
  });

  it('circle／octagon mask：角落在外、中心在內', () => {
    for (const s of ['circle', 'octagon'] as const) {
      const hm = createHeightmap(s, { w: 72, h: 72, depth: 7 });
      expect(hm.mask[2 * hm.w + 2]).toBe(0);
      expect(hm.mask[(hm.h >> 1) * hm.w + (hm.w >> 1)]).toBe(1);
    }
  });
});

describe('POC-1 確定性（Node 端）', () => {
  it('同一 500 步 op 序列重放兩次 → sha256 相同（byte-identical）', () => {
    const ops = fixedOps(500);
    const a = replayNode(ops);
    const b = replayNode(ops);
    const ha = hashHeightmapNode(a);
    const hb = hashHeightmapNode(b);
    expect(ha).toBe(hb);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    console.log('[POC-1] node sha256 =', ha);
  });

  it('500 步後狀態非平凡（>1000 格離開原面，覆蓋 clamp 路徑）', () => {
    const hm = replayNode(fixedOps(500));
    let changed = 0;
    for (const v of hm.data) if (v !== 179) changed++;
    expect(changed).toBeGreaterThan(1000);
    console.log('[POC-1] changed cells =', changed, '/', hm.data.length);
  });
});

describe('POC-4 mask 邊界', () => {
  it('circle／octagon：筆刷中心在 mask 外角落 → data 零變化、patch 全為原值', () => {
    for (const s of ['circle', 'octagon'] as const) {
      const hm = createHeightmap(s, { w: 72, h: 72, depth: 7 });
      const before = hm.data.slice();
      const p = applyBrush(hm, { tool: 'dig', cx: 3, cz: 3, radiusCm: DEFAULT_RADIUS_CM, strength: DEFAULT_STRENGTH_Q8 });
      expect(p.w).toBeGreaterThan(0); // bbox 覆蓋 grid，但每個 cell 都被 mask 擋下
      expect(hm.data.every((v, i) => v === before[i])).toBe(true);
      let diff = 0;
      for (let j = 0; j < p.h; j++) {
        for (let i = 0; i < p.w; i++) {
          if (p.patch[j * p.w + i] !== before[(p.y0 + j) * hm.w + p.x0 + i]) diff++;
        }
      }
      expect(diff).toBe(0);
    }
  });

  it('rect：筆刷跨出 grid 邊 → 只影響 in-grid cells、不拋錯', () => {
    const hm = createHeightmap('rect', STD);
    const before = hm.data.slice();
    const p = applyBrush(hm, { tool: 'mound', cx: 0.5, cz: 0.5, radiusCm: DEFAULT_RADIUS_CM, strength: DEFAULT_STRENGTH_Q8 });
    expect(p.x0).toBe(0);
    expect(p.y0).toBe(0);
    let changed = 0;
    for (let i = 0; i < hm.data.length; i++) if (hm.data[i] !== before[i]) changed++;
    expect(changed).toBeGreaterThan(0); // 部分在盤內
  });

  it('heightAtCm：mask 外／grid 外 → NaN；盤內原面 → ≈7.02 cm（179 量化）', () => {
    const circ = createHeightmap('circle', { w: 72, h: 72, depth: 7 });
    expect(Number.isNaN(heightAtCm(circ, 2, 2))).toBe(true);
    const rect = createHeightmap('rect', STD);
    expect(Number.isNaN(heightAtCm(rect, -1, 10))).toBe(true);
    expect(Number.isNaN(heightAtCm(rect, 71.9, 28.5))).toBe(true); // 超出最後 cell 中心
    const v = heightAtCm(rect, 36, 28.5);
    expect(v).toBeCloseTo((179 / 255) * 10, 6);
    expect(Number.isFinite(v)).toBe(true);
  });
});

describe('POC-5 clamp 與體積守恆', () => {
  it('挖到底：min 到 0、永不低於 0', () => {
    const hm = createHeightmap('rect', STD);
    const op = { tool: 'dig' as const, cx: 36, cz: 28.5, radiusCm: DEFAULT_RADIUS_CM, strength: DEFAULT_STRENGTH_Q8 };
    for (let k = 0; k < 600; k++) applyBrush(hm, op);
    const { min } = minMax(hm);
    expect(min).toBe(0);
    expect(hm.data.every((v) => v >= 0)).toBe(true);
  });

  it('堆不超過 255', () => {
    const hm = createHeightmap('rect', STD);
    const op = { tool: 'mound' as const, cx: 36, cz: 28.5, radiusCm: DEFAULT_RADIUS_CM, strength: DEFAULT_STRENGTH_Q8 };
    for (let k = 0; k < 3000; k++) applyBrush(hm, op);
    const { max } = minMax(hm);
    expect(max).toBe(255);
    expect(hm.data.every((v) => v <= 255)).toBe(true);
  });

  it('smooth 200 次不改總體積超過 1%', () => {
    const hm = createHeightmap('rect', STD);
    for (let k = 0; k < 600; k++) {
      applyBrush(hm, { tool: 'mound', cx: 36, cz: 28.5, radiusCm: 8, strength: DEFAULT_STRENGTH_Q8 });
    }
    const before = sum(hm);
    for (let k = 0; k < 200; k++) {
      const ang = (k * 2 * Math.PI) / 200;
      applyBrush(hm, {
        tool: 'smooth',
        cx: 36 + 6 * Math.cos(ang),
        cz: 28.5 + 5 * Math.sin(ang),
        radiusCm: 8,
        strength: 256,
      });
    }
    const after = sum(hm);
    const drift = Math.abs(after - before) / before;
    console.log('[POC-5] smooth volume drift =', (drift * 100).toFixed(4), '%');
    expect(drift).toBeLessThanOrEqual(0.01);
  });
});

describe('預設力道（拖曳 ≥1.0 s 才觸底）', () => {
  it('60 次應用（60 Hz＝1.0 s）中心觸底；59 次未觸底', () => {
    const hm = createHeightmap('rect', STD);
    const op = { tool: 'dig' as const, cx: 36, cz: 28.5, radiusCm: DEFAULT_RADIUS_CM, strength: DEFAULT_STRENGTH_Q8 };
    const cIdx = Math.round(28.5 * 2) * hm.w + Math.round(36 * 2);
    for (let k = 0; k < 59; k++) applyBrush(hm, op);
    expect(hm.data[cIdx]).toBeGreaterThan(0);
    applyBrush(hm, op);
    expect(hm.data[cIdx]).toBe(0);
  });
});

describe('encode／decode（u8-base64）', () => {
  it('往返一致（含 mask 由 shape 重導）', () => {
    const hm = createHeightmap('circle', { w: 72, h: 72, depth: 7 });
    for (const op of fixedOps(50)) applyBrush(hm, op);
    const back = decodeHeightmap(encodeHeightmap(hm));
    expect(back.w).toBe(hm.w);
    expect(back.h).toBe(hm.h);
    expect(back.shape).toBe(hm.shape);
    expect(back.depthCm).toBe(7);
    expect(Buffer.from(back.data).equals(Buffer.from(hm.data))).toBe(true);
    expect(Array.from(back.mask)).toEqual(Array.from(hm.mask));
  });

  it('純 TS base64 與 Node Buffer 實作逐字元相同', () => {
    const rnd = makeLcg(7);
    const bytes = new Uint8Array(1000).map(() => rnd() & 0xff);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    expect(Buffer.from(base64ToBytes(bytesToBase64(bytes))).equals(Buffer.from(bytes))).toBe(true);
  });

  it('壞 magic 拒絕', () => {
    expect(() => decodeHeightmap(bytesToBase64(new Uint8Array([1, 2, 3])))).toThrow();
  });
});
