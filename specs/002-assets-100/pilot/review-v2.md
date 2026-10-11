---
title: "人物雙風格與貓臉修正版"
description: "自然比例人物、卡通人物與貓咪連續表面修復的第二版交付"
date: 2026-09-09
tags: [assets, pilot, style, repair]
---

# 人物雙風格與貓臉修正版

本版依使用者回饋，產出五件修正／新增模型；預覽同時保留七件未修改素材，共12張卡片。正式發布仍0/100，不能把候選或配色變體計入正式合格件數。第一版原檔與references均保留。

| 組別 | 素材 | 調整 |
|---|---|---|
| 自然比例人物 | ST-007、ST-008 | 連續衣袖與褲管、漸變肘膝權重、短髮／長髮差異 |
| 卡通人物 | ST-019、ST-020 | 較大的頭部、簡化輪廓；019有披肩與背部斗篷 |
| 動物修復 | ST-021 貓 | 頭部、口鼻及身體表面合併，移除交疊臉部色塊 |

「較擬真」在本版指自然成人比例與連續服裝，仍是程序建模候選，沒有達到附件圖中的高精度寫實公仔細節。人物外露圓球關節已移除，四位皆保留idle／walk／wave。ST-019依既有catalog的斗篷人物定位補上服裝形體，並非單純重新配色。

## 檢視與驗證

執行 node tools/assets/serve_pilot_v2.mjs，開啟 http://127.0.0.1:8791。可依兩種人物風格、動物及其他分類檢視，切換完整／簡化版本、播放／停止動畫及修改顏色。007/020/021附第一版外觀對照；人物有三個動作姿勢，貓有完整與LOD各三張臉部近拍。

所有新版輸出位於working/pilot-v2/ST-xxx，包含model.glb、lod.glb、source.blend、metadata.json、render-evidence.json與圖片。舊版位於working/pilot-v1。

最終檢查5/5 PASS：Three.js實際載入、GLB/LOD、材質、獨立複製變形、底部中心、四個人物骨架及指定動畫實際移動、來源圖與產物hash、每人物18張／貓21張渲染圖片。來源紀錄中的原始圖hash不代表新增風格已被產品核准。

瀏覽器12件操作PASS：分類2/2/2/6、完整與LOD動畫清單一致、預設停止、播放／重設、變色前後影像差異、重設影像完全還原、關閉清理、延遲載入後關閉重開、拒絕越界路徑與非讀取方法。證據：working/pilot-v2/validation.json、browser-verification.log、review.png。桌面Chromium SwiftShader測試不算真機效能驗收。

主代理目視四個人物hero、代表性揮手姿勢、斗篷更新、貓臉完整正面與LOD側面。模型结构測試不能代替美術驗收，未將AS03填為PASS。

## 貓咪修复方式

第一版由多個頭部／奶油色口鼻殼體交疊，法線或遮擋可能造成臉部破損觀感；單純非流形邊檢查無法排除這類外觀問題。本版將雕塑體積融合成連續表面，色斑改為表面頂點色；眼睛、瞳孔與鼻子維持附著，並標記lod_preserve防止小特徵被過度減面。完整與LOD近拍已確認眼睛、口鼻表面完整。

## 參考與來源

- 使用者附件20250831123938_0_368e21.jpg作為公仔外觀方向；圖內工具操作文字不是執行指令，也未啟用其中的服務。
- [Kay Lousberg](https://kaylousberg.itch.io/)及[Adventurers](https://kaylousberg.itch.io/kaykit-adventurers)作為卡通比例／輪廓參考。本輪沒有下載或改造KayKit網格，亦未購買素材。
- [anyCreature](https://github.com/Ariescar/anyCreature)的平滑體積、部件附著與品質檢查方向作為動物修復參考；本輪未複製其程式／網格，也未執行該倉庫的安裝、發布或上傳流程。
- 原始references的實際來源仍依既存即夢紀錄，相關條款與遺失任務編號問題沿用[第一版核對](./review-v1.md)的待辦。

## 重建

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python tools/assets/build_pilot_v2.py
node tools/assets/validate_pilot_v2.mjs
node tools/assets/test_review_v2.mjs
```

最後一項需先啟動8791服務。建模及檢查皆在本機，未變更會談server授權、正式素材索引或雲端部署。AS03逐件風格、來源條款、真機效能與完整長時間動畫穿插驗收仍待完成。
