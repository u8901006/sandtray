## 4. 需求基線與追溯矩陣

| REQ ID | MUST 需求 | 契約／元件 | 工作包 | AC／附錄測試 |
|---|---|---|---|---|
| REQ-001 | 同房限案主與治療師，第三人不收 scene | room/admission | T02 | A01、A20 |
| REQ-002 | 100 個不同合格 3D 模型 | asset manifest | T06–T08 | AS01–AS08 |
| REQ-003 | 全模型移動、旋轉、縮放；支援標示可變色部位 | object schema | T01、T05 | AC03、A15 |
| REQ-004 | 治療師預設只讀，物件＋動作分別授權 | grant schema | T03 | A02–A04 |
| REQ-005 | 案主可隨時撤權，舊訊息不能生效 | grantVersion/epoch/fence | T03 | A05、A06、A19 |
| REQ-006 | 斷線重連需重新授權、已 ACK 狀態不遺失 | sync/operationId | T04 | A07、A09、A10 |
| REQ-007 | 同物件單一租約；同作品單一可寫 room | lease/coordinator | T03、T04 | A08、A18 |
| REQ-008 | 20 個骨架＋10 個節點動作；全物件路徑位移 | animation schema | T05、T07 | AC08、A12 |
| REQ-009 | 各自視角、明確物件縮放控制、iPad 操作 | camera/UI state | T01、T09 | AC09、A15 |
| REQ-010 | 依保存模式自動保存、版本、PNG/JSON 匯出 | scene/outbox/export | T05 | A11、A13、A16 |
| REQ-011 | 診所隔離、指定治療師、獨立匯出同意 | identity/assignment | T02、T05 | A14 |
| REQ-012 | 保存期限、刪除及備份還原實測 | retention/tombstone | T09 | A17 |
| REQ-013 | 100 instance 場景效能、10 rooms 壓測 | perf fixtures | T09 | AC13、A15 |
| REQ-014 | 完整 SDD 追溯，正式部署可回滾 | CI/ADR/release | T00、T10 | AC14 |
| REQ-015 | 素材生成與會談系統分離，記錄 AI 來源 | provenance/ingest | T06 | AS07、AC15 |

新增 AC：

- AC03：Given 選取任一 catalog asset，When 放置並變形，Then 兩端確認相同 transform，檢視可繞到背面且不是平面貼圖。
- AC08：Given 核准動畫物件，When 播放／停止／撤權，Then clip、時間與權限一致；20 個人物每件至少 idle、walk、wave 三段，10 個動作物每件至少一段。
- AC09：Given iPad 橫向，When 案主調整物件大小、治療師旋轉視角，Then 案主攝影機不被治療師改動，pinch 不誤改模型大小。
- AC13：Given 100 instance（含重複及不重複兩種 fixture）、最多 5 個同時動畫、10 個雙人 rooms，When 連續操作 60 分鐘，Then 達附錄性能門檻且不越權／漏已 ACK 資料。
- AC14：Given release candidate，When CI 查 traceability，Then 所有 MUST REQ 有 AC、工作及證據；故意移除一筆映射會失敗。發布後能用同一份去識別測試場景完成回滾演練。
- AC15：Given 素材上傳，When 審核發布，Then 無會談 scene 或案主資料送往圖片／3D 供應商；catalog provenance 可追到參考圖及加工版本。

## A11. 驗收測試（必過）

| ID | 情境 | 通過條件 |
|---|---|---|
| A01 | 雙人進房、第三人嘗試 | 正常兩人共見場景；第三人無任何 scene payload |
| A02 | 未授權治療師偽造 commit | 伺服器拒絕，sceneRevision 不變 |
| A03 | 授權熊 A 後操作熊 B | A 核准動作可用；B 全拒絕 |
| A04 | 只准移動，嘗試刪除／動畫 | 越權動作拒絕 |
| A05 | 治療師拖曳中案主收回 | 撤銷排序後所有舊 preview/commit 無效，回到 confirmed state |
| A06 | 授權過期與 client 竄改時間 | 以 server time 拒絕；修改本機時鐘無效 |
| A07 | 案主靜默斷網 | 最長 15 秒 lease 到期後拒絕治療師修改；重連需重新授權 |
| A08 | 雙方同時操作同一物件 | 單一租約；案主能收回，不跳來跳去 |
| A09 | commit 已保存但 ACK 遺失後重送 | operationId 只產生一次變更 |
| A10 | DO 休眠／重啟 | 已確認作品完整；舊 preview 不當成已保存 |
| A11 | 模型版本更新再開舊作品 | 使用原 assetVersion，不改變舊作品外觀 |
| A12 | 動畫中停止、收回、背景再開 | 動畫時刻與最終位置一致，不自行重啟 |
| A13 | R2 失敗／D1 更新失敗 | DO commit 可恢復，outbox 重試，UI 不虛報版本匯出成功 |
| A14 | 跨診所或未指派治療師猜 scene ID | API、WebSocket、export 全拒絕 |
| A15 | iPad 100 物件 60 分鐘 | 達性能目標，旋轉視角與縮放物件不衝突 |
| A16 | scene restore／undo | 不還原舊邀請與授權，不覆蓋未確認後續變更 |
| A17 | 刪除與還原演練 | active data 刪除；備份還原後刪除標記仍有效 |
| A18 | 兩房同時要求編輯同一 scene | 唯一可寫 room，另房不產生第二權威 |
| A19 | 收回時 preview flood | 高優先收回仍被處理，不能被一般 rate limit 阻擋 |
| A20 | 同一使用者開第二頁 | 明示接管；舊席位失效，授權重新取得 |


