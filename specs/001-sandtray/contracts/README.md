---
title: "A6 API 與訊息契約摘要"
description: "API 目標契約與現行私有素材交付路由摘要"
date: 2026-09-26
tags: [contracts, api, openapi]
---
## A6. API 與訊息

| 介面 | 方法／事件 | 權限與行為 |
|---|---|---|
| 登入 | `/auth/login`, `/auth/callback`, `/auth/logout` | OIDC state/nonce/PKCE；server session cookie |
| 建房 | `POST /api/rooms` | 治療師；新 scene 或獲指派的既有 scene |
| 邀請 | `POST /api/rooms/:id/invites` | 本房治療師；輪替使舊 token 失效 |
| 換 session | `POST /api/invites/redeem` | 一次性 token，等待入房確認 |
| 進房確認 | `POST /api/rooms/:id/admit` | 本房治療師，只能核准等候案主 |
| WebSocket | `GET /api/rooms/:id/socket` | 同源 cookie、Origin allowlist、席位檢查 |
| 素材 catalog（T00 target-only） | `GET /api/assets` | 目標契約保留、Worker 尚未實作；REQ-018 的現行私有交付為下列逐模型端點 |
| 私有模型素材 | `GET/HEAD /api/assets/{assetId}/{assetVersion}/model.glb` | REQ-018；需有效 session、已入座 room 與 `roomId`，回應 private/no-store |
| 當前作品 | `GET /api/rooms/:id/snapshot` | 房間參與者；無公共 cache |
| 命名保存 | `POST /api/rooms/:id/versions` | 案主或另有保存同意的本房治療師 |
| 作品匯出 | `POST /api/scenes/:id/exports` | 核對格式、指派及 export consent |
| 結束 | `POST /api/rooms/:id/close` | 房間參與者；伺服器收回權限並關閉連線 |
| 刪除 | `DELETE /api/scenes/:id` | 指定資料管理角色，依已設定保存政策執行 |

WebSocket 入站事件：`room.hello`、`presence.heartbeat`、`object.create`、`object.delete`、`object.lock.acquire/renew/release`、`object.transform.preview/commit`、`object.appearance.commit`、`animation.set`、`permission.request/grant/reject/revoke`、`control.revokeAll`、`animation.stopAll`、`scene.undo/redo`、`sync.request`。

`GET /api/assets` 是 T00 OpenAPI 中保留的 **target-only** catalog operation，不代表目前有 Worker handler；本機 catalog 由套件資料供應。REQ-018 的私有模型串流已實作在逐模型路由，兩者不是同一個 endpoint。若日後要實作 catalog API，需另補需求、授權與 runtime 驗收；若裁定移除 target operation，也須同步更新 OpenAPI 與本摘要。

出站：`room.snapshot`、`presence.changed`、`operation.ack/rejected`、`object.preview`、`scene.patch`、`permission.changed`、`lock.changed`、`sync.required`、`room.closed`。

錯誤代碼：UNAUTHENTICATED、ROOM_FULL、ROOM_CLOSED、PERMISSION_DENIED、GRANT_EXPIRED、STALE_EPOCH、LOCKED、STALE_FENCE、REVISION_CONFLICT、INVALID_PAYLOAD、RATE_LIMITED、SAVE_FAILED。UI 用易懂中文顯示，保留 requestId 供診斷。

一般訊息上限 16 KiB；scene snapshot 透過授權 HTTP 載入，上限 1 MiB。單連線 preview 上限 15/s、所有訊息合計 30/s（允許短 burst 60）；持久 commit 上限 10/s。權限收回／全部停止走獨立小額高優先通道，不因 preview 滿額而丟失；仍有防濫用上限。超額後先降低頻率，持續濫用才關閉連線。


正式 OpenAPI 與 WS JSON Schema 尚待實作；不得將此文字文件視為已完成 schema 驗證。
