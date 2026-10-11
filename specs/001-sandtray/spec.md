## 1. 專案目標與不可變原則

建立繁體中文線上 3D sandtray：一名案主和一名治療師同房，案主自由建構自己的世界；治療師只在案主明確同意後操作指定角色。作品可保存、恢復及數位匯出。

**技術選擇：React + TypeScript + Three.js / R3F + Cloudflare Worker Static Assets + Durable Objects SQLite + D1 + R2。** Blender 用於素材整理與動畫，不在會談 Worker 中執行。第一版不部署 Zeabur。

本版 MUST 原則：

1. 案主有創作與撤權主控權；治療師的登入身分、管理身分都不能替代物件授權。
2. 所有共享修改經伺服器檢查；不能只靠前端把按鈕藏起來。
3. 正式素材櫃恰有 100 個不同 assetId 的合格立體物件；色彩變體、縮圖、姿勢及 LOD 不另算模型。
4. 100 個模型全部可移動、旋轉、縮放；20 個人物具骨架動畫，另 10 個指定物件具節點／形變動作。其他 70 個仍可沿路徑移動，不承諾每件都有骨架。
5. ChatGPT 生成的圖片是概念素材，不是 GLB；不得把 billboard 或貼圖平面算成精緻 3D 模型。
6. 使用者裝置渲染畫面，Cloudflare 管理權限、狀態與檔案；不租 GPU 主機作會談畫面串流。
7. 所有動畫預設停止，案主可停止全部動作；不自動演出、對話或解讀作品。
8. 每項必需需求均有 REQ ID、驗收 AC ID、實作工作與驗證證據；不得用 demo 畫面代替安全與恢復測試。

100 是 catalog 數量，單房 100 個 instance 是另立的效能測試容量；不代表要一次下載或顯示全部 catalog。

## 2. 交付範圍與架構

| 層級 | Cloudflare 配置／工具 | 責任 |
|---|---|---|
| 使用者介面 | Worker Static Assets、React、Vite、TypeScript | 沙盤、素材櫃、權限、保存狀態 |
| 3D 執行 | Three.js / R3F、WebGL、GLTFLoader、AnimationMixer | GLB 顯示、選取、變形與動畫 |
| 入口 API | Worker，同源 API / WebSocket | 登入、邀請、Origin 檢查、資源授權 |
| 每次會談 | ROOM_DO，SQLite-backed | 兩席位、授權、租約、操作排序、confirmed state |
| 作品協調 | SCENE_COORDINATOR_DO | 一件作品同時只有一個可寫 room、切換 fencing |
| 全域索引 | D1 | 診所、治療師、指派、場景索引、資產發布索引 |
| 模型儲存 | R2 ASSETS | 不可變版本 GLB、KTX2、LOD、由 GLB 渲染的縮圖 |
| 私有作品 | R2 PRIVATE_SCENES | 經同意的快照、PNG、版本；不公共快取 |
| 素材製作來源 | ChatGPT Image → 圖轉 3D → Blender | 離線製作，不接觸會談內容 |

圖轉 3D 建議先以 **Meshy 作為 10 件試製候選**，以 GLB 為交付介面；未通過品質、授權、成本驗收前不綁死供應商。首批用網頁工具及人工匯入最省整合成本；API 批次化屬後續可選項。簡單石頭、橋、容器等幾何物件若圖轉 3D 品質不好，依 ChatGPT 參考圖直接用 Blender 建模，仍符合素材來源策略。

不納入首發：真實沙粒模擬、任意網格雕刻、會談中生成模型、AI 角色對話、多人家庭房、研究資料蒐集、內建語音視訊。語音視訊使用既有會談方式；「不用影印」以數位保存與匯出滿足。地形挖沙留下一版。

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


## 2026-09-23 REQ-019 膚色變體（使用者裁定）

正式人物可提供 `t1`–`t6`＋`orig` 七種 Skin 材質變體，預設 `t2`／`#E8BE9A`；適用清單與 server allow-list 以 [REQ-019](./req-019-color-variants.md) 為準。`sceneObject.colorVariant` 為向後相容 optional 欄位，變更走案主限定的 `object.appearance.commit`，須經 epoch／revision／transaction／durable ACK；save、undo／redo、restore 與 renderer 材質複本生命週期均屬同一驗收範圍。

## 2026-09-25 REQ-016 納入首發（使用者裁定）

