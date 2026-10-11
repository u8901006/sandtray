import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import rows from '../packages/asset-catalog/src/adventure-v1.json' with {type:'json'};
import {resolveAsset,validAssetVersion,provenanceIssues,pinnedModels,privateModelUrl,devAssets} from '../packages/asset-catalog/src/index';
import {resolvePrivateModel} from '../apps/worker/src/asset-delivery';
import {categoryGroup,OTHER_GROUP} from '../apps/web/src/shelf-groups';
import {normalizedScale,DEFAULT_DISPLAY_SIZE} from '../apps/web/src/model-size';
import {missingLocalAssetsReason} from './runtime/local-asset-gate';

// 2026-10-10 adventure-v1: KayKit (Kay Lousberg) Adventurers / Skeletons / Medieval Hexagon / Fantasy Weapons / RPG Tools /
// Resource / Furniture bits + Quaternius Ultimate Modular Ruins, all CC0. Pins the converter contract (tools/assets/import_adventure_v1.py).
const root=join(__dirname,'..');
const PUBLIC=join(root,'apps/web/public');
const PACKS={ADV:['KayKit Adventurers',8],SKL:['KayKit Skeletons',5],HEX:['KayKit Medieval Hexagon Pack',35],WPN:['KayKit Fantasy Weapons Bits',9],
 TLS:['KayKit RPG Tools Bits',10],RES:['KayKit Resource Bits',8],FUR:['KayKit Furniture Bits',6],RUN:['Quaternius Ultimate Modular Ruins',17]} as const;
const FIGURES=['AV_ADV_Knight','AV_ADV_Barbarian','AV_ADV_Mage','AV_ADV_Ranger','AV_ADV_Rogue','AV_ADV_Rogue_Hooded','AV_SKL_Skeleton_Warrior','AV_SKL_Skeleton_Mage','AV_SKL_Skeleton_Rogue','AV_SKL_Skeleton_Minion'];
type Doc={[k:string]:any};
function glb(path:string){
 const b=new Uint8Array(readFileSync(path)),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
 expect(v.getUint32(0,true)).toBe(0x46546c67);expect(v.getUint32(4,true)).toBe(2);expect(v.getUint32(8,true)).toBe(b.length);
 const n=v.getUint32(12,true);const doc:Doc=JSON.parse(new TextDecoder().decode(b.subarray(20,20+n)));
 const bin=b.subarray(20+n+8);return {bytes:b,doc,bin};
}
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const SIZE:{[k:string]:number}={SCALAR:1,VEC3:3,VEC4:4};
function firstOutput(doc:Doc,bin:Uint8Array,sampler:Doc){
 const acc=doc.accessors[sampler.output],view=doc.bufferViews[acc.bufferView],n=SIZE[acc.type];
 const dv=new DataView(bin.buffer,bin.byteOffset+view.byteOffset+(acc.byteOffset??0));
 return Array.from({length:n},(_,i)=>dv.getFloat32(i*4,true));
}

