import {PUBLIC_PATHS,type CatalogAsset} from '../../../packages/asset-catalog/src/index';
// 2026-09-28 使用者裁定：部署環境（staging／production）的物件庫隱藏 DEV_ 練習素材；2026-10-03 擴大為所有非 releasable（含 UNVERIFIED）。
// GPT-6 static review 2026-10-04 A2-F1：原本以 /api/health 非同步判定，回應前或失敗時會列出全部素材（fail-open）。
// 改為同步依 hostname：只有本機開發主機才可能列出非 releasable 素材；health 回報 staging／production 時一律隱藏（雙重保險）。
export function isLocalHost(hostname:string){return hostname==='localhost'||hostname==='127.0.0.1'||hostname==='[::1]'||hostname.endsWith('.localhost');}
export function listableAsset(asset:Pick<CatalogAsset,'id'|'url'|'provenance'>,{roomId,hostname,healthDeployed}:{roomId:string|null;hostname:string;healthDeployed:boolean}){
 // REQ-018 option B (T18-C): private-only models have no public URL, so local exploration (no room) cannot list them.
 if(!roomId&&!PUBLIC_PATHS.some(prefix=>asset.url.startsWith(prefix)))return false;
 const deployed=healthDeployed||!isLocalHost(hostname);
 return !(deployed&&(asset.id.startsWith('DEV_')||!asset.provenance.releasable));
}
