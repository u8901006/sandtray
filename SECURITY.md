# Security

## 回報漏洞

請用 GitHub 倉庫的 **Security → Report a vulnerability**（private vulnerability reporting），不要開公開 issue。請附上重現步驟、影響範圍，以及你測試用的版本或 commit。

這個專案會處理心理治療會談的場景。如果你在自己的部署上發現疑似外洩，請先通知你所在機構的資料保護負責人。

## 伺服器端不變式

修改相關程式時必須保留以下條件。發現任何一條被違反，就是安全問題：

- 所有共享操作都在 server 端驗證，治療師不能因為 client UI 狀態取得權限
- 授權綁定正確的 session、房間、物件、動作與 epoch
- revoke 之後，舊封包一律失效；lease 過期之後，舊操作一律失效
- 重新連線不會延續舊的物件授權；session 或 control epoch 改變後，舊請求不能重放成功
- 回 ACK 之前，必要的持久化已經完成
- duplicate / retry 有明確的 idempotency 行為
- 還原不會復活舊邀請、舊席位、舊 grant、舊 lease 或舊的匯出同意
- 刪除標記（tombstone）不會被晚到的寫入或還原繞過
- 跨房間、跨診所、跨租戶的存取在 server 端拒絕
- 部署環境的靜態素材要登入才能下載

`tests/runtime/security-gap-*.spec.ts` 是這些條件的回歸測試。

## 不要放進倉庫的東西

真實病人資料、OIDC client secret、Cloudflare API token、你自己的 D1 `database_id` 與網域。本機開發用 `apps/worker/.dev.vars`（已被 `.gitignore` 排除），格式見 `.dev.vars.example`。