// Open-source edition: the CC0 GLBs are not committed (see ASSETS.md). Without them these cases report SKIPPED via the shared
// REQUIRE_LOCAL_ASSETS gate (REQUIRE_LOCAL_ASSETS=1 turns a missing file into a failure), never PASS.
const skipWithoutModels=(ctx:{skip:(note?:string)=>void})=>{const reason=missingLocalAssetsReason(rows.map((r:{url:string})=>'apps/web/public'+r.url),'adventure-v1 GLBs');if(reason){console.warn(reason);ctx.skip(reason);}};
describe('adventure-v1 catalog',()=>{
 it('holds the reviewed selection per pack with unique ids and unique Traditional Chinese names',()=>{
  expect(rows.length).toBe(98);
  expect(new Set(rows.map(r=>r.id)).size).toBe(98);expect(new Set(rows.map(r=>r.name)).size).toBe(98);
  for(const [code,[pack,count]] of Object.entries(PACKS)){const list=rows.filter(r=>r.id.startsWith('AV_'+code+'_'));expect(list.length,code).toBe(count);for(const r of list)expect(r.sourcePack).toBe(pack);}
  for(const r of rows){expect(r.name).toMatch(/[一-鿿]/);expect(r.status).toBe('ready');expect(r.license).toBe('CC0-1.0');}
 });
 it('leaves out floor tiles, duplicate colours and the pieces dropped at thumbnail review',()=>{
  expect(rows.some(r=>/hex_|_(red|green|yellow)\./.test(r.origin))).toBe(false);
  for(const id of ['AV_HEX_tent','AV_HEX_tree_A_cut','AV_HEX_hill_A','AV_HEX_bridge_A','AV_HEX_bridge_B','AV_RUN_Chest_Gold'])expect(rows.some(r=>r.id===id),id).toBe(false);
 });
 it('every GLB matches its pinned hash, is self-contained and within the 3 MB / 30k triangle budget',ctx=>{skipWithoutModels(ctx);
  for(const r of rows){
   const file=join(PUBLIC,r.url);expect(existsSync(file),r.id).toBe(true);
   const {bytes,doc}=glb(file);
   expect(sha(bytes),r.id).toBe(r.sha256);expect(bytes.length).toBe(r.bytes);expect(r.url).toContain(r.sha256.slice(0,16));
   expect(bytes.length,r.id).toBeLessThanOrEqual(3_000_000);expect(r.triangles).toBeLessThanOrEqual(30_000);
   expect(doc.buffers.length).toBe(1);expect(doc.buffers[0].uri).toBeUndefined();
   for(const image of doc.images??[]){expect(image.uri,r.id).toBeUndefined();expect(image.bufferView).toBeTypeOf('number');}
  }
 });
 it('materials render: not metal, not mirror-smooth, and never fully transparent (the FBX import alpha-0 defect)',ctx=>{skipWithoutModels(ctx);
  for(const r of rows){
   const {doc}=glb(join(PUBLIC,r.url));
   for(const m of doc.materials??[]){
    const pbr=m.pbrMetallicRoughness;expect(pbr.metallicFactor,r.id).toBeLessThanOrEqual(0.1);expect(pbr.roughnessFactor,r.id).toBeGreaterThanOrEqual(0.5);
    // MASK (or OPAQUE) below the 0.5 cutoff vanishes; only deliberate BLEND glass (the lantern, alpha 0.2) may be faint.
    expect(pbr.baseColorFactor?.[3]??1,r.id+' '+m.name).toBeGreaterThan(m.alphaMode==='BLEND'?0.1:0.5);
    expect(m.extensions?.KHR_materials_specular,r.id).toBeUndefined();
   }
  }
 });
 it('display sizes stay within 0.6–3.2 tray units, figures match the catalogue-wide 1.6, and the size is part of the version',()=>{
  for(const r of rows){expect(r.displaySize,r.id).toBeGreaterThanOrEqual(0.6);expect(r.displaySize,r.id).toBeLessThanOrEqual(3.2);expect(r.version).toBe(`av-${r.sha256.slice(0,16)}-s${Math.round(r.displaySize*10)}`);}
  for(const id of FIGURES.filter(id=>id!=='AV_SKL_Skeleton_Minion'))expect(rows.find(r=>r.id===id)!.displaySize).toBe(1.6);
  const size=(id:string)=>rows.find(r=>r.id===id)!.displaySize;
  expect(size('AV_HEX_castle')).toBeGreaterThan(size('AV_ADV_Knight'));expect(size('AV_WPN_sword')).toBeLessThan(size('AV_ADV_Knight'));expect(size('AV_RES_gold_nuggets')).toBeLessThan(size('AV_WPN_sword'));
 });
 it('rigged figures carry 待機 / 行走 / 倒下 and rest in the 待機 pose at t = 0 instead of the bind T-pose',ctx=>{skipWithoutModels(ctx);
  expect(rows.filter(r=>r.clips.length>0).map(r=>r.id).sort()).toEqual([...FIGURES].sort());
  for(const id of FIGURES){
   const r=rows.find(x=>x.id===id)!;expect(r.clips.map(c=>c.name)).toEqual(['待機','行走','倒下']);expect(r.clips.every(c=>c.durationMs>0)).toBe(true);
   const {doc,bin}=glb(join(PUBLIC,r.url));expect(doc.animations.length).toBe(3);expect(doc.skins.length).toBe(1);
   const idle=doc.animations[0];let rotations=0;
   for(const ch of idle.channels){
    const node=doc.nodes[ch.target.node],want=firstOutput(doc,bin,idle.samplers[ch.sampler]);
    const have=node[ch.target.path]??(ch.target.path==='scale'?[1,1,1]:ch.target.path==='rotation'?[0,0,0,1]:[0,0,0]);
    want.forEach((w,i)=>expect(have[i],`${id} ${node.name} ${ch.target.path}`).toBeCloseTo(w,5));
    if(ch.target.path==='rotation')rotations++;
   }
   expect(rotations,id).toBeGreaterThan(10);
  }
 });
 it('every thumbnail exists as a PNG, and each pack ships its CC0 licence text',ctx=>{skipWithoutModels(ctx);
  for(const r of rows){const t=join(PUBLIC,r.thumbnail);expect(existsSync(t),r.id).toBe(true);expect([...readFileSync(t).subarray(0,4)]).toEqual([0x89,0x50,0x4e,0x47]);}
  for(const code of Object.keys(PACKS))expect(readFileSync(join(PUBLIC,'imported-assets/adventure-v1',code+'-LICENSE.txt'),'utf8')).toMatch(/CC0|Creative Commons Zero/);
  // T14 licenseSha256 (GPT-6 review F2): every row pins the exact licence text shipped for its pack
  for(const r of rows){const code=r.id.slice(3,3+3);expect(r.licenseSha256,r.id).toBe(sha(readFileSync(join(PUBLIC,'imported-assets/adventure-v1',code+'-LICENSE.txt'))));}
  expect(new Set(rows.map(r=>r.licenseSha256)).size).toBe(Object.keys(PACKS).length);
 });
 it('every new category sits under a shelf group, not 其他',()=>{
  for(const c of new Set(rows.map(r=>r.category)))expect(categoryGroup(c),c).not.toBe(OTHER_GROUP);
 });
});