2026-09-07本機證據：A13/A14/A16活動會談恢復、政策同意、讀取競態與T02等候恢復，見 [本輪工作與結果](./tasks/T05-restore-2026-09-07.md)。24/24 runtime通過不代表全部AC或真機通過。


## 2026-09-15 核准決策附錄（C2-F1、C3-F2、AC13）

依 Agent 留言板使用者裁定紀錄整合（留言標示 2026-09-15 22:35、22:50，實際台北時間 06:35、06:50，見 08:43 CORRECTION）。本附錄補充既有驗收，不表示已通過。

### 匯出同意與備份期限

- 匯出同意綁定 sessionEpoch。案主僅斷線時保留既有 exportConsent；治療師仍須符合房間身分、同意版本及格式等既有檢查。案主重連或作品版本還原後同意失效，治療師需重新取得案主同意。物件控制授權仍依斷線／重連撤權規則，不能因匯出同意保留而延續。對應REQ-006/010/011、A07/A14/A16。
- 每日備份 expiresAt 等於來源版本 expiresAt，備份不能延長保留期限；已到期、刪除標記及晚到寫入仍受既有拒絕與清除規則約束。對應REQ-012、A17。

### AC13 協定層60分鐘耐久門檻

適用本機／staging協定測試：10個雙人房、20連線、每房100個物件；建立1,000個物件的準備階段不列入60分鐘觀測視窗。保留完整測試資料與分位數計算方式。

| 指標 | 核准門檻 |
|---|---|
| ACK p50 / p95 / p99 | ≤100 / 300 / 1000 ms |
| ACK逾時（>10秒） | 0 |
| 服務退出／workerd crash | 0 |
| 已ACK後snapshot不一致 | 0 |
| 跨房隔離失敗 | 0 |
| receipt重送回原ACK | 100% |
| 記憶體最後10分鐘均值 | ≤前10分鐘均值×1.5 |

記憶體採樣需記錄程序範圍、單位、頻率與缺樣；分位數及樣本數需可重算，不可只報平均或去掉失敗樣本。此處不新增未核准數值門檻。

#### 2026-09-15 11:55 補充裁定（open-items #16，本機判定範圍）

使用者裁定（留言板 2026-09-15 11:55 DECISION）：核准門檻數值不變。依 E3／E3b 證據（docs/evidence/2026-09-15/glm/e3-ack-latency-run2.json、e3b-concurrency-run2.json；opus/C7），單房 create ACK p50 為 18.7 ms，本機 10 房並行時的 ~180 ms 來自 dev stack 單一 workerd isolate 序列化各 DO 持久化，非產品行為。因此：

- **ACK p50 / p95** 門檻於 staging 或正式環境判定；本機 10 房耐久只報數字，不以此二項判 PASS／FAIL。
- 本機 60 分鐘耐久的 PASS 判定採其餘七項（p99 ≤ 1000 ms、逾時 0、退出 0、snapshot 不一致 0、跨房隔離失敗 0、重送回原 ACK 100%、記憶體 ≤ ×1.5）**加上**同機單房 E3 量測 p50 ≤ 100 ms。
- 本機通過只構成 AC13 的部分證據；完整 AC13 仍需 staging 判定 p50／p95。

本段由 Claude Opus 5 代 GPT-6 整合（GPT-6 額度 9/19 恢復後 re-review）。

CORRECTION 註記（2026-09-17，Claude Fable 5.1 代行 GPT-6 re-review，R1-F1）：上段理由句「本機 10 房並行時的 ~180 ms 來自 dev stack 單一 workerd isolate 序列化各 DO 持久化」已於 C15 §3／C7 §6 撤回——實測主因為 wrangler 本機 observability trace collector 的每請求排隊（關閉後十房 p50 59 ms）。**裁定內容不變**（p50／p95 於 staging 判定）；原句依 AGENTS §3 保留不改。

