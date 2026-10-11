/**
 * sand-engine core — CPU 確定性 u8 高度場筆刷核心（REQ-016 §8；task T12／G33）。
 *
 * POC-1 目標：同一 op 序列在任何 JS 引擎（Node／Chromium）產生 byte-identical heightmap。
 * 因此 applyBrush 整條路徑只有整數運算：
 *   - 高斯衰減以預鑄 Q8 常數 LUT（G_LUT）內嵌原始碼，執行期零浮點、零 Math.exp；
 *   - 核形＝高斯 × 線性收邊（compact support，邊界必為 0），全程整數乘法＋移位；
 *   - dig／mound 力度與 smooth blend 係數皆為 Q8 定點；
 *   - smooth 的 3×3 鄰域平均讀 pre-op 快照，與迭代順序無關；
 *   - 位於 [0,255] 區間的 clamp 保證 u8 溢出行為確定。
 *
 * 座標約定：cell (i,j)，i∈[0,w)、j∈[0,h)；1 格＝0.5 cm（2 格／cm）；cell (i,j) 的
 * 取樣中心位於 (i+0.5)/2 cm。op 的 cx／cz 為盤內 cm 座標（原點在 min 角）。
 *
 * u8 量化：0＝盤底、255＝原面＋3 cm；原面＝round(depth/(depth+3)×255)（depth 7 → 179）。
 *
 * 授權邊界（POC-9）：
 *   - 未讀取 cynthiayuyu/sandtray 原始碼（無授權，使用者 06:40 裁定不聯絡作者）；
 *     「按住 ≥1 s 才觸底」「每影格最多一次筆刷」等互動常數僅取自 REQ-016 §2／§4 摘要。
 *   - 筆刷語意（dig/mound/smooth × radius/strength）參考 skeelogy/skulpt.js（MIT）與
 *     SamG-Coder/SandDune（MIT）的公開設計概念；cell 高度場模型參考 winchxyz/tidewright
 *     （MIT）的「每格高度值＋遮罩」概念。本檔為自行撰寫之整數實作，未複製任何參考專案程式碼。
 */

/** 每 cm 的格子數（REQ-016 §3.1：2 格／cm）。 */
export const CELLS_PER_CM = 2;
/** 高度圖解析度上下限（60×60～240×240）。 */
export const MIN_CELLS = 60;
export const MAX_CELLS = 240;
/** 預設筆刷半徑（cm，REQ-016 §2.2：固定 ≈6.5 cm，第一版不可調）。 */
export const DEFAULT_RADIUS_CM = 6.5;
/**
 * 預設力道（Q8，u8／次）：dig／mound 896＝3.5。峰值 delta＝(256×896)>>16＝3 u8／次，
 * 60 Hz 節流下從原面 179 到 0 需 60 次＝1.0 s（滿足「按住 ≥1.0 s 才觸底」；
 * spec §2.2 的 1.2 s 屬微調空間，留待 protocol v2 前校正）。
 */
export const DEFAULT_STRENGTH_Q8 = 896;
/** smooth 預設 blend（Q8，256＝核心處完全貼平鄰域平均）。 */
export const SMOOTH_STRENGTH_Q8 = 256;
/** 八邊形角切整數常數：round(√2×1024)＝1448。對邊距 a（half）之正八邊形邊界為 |dx|+|dz| ≤ a√2。 */
const K_OCTAGON_Q10 = 1448;

export type TrayShape = 'rect' | 'square' | 'circle' | 'octagon';
export type BrushTool = 'dig' | 'mound' | 'smooth';

export interface TraySizeCm {
  /** 寬（rect）；square／circle／octagon 之邊長／直徑／對邊距（h 強制＝w）。 */
  w: number;
  h: number;
  /** 內側深度（cm）。 */
  depth: number;
}

export interface Heightmap {
  shape: TrayShape;
  /** 格數（2 格／cm，clamp 至 [60,240]）。 */
  w: number;
  h: number;
  /** 建圖時的尺寸（cm；cells 可能因 clamp 偏離 sizeCm）。 */
  sizeCm: TraySizeCm;
  depthCm: number;
  /** u8 高度：0＝盤底、255＝原面＋3 cm。長度 w×h。 */
  data: Uint8Array;
  /** 1＝盤內、0＝mask 外（牆／盤外）；mask 不序列化，由 shape＋尺寸推導。 */
  mask: Uint8Array;
}

export interface BrushOp {
  tool: BrushTool;
  /** 筆刷中心（cm，盤內座標）。 */
  cx: number;
  cz: number;
  radiusCm: number;
  /**
   * Q8 定點：dig／mound 為「核心峰值每應用一次的 u8 位移量 ×256」；
   * smooth 為 blend 係數（≤256＝全貼平）。建議用 DEFAULT_STRENGTH_Q8／SMOOTH_STRENGTH_Q8。
   */
  strength: number;
}