describe('displaySize normalisation',()=>{
 it('scales the longest edge to displaySize and keeps 1.6 for assets without one',()=>{
  expect(DEFAULT_DISPLAY_SIZE).toBe(1.6);
  expect(normalizedScale({x:2,y:4,z:1})).toBeCloseTo(0.4);
  expect(normalizedScale({x:2,y:4,z:1},3.2)).toBeCloseTo(0.8);
  expect(normalizedScale({x:0.5,y:0.2,z:0.1},0.6)).toBeCloseTo(1.2);
 });
});

describe('adventure-v1 provenance and delivery',()=>{
 it('is CC0, releasable, valid, pinned and routed privately in a room',()=>{
  for(const r of rows){
   const asset=resolveAsset(r.id,r.version)!;expect(asset,r.id).toBeDefined();expect(asset.displaySize).toBe(r.displaySize);
   expect(asset.provenance.license).toBe('CC0-1.0');expect(asset.provenance.author).toBe(r.author);expect(asset.provenance.releasable).toBe(true);
   expect(asset.provenance.requiresAttribution).toBe(false);expect(provenanceIssues(asset)).toEqual([]);expect(validAssetVersion(r.id,r.version)).toBe(true);
   expect(pinnedModels.some(m=>m.id===r.id&&m.version===r.version&&m.sha256===r.sha256)).toBe(true);
   expect(resolvePrivateModel(r.id,r.version)).toEqual({key:'models/'+r.sha256+'.glb',sha256:r.sha256,bytes:r.bytes});
   expect(privateModelUrl(asset,'room-1')).toMatch(/^\/api\/assets\/AV_/);
  }
 });
 it('is part of the exported catalog exactly once and every KayKit piece credits Kay Lousberg',()=>{
  expect(devAssets.filter(a=>a.id.startsWith('AV_')).length).toBe(98);
  for(const r of rows)expect(r.author).toBe(r.id.startsWith('AV_RUN_')?'Quaternius':'Kay Lousberg');
 });
});
