/**
 * G33／T12 sand-engine POC — perf e2e（headed，真實 GPU；AC 的「Chromium 桌機」口徑）：
 * POC-2 標準盤 144×114：60 s 連續拖曳 fps ≥55、applyBrush p95 ≤0.5 ms；
 * POC-3 120 cm 盤 240×240：fps ≥30、p95 ≤2 ms。
 * bench 走 demo 真實拖曳節流路徑（每影格最多一次、≤60 次/s）。
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const EV_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/evidence/2026-09-18/glm/g33-sand-engine-poc');

test.beforeAll(() => {
  fs.mkdirSync(EV_DIR, { recursive: true });
});

test('POC-2 標準盤 144×114：60 s 連續拖曳 fps ≥55、applyBrush p95 ≤0.5 ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => window.__sand.bench(60));
  fs.writeFileSync(path.join(EV_DIR, 'poc2-standard-144x114.json'), JSON.stringify(r, null, 2));
  console.log('[POC-2]', JSON.stringify(r));
  expect(r.fps).toBeGreaterThanOrEqual(55);
  expect(r.p95Ms).toBeLessThanOrEqual(0.5);
});

test('POC-3 120 cm 盤 240×240：60 s 連續拖曳 fps ≥30、applyBrush p95 ≤2 ms', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.__sand.setTray('rect', 120, 120, 7));
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => window.__sand.bench(60));
  fs.writeFileSync(path.join(EV_DIR, 'poc3-max-240x240.json'), JSON.stringify(r, null, 2));
  console.log('[POC-3]', JSON.stringify(r));
  expect(r.fps).toBeGreaterThanOrEqual(30);
  expect(r.p95Ms).toBeLessThanOrEqual(2);
});
