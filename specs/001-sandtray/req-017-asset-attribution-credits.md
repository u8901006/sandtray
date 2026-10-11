---
title: "REQ-017 — 素材出處與 CC-BY 署名（credits 頁＋schema attribution 欄）"
description: "使用者 2026-09-18 15:5x 裁定採用 CC-BY 素材，因此沙盤 UI 必須先有 credits 頁、asset schema 必須有可強制的 attribution 欄位。本檔把需求寫成可實作、可驗收的規格：欄位定義、強制點（server 與 build 時）、UI 行為、離線／匯出情境、驗收條件與回歸。共享核心（protocol／asset-catalog／apps/web），實作預設 GPT-6（AGENTS §2）；Claude 負責 spec／review；GLM 負責回歸與素材 metadata"
date: 2026-09-18
tags: [spec, requirement, REQ-017, license, attribution, credits, CC-BY]
author: Claude Opus 5（依使用者裁定整理）
status: v1 PARTIAL（使用者 22:0x「署名頁先做」→ Opus C41 落地最小切片：provenance 必填＋E1/E2/E3 檢查＋credits UI＋credits.txt；protocol 條件式署名與非實作者驗收待 GPT-6 9/19；見 docs/evidence/2026-09-18/opus/C41-req017-credits-implementation.md）
supersedes: —
---

# 0. 需求與來由

**使用者 2026-09-18 15:5x 裁定**：

> 採用 CC-BY → 沙盤 UI 必須先有 credits 頁＋schema attribution 欄。

來由：[C37](../../docs/evidence/2026-09-18/opus/C37-sketchfab-candidate-probe.md) 發現 Sketchfab 上「可下載且 CC0」的候選幾近於零，17 筆缺口的可用候選**全部是 CC-BY 4.0**。CC-BY 的條件是「必須標示作者」——沒有 credits 顯示就是違約。因此本 REQ 是 **T13 Phase 1 gate 的硬前置**（[C36](../../docs/evidence/2026-09-18/opus/C36-g37-download-request-review.md) T-A4 升級）。

**範圍界線**：本 REQ 只處理「出處資料的完整性與顯示」，不處理素材採集（T13）、不處理 R2 交付授權（T-A3，仍是 private／authenticated）。

# 1. 現況（程式碼錨點，2026-09-18 實測）

| 層 | 現況 | 缺口 |
|---|---|---|
| `packages/protocol/src/index.ts:115` | `assetReleaseSchema.license = {licenseSource, licenseText, attribution, webDistributionAllowed: literal(true)}` | `attribution` 是 `z.string().max(1000)`——**允許空字串**；無 `author`、`licenseUrl`、`requiresAttribution`；`webDistributionAllowed` 只有 true 而沒有「公開 vs authenticated」之分 |
| `packages/asset-catalog/src/index.ts:4` | `CatalogAsset` 型別只有 `id/name/category/symbol/color/url/version/thumbnail/clips/sourcePack` | **runtime catalog（UI 真正讀的東西）完全沒有 author／license／attribution 欄**；`imported-v1.json` 的 JSON 裡其實有 `author`／`license`，但型別未宣告、UI 讀不到 |
| `apps/web/src/main.tsx`、`catalog-model.tsx` | 素材櫃只顯示名稱／縮圖／分類 | 無 credits 入口、無逐件出處顯示 |
| `tests/contracts.test.ts:27` | 對 `references/prompts-100.json` 驗 `assetDraftSchema` | 無 attribution 相關斷言 |
| 現有 270 件匯入素材 | 全 CC0-1.0（`attribution_required: false`），故目前**沒有**違約狀態 | 一旦有第一件 CC-BY 進 catalog，缺口即成違約 |

# 2. 使用者可見行為（驗收用語言）

1. **credits 入口**：沙盤畫面（治療師與案主皆可見）有「素材出處」入口；點開顯示清單。不需要離開房間、不中斷會談。
2. **清單內容**：每一件**目前房間已載入或素材櫃可選**的素材顯示：中文名稱、作者、授權名稱（如 `CC BY 4.0`）、授權連結、來源頁連結。CC0 素材顯示作者但標「無需署名」。
3. **分組**：依授權分組（CC0／CC-BY／其他），每組顯示件數；同一 pack 多件可折疊成 pack 一列＋件數，但**展開後必須能看到逐件作者**。
4. **匯出**：PNG 匯出（既有功能）與保存的作品，其出處資訊必須可追溯——**最低要求**：匯出時同時可下載一份 `credits.txt`（或畫面上可複製的文字區塊）。不強制把文字燒進圖片。
5. **離線／載入失敗**：credits 清單來自 catalog metadata，不依賴 GLB 是否載入成功；素材載入失敗仍要列出。
6. **不可關閉**：credits 入口不得被設定隱藏（避免「關掉就沒署名」的違約路徑）。

# 3. 資料模型（建議；最終由 GPT-6 定案）

`CatalogAsset` 新增**必填** `provenance`：

```ts
provenance: {
  author: string;                    // 非空
  license: 'CC0-1.0'|'CC-BY-4.0'|'QAL-1.0';   // 允許清單；by-sa／by-nc／by-nd 一律拒（R2）
  licenseUrl: string;                // 非空 URL
  sourceUrl: string;                 // 來源頁（pack 頁或模型頁）
  sourcePack?: string;
  requiresAttribution: boolean;      // CC-BY → true
  attributionText: string;           // requiresAttribution 時非空；CC0 可為空
  standaloneRedistributionAllowed: boolean;  // QAL → false（T-A3：不得進公開靜態路徑）
  licenseSnapshotSha256?: string;    // 授權快照（T13 D1）
}
```

