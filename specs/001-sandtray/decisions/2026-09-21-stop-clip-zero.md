---
title: "停止角色動作的第 0 幀裁定"
description: "2026-09-21 使用者確認單一角色停止控制回到 clip 第 0 幀；區分停止所有動作的現有行為。"
date: 2026-09-21
tags: [decision, REQ-008, animation]
author: GPT-6
---

# 使用者裁定

「停止動作」目前回到 clip 第 0 幀，接受此行為，不需要改成定格當下姿態。C54／G58 對此提出的待裁定項已解除。

單一角色控制由 `apps/web/src/main.tsx` 的 `playClip('stopped')` 送出 `offsetMs: 0`、`loop: false`；本機與會談入口使用相同數值。`catalog-model.tsx` 依時間 0 呈現選定 clip；本次不修改產品程式與共享協定。

# 範圍與歷史更正

本機「停止所有動作」是另一個入口：`stopLocalAnimations()` 目前保留 offsetMs 與路徑位置。舊 quickstart-v15／T10-local-stop-all 記錄此行為，仍屬該入口的歷史與實作說明。本裁定不把「所有停止入口均已歸零」寫成既成事實。2026-09-21 06:42 留言提及取代 quickstart-v15 的說法過廣，應以本文件的入口區分為準。

C54/G58 靜止截圖測試只證明停止後畫面不再變化，不能單獨證明姿態是第 0 幀；本輪入口數值核對是靜態證據，並未新增逐幀姿態驗收。

# 關聯

- [本輪工作與證據](../../../docs/evidence/2026-09-21/gpt6/t18e/README.md)
- [歷史停止全部任務](../tasks/T10-local-stop-all-2026-09-13.md)