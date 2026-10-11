---
title: "REQ-019 膚色變體"
description: "正式人物的七色 Skin 變體：server 驗證、持久化與 Three.js 材質生命週期。"
date: 2026-09-25
tags: [REQ-019, color-variant, persistence, security]
author: "GPT-5"
status: "PARTIAL"
---

# REQ-019：人物膚色變體

## 目的

案主可在支援 `Skin` 材質的正式人物上選擇七種膚色：`t1`–`t6` 與 `orig`（原作色）；預設為 `t2`／sRGB `#E8BE9A`。變體只改變已核准的 `Skin` 材質，不改網格、骨架、動畫、資產版本或其他材質。

目前產品 allow-list 對應使用者裁定的 12 件人物：ST-101／102／107／108／109／110／111／116／117／202／204／206；catalog 尚未有對應資產時不得因 client payload 強行啟用。

## 固定契約與 AC

- `ColorVariant = t1 | t2 | t3 | t4 | t5 | t6 | orig`；舊 snapshot 沒有 `colorVariant` 時仍可讀取，視為該支援素材的預設 `t2`，不把缺欄解讀為 `orig`。
- `sceneObject.colorVariant` 為 optional；`object.create` 可帶選項但 server 只接受 allow-list asset/version，支援素材省略時寫入 `t2`。
- `object.appearance.commit` 由案主送出，需帶現行 session/control epoch 與 `expectedObjectRevision`；server 以 transaction 更新 `colorVariant`／既有 `materialOverrides`／`hidden`，寫入 history 後才回 ACK。治療師不得僅靠 grant 偽造此命令。
- 未支援素材、未知代號、跨房／過期 session、stale epoch 或 revision conflict 必須拒絕，`sceneRevision` 與物件狀態不得改變；duplicate operation 只回既有 durable ACK。
- undo／redo、命名保存、checkpoint、JSON/PNG snapshot 與 restore 必須保留變體；restore 重新驗證 asset/version 與變體 allow-list，清理舊 grants／leases／邀請等既有 authority，不復活權限。
- renderer 不得改 shared asset cache 的材質；每個 clone 必須擁有自己的 `Skin` material copy。切換或卸載時停止 animation、釋放 mixer 與材質複本；不得 dispose 共用 texture。

## 七色表

| 代號 | 名稱 | sRGB | 行為 |
|---|---|---|---|
| `t1` | 很淺 | `#F6DCC6` | Skin 材質覆寫 |
| `t2` | 淺中 | `#E8BE9A` | 預設／轉檔預設 |
| `t3` | 中等 | `#D4A27C` | Skin 材質覆寫 |
| `t4` | 小麥 | `#B7835C` | Skin 材質覆寫 |
| `t5` | 深 | `#8A5A3C` | Skin 材質覆寫 |
| `t6` | 很深 | `#5A3A28` | Skin 材質覆寫 |
| `orig` | 黑（原作） | 原作線性 0.0134 | 還原每個 GLB 的原始 Skin 色，不使用 sRGB 近似色 |

## 驗證矩陣

1. protocol／JSON schema：七個代號接受，未知代號與非字串拒絕；舊 scene 無欄位仍通過。
2. server 正向／負向：支援人物可切換並 ACK；非 allow-list 素材、治療師、stale epoch/revision、跨房與 replay 皆拒絕。
3. persistence：save → snapshot → restore、undo／redo、DO 重啟後 `colorVariant` 一致，舊 snapshot 缺欄相容。
4. renderer：至少一個模型的七色切換逐一改變 Skin 顏色；兩個 clone 互不污染；卸載後材質複本可回收。

本需求完成前，正式素材 `ready` 與整體產品 release gate 維持既有 No-Go。

## 2026-09-23 21:50 使用者裁定：`orig` 定義（Claude Opus 5.5 記錄）

起因：V7-C02 指出 renderer 以「首次載入的材質色」當 `orig`，而 G06-B1 batch02a GLB 已烘入 t2，上線後 `orig` 會變 t2。使用者裁定：

- **`orig` 維持原作黑**，不隨 GLB 內容改變。
- **每件支援素材在 catalog 記錄原作 Skin 色常數**（線性 RGBA，取自原作匯入的 imported-v1 GLB），renderer 選 `orig` 時以該常數寫入 Skin，不讀檔內當下色、不經 8-bit sRGB 往返。
- 新版本素材（如 batch02a）沿用同一 asset 的原作常數；缺常數的支援素材視為 catalog 錯誤（測試應失敗），不得靜默退回檔內色。

原作常數（Claude Opus 5.5 以 GLB JSON chunk 讀出，2026-09-23）：

| 素材 | 版本（imported-v1） | 原作 Skin baseColorFactor（線性 RGBA） | 貼圖 |
|---|---|---|---|
| IMP_ULTIMATE_Casual_Male | import-34b06e07f9ec3f26 | 0.013410447165369987 ×3, 1 | 無 |
| IMP_ULTIMATE_Casual_Female | import-1a909850aee6c0ac | 同上 | 無 |
| IMP_ULTIMATE_Casual2_Male | import-1c85762cbba47b8f | 同上 | 無 |
| IMP_ULTIMATE_Casual2_Female | import-d95c07243223d4f7 | 同上 | 無 |
| IMP_ULTIMATE_Suit_Male | import-4b3bbaddd3827dfe | 同上 | 無 |
| IMP_ULTIMATE_Suit_Female | import-99a13ffd39792239 | 同上 | 無 |
| IMP_ULTIMATE_Worker_Male | import-6acc81d07a9aca9f | 同上 | 無 |
| IMP_ULTIMATE_OldClassy_Male | import-da22b0aa834495b6 | 同上 | 無 |
| IMP_ULTIMATE_Doctor_Male_Young | import-0ca89474eeb41e6b | 同上 | 無 |
| IMP_ULTIMATE_Soldier_Male | import-67e36bad7a27a23e | 同上 | 無 |
| IMP_ULTIMATE_Knight_Male | import-305930fc97686f0f | 同上 | 無 |
| IMP_ULTIMATE_Wizard | import-c6d87493b57eeb5e | 同上 | 無 |

