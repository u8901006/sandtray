---
title: "第一批十件立體素材試作"
description: "依 references 製作的 Blender 與 GLB 候選、來源核對與待驗收事項"
date: 2026-09-09
tags: [assets, pilot, blender, review]
---

# 第一批十件立體素材試作

10/10 已建立立體模型候選；正式 RELEASED 仍為 0/100。原始參考圖、來源紀錄及 catalog.planned.json 保留原樣。這份紀錄取代舊 pilot README 中「尚未生成圖片／模型」的進度描述，不代表產品核准。

使用者指定 references 為建模依據。實際來源紀錄為即夢 dreamina text2image 5.0，不能寫成 ChatGPT Image。這一輪使用本機 Blender 5.2.1 程序建模，未呼叫付費重建服務。GLM-5.3-flash 未提供；由可用子代理分工，主代理整合驗證。

| ID | 名稱 | 動畫 | 模型三角面 | LOD 三角面 |
|---|---|---|---:|---:|
| ST-007 | 年輕成人短髮 | idle / walk / wave | 6904 | 3452 |
| ST-020 | 中性簡約人偶 | idle / walk / wave | 6904 | 3452 |
| ST-021 | 貓 | 靜態 | 5956 | 2978 |
| ST-036 | 蝴蝶 | flap | 5656 | 2828 |
| ST-046 | 岩石 | 靜態 | 1280 | 640 |
| ST-048 | 洞穴 | 靜態 | 1372 | 686 |
| ST-056 | 小屋 | 靜態 | 4500 | 2250 |
| ST-064 | 橋 | 靜態 | 8704 | 4352 |
| ST-084 | 椅子 | 靜態 | 2632 | 1316 |
| ST-092 | 龍 | 靜態 | 9324 | 4662 |

每件位於 working/pilot-v1/ST-xxx，包含 model.glb、lod.glb、source.blend、metadata.json、hero.png、六向圖片及八格轉台。metadata 記錄參考圖與實際模型 SHA256、位元組及編輯部位；render-evidence 記錄從 GLB 重新匯入的渲染來源。全部為 MESH_DRAFT。

## 本機檢視

在專案目錄執行：

```powershell
node tools/assets/serve_pilot_v1.mjs
```

開啟 http://127.0.0.1:8790，可拖曳旋轉、縮放、切換 LOD、修改指定材質、試播及停止動畫、對照參考圖與六向渲染。服務只綁定本機並只讀取指定素材目錄；頁面未接正式素材櫃。

## 可重現流程

```powershell
node tools/assets/audit_references_v1.mjs
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python tools/assets/build_pilot_v1.py
node tools/assets/validate_pilot_v1.mjs
```

建模腳本由三個獨立模組組成，主流程合併靜態網格、保留骨架／翼節點、統一底部中心、輸出 GLB 與減面版本，再重新載入 GLB 渲染。上述命令重建 working/pilot-v1 工作產物，不改 references。

## 參考圖核對

100 筆來源中 98 張存在，僅 90 個不同 SHA256；存在圖片的 PNG、2048 尺寸、大小與來源 hash 相符。

- 缺 ST-013、ST-015；ST-015 的舊紀錄為 0 bytes／空檔 hash。
- 共圖六組：070/072、075/077、078/085、081/086、091/093/094/095、098/099。同組均待人工核對，不能猜哪一筆正確。
- 12 筆 submitId 遺失／不可驗證；即夢條款審閱尚待補齊。
- 首批十件的參考圖皆存在且沒有落入上述共圖組。

完整結果：working/pilot-v1/reference-audit.json。只核對來源完整性，沒有核准授權或風格。

## 驗收限制

最終加強驗證與瀏覽器操作結果另見本輪 task 記錄；未執行的項目不列 PASS。

人形採剛性權重及分段衣料重疊，仍需逐幀檢查關節穿插與外觀。岩石目前為簡化霧面造型，沒有還原參考圖所有裂紋與自然紋理。椅子依 references 保留綠色軟墊，ST-020 採橘色服裝，皆與舊 brief 有差異，待產品逐件審閱。

AS03 產品风格核准、AS07 完整條款、真機效能、正式發布索引與 immutable path 尚未完成；G1 尚未放行，因此不把本輪候選列入正式 100 件，也不將成功匯出視為完整素材驗收。
