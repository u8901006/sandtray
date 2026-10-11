---
title: "REQ-018 — 素材走登入後才能取得的網址（authenticated asset delivery）"
description: "使用者 2026-09-18 22:0x 裁定：模型檔改走登入後才拿得到的網址，一次解決 QAL／CC-BY 素材不得公開再散布（T-A3）與原檔外流兩個問題。本檔為規格草案：路由、授權、快取、公開路徑退場、效能與驗收；實作屬 worker／R2／auth 共享核心，預設 GPT-6"
date: 2026-09-18
tags: [spec, requirement, REQ-018, assets, R2, auth, T-A3]
author: Claude Opus 5（依使用者裁定整理）
status: DRAFT v2（2026-09-20 使用者裁定選項 B：CC0 保留公開、受限素材只走私有；T18-A API 與 T18-B room 模式切換已落地）
supersedes: DRAFT v1 §3「公開路徑退場」階段②與 R3「舊路徑回 410」（見 §0.1）
---

# 0. 需求與來由

> 模型走登入後才能拿的網址。（使用者 2026-09-18）

現況：所有 GLB 由 `apps/web/public/imported-assets/**` 與 `/dev-assets/**` 以**靜態公開路徑**提供（Vite build 進 `dist/`，任何人知道 URL 即可 `curl`）。這對 CC0 無妨，但 (a) Quaternius QAL 素材禁止 standalone 再散布（[C36 D1](../../docs/evidence/2026-09-18/opus/C36-g37-download-request-review.md)）、(b) CC-BY 原檔公開等於替作者散布、(c) 使用者自備 `.blend` 轉出的動物授權未核對。REQ-017 E3 目前只能「拒絕受限素材進公開路徑」，等於受限素材**根本進不了產品**；本 REQ 提供受限素材的合法交付通道。

# 0.1 裁定紀錄（2026-09-20，使用者；Claude Opus 5 整理）

T18-B 發現 DRAFT v1 §3 階段②（CC0 也搬、公開路徑最終只留 LICENSE）與**本機探索模式**互斥：探索模式沒有 session 也沒有 room，私有路由必填 `roomId`，門口一收探索即失效。使用者於 15:5x 在 A（探索也要求登入＋個人房）／B（CC0 保留公開，受限素材只走私有）／C（探索改用縮小素材）中**選 B**。

依 B 修訂：

- **公開靜態路徑保留給 `standaloneRedistributionAllowed:true` 的素材（目前＝CC0）**；`apps/web/public/imported-assets/` 不再以「只留 LICENSE」為目標。階段②取消；R3「catalog 一次切換、舊路徑回 410」不適用於 CC0。
- **受限素材（QAL、CC-BY、`standaloneRedistributionAllowed:false`）只能有私有路由**：E3 `RESTRICTED_ON_PUBLIC_PATH` 繼續是 build gate（AC18-6 不變）；room 模式前端已對所有 releasable 且 hash-pinned 素材走私有路由（T18-B），受限素材進 catalog 時自動走教室，不需再改前端。
- **產品陳述**：只能說「受限素材受登入與房間保護」，**不得**說「全站模型已受保護」；CC0 公開下載屬授權允許。
- **本機探索**：維持靜態 CC0 路徑；探索模式永遠看不到受限素材（受限素材沒有公開 URL，探索無 room 拿不到私有 URL）——這是 B 的固有結果，非 bug。
- ~~**待決（不在 B 裁定內）**：9 件 UNVERIFIED 使用者動物目前在公開路徑（E3 對 UNVERIFIED 豁免），而 worker 對非 releasable 拒絕，所以它們既公開又進不了教室。選項：核對授權後升 releasable（走教室）／自公開 catalog 移除／維持現狀但標記為開發用。列 open item，等使用者。~~ **2026-09-20 16:0x 使用者裁定「核對授權後升 releasable」→ T18-C**：7 件（chicken／deer／dog／horse／kitty／pinguin／tiger）核對為 ITHappy Studios「Animals FREE」（可商用、不得 as-is 再散布、無署名要求）→ 新 License `ITHAPPY-FREE`、releasable、private-only（檔案移出 `apps/web/public`，url 改私有路由，本機探索不列出）；**trex** 核對為 TurboSquid #1015414 Standard License，條文明文禁止非 Unity／Unreal／Lumberyard 的 WebGL 與開放格式 → **不可升**；使用者 16:3x 裁定**自 catalog 與公開路徑移除**（T18-D，已落地）。**panda**：使用者聲明自製 → `PROJECT-OWN`（releasable、可公開路徑；匯出 GLB 無外部貼圖）。catalog 現已零 UNVERIFIED。詳 [T18-C evidence](../../docs/evidence/2026-09-20/opus/T18-C-user-animals-license-verification.md)。
- 受限素材的首個實例即為 ITHappy 7 件：worker `pinnedModels`（imported-v1＋animals）＋前端 `modelUrlFor` 讓它們在 room 模式走私有路由，本機探索看不到——B 的固有結果。
- 縮圖：catalog 無縮圖 hash，維持靜態；受限素材進來前需 schema 增欄（GPT-6 整合）。

# 1. 範圍

- **In**：`GET /api/assets/{assetId}/{assetVersion}/model.glb`（＋縮圖）由 worker 驗證 session cookie 後回應；R2 private bucket 為儲存；`CatalogAsset.url` 改指向此路由；公開路徑退場計畫。
- **Out**：CDN 簽名 URL 服務商選型以外的計費、素材轉檔（T13 Phase 1b）、credits（REQ-017）。