/** 受影響區塊（post-state）：協定 v2 沙操作 ACK 的 u8 片段即此格式。 */
export interface Patch {
  x0: number;
  y0: number;
  w: number;
  h: number;
  patch: Uint8Array;
}

/**
 * 預鑄高斯 LUT（Q8）：G[u]＝round(256×exp(−4.5×u/256))，u＝(d²/r²)×256 ∈ [0,256]。
 * 對應 σ＝r/3。由 Python 一次性計算後內嵌，消除跨引擎 Math.exp 差異之任何可能。
 * 值域 0–256 故用 Uint16Array。執行期再乘線性收邊 (256−u)，保證核邊為 0（compact support）。
 */
const G_LUT = new Uint16Array([
  256,252,247,243,239,234,230,226,222,219,215,211,207,204,200,197,
  193,190,187,183,180,177,174,171,168,165,162,159,156,154,151,148,
  146,143,141,138,136,134,131,129,127,125,122,120,118,116,114,112,
  110,108,106,104,103,101,99,97,96,94,92,91,89,88,86,85,
  83,82,80,79,77,76,75,73,72,71,70,68,67,66,65,64,
  63,62,61,60,58,57,56,55,55,54,53,52,51,50,49,48,
  47,47,46,45,44,43,43,42,41,40,40,39,38,38,37,36,
  36,35,35,34,33,33,32,32,31,31,30,29,29,28,28,27,
  27,27,26,26,25,25,24,24,23,23,23,22,22,21,21,21,
  20,20,20,19,19,19,18,18,18,17,17,17,16,16,16,16,
  15,15,15,15,14,14,14,14,13,13,13,13,12,12,12,12,
  12,11,11,11,11,11,10,10,10,10,10,10,9,9,9,9,
  9,9,8,8,8,8,8,8,8,7,7,7,7,7,7,7,
  7,6,6,6,6,6,6,6,6,6,6,5,5,5,5,5,
  5,5,5,5,5,5,4,4,4,4,4,4,4,4,4,4,
  4,4,4,4,4,3,3,3,3,3,3,3,3,3,3,3,
  3,
]);

function clampCells(cm: number): number {
  return Math.min(MAX_CELLS, Math.max(MIN_CELLS, Math.round(cm * CELLS_PER_CM)));
}

/** 原面的 u8 值：round(depth/(depth+3)×255)。depth 7 → 179。 */
export function surfaceU8(depthCm: number): number {
  return Math.round((depthCm / (depthCm + 3)) * 255);
}

/** u8 高度 → cm（僅供顯示／互動讀值，不參與位元組確定性）。 */
export function u8ToCm(v: number, depthCm: number): number {
  return (v / 255) * (depthCm + 3);
}

function computeMask(shape: TrayShape, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  if (shape === 'rect' || shape === 'square') {
    mask.fill(1);
    return mask;
  }
  const cx = w / 2;
  const cz = h / 2;
  if (shape === 'circle') {
    const r2 = (w / 2) * (h / 2);
    for (let j = 0; j < h; j++) {
      const dz = j + 0.5 - cz;
      for (let i = 0; i < w; i++) {
        const dx = i + 0.5 - cx;
        mask[j * w + i] = dx * dx + dz * dz <= r2 ? 1 : 0;
      }
    }
    return mask;
  }
  // octagon：|dx|、|dz| ≤ half（對邊距）且 |dx|+|dz| ≤ T（切角）；T＝half×(1+√2)，整數化。
  const half = Math.floor(Math.min(w, h) / 2);
  const t = (half * K_OCTAGON_Q10) >> 10;
  for (let j = 0; j < h; j++) {
    const dz = Math.abs(j + 0.5 - cz);
    for (let i = 0; i < w; i++) {
      const dx = Math.abs(i + 0.5 - cx);
      mask[j * w + i] = dx <= half && dz <= half && dx + dz <= t ? 1 : 0;
    }
  }
  return mask;
}

/**
 * 建立高度圖：全域填原面高度。square／circle／octagon 以 sizeCm.w 為邊長／直徑／對邊距
 * （h 忽略、強制＝w，REQ-016 §3.1）。cells＝clamp(round(cm×2), 60, 240)。
 */
