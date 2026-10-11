import {resolveAsset} from '../../../packages/asset-catalog/src/index';
// 2026-10-10 案主影片 UX 觀察 3：治療師請求原本顯示 8 碼物件 ID，案主看不出是哪一件。
// 改用與右側「沙盤裡的物件」清單相同的名稱與序號（例：「熊貓 1」）；找不到時退回中性說法，不顯示 ID。
type SceneObject={id:string;assetId:string;assetVersion?:string};
export function requestObjectLabel(objects:readonly SceneObject[]|undefined,objectId:string){
 const index=objects?.findIndex(o=>o.id===objectId)??-1;
 if(index<0)return '一件物件';
 const {assetId,assetVersion}=objects![index];const name=(resolveAsset(assetId,assetVersion)??resolveAsset(assetId))?.name;
 return name?`${name} ${index+1}`:`第 ${index+1} 件物件`;
}
