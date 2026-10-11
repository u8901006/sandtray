/**
 * G33／T12 sand-engine POC — functional e2e（headless）：
 * POC-1 瀏覽器側確定性、POC-6 方塊落點、POC-7 資源釋放、四形狀截圖、
 * 挖到底露藍／堆沙截圖、真實滑鼠拖曳路徑。
 * 數據與截圖預設寫入 test-results/evidence/（SAND_EVIDENCE_DIR 可覆寫；不直寫 docs/evidence）。
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { applyBrush, createHeightmap, heightAtCm } from '../src/core';
import { fixedOps, hashHeightmapNode, replayNode, STANDARD_TRAY } from '../test/op-script';

// C31（open-items #13 同型）：測試不得直寫歷史 evidence——預設寫到 test-results/evidence，
// 要歸檔時由執行者設 SAND_EVIDENCE_DIR 指向自己的 evidence 目錄再複製。
const EV_DIR = process.env.SAND_EVIDENCE_DIR
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test-results/evidence');
const SHOTS = path.join(EV_DIR, 'screenshots');

test.beforeAll(() => {
  fs.mkdirSync(SHOTS, { recursive: true });
});

test('POC-1 確定性：同一 500 步序列，Chromium 與 Node 的 sha256 相同', async ({ page }) => {
  const ops = fixedOps(500);
  const nodeHash = hashHeightmapNode(replayNode(ops));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.__sand?.ready ?? false)).toBe(true);
  const browserHash = await page.evaluate(async (ops) => {
    window.__sand.applyOps(ops);
    return await window.__sand.sha256Hex();
  }, ops);
  expect(browserHash).toBe(nodeHash);
  fs.writeFileSync(
    path.join(EV_DIR, 'poc1-determinism.json'),
    JSON.stringify({ ops: ops.length, nodeHash, browserHash, byteIdentical: browserHash === nodeHash }, null, 2),
  );
});

test('POC-6 物件落點：方塊底面＝heightAtCm 該點值（誤差 ≤0.5 mm，含 Node 對照）', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(() => {
    for (let k = 0; k < 120; k++) {
      window.__sand.applyOps([{ tool: 'dig', cx: 30, cz: 20, radiusCm: 6.5, strength: 896 }]);
    }
    return window.__sand.placeBox(30, 20);
  });
  expect(r).not.toBeNull();
  expect(Math.abs(r!.sampledCm - r!.boxBottomCm)).toBeLessThanOrEqual(0.05);
  // Node 端以同一 core 獨立重放對照（瀏覽器回報值不得偏離）
  const hm = createHeightmap('rect', { ...STANDARD_TRAY });
  for (let k = 0; k < 120; k++) {
    applyBrush(hm, { tool: 'dig', cx: 30, cz: 20, radiusCm: 6.5, strength: 896 });
  }
  const nodeCm = heightAtCm(hm, 30, 20);
  expect(Math.abs(r!.boxBottomCm - nodeCm)).toBeLessThanOrEqual(0.05);
  fs.writeFileSync(
    path.join(EV_DIR, 'poc6-box-height.json'),
    JSON.stringify({ boxBottomCm: r!.boxBottomCm, pageSampledCm: r!.sampledCm, nodeExpectedCm: nodeCm }, null, 2),
  );
});

test('POC-7 關閉場景後 renderer.info.memory（geometries／textures）回基線', async ({ page }) => {
  await page.goto('/');
  const s1 = await page.evaluate(() => window.__sand.stats());
  expect(s1.geometries).toBeGreaterThanOrEqual(3); // 沙面＋藍底＋框體
  const base = await page.evaluate(() => {
    window.__sand.closeScene();
    return window.__sand.stats();
  });
  expect(base.geometries).toBe(0);
  // textures 的 +1 是 three WebGLState 首次綁定 material 時上傳的 1×1 emptyTexture 單例
  // （renderer 生命週期、與場景無關）：關鍵是不隨場景重建增長，見第二次循環。
  expect(base.textures).toBeLessThanOrEqual(1);
  const again = await page.evaluate(() => {
    window.__sand.openScene();
    window.__sand.placeBox(40, 25);
    window.__sand.closeScene();
    return window.__sand.stats();
  });
  expect(again.geometries).toBe(0);
  expect(again.textures).toBe(base.textures);
  fs.writeFileSync(
    path.join(EV_DIR, 'poc7-resource-baseline.json'),
    JSON.stringify({ afterLoad: s1, afterClose: base, afterReopenAndClose: again }, null, 2),
  );
});

test('四形狀 UI 切換＋截圖（rect／square／circle／octagon）', async ({ page }) => {
  await page.goto('/');
  for (const shape of ['rect', 'square', 'circle', 'octagon'] as const) {
    await page.click(`#shapes button[data-shape="${shape}"]`);
    await page.waitForTimeout(250);
    const dims = await page.evaluate(() => window.__sand.dims());
    expect(dims.shape).toBe(shape);
    await page.screenshot({ path: path.join(SHOTS, `shape-${shape}.png`) });
  }
});

test('挖到底露藍（min＝0）與堆沙（max＝255）截圖', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    for (let k = 0; k < 300; k++) {
      window.__sand.applyOps([{ tool: 'dig', cx: 36, cz: 28.5, radiusCm: 6.5, strength: 896 }]);
    }
  });
  const mm = await page.evaluate(() => window.__sand.minMax());
  expect(mm.min).toBe(0);
  await page.screenshot({ path: path.join(SHOTS, 'dig-to-blue.png') });
  await page.evaluate(() => {
    window.__sand.setTray('rect', 72, 57, 7);
    for (let k = 0; k < 2500; k++) {
      window.__sand.applyOps([{ tool: 'mound', cx: 36, cz: 28.5, radiusCm: 6.5, strength: 896 }]);
    }
  });
  const mm2 = await page.evaluate(() => window.__sand.minMax());
  expect(mm2.max).toBe(255);
  await page.screenshot({ path: path.join(SHOTS, 'mound.png') });
});

test('真實滑鼠拖曳（pointer 事件路徑）改變高度圖', async ({ page }) => {
  await page.goto('/');
  const before = await page.evaluate(() => window.__sand.sha256Hex());
  const canvas = page.locator('#app canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let k = 0; k < 40; k++) {
    await page.mouse.move(
      box.x + box.width * (0.35 + 0.3 * Math.sin(k / 5)),
      box.y + box.height * (0.4 + 0.2 * Math.cos(k / 7)),
      { steps: 2 },
    );
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  const after = await page.evaluate(() => window.__sand.sha256Hex());
  expect(after).not.toBe(before);
});