## 2026-09-24 驗證狀態（V7-I04；REQ-019 維持 PARTIAL）

V7-C03 已對 V7-I03 產品程式碼完成非作者 review，結果 PASS；V7-G03 完整 runtime 118/118、e2e 26/26。V7-I04 再以本機 hash 核對、Skin 已烘入 t2 的 batch02a GLB 實際渲染 `orig`：差異 1,327 px，平均亮度降至 t2 的 15.1%；新增案例 targeted 1/1、完整 runtime 119/119 PASS，`npm run check` EXIT 0。詳見 [V7-I04 task](tasks/V7-I04-batch02a-orig-render-2026-09-24.md) 與 [evidence](../../docs/evidence/2026-09-24/gpt5/v7-i04-batch02a-orig-render.md)。

仍未完成：本次新增案例的非作者 review、卸載後材質資源回收行為量測、其他 batch02a 模型的實渲染、正式素材核准、staging／真機驗收。故本需求與產品均不得標記完成。

## 2026-09-25 V7-I04R 更新（C04 M2 門檻缺口已修；REQ-019 仍 PARTIAL）

C04 原指出 `orig/t2 < 35%` 對「orig 誤接 t6」會假 PASS。I04 測試現同時要求 `orig/t2 < 35%` 及 `orig/t6 < 70%`；正確實測 t2→orig 1,327 px／15.1%，t6→orig 1,264 px／44.65%。M2 突變由新增相對門檻抓到，renderer 還原 SHA 一致。缺少被 gitignore 的 G06-B1 GLB 時輸出 `ENV_MISSING_ASSET` 並 1 skipped/NOT_RUN；該狀態不算 AC 通過。`npm run check` EXIT 0、完整 runtime 119/119 PASS（5.9m）。詳見 [V7-I04 task](tasks/V7-I04-batch02a-orig-render-2026-09-24.md)、[C04 review](../../docs/evidence/2026-09-24/opus/v7-c04-i04-review.md) 與 [I04R evidence](../../docs/evidence/2026-09-25/gpt5/v7-i04r-c04-threshold.md)。

C04 M2 門檻修正等待非作者 re-review；本次 I04 e2e／Worker dry-run、材質 disposal 量測、其他 11 件 batch02a 實渲染、正式素材核准、staging／真機仍 NOT_RUN，故 REQ-019／產品均不得宣稱完成。

## 2026-09-25 V7-G05 更新（C04R 建議 (1)(2) 落地＋batch02a 十件全數實渲染；REQ-019 仍 PARTIAL）

V7-C04R re-review PASS 後：batch02a-orig 案依建議把 `t6ToOrig.count > 200` 前移到亮度斷言前、新增 `stability.count < 50` 斷言，targeted 1/1 且數字與 I04R baseline 逐位一致。新增 sweep 測試以同法實渲染其餘 9 件 batch02a 人物，9/9 PASS：t2→orig 亮度比 14.1%–20.8%（門檻 35%）、t6→orig 43.0%–52.7%（門檻 70%）、stability 全 0。M2 突變（orig 誤接 t6）在 sweep 案 FAIL，且因斷言前移，失敗訊息落在 count 斷言而非退化亮度比較；renderer 還原 SHA 逐位一致。`npm run check` EXIT 0（Vitest 113/113）；完整 runtime 128/128 PASS（13.2m，含新 sweep 9 案）。至此 batch02a 十件人物「烘入 t2 選 orig 還原原作黑」全數有行為證據；詳見 [V7-G05 evidence](../../docs/evidence/2026-09-25/glm/v7-g05/README.md)。

仍未完成：材質 disposal 量測（AC19-4）、I04 e2e／Worker dry-run、batch02a 正式 catalog metadata（本 sweep 仍以 v1 條目換檔）、C04R 建議 (3) 驗收模式開關（待整合者／使用者裁示）、正式素材核准、staging／真機。REQ-019 與產品維持不得宣稱完成。
## 2026-09-25 V7-I04R-LOCAL 更新（缺素材驗收 gate；REQ-019 仍 PARTIAL）

採納 C04R 建議 (3)：I04 與 sweep runtime 案只在 `REQUIRE_LOCAL_ASSETS=1` 時將缺少 ignored GLB 轉為明確 FAIL；預設仍具名 SKIPPED/NOT_RUN。實測必要模式缺檔 2 FAIL／exit 1、預設模式 2 skipped／exit 0；十件 batch02a 人物渲染 10/10 PASS。`npm run check` EXIT 0（113/113）。完整驗收模式 runtime **127/128**，唯一失敗為 `version-ui.spec.ts` 的 `socket hang up`；隔離重跑 1/1 PASS 不覆蓋全套失敗，整體 NEEDS_REVIEW。詳見 [V7-I04R-LOCAL evidence](../../docs/evidence/2026-09-25/gpt5/v7-i04r-local-asset-gate.md)。

仍未完成：材質 disposal 量測、I04 e2e／Worker dry-run、batch02a 正式 catalog metadata、正式素材核准、staging／真機；服務穩定性仍未排除。REQ-019 維持 PARTIAL，產品 No-Go。
