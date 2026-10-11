import previousPuppet from './dev-puppet-v1.json' with {type:'json'};
import imported from './imported-v1.json' with {type:'json'};
import megaKits from './megakits-v1.json' with {type:'json'};
import adventure from './adventure-v1.json' with {type:'json'};
import bits from './bits-v1.json' with {type:'json'};
import {provenanceFor,provenanceIssues,type Provenance} from './provenance';
import type {ColorVariant} from '../../protocol/src/index';
export * from './provenance';
export type LinearRgba=readonly [number,number,number,number];
/** displaySize (2026-10-10, adventure-v1): longest edge in tray units when placed at scale 1; absent = the catalogue-wide 1.6. */
export type CatalogAsset={id:string;name:string;category:string;symbol:string;color:string;url:string;version:string;thumbnail?:string;displaySize?:number;clips:{id:string;name:string;durationMs:number}[];sourcePack?:string;colorVariantOriginal?:LinearRgba;provenance:Provenance};
type RawAsset=Omit<CatalogAsset,'provenance'>&{provenance?:Provenance;license?:string;author?:string};
// REQ-019 / V7-C02: the imported-v1 Ultimate character files all carry the
// same original Skin factor. Keep it as linear RGBA metadata, not an 8-bit
// hex approximation; batch02a files may already contain the default t2.
export const COLOR_VARIANT_ASSET_IDS:ReadonlySet<string>=new Set([
  'IMP_ULTIMATE_Casual_Male','IMP_ULTIMATE_Casual_Female',
  'IMP_ULTIMATE_Casual2_Male','IMP_ULTIMATE_Casual2_Female',
  'IMP_ULTIMATE_Suit_Male','IMP_ULTIMATE_Suit_Female',
  'IMP_ULTIMATE_Worker_Male','IMP_ULTIMATE_OldClassy_Male',
  'IMP_ULTIMATE_Doctor_Male_Young','IMP_ULTIMATE_Soldier_Male',
  'IMP_ULTIMATE_Knight_Male','IMP_ULTIMATE_Wizard',
]);
export const ORIGINAL_SKIN_LINEAR:LinearRgba=[0.013410447165369987,0.013410447165369987,0.013410447165369987,1];
// REQ-017: provenance is attached here (not in the data files) so every catalog entry has it, including practice models.
const withProvenance=(asset:RawAsset):CatalogAsset=>({...asset,...(COLOR_VARIANT_ASSET_IDS.has(asset.id)?{colorVariantOriginal:asset.colorVariantOriginal??ORIGINAL_SKIN_LINEAR}:{}),provenance:asset.provenance??provenanceFor(asset)});
const practiceAssets:RawAsset[] = [
  {id:'DEV_ROCK',name:'圓石',category:'自然',symbol:'●',color:'#9caba3',url:'/dev-assets/rock.glb',version:'dev-v1',clips:[]},
  {id:'DEV_HOUSE',name:'小屋',category:'建築',symbol:'⌂',color:'#c59477',url:'/dev-assets/house.glb',version:'dev-v1',clips:[]},
  {id:'DEV_ARCH',name:'拱門',category:'建築',symbol:'∩',color:'#c5b697',url:'/dev-assets/arch.glb',version:'dev-v1',clips:[]},
  // G57: current DEV_PUPPET release; the pinned v1 (dev-puppet-v1.json) lacks 原地行走, restoring the
  // "newer-only clip on an old model" server negative the trex removal dropped.
  {id:'DEV_PUPPET',name:'練習玩偶',category:'練習',symbol:'♟',color:'#8d7ae5',url:'/dev-assets/puppet-v2.glb',version:'puppet-v2',clips:[{id:'clip-0',name:'待機',durationMs:1000},{id:'clip-1',name:'原地行走',durationMs:800}]},
];
export const devAssets:CatalogAsset[]=[...practiceAssets,...imported,...megaKits,...adventure,...bits].map(withProvenance);
export const assetById=new Map(devAssets.map(asset=>[asset.id,asset]));
const assetVersions=new Map<string,Map<string,CatalogAsset>>();
for(const asset of [...previousPuppet.map(withProvenance),...devAssets]){
 let versions=assetVersions.get(asset.id);if(!versions){versions=new Map();assetVersions.set(asset.id,versions);}versions.set(asset.version,asset);
}
export function resolveAsset(id:string,version?:string):CatalogAsset|undefined{return version===undefined?assetById.get(id):assetVersions.get(id)?.get(version);}
// E2 (REQ-017): the server calls this before object.create / restore; an asset without valid provenance is not placeable.
export function validAssetVersion(id:string,version:string){const asset=resolveAsset(id,version);return asset!==undefined&&provenanceIssues(asset).length===0;}
export function supportsColorVariants(id:string,version:string){const asset=resolveAsset(id,version);return asset!==undefined&&COLOR_VARIANT_ASSET_IDS.has(asset.id)&&asset.colorVariantOriginal!==undefined;}
export function colorVariantOriginal(id:string,version:string):LinearRgba|undefined{return resolveAsset(id,version)?.colorVariantOriginal;}
export const COLOR_VARIANT_OPTIONS:readonly ColorVariant[]=['t1','t2','t3','t4','t5','t6','orig'];
export function clipDuration(id:string,clipId:string,version?:string){return resolveAsset(id,version)?.clips.find(clip=>clip.id===clipId)?.durationMs;}
export type DevAssetId=typeof devAssets[number]['id'];
// REQ-018 (T18-B): inside a room every releasable, hash-pinned catalog model is fetched through the
// session-and-room-authorized worker route; DEV_ONLY practice models and UNVERIFIED imports keep their
// static url because the worker refuses them (resolvePrivateModel). Local exploration has no room and
// therefore no private route — retiring the public CC0 paths is a separate, user-decided step.
/** Every catalog entry with a content hash the worker may stream from the private bucket (models/<sha256>.glb).
 * Open-source edition: CC0 packs only (imported-v1, megakits-v1, adventure-v1, bits-v1). */
export type PinnedModel={id:string;version:string;sha256:string;bytes:number;url:string;privateSource?:string};
const pinnedList:PinnedModel[]=[];const pinned=new Set<string>();
for(const raw of [...imported,...megaKits,...adventure,...bits] as PinnedModel[]){const key=raw.id+'\0'+raw.version;if(pinned.has(key))continue;pinned.add(key);pinnedList.push({id:raw.id,version:raw.version,sha256:raw.sha256,bytes:raw.bytes,url:raw.url,privateSource:raw.privateSource});}
export const pinnedModels:readonly PinnedModel[]=pinnedList;
export function privateModelUrl(asset:Pick<CatalogAsset,'id'|'version'|'provenance'>,roomId:string):string|undefined{
 if(!asset.provenance.releasable||!pinned.has(asset.id+'\0'+asset.version))return undefined;
 return `/api/assets/${encodeURIComponent(asset.id)}/${encodeURIComponent(asset.version)}/model.glb?roomId=${encodeURIComponent(roomId)}`;
}
export function modelUrlFor(asset:Pick<CatalogAsset,'id'|'version'|'url'|'provenance'>,roomId:string|null|undefined):string{
 return (roomId?privateModelUrl(asset,roomId):undefined)??asset.url;
}