export function createHeightmap(shape: TrayShape, sizeCm: TraySizeCm): Heightmap {
  const square = shape === 'square' || shape === 'circle' || shape === 'octagon';
  const size: TraySizeCm = square ? { w: sizeCm.w, h: sizeCm.w, depth: sizeCm.depth } : { ...sizeCm };
  const w = clampCells(size.w);
  const h = clampCells(size.h);
  const hm: Heightmap = {
    shape,
    w,
    h,
    sizeCm: size,
    depthCm: size.depth,
    data: new Uint8Array(w * h),
    mask: computeMask(shape, w, h),
  };
  hm.data.fill(surfaceU8(size.depth));
  return hm;
}

/** 套用一筆筆刷。全整數；回傳受影響區塊的 post-state（mask 外格子保持原值）。 */
export function applyBrush(hm: Heightmap, op: BrushOp): Patch {
  const { w, h, data, mask } = hm;
  const rc = Math.max(1, Math.round(op.radiusCm * CELLS_PER_CM));
  const cx = Math.round(op.cx * CELLS_PER_CM);
  const cz = Math.round(op.cz * CELLS_PER_CM);
  const rc2 = rc * rc;
  let x0 = Math.max(0, cx - rc);
  let x1 = Math.min(w - 1, cx + rc);
  let y0 = Math.max(0, cz - rc);
  let y1 = Math.min(h - 1, cz + rc);
  if (x1 < x0 || y1 < y0) {
    return { x0: 0, y0: 0, w: 0, h: 0, patch: new Uint8Array(0) };
  }
  // patch 矩形＝半徑 bbox（smooth 讀取範圍再外擴一圈，但不改回傳範圍）。
  const px0 = x0;
  const py0 = y0;
  const pw = x1 - x0 + 1;
  const ph = y1 - y0 + 1;

  if (op.tool === 'smooth') {
    x0 = Math.max(0, x0 - 1);
    y0 = Math.max(0, y0 - 1);
    x1 = Math.min(w - 1, x1 + 1);
    y1 = Math.min(h - 1, y1 + 1);
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    // pre-op 快照：鄰域平均與順序無關。
    const snap = new Uint8Array(bw * bh);
    for (let j = 0; j < bh; j++) {
      snap.set(data.subarray((y0 + j) * w + x0, (y0 + j) * w + x0 + bw), j * bw);
    }
    const blend = Math.min(op.strength, 256);
    for (let j = py0; j <= y1 && j < py0 + ph; j++) {
      for (let i = px0; i <= x1 && i < px0 + pw; i++) {
        const idx = j * w + i;
        if (mask[idx] === 0) continue;
        const dx = i - cx;
        const dz = j - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > rc2) continue;
        const u = (d2 * 256 / rc2) | 0;
        const wgt = (G_LUT[u] * (256 - u)) >> 8; // 0..256，含線性收邊
        // 3×3 平均（grid 邊界以鉗位取代虛擬鄰居）
        let sum = 0;
        for (let nj = Math.max(y0, j - 1); nj <= Math.min(y1, j + 1); nj++) {
          for (let ni = Math.max(x0, i - 1); ni <= Math.min(x1, i + 1); ni++) {
            sum += snap[(nj - y0) * bw + (ni - x0)];
          }
        }
        const avg = (sum + 4) / 9 | 0;
        const old = data[idx];
        const wb = (wgt * blend) >> 8; // 有效 blend ≤256
        // round-half（+128）：floor 會對正負 delta 都往 −∞ 偏、單向損體積，破壞 POC-5 守恆。
        data[idx] = old + (((avg - old) * wb + 128) >> 8);
      }
    }
  } else {
    for (let j = py0; j < py0 + ph; j++) {
      for (let i = px0; i < px0 + pw; i++) {
        const idx = j * w + i;
        if (mask[idx] === 0) continue;
        const dx = i - cx;
        const dz = j - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > rc2) continue;
        const u = (d2 * 256 / rc2) | 0;
        const wgt = (G_LUT[u] * (256 - u)) >> 8;
        const delta = (wgt * op.strength) >> 16;
        if (op.tool === 'dig') {
          const v = data[idx] - delta;
          data[idx] = v < 0 ? 0 : v;
        } else {
          const v = data[idx] + delta;
          data[idx] = v > 255 ? 255 : v;
        }
      }
    }
  }

  const patch = new Uint8Array(pw * ph);
  for (let j = 0; j < ph; j++) {
    patch.set(data.subarray((py0 + j) * w + px0, (py0 + j) * w + px0 + pw), j * pw);
  }
  return { x0: px0, y0: py0, w: pw, h: ph, patch };
}

/**
 * 雙線性取樣（cell 中心取樣）。四個參與 cell 任一在 grid 外或 mask 外 → NaN（POC-4）。
 * 回 cm（僅供顯示／放置，非確定性路徑）。
 */
