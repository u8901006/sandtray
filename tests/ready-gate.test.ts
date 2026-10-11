import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {resolveAsset,provenanceIssues,pinnedModels} from '../packages/asset-catalog/src/index';
import {missingLocalAssetsReason} from './runtime/local-asset-gate';

// 2026-10-10 T13 amendment (user decision): adventure-v1 + bits-v1 (202) are formal assets with status 'ready'. Any catalog
// row marked ready must meet the T13 Phase 1 per-item gate: the file is the pinned, self-contained GLB (no missing textures),
// mesh bounds are finite and non-degenerate (the app recentres the pivot and scales to displaySize from these bounds), the
// licence metadata is complete and the thumbnail exists. Loading through the app's GLTFLoader is in tests/e2e/ready-gate.spec.ts.
const root=join(__dirname,'..'),src=join(root,'packages/asset-catalog/src'),PUBLIC=join(root,'apps/web/public');
type Row={id:string;version:string;status?:string;url:string;thumbnail:string;sha256:string;bytes:number;license:string;licenseSha256?:string;displaySize?:number};
const all=readdirSync(src).filter(f=>f.endsWith('.json')).flatMap(f=>{const data=JSON.parse(readFileSync(join(src,f),'utf8'));return Array.isArray(data)?(data as Row[]).map(row=>({file:f,row})):[];});
const ready=all.filter(x=>x.row.status==='ready');
const READY_COUNT=202;
function glb(path:string){
 const b=new Uint8Array(readFileSync(path)),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
 expect(v.getUint32(0,true)).toBe(0x46546c67);const n=v.getUint32(12,true);
 return {bytes:b,doc:JSON.parse(new TextDecoder().decode(b.subarray(20,20+n)))};
}
// Open-source edition: the CC0 GLBs are not committed (see ASSETS.md). Without them these cases report SKIPPED via the shared
// REQUIRE_LOCAL_ASSETS gate (REQUIRE_LOCAL_ASSETS=1 turns a missing file into a failure), never PASS.
const skipWithoutModels=(ctx:{skip:(note?:string)=>void})=>{const reason=missingLocalAssetsReason(ready.map(x=>x.row).map((r:{url:string})=>'apps/web/public'+r.url),'ready (adventure-v1 + bits-v1) GLBs');if(reason){console.warn(reason);ctx.skip(reason);}};
describe('T13 ready gate',()=>{
 it('counts exactly the 202 user-approved formal assets (adventure-v1 98 + bits-v1 104) and nothing else',()=>{
  expect(ready.length).toBe(READY_COUNT);
  expect(ready.filter(x=>x.file==='adventure-v1.json').length).toBe(98);expect(ready.filter(x=>x.file==='bits-v1.json').length).toBe(104);
  expect(new Set(ready.map(x=>x.file))).toEqual(new Set(['adventure-v1.json','bits-v1.json']));
 });
 it('every ready asset has complete licence metadata, a valid provenance and a private pinned model',()=>{
  for(const {row} of ready){
   const asset=resolveAsset(row.id,row.version)!;expect(asset,row.id).toBeDefined();expect(provenanceIssues(asset),row.id).toEqual([]);
   expect(asset.provenance.releasable,row.id).toBe(true);expect(row.license).toBe('CC0-1.0');expect(row.licenseSha256,row.id).toMatch(/^[0-9a-f]{64}$/);
   expect(pinnedModels.some(m=>m.id===row.id&&m.version===row.version&&m.sha256===row.sha256),row.id).toBe(true);
  }
 });
 it('every ready asset is its pinned self-contained GLB with finite, non-degenerate bounds and a PNG thumbnail',ctx=>{skipWithoutModels(ctx);
  for(const {row} of ready){
   const file=join(PUBLIC,row.url);expect(existsSync(file),row.id).toBe(true);
   const {bytes,doc}=glb(file);expect(createHash('sha256').update(bytes).digest('hex'),row.id).toBe(row.sha256);
   expect(doc.buffers.every((b:{uri?:string})=>b.uri===undefined),row.id).toBe(true);
   for(const image of doc.images??[])expect(image.uri===undefined&&typeof image.bufferView==='number',row.id).toBe(true);
   for(const texture of doc.textures??[])expect(doc.images?.[texture.source],row.id).toBeDefined();
   const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
   for(const mesh of doc.meshes)for(const p of mesh.primitives){const a=doc.accessors[p.attributes.POSITION];for(let i=0;i<3;i++){min[i]=Math.min(min[i],a.min[i]);max[i]=Math.max(max[i],a.max[i]);}}
   const size=max.map((v,i)=>v-min[i]);expect(size.every(Number.isFinite),row.id).toBe(true);expect(Math.max(...size),row.id).toBeGreaterThan(1e-4);
   const t=join(PUBLIC,row.thumbnail);expect(existsSync(t),row.id).toBe(true);expect([...readFileSync(t).subarray(0,4)]).toEqual([0x89,0x50,0x4e,0x47]);
  }
 });
});
