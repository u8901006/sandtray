# Sandtray

瀏覽器裡的 3D 沙盤，給治療師和案主遠端一起使用。兩個人看同一個沙盤，可以放物件、挖沙、加水，伺服器決定誰能動哪個物件。

A browser-based 3D sandtray for remote sandplay sessions between a therapist and a client, built on Cloudflare Workers and Durable Objects.

> **這不是醫療器材。** 本軟體不提供診斷或治療建議，也不取代受過訓練的專業人員。正式用於臨床前，請自行評估所在地的法規、資料保護與機構規範。
> This software is not a medical device. See [NOTICE.md](NOTICE.md).

## 有什麼

- 兩個沙盤（乾沙、可加水），沙可以挖可以堆，存成高度圖
- 雙人即時同步：WebSocket＋revision／ACK，物件授權綁定 session、房間、物件與 epoch
- 存檔、還原、版本、刪除與 tombstone
- 素材出處頁：每件素材都有作者與授權，CC-BY 素材不能隱藏署名
- 匯出 PNG（需要案主另外同意）

## 架構

| 位置 | 內容 |
|---|---|
| `apps/web` | React 19＋three.js / react-three-fiber 前端 |
| `apps/worker` | Cloudflare Worker：`RoomDurableObject`、`SceneCoordinatorDurableObject`、`AuthDurableObject`，D1 目錄、R2 私有素材與場景 |
| `packages/protocol` | 共用 schema（zod），WebSocket 封包與場景格式 |
| `packages/room-core` | 授權、lease、grant 的純邏輯 |
| `packages/sand-engine` | 確定性的沙面高度場筆刷 |
| `packages/asset-catalog` | 素材目錄與出處（provenance）檢查 |
| `specs/` | 需求、資料模型、驗收條件、決策紀錄與 JSON Schema 契約 |

## 本機執行

需要 Node.js 22.12 以上、23 以下（見 `.nvmrc`）。

```bash
npm ci
```

```bash
npm run dev
```

打開 http://127.0.0.1:5173 。本機模式不需要登入，也不需要 Cloudflare 帳號。這時物件庫只有幾個開發用練習模型；要看到完整的 999 件 CC0 素材，請照 [ASSETS.md](ASSETS.md) 下載素材包。

要跑雙人同步的 Worker：

```bash
npm run dev:worker
```

## 測試

```bash
npm run check
```

這會跑 contract 檢查、型別檢查、單元測試和建置。素材模型檔不在倉庫裡，缺檔時相關測試會顯示 SKIPPED，不會算成通過。設 `REQUIRE_LOCAL_ASSETS=1` 會讓缺檔直接變成失敗。

瀏覽器測試：`npm run test:e2e`；Worker 端到端測試：`npm run test:runtime`。

## 部署到你自己的 Cloudflare

`apps/worker/wrangler.jsonc` 的 `env.production` 是範本，所有值都要換成你自己的：

1. `wrangler d1 create`、`wrangler r2 bucket create` 建立資源，把 `database_id` 的 `REPLACE_ME` 換掉
2. 把 `sandtray.example.org` 換成你的網域
3. 用 `wrangler secret put --env production` 設定 OIDC 的六個 secret（見 `apps/worker/.dev.vars.example`）
4. 依序套用 `apps/worker/migrations/` 的 D1 migration

部署後，所有靜態素材都要登入才能下載。

## 安全

伺服器端的安全不變式寫在 [SECURITY.md](SECURITY.md)。發現漏洞請用 GitHub 的 private vulnerability reporting，不要開公開 issue。

## 授權

- 程式碼：[GNU AGPL-3.0](LICENSE)。如果你修改後架成網路服務給別人使用，必須把修改後的原始碼提供給使用者。
- 3D 素材：各自保有原作者的授權，見 [ASSETS.md](ASSETS.md)。
- `assets/garden-pbr-v1` 的貼圖來自 Poly Haven，CC0。

## 參與

見 [CONTRIBUTING.md](CONTRIBUTING.md)。
