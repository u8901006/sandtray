# 素材與授權

程式碼採用 AGPL-3.0，3D 素材不是。每件素材保留原作者的授權，出處寫在 `packages/asset-catalog/src/*.json` 和 `provenance.ts`，app 內的「素材出處」頁會列出全部。

## 倉庫裡有什麼

| 路徑 | 內容 | 授權 |
|---|---|---|
| `apps/web/public/dev-assets/` | 5 個開發用練習模型（`tools/create-dev-assets.ts` 產生） | AGPL-3.0，隨程式碼 |
| `assets/garden-pbr-v1/` | 森林地面、木地板貼圖 | CC0，Poly Haven |

## 倉庫裡沒有、要自己下載的

目錄檔已經列好 999 件 CC0 模型的 id、名稱、版本與 SHA-256，但模型檔本身沒有放進 git。下載原始素材包後，用 `tools/assets/` 的匯入腳本轉換，結果放到 `apps/web/public/imported-assets/`，雜湊必須和目錄檔一致。

| 目錄檔 | 件數 | 來源 |
|---|---|---|
| `imported-v1.json` | 270 | Kenney Mini Arena、Mini Dungeon、Furniture Kit、Mini Characters；Quaternius Ultimate Animated Character Pack |
| `megakits-v1.json` | 527 | Quaternius Fantasy Props、Stylized Nature、Modular SciFi、Medieval Village MegaKit |
| `adventure-v1.json` | 98 | KayKit（Kay Lousberg）Adventurers、Skeletons、Medieval Hexagon、Fantasy Weapons、RPG Tools、Resource、Furniture Bits；Quaternius Ultimate Modular Ruins |
| `bits-v1.json` | 104 | KayKit City Builder、Restaurant、Space Base、Board Game、Holiday Bits |

以上全部是 CC0 1.0。匯入腳本預設從 `./asset-packs/` 讀原始檔（已列入 `.gitignore`），可以用 `--source` 指定別的位置。

## 新增素材的規則

授權允許清單只有 **CC0-1.0** 與 **CC-BY-4.0**：

- CC-BY 素材必須填署名文字，出處頁會顯示，而且不能隱藏
- CC-BY-SA、CC-BY-NC、CC-BY-ND 一律不收；`npm run check` 會擋下
- 不能單獨再散布的授權，不得放在公開靜態路徑（`/imported-assets/`、`/dev-assets/`）
- 授權沒核對過的素材標成 `UNVERIFIED`，部署環境不會列出

圖片平面、billboard 或 placeholder 不能當成正式 3D 模型。
