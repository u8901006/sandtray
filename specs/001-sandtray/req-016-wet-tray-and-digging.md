---
title: "REQ-016 草案 — 雙沙盤（乾／濕）、可加水、可挖掘、藍色盤底"
description: "使用者 2026-09-18 06:0x 需求：每房兩個沙盤（乾沙、可加水），盤底與內側改藍色，沙子可挖掘。本檔把需求寫成可實作、可驗收的規格草案，含四個未裁定的範圍假設（以推薦選項暫定、可翻轉）、schema／protocol／持久化／renderer 各層影響、參考實作與授權、驗收條件。共享核心，實作預設由 GPT-6 主導（AGENTS §2）；Claude 負責 spec／review；GLM 負責回歸與素材資料。未經 CLAIM 不得動手"
date: 2026-09-18
tags: [spec, requirement, REQ-016, wet-tray, water, digging]
author: Claude Opus 5（依使用者需求整理）
status: DRAFT v2（2026-09-18 06:30 使用者補充：尺寸可自訂、國際標準 72×57×7 cm、形狀圓／正方／八邊；沙參考 cynthiayuyu/sandtray、SamG-Coder/SandDune；A6 已裁定、不聯絡 cynthiayuyu；§8 依 GPT 建議定案 CPU 確定性核心＋sand-engine POC；A1–A5 使用者 08:0x 確認採推薦選項；POC 指派 GLM（G33）；GPT-6 9/19 re-review）
supersedes: —
---

# 0. 需求原文（使用者，2026-09-18）

> 增加一個可以加入水的沙盤，讓每個房間可以有兩個沙盤：一個是乾沙，一個是可以加入水的。沙盤的底部與內部改為藍色。沙子加入可以挖掘的功能。水的部分參考 cortiz2894/stylized-components。沙子查詢是否已經有開源專案可以參考。

**補充（同日 06:30）**：沙子參考 cynthiayuyu/sandtray、SamG-Coder/SandDune；沙盤大小可自訂；形狀：1) 國際標準尺寸內側長 72 cm、寬 57 cm、高 7 cm；2) 圓形、正方形、八邊形。

# 1. 範圍假設（**A1–A5 使用者 2026-09-18 08:0x 裁定：維持推薦選項**；A6 06:40 裁定）

| # | 問題 | 暫定（推薦） | 若翻轉 |
|---|---|---|---|
| A1 | 兩盤如何呈現 | **並排同時存在**（如真實沙遊室），物件屬於放置時所在的盤 | 「切換」→ 少一個 layout 問題，多一個 UI 狀態 |
| A2 | 哪些盤可挖 | **兩盤都可挖**；乾盤挖到底露藍色，濕盤挖到低於水位處積水 | 只濕盤 → 乾盤維持平面，工作量減約 30% |
| A3 | 水量 | **水位值 0～1**，共享狀態、存檔同步；挖到低於水位自動有水 | 固定水位 → 少一個操作與 UI |
| A4 | 誰能挖 | **已裁定（使用者 2026-09-25 19:5x）：與放物件同一套授權——案主有主控權、可直接挖／堆／調水位；治療師須先取得案主 grant，案主可隨時收回；server 驗證**。原暫定文字「案主需治療師 grant；治療師隨時可」方向寫反，依 CORRECTION 作廢（保留此註記） | 任何人 → 需新的 rate-limit 類別 |
| A4′ | 治療師能否改沙／水 | **使用者裁定（2026-09-30 /goal）：治療師一律拒絕挖沙**——`sand.stroke`、`tray.water` 與沙的復原／重做只有案主能做；治療師即使持有物件 grant 也一律 PERMISSION_DENIED，不設計 tray grant。取代上列 A4 對沙／水的部分（物件 grant 不變）。Claude 解讀為含水位，若使用者本意只限「挖」請更正 | — |
| A5 | 能否堆沙（高於原面） | **可以，上限原面 +3 cm**（cynthiayuyu 參考允許堆／挖雙向；沙遊常見堆丘） | 不可 → 少物件穿插問題，但失去「堆山」 |
| A6 | 尺寸／形狀何時決定 | **已裁定（使用者 2026-09-18 06:40）：建房時選**（預設國際標準矩形），建房後不可改 | — |