`assetReleaseSchema.license` 對齊：`attribution` 改為「`requiresAttribution` 為 true 時 `.min(1)`」的條件式（zod `superRefine`）；新增 `author`、`licenseUrl`、`requiresAttribution`、`standaloneRedistributionAllowed`。**向後相容**：現有 270 件 CC0 需一次性補 `provenance`（可由 `imported-v1.json` 既有 `author`／`license` 欄機械生成，GLM 可做）。

# 4. 強制點（防止「資料有、顯示沒有」與「顯示有、資料空」）

| # | 強制點 | 位置 | 行為 |
|---|---|---|---|
| E1 | build／contract 時 | `tools/contracts.ts`、`tests/contracts.test.ts` | catalog 任一筆 `requiresAttribution: true` 而 `attributionText` 空 → **失敗**；任一筆缺 `provenance` → 失敗 |
| E2 | server 端 | `apps/worker/src/sync.ts:83,158`（`validAssetVersion` 附近） | `object.create`／scene 還原時，assetId 對應 catalog 條目若 `provenance` 不完整 → `INVALID_PAYLOAD`（不讓無出處素材進場景） |
| E3 | 公開路徑 | `apps/web/public/imported-assets/` | `standaloneRedistributionAllowed: false` 的素材**不得**出現在此靜態路徑（lint 腳本檢查檔名對照 catalog） |
| E4 | UI | credits 元件 | 清單為空但 catalog 非空 → 視為 bug（回歸測試斷言至少列出目前素材數） |

# 5. AC（AC17-1～AC17-9，含 AC17-4b）

- **AC17-1** `CatalogAsset.provenance` 型別落地，270 件既有素材全部補齊（author／license／licenseUrl 非空；CC0 者 `requiresAttribution: false`）。
- **AC17-2** E1 生效：故意把一筆 CC-BY 的 `attributionText` 清空 → `npm run check` **失敗**；還原 → 通過（突變測試，證明斷言有效）。
- **AC17-3** E2 生效：偽造一筆 `provenance` 不完整的 catalog 條目，`object.create` 被 server 以 `INVALID_PAYLOAD` 拒絕（直呼或 runtime 測試）。
- **AC17-4** E3 生效：lint 腳本在 `standaloneRedistributionAllowed: false` 素材被放進 `public/imported-assets/` 時失敗。
- **AC17-4b** 授權允許清單生效：把任一筆 `license` 改成 `CC-BY-SA-4.0` → `npm run check` 失敗（突變反證）。
- **AC17-5** UI：素材櫃有 credits 入口；點開列出目前 catalog 全部素材的作者與授權，CC-BY 分組件數正確。
- **AC17-6** UI：credits 入口在案主端與治療師端皆可見、無法被隱藏（設定面板沒有關閉選項）。
- **AC17-7** 匯出：PNG 匯出流程可取得 `credits.txt` 內容（或可複製文字），內容含全部 `requiresAttribution: true` 素材的作者與授權連結。
- **AC17-8** 素材載入失敗（T10 timeout 路徑）時 credits 仍列出該素材。
- **AC17-9** 回歸：既有 82 unit／86 runtime／24 e2e 不因本 REQ 退化；新增測試數如實記錄。

# 6. 不變式（不得破壞）

- credits 顯示**不是**授權判定：`license` 欄仍以 T13 D1 三層採信（檔內 License.txt ＞ 包頁＋快照 ＞ 衝突即保守 QAL）。
- 出處資料不得由 client 送出後被信任——catalog 是 build-time 資料，server 只做存在性與完整性檢查（E2）。
- `standaloneRedistributionAllowed: false` 仍不得走公開 CDN（T-A3）；credits 頁的存在**不會**讓 QAL 素材變成可公開散布。
- 不得為了讓 `check` 變綠而放寬 E1／E2 的斷言（AGENTS §13）。

# 7. 風險與未決

- **R1** CC-BY 4.0 的署名要求含「標示修改」（modified 需註明）——Blender 轉檔／decimate 屬修改，`attributionText` 建議固定含「（已為 Web 最佳化）」字樣。**待 GPT-6 定樣板**。
- **R2 已裁定（使用者 2026-09-18 16:0x）：CC-BY-SA 一律排除**——ShareAlike 會把同授權傳染到衍生作品（沙盤場景／匯出圖／保存檔皆可能被視為衍生）。採集來源不得列入 `by-sa`；同理排除 `by-nc`（禁商用）與 `by-nd`（禁改作，與 Web 最佳化衝突）。允許清單：**CC0-1.0、CC-BY-4.0**（＋既有本機 CC0 與 QAL 受限素材，QAL 不得公開散布）。E1 contract 檢查應把 `license` 值限定在允許清單內，出現 `by-sa`／`by-nc`／`by-nd` 即失敗。
- **R3** credits 清單顯示「目前 catalog 全部」還是「本房已用」——本檔採「素材櫃可選＋房內已載入」兩者（§2.2），實作可先做全量。
- **R4** 匯出作品（PNG／保存檔）若在診所外流通，署名義務仍在——`credits.txt` 是最低滿足，不是法律意見。

# 8. 分工

- **GPT-6（9/19 CLAIM）**：`provenance` 型別與 `assetReleaseSchema` 調整、E2 server 守門、credits UI、R1 樣板、migration（270 件補欄）。屬共享核心。
- **Claude Opus 5**：本 spec；實作後 review（E1～E4 各做突變反證）。
- **GLM**：270 件 `provenance` 機械生成＋AC17-2／3／4 的突變回歸＋traceability REQ-017 列（**先寫 `NOT_IMPLEMENTED`**）。等 GPT-6 定欄位名再動程式碼。
- **使用者**：R2 已裁定（16:0x 排除 CC-BY-SA／NC／ND）；餘無待辦。
