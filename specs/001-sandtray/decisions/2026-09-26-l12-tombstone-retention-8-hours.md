---
title: "L12-6 tombstone 存續期：8 小時"
description: "使用者確認 tombstone 自 deleted_at 起保留 8 小時；作品內容立即清除，清除未完成時標記不可過期移除。"
date: 2026-09-26
tags: [decision, ADR, L12, REQ-012, deletion, retention]
author: GPT-5
status: ACCEPTED
---
# ADR-L12-6：tombstone 存續期 8 小時

## 狀態與範圍

**Status：ACCEPTED（使用者 2026-09-26 明確選定 8 小時）**。本決策只定義刪除標記的存續期，不改變「會談結束即刪全部作品內容」的 L01-4 裁定，也不代表刪除／復原路徑已通過驗收。

## 決策

1. `scene_tombstones` 的保留期限為 **8 小時（28,800,000 ms），自刪除請求時間 `deleted_at` 起算**。到達期限後，排程應在下一次安全清除機會移除 tombstone 與其 coordinator DO metadata。
2. 這 8 小時只適用於阻止晚到寫入、舊連線／邀請重連與場景復活的 tombstone／刪除標記，不是作品保存期。Room DO 內容、R2 作品物件與 D1 作品／版本索引仍須在結束時立即抹除。
3. **期限已到，不足以單獨授權清除。** 若 deletion 尚非 `COMPLETE`，或任何相關 Room DO、R2 物件、D1 scene/version/archive row 尚存，tombstone 必須繼續存在並維持拒絕讀寫；待清除前提全部成立後才可移除。刪除故障不能因 8 小時到期而轉成允許復活。
4. tombstone／coordinator 最後清除必須可重試且可恢復。清除 D1 marker 與 coordinator `deleteAll()` 間若有失敗，必須仍留下可供後續排程找到並重試的索引／狀態；不能出現「D1 marker 已刪、coordinator storage 未清、後續掃描再也找不到」的終局。重試具冪等性，直到 D1 tombstone 與 coordinator storage／alarm 都清空。
5. Staging／production 的有效值固定為 **8 小時**。本機 unit/runtime fixture 可用隔離測試值加速邊界案例，但該 override 不得進 staging／production；不再由 cloud `RETENTION_POLICY` 決定正式 tombstone 時鐘。

## 理由

使用者選定的 8 小時對齊現有最長登入 session：`AuthDurableObject.createSession()` 設定 `expiresAt = now + 8 h`，`attachRoom()` 不延長它；room invitation 為 30 分鐘，無操作到期為 2 小時。刪除時刻之後不會再有有效的舊 session／invite，故 8 小時可覆蓋現行最長 server session 壽命；期限不是保留作品內容的理由。若刪除程序失敗，安全閘門優先於時限，標記續留直到清除成功。

## 驗收要求

- `deleted_at + 8 h` 前不移除 tombstone；到期邊界使用 `<=`，且只在所有安全前提成立後清除。
- `PENDING`、DO／R2／D1 殘留、任一 Room DO `purgeErasure` 拒絕、D1 操作失敗或 coordinator `deleteAll()` 失敗，都必須保留可重試路徑；重跑後可以完成清除，且期間舊操作一律拒絕。
- Mutation：移除任一 pending／rows／objects／room／coordinator-purge 守門，對應負向案必須失敗；在 DO storage 清除後注入 D1 marker 刪除失敗，重跑仍須能收斂至零殘留。
- 真實 staging cron 驗證仍屬 L04；僅 unit／runtime 測試不等於 production cron PASS。

## 實作追蹤（2026-09-26；取代下方決策當時的 pending 狀態）

`policy.ts` 現固定 staging／production tombstone TTL 為 8 小時；named deployment 若傳入 `RETENTION_POLICY` 或 `TOMBSTONE_TTL_MS` 會 fail-loud，local/test override 限定於未設定 `DEPLOY_ENV` 的 prototype。`coordinator.purgeTombstone()` 不接受 caller-supplied TTL，而是自行讀取環境政策；它先清 Room DO，再交易式清 coordinator payload、保留 COMPLETE deny/retry marker 與 alarm，D1 tombstone 最後刪除；錯誤時保留／重建 marker 並排 retry。每小時 cron 覆蓋 default、staging、production。

行為證據：[L12-2／L12-6 implementation evidence](../../../docs/evidence/2026-09-26/v8-gpt5-l12-2-l12-6-implementation.md)。最終 targeted runtime **5/5 PASS**；主要行為版完整 runtime **86/86 PASS**，其後移除 purge RPC caller TTL 參數、加強 test fixture，完整套件未在這些收尾 diff 後重跑，但最終相關 spec 又 5/5。最終 `npm run check` EXIT 0、staging／production Wrangler dry-run EXIT 0。實際 staging cron、mutation、`npm run test:e2e` 與 Cloudflare 部署均 **NOT_RUN**；Claude Opus 5 非作者安全 review **待完成**。故 L12-2／L12-6 標 **PARTIAL／NEEDS_REVIEW**，L12 與產品仍 **OPEN／No-Go**。