補充（2026-09-17，Claude Opus 5，依 C15）：本機 60 分鐘的**記憶體項**經兩次判別（G11 run16／run17）確定為 wrangler dev 轉發層每請求堆積（ProxyWorker workerd 53%／user workerd 47%，操作率減半成長率即減半），非產品 DO 狀態；記憶體門檻「後 10 分鐘均值 ≤ 前 10 分鐘 ×1.5」於 staging 以 Workers／DO 指標判定，本機只報兩層各自曲線。本機 60 分鐘 PASS 判定因此為其餘六項（p99、逾時、退出、snapshot、跨房、重送）＋單房 E3；p50／p95／記憶體三項於 staging 判定。門檻數值不變。

AC13協定數值缺漏的SPEC CONFLICT於本附錄關閉。A15真機WebGL/FPS門檻仍待定義；協定通過不等於iPad 100物件60分鐘渲染驗收，也不等於完整AC13完成。服務退出原因未定位與耐久未跑的狀態保留。

補充（2026-09-28，Claude Opus 5.5，使用者裁定）：**staging 的 ACK p50／p95／p99（≤100／300／1000 ms）改以伺服器端計時判定**——Room DO 於 `operation.ack` 附 `serverMs`（自收到 WebSocket frame 至產生 ack，含 AUTH_DO 身分查詢 RPC；不含 output gate 持久化等待，且 Workers `Date.now()` 只在 I/O 後前進，純 CPU 段不計）。客戶端量得的 ACK 延遲在 staging 只記錄不判定。起因：使用者網路至 Cloudflare 走 SJC colo，客戶端 TCP connect≈150 ms、`/api/health` TTFB 0.44–0.57 s，原客戶端門檻客觀不可達。本機判定不變（客戶端 p99≤1000，p50／p95 只記錄）。門檻數值不變；逾時 0、退出 0、snapshot 0、跨房 0、重送回原 ACK 等其餘項目不受影響。實作：`tests/load/endurance-protocol.spec.ts`、`tests/runtime/ack-server-timing.spec.ts`。

#### 2026-09-17 21:00 裁定（C4 #9 法遵決策：完全抹除，折衷版）

- 場景內容（R2 物件、`scene_versions`、`scene_archive`、Room DO 狀態）於刪除時立即抹除（既有行為，A17）。
- `scene_tombstones` 保留至 `deleted_at + 保留政策 ttlMs`；此時鐘與備份到期相同（C3-F2），保留期內「restore／晚到寫入不得復活」不變式完整保留。
- 保留期過後由 scheduled 清除 tombstone，並 `deleteAll()` 該 scene 的 coordinator DO 儲存；清除前必須再次驗證：deletion 為 COMPLETE、D1 無該 scene 任何列、R2 無該 scene 任何物件，任一不成立即不清除。系統最終不留該場景存在過的痕跡（含 ID）。
- 「連 tombstone 立即刪除」不採（會讓每日備份與晚到 save 復活已刪場景）。
- 對應 REQ-012、A17；回歸 `tests/runtime/tombstone-purge.spec.ts`。實作 I2（Claude Fable 5.1 CLAIM、Opus 5 續作，使用者授權改共享核心）；GPT-6 9/19 re-review。

### REQ-019 膚色變體（2026-09-23 使用者裁定）

- AC19-1：支援人物可選 `t1`–`t6`／`orig`，預設 `t2`；非 allow-list 素材與未知代號由 server 拒絕。
- AC19-2：案主的 `object.appearance.commit` 以 session/control epoch 與 object revision fencing，transaction 完成後才 ACK；治療師、跨房、stale/replay 不得改 scene。
- AC19-3：snapshot、命名保存、undo／redo、restore、DO 重啟保留變體；舊 snapshot 缺欄位仍可讀且不誤當 `orig`。
- AC19-4：Three.js 每個 clone 使用獨立 Skin material；切換與卸載不污染 shared cache、不 dispose 共用 texture，並有正負行為證據。

### 2026-09-25 使用者裁定（Claude Opus 5.5 記錄）

