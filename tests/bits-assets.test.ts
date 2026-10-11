import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import rows from '../packages/asset-catalog/src/bits-v1.json' with {type:'json'};
import {resolveAsset,validAssetVersion,provenanceIssues,pinnedModels,privateModelUrl,devAssets} from '../packages/asset-catalog/src/index';
import {resolvePrivateModel} from '../apps/worker/src/asset-delivery';
import {categoryGroup,OTHER_GROUP} from '../apps/web/src/shelf-groups';
import {missingLocalAssetsReason} from './runtime/local-asset-gate';

// 2026-10-10 bits-v1: KayKit (Kay Lousberg) City Builder / Restaurant / Space Base / Board Game / Holiday Bits, all CC0.
// Pins the converter contract (tools/assets/import_bits_v1.py) and the selection in tools/assets/bits_v1_plan.py.
const root=join(__dirname,'..');
const PUBLIC=join(root,'apps/web/public');
const PACKS={CTY:['KayKit City Builder Bits',26],RST:['KayKit Restaurant Bits',23],SPC:['KayKit Space Base Bits',13],BRD:['KayKit Board Game Bits',18],HOL:['KayKit Holiday Bits',24]} as const;
type Doc={[k:string]:any};
function glb(path:string){
 const b=new Uint8Array(readFileSync(path)),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
 expect(v.getUint32(0,true)).toBe(0x46546c67);expect(v.getUint32(4,true)).toBe(2);expect(v.getUint32(8,true)).toBe(b.length);
 const n=v.getUint32(12,true);const doc:Doc=JSON.parse(new TextDecoder().decode(b.subarray(20,20+n)));return {bytes:b,doc};
}
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const row=(id:string)=>rows.find(r=>r.id===id)!;

