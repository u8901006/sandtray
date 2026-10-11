---
title: "可執行契約索引"
description: "T00 JSON Schema / OpenAPI 與額外語意檢查"
date: 2026-09-06
tags: [contracts]
---
# 契約

單一來源：[packages/protocol](../../../packages/protocol/src/index.ts)。
原 README 是接手基線摘錄；現行可執行檔案如下：

- [OpenAPI 3.1](./openapi.json)
- [WS 入站](./ws-inbound.schema.json) / [WS 出站](./ws-outbound.schema.json)
- [Scene](./scene.schema.json) / [Grant](./grant.schema.json) / [Lease](./lease.schema.json)
- [素材 draft](./asset-draft.schema.json) / [素材 release](./asset-release.schema.json)

產生：npx tsx tools/contracts.ts --write。驗證：npm run contracts。
unit quaternion 長度、素材 hash 對應路徑、不同 QA 檢查、必要 clip 和 canonical reference 關聯另由 runtime validator 檢查。
現有本機業務 API 與驗證範圍以 STATUS 最新紀錄為準。OpenAPI 含尚未實作的目標端點，不能單憑契約宣稱完成。新增資料管理者備份與受控還原端點已通過本機 runtime 驗證。
發布 schema 完整也不代表真實 GLB 通過美術或授權驗收，T06 ingest 必須查實檔與報告。

[啟動方式](../quickstart.md) · [驗證證據](../../../docs/evidence/2026-09-06/verification.md)

[備份還原契約與驗證](../tasks/T09-backup-2026-09-10.md) · [操作文件 v5](../quickstart-v5.md)

[管理資格、作品狀態與備份分頁契約](../tasks/T09-management-2026-09-10.md) · [操作文件 v6](../quickstart-v6.md)。新增三個 GET 端點已通過本機 runtime 權限與分頁測試。

保存作品API新增cursor續頁，最多100件／頁；animation.set接入每個素材固定版本的clip白名單，授權／lease／fencing不變。[素材契約](../tasks/T06-imported-packs-2026-09-10.md) · [保存分頁契約](../tasks/T09-saved-pages-2026-09-10.md)。
