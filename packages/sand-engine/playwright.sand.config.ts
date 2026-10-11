import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

// 與 root playwright.config.ts 同慣例：瀏覽器用 repo-local node_modules/playwright-core/.local-browsers
// （chromium-1243），不下載到使用者全域快取。
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';

/**
 * G33／T12 sand-engine POC e2e：自帶 Vite demo（5179，不佔 apps/web 的 8788）。
 * functional 專案跑 headless（確定性／POC-6／POC-7／截圖／真實滑鼠路徑）；
 * perf 專案跑 headed——AC 的「Chromium 桌機 fps」指真實 GPU 而非 SwiftShader。
 */
const config: PlaywrightTestConfig = {
  testDir: './test-e2e',
  timeout: 240_000,
  reporter: 'list',
  outputDir: './test-results',
  use: {
    baseURL: 'http://127.0.0.1:5179',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'npx vite --config packages/sand-engine/demo/vite.config.ts',
    cwd: '../..',
    url: 'http://127.0.0.1:5179',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'functional',
      testMatch: /poc-functional\.spec\.ts/,
      use: { headless: true },
    },
    {
      name: 'perf',
      testMatch: /poc-perf\.spec\.ts/,
      use: { headless: false },
    },
    {
      // C31-F1（2026-09-18，使用者核准下載 WebKit）：POC-1「任何 JS 引擎」需要非 V8 樣本——
      // Node 與 Chromium 同為 V8。只跑確定性一案；WebKit 裝在 repo-local .local-browsers/webkit-2359。
      name: 'webkit-determinism',
      testMatch: /poc-functional\.spec\.ts/,
      grep: /POC-1/,
      use: { headless: true, browserName: 'webkit' },
    },
  ],
};

export default defineConfig(config);