# 2. 使用者可見行為

1. 已登入的治療師與已入座的案主載入素材與現在**一樣快、一樣的畫面**；未登入者直接開 GLB 網址得到 401，不洩漏檔案是否存在（403／404 不區分）。
2. 房間關閉、席位撤銷、session 過期後，舊的素材網址**立即失效**（不得靠瀏覽器快取繼續拿新檔；已在記憶體的模型不受影響）。
3. 素材載入失敗的既有流程（T10 timeout／重試）不變；401 視為「需要重新登入」而非「模型壞了」。

# 3. 設計（建議；GPT-6 定案）

| 項 | 建議 |
|---|---|
| 路由 | `GET /api/assets/{assetId}/{assetVersion}/model.glb`、`…/thumbnail.png`；`assetId`／`assetVersion` 必須存在於 catalog（`resolveAsset`），否則 404（與 401 順序：**先驗 session 再查 catalog**，未登入一律 401） |
| 授權 | 沿既有 session cookie（`auth.ts`／`sessions.ts`）；案主席位以 room admission 為準（已入座即可）。**不**綁 grant／lease（載入模型不是操作物件） |
| 儲存 | R2 private bucket `sandtray-assets`，key＝`models/<hash>.glb`（沿 T06 內容 hash 命名，版本固定 REQ-011）；worker 以 binding 讀取後串流回應，或簽 5 分鐘 presigned URL 302（二選一，效能量測後定） |
| 快取 | `Cache-Control: private, max-age=300`；`ETag`＝內容 sha256；**不得** `public`；Cloudflare cache 不快取（`Cache-Control: private` 或 `cf-cache-status` 驗證） |
| 速率 | 每 session 每分鐘 N 次（沿限流桶設計；GPT-6 修桶時一併） |
| catalog | `CatalogAsset.url` 由靜態路徑改為路由；`provenance.standaloneRedistributionAllowed:false` 的素材**只能**有路由 URL（REQ-017 E3 的 `PUBLIC_PATHS` 檢查繼續有效） |
| 公開路徑退場 | ~~分兩階段：① 受限素材（QAL／CC-BY／UNVERIFIED）先搬；② CC0 也搬（統一路徑、統一快取策略）。`apps/web/public/imported-assets/` 最終只留 LICENSE 檔~~ **v2（選項 B）**：只有階段①的精神保留——受限素材不得有公開路徑；CC0 保留公開，階段②取消（§0.1） |
| 本機 dev | `wrangler dev` 用本機 R2 模擬或 `tools/verification/runtime-server.mjs` 掛靜態目錄，行為與正式一致（401 規則不可在 dev 放寬） |

# 4. 不變式

- 未認證請求對任何素材路徑一律 401；不得以 query token、referer、IP 白名單放行。
- 素材內容 hash 命名不變（REQ-011）；worker 不得回應 catalog 以外的 key（不可 `..`、不可任意 key，沿 `validateRelease` 的 immutable path 精神）。
- 已 revoke／closed 的 session 拿不到新回應（T-A3；與 AGENTS §9「revoke 後舊 packet 失效」同族）。
- credits（REQ-017）與交付通道無關：受限素材走本通道**仍要**署名。

# 5. AC（AC18-1～AC18-8）

- AC18-1 未登入 `GET …/model.glb` → 401；登入治療師 → 200 且 body sha256 ＝ catalog `sha256`。
- AC18-2 已入座案主 → 200；未入座（waiting）→ 401／403（擇一，固定並記錄）。
- AC18-3 session 登出／過期後同 URL → 401（瀏覽器 `no-store` 或 `private` 驗證：第二次請求確實打到 worker）。
- AC18-4 不存在的 assetId／version：登入 → 404；未登入 → 401（不洩漏存在性）。
- AC18-5 `Cache-Control` 含 `private`、不含 `public`；`cf-cache-status` 不為 HIT。
- AC18-6 REQ-017 E3：把一件 QAL 素材的 `url` 改回 `/imported-assets/…` → `npm run check` 失敗（既有 RESTRICTED_ON_PUBLIC_PATH）。
- AC18-7 效能：本機 100 instance 場景首載時間相對靜態路徑 **劣化 ≤ 20%**（用 T10／capacity 既有量測法；staging 再量一次）。
- AC18-8 回歸：runtime／e2e 既有分母不退化；T10 timeout／retry 路徑對 401 顯示「請重新登入」而非無限重試。

# 6. 風險

- R1 worker 串流大 GLB（最大 22.6 MB 庭園）對 CPU 時間與 egress 的影響 → 先量；不行就走 presigned 302。
- R2 本機 dev 若放寬 401 會讓測試假通過 → AC18-1 必須在 runtime 套件（真 worker）驗。
- R3 ~~公開路徑退場期間兩套 URL 並存 → catalog 一次切換、舊路徑回 410。~~ v2：CC0 兩套 URL 長期並存是設計（探索走靜態、room 走私有），非過渡；410 只適用於未來被撤下的受限素材。

# 7. 分工

- **GPT-6**：路由、auth 綁定、R2 binding／`env.staging`、catalog url 切換、限流。
- **Claude Opus 5**：本 spec；實作後 threat model（401 繞過、快取外洩、key 逃逸）與 review。
- **GLM**：AC18-1～6 回歸測試、AC18-7 量測、公開路徑退場的檔案盤點。
- **使用者**：R2 bucket 建立（9/20 資源日）。
