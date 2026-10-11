# 參與開發

歡迎 issue 與 pull request。

## 送 PR 前

1. `npm run check` 必須通過
2. 改到 UI 或互動，請跑相關的 `npm run test:e2e`
3. 改到 Worker、同步、授權、存檔或刪除，請跑 `npm run test:runtime`，並對照 [SECURITY.md](SECURITY.md) 的不變式
4. 改到 `packages/protocol` 或 API 路由，執行 `npx tsx tools/contracts.ts --write` 更新 `specs/001-sandtray/contracts/`，一起提交

## 測試結果要照實寫

- 沒跑的測試寫 NOT_RUN，不要寫 PASS
- 完整套件有失敗，就寫完整結果（例如 63/65），單獨重跑通過另外註明
- 不要為了讓測試變綠而刪測試、放寬斷言或加 skip
- 「看起來正確」或「build 成功」不等於行為正確

## 素材

新增 3D 素材前先讀 [ASSETS.md](ASSETS.md)。授權不明的素材不要送進來。

## 授權

你送出的貢獻以 AGPL-3.0 釋出。