export function heightAtCm(hm: Heightmap, xCm: number, zCm: number): number {
  const gx = xCm * CELLS_PER_CM - 0.5;
  const gz = zCm * CELLS_PER_CM - 0.5;
  const i0 = Math.floor(gx);
  const j0 = Math.floor(gz);
  if (i0 < 0 || j0 < 0 || i0 + 1 >= hm.w || j0 + 1 >= hm.h) return NaN;
  const idx00 = j0 * hm.w + i0;
  const idx10 = idx00 + 1;
  const idx01 = idx00 + hm.w;
  const idx11 = idx01 + 1;
  if (!hm.mask[idx00] || !hm.mask[idx10] || !hm.mask[idx01] || !hm.mask[idx11]) return NaN;
  const t = gx - i0;
  const s = gz - j0;
  const d = hm.data;
  const v =
    d[idx00] * (1 - t) * (1 - s) +
    d[idx10] * t * (1 - s) +
    d[idx01] * (1 - t) * s +
    d[idx11] * t * s;
  return (v / 255) * (hm.depthCm + 3);
}

/* ------------------------------- u8-base64 ------------------------------- */

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_REV = (() => {
  const rev = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) rev[B64_ALPHABET.charCodeAt(i)] = i;
  return rev;
})();

/** 純 TS base64（零 DOM：btoa／Buffer 都不用），Node／瀏覽器同一實作。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += B64_ALPHABET[(n >> 18) & 63];
    out += B64_ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64_ALPHABET[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64_ALPHABET[n & 63] : '=';
  }
  return out;
}

export function base64ToBytes(s: string): Uint8Array {
  if (s.length % 4 !== 0) throw new Error('base64 length must be multiple of 4');
  let pad = 0;
  if (s.endsWith('==')) pad = 2;
  else if (s.endsWith('=')) pad = 1;
  const outLen = (s.length / 4) * 3 - pad;
  const out = new Uint8Array(outLen);
  // '='（0x3d）視為 0 值（輸出長度已扣除 padding）；其餘非法字元仍 -1 拋錯。
  const val = (k: number): number => {
    const c = s.charCodeAt(k);
    return c === 0x3d ? 0 : B64_REV[c];
  };
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const c0 = val(i);
    const c1 = val(i + 1);
    const c2 = val(i + 2);
    const c3 = val(i + 3);
    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) throw new Error('invalid base64');
    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (o < outLen) out[o++] = (n >> 16) & 0xff;
    if (o < outLen) out[o++] = (n >> 8) & 0xff;
    if (o < outLen) out[o++] = n & 0xff;
  }
  return out;
}

/** 二進位格式：'SND1'＋shape(1B)＋w(u16LE)＋h(u16LE)＋depthMm(u16LE)＋data(w×h)。mask 不存。 */
export function encodeHeightmap(hm: Heightmap): string {
  const shapeCode = ['rect', 'square', 'circle', 'octagon'].indexOf(hm.shape);
  if (shapeCode < 0) throw new Error(`unknown shape: ${hm.shape}`);
  const depthMm = Math.round(hm.depthCm * 10);
  const head = new Uint8Array(11);
  head.set([0x53, 0x4e, 0x44, 0x31, shapeCode], 0);
  head[5] = hm.w & 0xff;
  head[6] = (hm.w >> 8) & 0xff;
  head[7] = hm.h & 0xff;
  head[8] = (hm.h >> 8) & 0xff;
  head[9] = depthMm & 0xff;
  head[10] = (depthMm >> 8) & 0xff;
  const all = new Uint8Array(11 + hm.data.length);
  all.set(head, 0);
  all.set(hm.data, 11);
  return bytesToBase64(all);
}

export function decodeHeightmap(s: string): Heightmap {
  const bytes = base64ToBytes(s);
  if (bytes.length < 11 || bytes[0] !== 0x53 || bytes[1] !== 0x4e || bytes[2] !== 0x44 || bytes[3] !== 0x31) {
    throw new Error('bad magic (expected SND1)');
  }
  const shapes: TrayShape[] = ['rect', 'square', 'circle', 'octagon'];
  const shape = shapes[bytes[4]];
  if (!shape) throw new Error('bad shape code');
  const w = bytes[5] | (bytes[6] << 8);
  const h = bytes[7] | (bytes[8] << 8);
  const depthMm = bytes[9] | (bytes[10] << 8);
  if (w < 1 || h < 1) throw new Error('bad dimensions');
  if (bytes.length !== 11 + w * h) throw new Error('bad payload length');
  const data = new Uint8Array(w * h);
  data.set(bytes.subarray(11));
  const depth = depthMm / 10;
  const sizeCm: TraySizeCm = { w: w / CELLS_PER_CM, h: h / CELLS_PER_CM, depth };
  return { shape, w, h, sizeCm, depthCm: depth, data, mask: computeMask(shape, w, h) };
}