- **A15 門檻**：支援 iPad 第 10 代以上、iPadOS 17+。100 instance 場景互動時 **FPS p50 ≥ 30、p5 ≥ 20**。取樣方式在 L08-1 事先寫明，不得事後挑片段計算。首載上限、溫度降頻判定、桌機瀏覽器清單**尚未裁定**。
- **兩小時保留**：以「**無人操作兩小時**」計時。`presence.heartbeat` 與純連線不算操作。現行 `sync.ts:146` 讓 heartbeat 推進 `lastActivity`，違反本裁定，已列 BUG（issue L02-6）。
- **分階段上線**：採選項 B（R1／R2／R3），版本化例外見 spec.md 同日段；AC 與門檻數值不變。
- **個資**：不蒐集真實案主個資（spec.md 同日段）。

### 2026-09-25 23:3x 使用者裁定（Claude Opus 5.5 記錄）

- **保留（L01-4）**：會談即焚，見 spec.md 同日段。A11、A13、A16、A17 依 issue L12 對照表改寫：A17 改為「會談結束後 DO／R2／D1 零殘留；晚到寫入、重連、重送不得復活」。09-15「備份期限」附錄因取消備份而不再適用；09-17 tombstone 折衷的「最終零痕跡」與「保留期內不得復活」兩條不變式保留。
- **服務退出（L01-8）**：以 staging 判定。本附錄 09-15／09-17 把「服務退出／workerd crash＝0」列為**本機** 60 分鐘 PASS 條件的部分，自本日起 supersede：本機 60 分鐘 PASS＝p99、逾時、snapshot 不一致、跨房、重送五項＋單房 E3；**服務退出改以 staging 60 分鐘耐久 Worker 例外與 5xx＝0 判定**。本機 wrangler dev 退出保留為測試基建風險持續追蹤，不得寫成「已根除」。門檻數值不變。

### 2026-09-26 使用者裁定（Claude Opus 5.5 記錄）

- **JSON 匯出取消（L01-9）**：會談結束就結束。匯出只剩 PNG；server 對 `json` 格式的匯出請求必須拒絕且無任何寫入。A11 不適用。
- **PNG 匯出保留**（使用者 2026-09-26 07:34 確認）：會談中可匯出 PNG，匯出同意、格式與授權檢查依既有 REQ-011／A14 規則。

### 2026-09-26 使用者裁定：AC08 打招呼動作（Claude Opus 5.5 記錄）

- AC08「20 個人物每件至少 idle、walk、wave 三段」改為「**idle、walk、以及一段打招呼類動作**」；Quaternius 人物包以既有 **`Victory`**（高舉雙手）作為打招呼動作。原文保留作歷史。其他 AC08 條件（播放／停止／撤權時 clip、時間、權限一致；10 個動作物件各至少一段）不變。

### 2026-09-26 使用者裁定：L12-6 tombstone 存續期 8 小時

- 使用者明確選定 **8 小時**，理由是與登入 session 最長有效期一致。期限自刪除請求時間 `deleted_at` 起算；此期限只適用於防復活 tombstone／刪除標記，作品內容仍須在結束時立即抹除。
- 到期只是「可開始安全清除」的必要條件，不是充分條件：deletion 未 `COMPLETE`，或任一 DO／R2／D1 殘留時，標記必須續留並重試；跨儲存清除須保留可恢復索引直到 coordinator DO storage 也成功清空。詳見 [ADR-L12-6](decisions/2026-09-26-l12-tombstone-retention-8-hours.md)。
- 本紀錄 supersede T11 以 cloud retention policy 決定 tombstone 時鐘的部分；歷史 2026-09-17 原裁定保留。**實作狀態未同步**：目前程式預設仍為 24 小時，且 purge 失敗索引風險尚未修；程式與 failure-injection／runtime 驗證未完成前，不得標示 L12-6／L12-2 PASS。

# 2026-09-27 L12 verification status (supersedes earlier pending-sync note)

The accepted tombstone retention decision is **8 hours**, matching the maximum login-session lifetime and minimizing metadata retention. The deletion path now blocks purge while local COMPLETE, D1 scene-version/archive, R2-prefix, or Room DO residue remains. Once those gates pass, coordinator `deleteAll()` clears coordinator storage and alarm; the D1 tombstone is conditionally deleted last and remains the sole retry index if that final deletion fails.

Local verification: `npm run check` EXIT 0; runtime 103/103 PASS (0 skipped); E2E 26/26 PASS; browser environment probe passed before runtime and E2E. Independent GPT-5 static review PASS (reviewer tests NOT_RUN). Evidence: `docs/evidence/2026-09-27/v8-gpt5-l12-deleteall-retry-index-remediation.md`.

This records implementation evidence only; it does not satisfy the remaining restart/`changes=0` cases or staging/real Cloudflare cron, mutation, deployment and production-readiness gates. L12 remains PARTIAL / NEEDS_REVIEW; release remains No-Go.
