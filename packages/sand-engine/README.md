# @sandtray/sand-engine（POC）

REQ-016 §8／task T12（G33，2026-09-18）：CPU 確定性 u8 高度場筆刷核心＋Three.js displacement 渲染的概念驗證。獨立套件、零 Cloudflare 依賴、不碰 `apps/` 與既有 `packages/`。**C31 review 已 PASS（2026-09-18；WebKit 補證後三引擎 byte-identical）——可進 protocol v2。**

## 結構

- `src/core.ts` — 純 TS、零 DOM、零 Three。`createHeightmap`／`applyBrush`（全整數：預鑄 Q8 高斯 LUT＋線性收邊）／`heightAtCm`（雙線性）／`encodeHeightmap`／`decodeHeightmap`（u8-base64，純 TS base64）。
- `src/render.ts` — Three.js 0.185 渲染：PlaneGeometry 頂點 y、`applyPatch` 只更新受影響區域＋區域法線、挖到 v=0 頂點 alpha→0 露藍底、ExtrudeGeometry 框體、`disposeScene` 資源釋放。
- `demo/` — Vite 頁（port 5179）：挖／堆／抹平、滑鼠＋觸控、放方塊、fps／heap HUD、四形狀與標準／120 cm 切換；`window.__sand` 測試 API。
- `test/` — vitest unit（16 案）＋共用 500 步 op 產生器（整數 LCG）。
- `test-e2e/` — Playwright（functional headless＋perf headed）。

## 執行

```bash
npm test -w @sandtray/sand-engine                 # unit（16 案）
npx playwright test --config packages/sand-engine/playwright.sand.config.ts            # 全部（perf 會開視窗 2×60 s）
npx playwright test --config packages/sand-engine/playwright.sand.config.ts --project=functional
npx playwright test --config packages/sand-engine/playwright.sand.config.ts --project=webkit-determinism   # POC-1 跨引擎（需 WebKit，見下節）
npm run demo -w @sandtray/sand-engine             # 手動試玩 http://127.0.0.1:5179
```

root `npm test`／`check` 不含本套件（root vitest include 為 `tests/**`）；root `tsc --noEmit` 涵蓋本套件。

### WebKit（跨引擎確定性）——其他機器需安裝一次

`webkit-determinism` 專案（C31-F1，2026-09-18 使用者核准下載）：Node 與 Chromium 同為 V8，POC-1「任何 JS 引擎」另補 Playwright WebKit（JavaScriptCore）樣本。瀏覽器裝在 repo-local `node_modules/playwright-core/.local-browsers/`（`PLAYWRIGHT_BROWSERS_PATH='0'` 慣例，**不進 git**），故**每台新機器要重做一次**（以下為 Windows；其他平台 zip 名見 `npx playwright install --dry-run webkit` 輸出）：

```bash
# ① 正常路：installer 直接裝 repo-local
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install webkit

# ② cdn.playwright.dev 逾時時（本機 2026-09-18 實測兩次 30 s 逾時）：改抓官方
#    fallback 1 鏡像。Content-Length 必為 62,672,093 B（webkit v2359 / webkit-win64.zip），不符即停。
curl -L -o webkit-2359.zip \
  "https://playwright.download.prss.microsoft.com/dbazure/download/playwright/builds/webkit/2359/webkit-win64.zip"
#    解壓內容直接放進 node_modules/playwright-core/.local-browsers/webkit-2359/
#    （目錄頂層就是 Playwright.exe 等檔案），再補一個空的 INSTALLATION_COMPLETE 標記檔。

# ③ 驗收：dry-run 認得 + 專案跑 POC-1（預期 1 passed；sha256 = 0afe4c0d5b15…f04f2145）
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install --dry-run webkit
npx playwright test --config packages/sand-engine/playwright.sand.config.ts --project=webkit-determinism
```

PowerShell 解壓替代：`Expand-Archive webkit-2359.zip -DestinationPath node_modules\playwright-core\.local-browsers\webkit-2359`。WebKit 補證證據：`docs/evidence/2026-09-18/opus/c31-logs/`。

## 關鍵結果（2026-09-18，證據見 docs/evidence/2026-09-18/glm/g33-sand-engine-poc/）

- **POC-1 確定性**：同一 500 步整數 LCG op 序列，Node（vitest＋node:crypto）、Chromium（Playwright＋crypto.subtle）與 **WebKit 26.6／JavaScriptCore**（C31-F1 補證，2026-09-18；證據 `docs/evidence/2026-09-18/opus/c31-logs/`）sha256 皆為 `0afe4c0d5b156c7305f67ecb765cad2df6fc659eefa2b3ac61d42fd9f04f2145`（三引擎 byte-identical）。
- **POC-2**（144×114，60 s 連續拖曳、AMD Radeon 780M／D3D11）：fps 106.47（≥55）、applyBrush p95 0.10 ms（≤0.5）。
- **POC-3**（240×240）：fps 119.45（≥30）、p95 0.20 ms（≤2）、heap ≈29 MB。

## 授權邊界（POC-9）

- **未讀取** cynthiayuyu/sandtray 原始碼（無授權；使用者 06:40 裁定不聯絡作者）；「按住 ≥1 s 觸底」「每影格最多一次筆刷」等常數僅取自 REQ-016 §2／§4 的設計摘要。
- 筆刷語意（dig／mound／smooth × radius／strength）：參考 [skeelogy/skulpt.js](https://github.com/skeelogy/skulpt.js)（MIT）與 [SamG-Coder/SandDune](https://github.com/SamG-Coder/SandDune)（MIT）之公開設計概念；cell 高度場模型參考 [winchxyz/tidewright](https://github.com/winchxyz/tidewright)（MIT）。以上皆借設計不借碼；本套件程式碼全部自行撰寫，引用處見 `src/core.ts` 檔頭註解。
- 水面、休止角崩塌、同步、持久化不在本 POC（REQ-016 §3.4／§8）。