## 2026-09-27 驗證增補（supersede 上方 2026-09-26 驗證狀態）

R9 adversarial findings 已在 L12-2／L12-4／L12-6 remediation 中修補：purge 在第一個 D1/R2 await 前同步互斥；D1 tombstone 保留為 durable deny/retry index；Room DO、D1 delete、post-delete coordinator finish 與 alarm clear 均有 failure injection，解除故障後由真實 DO alarm 自動恢復；named staging／production 缺 `DIRECTORY` 時 fail-closed。非作者 scoped review **PASS**（唯讀；reviewer runtime NOT_RUN）。詳見 [R9 remediation evidence](../../../docs/evidence/2026-09-27/v8-gpt5-l12-2-r9-remediation.md)。

使用者確認暫停本機 runtime 環境阻擋後，最終整合樹完整 runtime **102/102 PASS、0 skipped**；前置 browser probe PASS。R9 remediation 當時的完整 e2e 為 **26/26 PASS**；完整 runtime 89/89、e2e 26/26 後僅有 runtime 測試夾具擴充，後續 102/102 已涵蓋最終 runtime 測試樹。詳見 [L04 runtime revalidation](../../../docs/evidence/2026-09-27/v8-gpt5-l04-runtime-revalidation.md) 與 [R9 remediation evidence](../../../docs/evidence/2026-09-27/v8-gpt5-l12-2-r9-remediation.md)。

L12-2／L12-4／L12-6 仍 **PARTIAL／NEEDS_REVIEW**：ADR 所列 mutation campaign、實際 staging cron／故障恢復，以及本次新一輪 final-tree adversarial review 尚未完成；上述本機證據不替代它們。未連 staging／production、未部署；產品維持 **No-Go**。

## 決策建立當時的落地狀態（歷史；已由上方追蹤 supersede）

此決策文件先行。當時 `policy.ts` 預設 24 小時且可由 `TOMBSTONE_TTL_MS` 覆寫；`coordinator.purgeTombstone()` 先刪 D1 tombstone 再呼叫 `deleteAll()`，存在失去排程索引的風險。當時 L12-2／L12-4／L12-6 尚未完成，產品 **No-Go**。

## 來源

- 使用者本輪明確選擇 8 小時，理由為目前登入 session 最長有效期。
- [L12 session-only retention issue](../issues/L12-session-only-retention.md)
- [T11 tombstone 清除歷史規格](../tasks/T11-tombstone-purge-2026-09-17.md)（保留歷史裁定；本 ADR 明確化其期限，並受 L01-4 會談即焚決策 supersede）。
- [Cloudflare SQLite-backed Durable Object Storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)：SQLite-backed `deleteAll()` 原子刪除所有 storage；compatibility date `2026-02-24` 起同時清除 alarm。這不提供跨 D1／R2／DO 的交易性，跨儲存清除仍須具備冪等重試。
- [Cloudflare Durable Object Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)：alarm 是 at-least-once，未捕捉錯誤最多自動重試 6 次；需要持續重試時，handler 必須明確再排 alarm。不得把平台 alarm 重試誤認成跨儲存整體交易。

# 2026-09-27 implementation-status addendum (supersedes previous status)

The user-selected retention period remains **8 hours**. The implementation now treats the D1 tombstone as the sole retry index: after local COMPLETE, D1 scene-version/archive, R2-prefix, and Room DO residue checks pass, the coordinator writes its completion marker and alarm, calls SQLite Durable Object `deleteAll()` to clear coordinator storage and alarm, and conditionally deletes the D1 tombstone last. If D1 deletion fails after `deleteAll()`, the remaining tombstone is sufficient for a later scheduled sweep to retry; coordinator storage/alarm are not recreated. The authorized change is local only; no deployment or remote operation was performed.

Verification on the final local tree: `npm run check` EXIT 0 (contracts 9, TypeScript, 31 Vitest files / 191 tests, diagnostics 1/1, build); `npm run test:runtime` 103/103 PASS, 0 skipped; `npm run test:e2e` 26/26 PASS. Browser environment probe passed before runtime and E2E. Independent GPT-5 static review PASS; reviewer tests **NOT_RUN**. Full evidence: `docs/evidence/2026-09-27/v8-gpt5-l12-deleteall-retry-index-remediation.md`.

L12 remains OPEN / PARTIAL / NEEDS_REVIEW; product remains No-Go. Forced isolate restart after `deleteAll()`/D1 failure, explicit D1 `changes=0` injection, mutation testing, real Cloudflare cron, staging probe, and deployment remain **NOT_RUN**.