> **2026-10-05 使用者裁定（Claude Opus 5.5 記錄）**：A5／AC16-13 的資料上限不變（u8 255＝原面＋3 cm，伺服器、同步、存檔、確定性向量皆不動）。**顯示**改為原面以上高度 ×3，並對原面以上部分做顯示端圓滑（box blur 半徑 2 格、3 次），堆沙可呈約 9 cm 的圓頂小沙丘；原面以下（挖沙、水位）比例不變。物件落點使用同一顯示高度。AC16-13 的「+3 cm」指資料值；畫面上限為 +9 cm。**2026-10-05 修補（GPT-6.1 SOL 多輪 review 後）**：只有原面以上（×3）的部分做盤內正規化圓滑，每格再加上自己原面以下的真實深度；沙丘旁淺挖的格子會保留部分沙丘裙邊、可能畫在原面之上。挖到盤底附近（最後 12 個 u8，約 0.5 cm）的格子依殘餘裙邊與剩餘厚度逐步沉到藍色盤底之下，因此薄沙層已會露出部分藍底；測試涵蓋的情境中，一筆堆／挖讓可見表面變化 < 0.6 cm（正常筆刷變化加上連續沉底轉換）。水面是沙面網格的平面副本，以同一份畫面高度計算深淺與岸線，並在 shader 中裁切於藍牆（圓盤用 72 邊形內切圓，120 cm 盤角點最多內縮約 0.57 mm）。藍色內壁在輪廓內半格；沙面網格到輪廓（藍牆後）。物件放置、拖曳與平移把手放開時依沙面網格三角形貼地（盤底格以藍色盤底為準）；例外：八角盤角落沙面三角形之間 ≤ 0.1 mm 的窄縫取最近沙面高度；藍牆之後（實際畫出的藍牆多邊形之外、木框斜角之內）取可見表面，即藍色封口環或高於它的沙；木框斜角區（輪廓內約 0.22 cm）仍取封口高度、未貼到木框頂，屬已知近似。已放置物件在沙面之後改變時不自動重新貼地。[evidence](../../docs/evidence/2026-10-05/opus/mound-dune-height.md)

# 2. 使用者可見行為（驗收用語言）

0. **尺寸與形狀**：建房時為每個盤選形狀與尺寸——矩形（預設**國際標準：內側 72×57 cm、深 7 cm**）、正方形（邊長）、圓形（直徑）、八邊形（對邊距）；尺寸以 cm 輸入，範圍 30～120 cm，深 5～10 cm。世界座標換算固定 **1 單位＝7.2 cm**（讓標準盤剛好是現有 10 單位寬，既有素材比例不變；標準盤 = 10×7.92×0.97 單位）。
1. 房間裡有兩個盤：左「乾沙」、右「濕沙」，各自的框、沙面、盤底，形狀尺寸可不同。兩盤盤底與內側為藍色（實色，Pantone 近似 `#1F5F8B`，可由 `environment` 調整），沙面顏色沿用 `environment.sandColor`。
2. 沙面可挖：選「挖掘」工具後，在沙面上拖曳（滑鼠／觸控）會把沙往下推，形成凹陷；連續挖到盤底即露出藍色。筆刷為高斯形、固定半徑（≈6.5 cm）、力道放緩——**按住約 1.2 秒才從沙面挖到藍底**（治療情境動作要慢，避免「想攤平」變成挖洞；借鑑 cynthiayuyu 設計）。第一版不做筆刷大小調整。
3. 「堆沙」工具把沙往上推，上限原面 +3 cm（A5）；「攤平」工具把沙往原面拉回。
4. 濕盤有水位滑桿（0＝無水，1＝滿至沙面原高）。沙面低於水位的區域顯示水；水面有輕微動態（Voronoi／漣漪），放物件到水中或挖掘產生漣漪。乾盤沒有水位。
5. 物件放在凹陷處會落在凹陷的沙面高度上（不是浮在原平面）；物件所在盤的 id 記在物件上。
6. 兩人同步：任一方挖掘、填回、調水位，另一方 ≤1 秒內看到相同結果；斷線重連後高度圖與水位一致。
7. 存檔／還原／備份／PNG：高度圖與水位一起存；還原後凹陷與水位一致；PNG 匯出畫出兩盤與水。
8. 刪除／完全抹除：高度圖隨場景抹除（T11 語義不變）。
9. 效能：每盤高度圖依尺寸 60×60～240×240（標準盤 144×114）；挖掘操作 ACK p50 不高於現有 object.transform.commit 的門檻；iPad 上 60 分鐘不當機（併入 AC13／A15）。

# 3. 各層影響（GPT-6 整合，Claude review）