// Open-source edition: the CC0 GLBs are not committed (see ASSETS.md). Without them these cases report SKIPPED via the shared
// REQUIRE_LOCAL_ASSETS gate (REQUIRE_LOCAL_ASSETS=1 turns a missing file into a failure), never PASS.
const skipWithoutModels=(ctx:{skip:(note?:string)=>void})=>{const reason=missingLocalAssetsReason(rows.map((r:{url:string})=>'apps/web/public'+r.url),'bits-v1 GLBs');if(reason){console.warn(reason);ctx.skip(reason);}};
describe('bits-v1 catalog',()=>{
 it('holds the reviewed 104 pieces per pack with unique ids and unique Traditional Chinese names',()=>{
  expect(rows.length).toBe(104);
  expect(new Set(rows.map(r=>r.id)).size).toBe(104);expect(new Set(rows.map(r=>r.name)).size).toBe(104);
  for(const [code,[pack,count]] of Object.entries(PACKS)){const list=rows.filter(r=>r.id.startsWith('KB_'+code+'_'));expect(list.length,code).toBe(count);for(const r of list)expect(r.sourcePack).toBe(pack);}
  for(const r of rows){expect(r.name).toMatch(/[一-鿿]/);expect(r.status).toBe('ready');expect(r.license).toBe('CC0-1.0');expect(r.author).toBe('Kay Lousberg');expect(r.clips).toEqual([]);}
  // names do not collide with any other catalogue entry either, so search results stay unambiguous
  const others=new Set(devAssets.filter(a=>!a.id.startsWith('KB_')).map(a=>a.name));
  expect(rows.filter(r=>others.has(r.name)).map(r=>r.name)).toEqual([]);
 });
 it('leaves out modular parts, chopped / raw variants, terrain, printed cards, colour duplicates and the knife',()=>{
  expect(rows.some(r=>/withoutBase|kitchencounter|kitchencabinet|wall|floor_|_chopped|_slice|_trash|_uncooked|terrain_|tunnel_|playercard_|\/tile_|knife/.test(r.origin))).toBe(false);
  // one colour per shape, except meeples / pawns / flags, which come in all four colours
  for(const kind of ['meeple','pawn_A','flag_A'])expect(rows.filter(r=>r.origin.includes('/'+kind+'_')).length,kind).toBe(4);
  expect(rows.filter(r=>/present_/.test(r.origin)).length).toBe(4);
 });
 it('every GLB matches its pinned hash, is self-contained, unrigged and within the 3 MB / 30k triangle budget',ctx=>{skipWithoutModels(ctx);
  for(const r of rows){
   const file=join(PUBLIC,r.url);expect(existsSync(file),r.id).toBe(true);
   const {bytes,doc}=glb(file);
   expect(sha(bytes),r.id).toBe(r.sha256);expect(bytes.length).toBe(r.bytes);expect(r.url).toContain(r.sha256.slice(0,16));
   expect(bytes.length,r.id).toBeLessThanOrEqual(3_000_000);expect(r.triangles).toBeLessThanOrEqual(30_000);
   expect(doc.buffers.length).toBe(1);expect(doc.buffers[0].uri).toBeUndefined();expect(doc.skins).toBeUndefined();expect(doc.animations).toBeUndefined();
   for(const image of doc.images??[]){expect(image.uri,r.id).toBeUndefined();expect(image.bufferView).toBeTypeOf('number');}
   for(const m of doc.materials??[]){const pbr=m.pbrMetallicRoughness;expect(pbr.metallicFactor,r.id).toBeLessThanOrEqual(0.1);expect(pbr.roughnessFactor,r.id).toBeGreaterThanOrEqual(0.5);expect(pbr.baseColorFactor?.[3]??1,r.id).toBeGreaterThan(0.1);}
  }
 });
 it('display sizes stay within 0.6–3.2, are part of the version, and pieces used together keep their relative scale',()=>{
  for(const r of rows){expect(r.displaySize,r.id).toBeGreaterThanOrEqual(0.6);expect(r.displaySize,r.id).toBeLessThanOrEqual(3.2);expect(r.version).toBe(`kb-${r.sha256.slice(0,16)}-s${Math.round(r.displaySize*10)}`);}
  const s=(id:string)=>row(id).displaySize;
  expect(s('KB_CTY_building_H')).toBeGreaterThan(s('KB_CTY_car_police'));expect(s('KB_CTY_car_police')).toBeGreaterThan(s('KB_CTY_firehydrant'));
  expect(s('KB_CTY_road_straight')).toBe(s('KB_CTY_building_A')); // the 2.0 m pavement base and the 2.0 m road tile line up
  // train and track share one scale (×1.4 of the source): locomotive 0.86 → 1.2, straight track 1.0 → 1.4, curve 2.24 → 3.1
  expect(s('KB_HOL_tracks_straight')/s('KB_HOL_train_locomotive')).toBeCloseTo(1.0/0.86,1);expect(s('KB_HOL_tracks_curve')/s('KB_HOL_tracks_straight')).toBeCloseTo(2.24,1);
 });
 it('every thumbnail exists as a PNG; each pack ships its licence text, Holiday as a labelled page snapshot',ctx=>{skipWithoutModels(ctx);
  for(const r of rows){const t=join(PUBLIC,r.thumbnail);expect(existsSync(t),r.id).toBe(true);expect([...readFileSync(t).subarray(0,4)]).toEqual([0x89,0x50,0x4e,0x47]);}
  for(const code of Object.keys(PACKS))expect(readFileSync(join(PUBLIC,'imported-assets/bits-v1',code+'-LICENSE.txt'),'utf8')).toMatch(/CC0|Creative Commons Zero/);
  // T14 licenseSha256 (GPT-6 review F2): every row pins the exact licence text shipped for its pack
  for(const r of rows){const code=r.id.slice(3,3+3);expect(r.licenseSha256,r.id).toBe(sha(readFileSync(join(PUBLIC,'imported-assets/bits-v1',code+'-LICENSE.txt'))));}
  expect(new Set(rows.map(r=>r.licenseSha256)).size).toBe(Object.keys(PACKS).length);
  const hol=readFileSync(join(PUBLIC,'imported-assets/bits-v1/HOL-LICENSE.txt'),'utf8');
  expect(hol).toContain('NOT part of the pack');expect(hol).toContain('https://kaylousberg.itch.io/holiday-bits');expect(hol).toContain('Creative Commons Zero v1.0 Universal');
 });
 it('every category sits under a shelf group, not 其他',()=>{
  for(const c of new Set(rows.map(r=>r.category)))expect(categoryGroup(c),c).not.toBe(OTHER_GROUP);
  expect(categoryGroup('桌遊').id).toBe('symbols');expect(categoryGroup('食物').id).toBe('daily');expect(categoryGroup('交通').id).toBe('transport');
 });
});

describe('bits-v1 provenance and delivery',()=>{
 it('is CC0, releasable, valid, pinned and routed privately in a room',()=>{
  for(const r of rows){
   const asset=resolveAsset(r.id,r.version)!;expect(asset,r.id).toBeDefined();expect(asset.displaySize).toBe(r.displaySize);
   expect(asset.provenance.license).toBe('CC0-1.0');expect(asset.provenance.author).toBe('Kay Lousberg');expect(asset.provenance.releasable).toBe(true);
   expect(asset.provenance.requiresAttribution).toBe(false);expect(provenanceIssues(asset)).toEqual([]);expect(validAssetVersion(r.id,r.version)).toBe(true);
   expect(pinnedModels.some(m=>m.id===r.id&&m.version===r.version&&m.sha256===r.sha256)).toBe(true);
   expect(resolvePrivateModel(r.id,r.version)).toEqual({key:'models/'+r.sha256+'.glb',sha256:r.sha256,bytes:r.bytes});
   expect(privateModelUrl(asset,'room-1')).toMatch(/^\/api\/assets\/KB_/);
  }
  expect(resolveAsset('KB_HOL_snowman_A')!.provenance.sourceUrl).toBe('https://kaylousberg.itch.io/holiday-bits');
 });
 it('is part of the exported catalog exactly once',()=>{
  expect(devAssets.filter(a=>a.id.startsWith('KB_')).length).toBe(104);
 });
});
