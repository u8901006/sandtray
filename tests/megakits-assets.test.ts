import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import rows from '../packages/asset-catalog/src/megakits-v1.json' with {type:'json'};
import {resolveAsset,validAssetVersion,provenanceIssues,pinnedModels,privateModelUrl,devAssets} from '../packages/asset-catalog/src/index';
import {resolvePrivateModel} from '../apps/worker/src/asset-delivery';
import {missingLocalAssetsReason} from './runtime/local-asset-gate';

// 2026-10-06 Quaternius MegaKits v1 (Fantasy Props 94, Stylized Nature 68, Modular SciFi 189 of 190, Medieval Village 176; CC0 1.0).
// Pins the converter contract: one self-contained GLB per model, only 512 px base-colour, normal (kept by user decision 2026-10-06) and emissive textures kept, explicit
// metallic/roughness factors (the glTF default metallicFactor 1 renders metal black without an environment map), CC0 provenance.
const root=join(__dirname,'..');
const PUBLIC=join(root,'apps/web/public');
const PACKS={FP:['Quaternius Fantasy Props MegaKit',94],SN:['Quaternius Stylized Nature MegaKit',68],SF:['Quaternius Modular SciFi MegaKit',189],MV:['Quaternius Medieval Village MegaKit',176]} as const;
function glb(path:string){
 const b=new Uint8Array(readFileSync(path)),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
 expect(v.getUint32(0,true)).toBe(0x46546c67);expect(v.getUint32(4,true)).toBe(2);expect(v.getUint32(8,true)).toBe(b.length);
 const n=v.getUint32(12,true);return {bytes:b,doc:JSON.parse(new TextDecoder().decode(b.subarray(20,20+n)))};
}
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');

// Open-source edition: the CC0 GLBs are not committed (see ASSETS.md). Without them these cases report SKIPPED via the shared
// REQUIRE_LOCAL_ASSETS gate (REQUIRE_LOCAL_ASSETS=1 turns a missing file into a failure), never PASS.
const skipWithoutModels=(ctx:{skip:(note?:string)=>void})=>{const reason=missingLocalAssetsReason(rows.map((r:{url:string})=>'apps/web/public'+r.url),'megakits-v1 GLBs');if(reason){console.warn(reason);ctx.skip(reason);}};
describe('megakits-v1 catalog',()=>{
 it('holds every pack model but the one with a missing source .bin, with unique ids and unique Traditional Chinese names',()=>{
  expect(rows.length).toBe(527);
  expect(new Set(rows.map(r=>r.id)).size).toBe(527);
  expect(new Set(rows.map(r=>r.name)).size).toBe(527);
  for(const [code,[pack,count]] of Object.entries(PACKS)){
   const list=rows.filter(r=>r.id.startsWith('MK_'+code+'_'));
   expect(list.length).toBe(count);for(const r of list)expect(r.sourcePack).toBe(pack);
  }
  expect(rows.some(r=>r.id==='MK_SF_Decal_Line_90')).toBe(false);// Decal_Line_90.gltf names a .bin that is not in the pack
  for(const r of rows){expect(r.name).toMatch(/[一-鿿]/);expect(r.status).toBe('IMPORTED_UNREVIEWED');}
 });
 it('every GLB matches its pinned hash, is self-contained, within the 3 MB / 30k triangle budget and keeps normal maps embedded but no ORM map',ctx=>{skipWithoutModels(ctx);
  for(const r of rows){
   const file=join(PUBLIC,r.url);expect(existsSync(file),r.id).toBe(true);
   const {bytes,doc}=glb(file);
   expect(sha(bytes),r.id).toBe(r.sha256);expect(r.url).toContain(r.sha256.slice(0,16));expect(r.version).toBe('mk-'+r.sha256.slice(0,16));
   expect(bytes.length,r.id).toBe(r.bytes);expect(bytes.length,r.id).toBeLessThanOrEqual(3_000_000);expect(r.triangles).toBeLessThanOrEqual(30_000);
   expect(doc.buffers.length).toBe(1);expect(doc.buffers[0].uri).toBeUndefined();
   for(const image of doc.images??[]){expect(image.uri,r.id).toBeUndefined();expect(['image/jpeg','image/png']).toContain(image.mimeType);expect(image.bufferView).toBeTypeOf('number');}
   for(const material of doc.materials??[]){
    expect(material.occlusionTexture,r.id).toBeUndefined();if(material.normalTexture)expect(doc.images[doc.textures[material.normalTexture.index].source].bufferView,r.id).toBeTypeOf('number');
    expect(material.pbrMetallicRoughness.metallicRoughnessTexture,r.id).toBeUndefined();
    expect(material.pbrMetallicRoughness.metallicFactor,r.id).toBeLessThanOrEqual(0.1);expect(material.pbrMetallicRoughness.roughnessFactor,r.id).toBeGreaterThan(0.5);
   }
  }
 });
 it('every thumbnail exists as a PNG, and each pack ships its CC0 licence text',ctx=>{skipWithoutModels(ctx);
  for(const r of rows){const t=join(PUBLIC,r.thumbnail);expect(existsSync(t),r.id).toBe(true);expect([...readFileSync(t).subarray(0,4)]).toEqual([0x89,0x50,0x4e,0x47]);}
  for(const code of Object.keys(PACKS))expect(readFileSync(join(PUBLIC,'imported-assets/megakits-v1',code+'-LICENSE.txt'),'utf8')).toContain('CC0 1.0');
 });
 it('animated models keep their clips and skins',ctx=>{skipWithoutModels(ctx);
  const animated=rows.filter(r=>r.clips.length>0);expect(animated.length).toBeGreaterThan(0);
  for(const r of animated){const {doc}=glb(join(PUBLIC,r.url));expect(doc.animations.length).toBe(r.clips.length);expect(r.clips.every(c=>c.durationMs>0)).toBe(true);}
 });
});

describe('megakits-v1 provenance and delivery',()=>{
 it('is CC0, releasable, valid, pinned, routed privately in a room and not a restricted licence on a public path',()=>{
  for(const r of rows){
   const asset=resolveAsset(r.id,r.version)!;expect(asset,r.id).toBeDefined();
   expect(asset.provenance.license).toBe('CC0-1.0');expect(asset.provenance.author).toBe('Quaternius');expect(asset.provenance.releasable).toBe(true);
   expect(asset.provenance.requiresAttribution).toBe(false);expect(provenanceIssues(asset)).toEqual([]);expect(validAssetVersion(r.id,r.version)).toBe(true);
   expect(pinnedModels.some(m=>m.id===r.id&&m.version===r.version&&m.sha256===r.sha256)).toBe(true);
   expect(resolvePrivateModel(r.id,r.version)).toEqual({key:'models/'+r.sha256+'.glb',sha256:r.sha256,bytes:r.bytes});
   expect(privateModelUrl(asset,'room-1')).toMatch(/^\/api\/assets\/MK_/);
  }
 });
 it('is part of the exported catalog exactly once',()=>{
  expect(devAssets.filter(a=>a.id.startsWith('MK_')).length).toBe(527);
 });
});