使用者裁定：**雙沙盤、挖沙／堆沙、水位（[REQ-016](./req-016-wet-tray-and-digging.md)）屬第一版上線範圍**。§2「不納入首發」清單中的「地形挖沙留下一版」自本日起由本段 supersede（原句保留作歷史）；「真實沙粒模擬、任意網格雕刻」仍不納入，REQ-016 採高度圖＋CPU 確定性核心，不是粒子模擬。挖沙授權遵守 §1 MUST #1：案主有主控權，治療師須先取得案主同意（REQ-016 A4 同日裁定）。

## 2026-09-25 分階段上線（使用者裁定：選項 B；版本化例外）

| 階段 | 使用者 | 資料 | 素材 | 必過 gate |
|---|---|---|---|---|
| R1 內部 staging | 使用者本人、開發團隊 | 只用虛構資料 | 只上架正式核准（`ready`）件，數量不限 | L03、L04 staging 量測、L09 入口掃描 |
| R2 限量臨床試用 | 真實治療師與案主（限量） | **不蒐集案主個資**（同日裁定） | 只上架正式核准件，可少於 100 | **除 MUST #3 數量外，全部 MUST 與安全、保存、刪除、回滾、維運 gate**（L02～L10）；REQ-016 屬首發，R2 前須完成 |
| R3 正式全規格 | 一般使用 | 同 R2 | **恰 100 件**（MUST #3） | 全部 |

例外範圍只有一條：§1 MUST #3「恰有 100 個不同 assetId 的合格立體物件」自 R3 起生效。其餘 MUST 不因分階段放寬，未核准素材不得以任何階段名義上架。

不蒐集案主個資：系統不得要求、儲存或記錄可識別案主的資料（姓名、聯絡方式、生日、證件號等）；案主以邀請連結匿名進房。

## 2026-09-25 會談即焚（使用者裁定 L01-4）

作品只存在於會談期間。會談結束（治療師結束會談、雙方明確離開，或無人操作兩小時）後，伺服器刪除該場景全部資料：DO 狀態、命名版本、checkpoint、R2 快照與 PNG、D1 索引。不做每日備份，不提供雲端保存作品列表與跨會談再開啟。唯一留存方式是會談中把 PNG／JSON 匯出到自己的裝置。網路中斷、iPad 背景回收不算離開。

本段 supersede REQ-010 的「依保存模式自動保存、版本」中跨會談部分，以及 REQ-012 的「保存期限、備份還原」；會談內自動保存與 undo／redo 保留（REQ-006、A10）。對照表與落地工作見 [issue L12](./issues/L12-session-only-retention.md)。原 REQ 表格保留作歷史。

## 2026-09-26 取消 JSON 匯出（使用者裁定 L01-9）

取消 JSON 匯出，會談結束就結束：不提供匯出、匯入或任何接續會談的方式。REQ-010 的匯出只剩 PNG 圖片（不能還原成場景）；匯出同意（REQ-011）只涵蓋 PNG。A11「再開舊作品」不適用。落地見 [issue L12](./issues/L12-session-only-retention.md) L12-8。

## 2026-10-09 入口限制：只有登入治療師與受邀案主可使用沙盤（使用者指示）

使用者指示做類似遊戲的登入介面，**只有已登入的治療師與持治療師邀請連結的案主可以使用沙盤**。自本日起，部署環境（staging／production 及任何非本機主機）不再提供匿名「本機探索」：未登入者只看到入口畫面（治療師登入、案主請用邀請連結），沙盤與 WebGL 不會掛載；已入房的案主只能回到自己的房間；身分確認失敗（非 401）一律不放行並可重試。本機開發主機（localhost／127.0.0.1）保留本機探索供開發與既有測試使用，`?gate=1` 可強制開啟入口以測試。授權仍以 Worker 為準（OIDC、邀請兌換、各 `/api` 路由驗 session），入口只是前端畫面判定。未改：公開路徑的 GLB／縮圖檔仍可被直接下載（靜態檔，非沙盤操作），是否改為需登入另待裁定。實作與證據：[entry-gate](../../docs/evidence/2026-10-09/opus/entry-gate.md)。

**2026-10-09 補充（使用者裁定，取代上段「未改」一句）**：素材登入才能下載。staging／production 所有請求先經 Worker（`run_worker_first: true`），未登入只放行 `/`、`/index.html` 與 vite bundle `/assets/<檔名>`，其餘（`/imported-assets/`、`/dev-assets/`、`/environments/`、未知路徑）回 401；已登入回應 `Cache-Control: private, no-cache`。本機原型（未設 `DEPLOY_ENV`）不變。