## 3.1 protocol（`packages/protocol`）
- `sceneSchema.trays: [traySchema, traySchema]`（固定兩個，`kind:'dry'|'wet'`）。
- `traySchema = { id, kind:'dry'|'wet', shape:'rect'|'square'|'circle'|'octagon', sizeCm:{w,h,depth}（square／circle／octagon 以 w 為邊長／直徑／對邊距，h＝w）, heightmap:{w,h,encoding:'u8-base64',data}, waterLevel:0..1（dry 固定 0）, baseColor: color }`。
- 高度圖解析度規則：**2 格／cm**，標準盤 144×114；上限 240×240（120 cm 盤）、下限 60×60；u8 量化 0＝盤底、255＝原面＋3 cm（堆沙上限），原面落在 ≈ 179。標準盤 16,416 B → base64 ≈ 21.9 KB；最大盤 57,600 B → 76.8 KB。**snapshot 上限要從「100 物件」擴到含兩張高度圖（最壞 ≈ 154 KB）**——ws-outbound contract、16 KiB inbound frame 上限（S1／C21-F1：初始同步走 snapshot 端點不走 WS frame）、2 MiB backup 上限都要對照。
- 非矩形盤：高度圖仍是矩形陣列，加 `mask`（由 shape 推導、不存）；mask 外的格子固定為「牆」，筆刷與放置都被 clamp 在 mask 內；框體用現有 `ExtrudeGeometry(Shape)` 依形狀生成。
- `sceneObjectSchema.trayId`（必填；migration：既有物件全部歸 `dry`）。
- 新操作：`sand.dig {trayId, center:[x,z], radius, strength}`、`sand.fill {…同}`、`tray.water {trayId, level}`。`sand.*` 為**增量**（server 對高度圖套筆刷並回傳受影響區塊的 u8 片段），不是整張圖重傳；client 端可樂觀套用、以 ACK 校正。
- `schemaVersion` 1→2；舊 snapshot 讀入時補預設 trays（平面、waterLevel 0）。

## 3.2 room-core／sync（伺服器權威）
- 挖掘授權：A4 **已裁定（2026-09-25）**與 `object.transform.commit` 同 grant 類別——**案主直接可操作；治療師須持有案主授予、未撤銷、epoch 相符的 grant**（原暫定括號「治療師隨時、案主需 grant」方向寫反，作廢）；適用全部 `sand.*` 與水位操作；grant 的 `objectId` 對 tray 操作改為 `trayId`——**需確認 grant schema 是否允許非物件目標**，否則加 `target:{kind:'tray',id}`。
- 限流：`sand.*` 計入 commits 桶（10/s）；拖曳時 client 端合併為 ≤10 op/s 的筆刷路徑（一個 op 帶多個 center 點，上限 8 點）。
- revision：高度圖變更推進 `sceneRevision`；`history`（undo）每步存受影響區塊的 before/after，不存整圖。
- 不變式（AGENTS §9）全部沿用：revoke 後舊 `sand.dig` 失效、epoch 檢查、idempotency（operationId）、ACK 前持久化。

## 3.3 持久化
- versions／backup 格式含 `trays`；`backupSchema` 更新；2 MiB 上限重算（最壞兩盤 +154 KB，仍遠低於上限）。
- 每日備份、還原、tombstone／完全抹除（T11）語義不變——高度圖在 snapshot 內，隨之抹除。

## 3.4 renderer（`apps/web`）
- 沙面：`PlaneGeometry(10,7,127,89)` 頂點 y 由高度圖驅動（`BufferAttribute` 更新，只改受影響區塊），法線重算；藍色底：盤內側五面實色材質，沙面透明度 0，挖到 0 高度時自然露出底面。
- 水（濕盤）：移植 `stylized-components` 的 `WaterFloor`（MIT，需在 `NOTICE`／about 頁署名 Christian Ortiz）——第一版只取：Voronoi cel-shaded 表面＋漣漪環＋深度交界線；**不取** GPU 粒子閃光與 PDE 波動（成本高、行動裝置風險）。水面為固定平面（y＝waterLevel×原面高），與沙面交界用深度差算出岸線。
- 挖掘互動：raycast 命中沙面 → 本地立即套筆刷（樂觀）→ 送 `sand.dig` → ACK 校正。觸控：單指拖曳＝挖，需與現有相機／物件拖曳手勢區分（工具模式切換）。
- 物件落點：放置／移動時取該點高度圖值作 y。
- 資源釋放：高度圖 attribute、水材質、深度 render target 在關房／切環境時 dispose（AGENTS §10 清單）。
- PNG 匯出：現有 `png-export.tsx` 需含兩盤與水面。

## 3.5 不做（第一版）
- 筆刷大小調整、休止角崩塌（列為第二版可選，SandDune MIT）、風／濕度、水的物理（流動、滲透）、乾盤加水、建房後改尺寸形狀（A6）。

# 4. 參考實作與授權

| 用途 | 來源 | 授權 | 取捨 |
|---|---|---|---|
| 水面 | [cortiz2894/stylized-components](https://github.com/cortiz2894/stylized-components) `WaterFloor`（Three 0.182＋R3F；我們 0.185.1＋R3F 9.7，相容） | MIT，署名 Christian Ortiz | 取 Voronoi 表面＋漣漪＋深度交界；不取粒子與 PDE |
| **沙盤高度場（同領域）** | [cynthiayuyu/sandtray](https://github.com/cynthiayuyu/sandtray)（Three.js＋Vite；72×57×7 cm、藍底、高斯筆刷堆／挖、每影格節流、PNG、觸控兩段手勢、Supabase 可選） | **無授權檔（license: None）** | **只借設計**（筆刷力道、節流、手勢、常數）；**不得複製程式碼**。**使用者裁定（06:40）：不聯絡作者**——所有程式碼自行撰寫；實作者不得開啟該 repo 原始碼逐行對照，只得參考本檔摘要的設計常數 |
| 沙的崩塌／濕沙 | [SamG-Coder/SandDune](https://github.com/SamG-Coder/SandDune)（Three.js＋WebGL2；160×160 高度場 30 Hz、休止角崩塌、風、濕度、淺水流、自適應品質） | MIT | 借 `brush()`（挖出的沙堆到邊緣）與 `transferPair` 休止角鬆弛作**伺服器端可選的整平步驟**；不引入整套模擬（風、魚、淺水流對 iPad 太重） |
| **沙物理（GPU 高度場＋崩塌）** | [winchxyz/tidewright](https://github.com/winchxyz/tidewright)（WebGL2、零依賴；640² ping-pong RGBA32F：沙深／濕度／壓實／表面水膜；八鄰域休止角崩塌；倒沙粒子落地併入高度場；體積守恆） | MIT | 借：cell 四欄設計、崩塌演算法、倒沙→高度場流程。**不借**：GPU 模擬作為狀態來源（見 §8） |
| 筆刷互動 | [skeelogy/skulpt.js](https://github.com/skeelogy/skulpt.js)（Three.js GPU 高度場雕刻：add／remove／smooth 筆刷、低解析 proxy 碰撞） | MIT，**2015 後未更新** | 借筆刷語意（挖／堆／抹平＋半徑／強度），不當依賴 |
| 可變形高度圖 | [IceCreamYou/THREE.Terrain](https://github.com/IceCreamYou/THREE.Terrain)（sculpt 工具）、[GoldSloth/three.js-Terrain-Heightmap](https://github.com/GoldSloth/three.js-Terrain-Heightmap)（可陷落網格）、[meetar/heightmap-demos](https://github.com/meetar/heightmap-demos) | MIT／各自 | 只借筆刷與法線重算作法，不引入依賴 |
| 顆粒模擬（進階） | [SamG-Coder/grain-cuda-sand](https://github.com/SamG-Coder/grain-cuda-sand)（WebGPU、131,072 粒 PBD）、[NewKrok/three-particles](https://github.com/NewKrok/three-particles)（WebGPU compute 粒子） | MIT | **第二版局部特效**（倒沙、沙流）才考慮；不作核心——不可同步、不可存檔、WebGPU fallback |
| ~~iksaif/sandcastle~~ | GPT 建議；GitHub API：**無授權、0★、無描述** | None | **不納入**（無授權不得借碼，描述無法核實） |
| 落沙粒子模擬 | [m4ym4y/falling-sand-shader](https://github.com/m4ym4y/falling-sand-shader)、[NicksterSand/3D-Falling-Sand](https://github.com/NicksterSand/3D-Falling-Sand) | — | **不採用**：不可序列化、不可同步、行動裝置成本過高 |

結論（v2 更新）：cynthiayuyu/sandtray 就是「瀏覽器沙遊高度場」的現成案例，證實路線正確，但無授權只能借設計；SandDune 提供 MIT 的筆刷與崩塌演算法。高度圖＋筆刷仍是可同步、可存檔、可 PNG 的唯一務實路線。

# 5. 驗收條件（AC16）

| # | 條件 | 驗證 |
|---|---|---|
| AC16-1 | schema v2 往返：v1 snapshot 讀入→補預設 trays→存回→再讀一致 | unit（protocol） |
| AC16-2 | `sand.dig` 未授權案主 → server 拒絕、高度圖不變、revision 不動 | runtime |
| AC16-3 | 兩端挖同一區塊：server 序列化，兩端最終高度圖 byte-identical | runtime |
| AC16-4 | revoke 後晚到的 `sand.dig` 失效；重連不延續 | runtime（沿用 security-gap 家族） |
| AC16-5 | 存檔→還原→高度圖與 waterLevel 一致；備份還原同 | runtime |
| AC16-6 | 完全抹除後無高度圖殘留（T11 矩陣加一案） | runtime |
| AC16-7 | 挖到底露藍色、濕盤低於水位處有水、物件落在凹陷高度 | e2e 截圖＋像素取樣 |
| AC16-8 | 十房耐久加入每 tick 一次 `sand.dig`：既有九項門檻不退化 | endurance（run 形狀改動需 C 裁定） |
| AC16-9 | iPad：挖掘拖曳與相機手勢不衝突；60 分鐘（A15） | 真機 |
| AC16-10 | 關房後 GPU 資源釋放（renderer info 計數回到基線） | e2e |
| AC16-11 | 四種形狀各一盤：mask 外不可挖、不可放物件（server 拒絕）；框體與沙面貼合無縫 | runtime＋e2e 截圖 |
| AC16-12 | 尺寸範圍外（<30 或 >120 cm、深 <5 或 >10）建房被 schema 拒絕；標準盤高度圖恰為 144×114 | unit |
| AC16-13 | 堆沙不超過原面 +3 cm；挖掘不低於盤底；力道：連續按住 ≥1.0 s 才觸底（節流門檻可測） | runtime |

# 6. 分工與順序（建議）

1. ~~使用者裁定 A1–A5~~ 已全部裁定（§1）。
2. GPT-6（9/19 後）：protocol v2＋migration＋`sand.*`／`tray.water` 伺服器實作＋contract 重生（一個 CLAIM）。
3. Claude：threat model（新操作的授權／限流／idempotency／history 大小）＋schema review。
4. GLM：AC16-1～6 回歸先寫（固定現況→翻轉）。
5. GPT-6：renderer（高度圖網格＋水面移植＋挖掘手勢＋PNG）；Claude UX／資源釋放 review；GLM e2e＋耐久形狀。
6. 真機（使用者）。

估計：伺服器側 2–3 個工作日、renderer 3–5 個工作日、測試 2 日——**不影響 9/19–9/22 staging 時程**（AC13 用現有場景形狀跑；AC16-8 另排）。

# 7. 對現有 release gate 的影響

本需求是新功能，不改變 C5 No-Go 五項理由；未完成前不列入上線條件（可作第二版）。若使用者希望列為上線必要，需明示，並接受 staging 之後再多一輪耐久。

# 8. 對 GPT 建議（2026-09-18 使用者轉述）的評估

同意的部分：95% 高度場＋5% 粒子特效；筆刷 op 作線上格式（`{tool,x,z,radius,strength}`）而非同步沙粒；先做獨立 POC 再併回；Tidewright／skulpt.js 納入參考；grain-cuda-sand 只作進階。

**不同意／修正**：
1. **「其他 client 自己重跑筆刷」不能是真相來源**。GPU ping-pong 模擬（Tidewright 式）在不同 GPU 上浮點結果不逐 bit 相同，兩端各自重跑數百步後高度圖漂移，重連也無權威狀態可取；違反 AGENTS §9（server 驗證、ACK 前持久化）。**定案**：筆刷核心在 **CPU、u8 整數運算、確定性**，Durable Object 為權威（套筆刷 → 回傳受影響區塊）；client 用同一 CPU 核心樂觀套用、以 ACK 校正；**GPU 只做渲染（displacement）**。
2. 休止角崩塌若做（第二版），必須是定點整數、伺服器端同步執行的鬆弛步驟，客戶端只重放結果；不採 GPU 崩塌。
3. iksaif/sandcastle 無授權，不納入。
4. skulpt.js 2015 年後未更新，只借語意。

**POC 定案**：`packages/sand-engine`（獨立、零 Cloudflare 依賴）——(a) CPU 確定性核心：`applyBrush(heightmap,mask,op)`、`heightAt`、區塊 diff 編碼；(b) Three.js displacement 渲染＋法線更新；(c) 挖／堆／抹平＋物件落在沙面高度；(d) iPad Safari 效能量測（標準盤 144×114 與最大盤 240×240，60 s 連續拖曳 fps／記憶體）。AC：同一 op 序列在 Node 與瀏覽器產生 byte-identical 高度圖（確定性證明）。POC 通過後才進 protocol v2。**POC 執行者：GLM-5.3-flash（使用者 08:0x 裁定），任務編號 G33**；Opus C31 核對（確定性 AC、效能數字、授權邊界）。
