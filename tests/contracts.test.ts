import {it,expect} from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import SwaggerParser from '@apidevtools/swagger-parser';
import {readFileSync,existsSync} from 'node:fs';
import {artifacts,checkTraceability} from '../tools/contracts';
import {assetDraftSchema,validateRelease,parseInbound,validTransform} from '../packages/protocol/src/index';
const ajv=new Ajv2020({strict:false});addFormats(ajv);
const all=artifacts();
it('compiles all JSON Schemas and validates OpenAPI references',async()=>{
  for(const [name,schema] of Object.entries(all)) if(name.endsWith('schema.json')) expect(()=>ajv.compile(schema)).not.toThrow();
  await expect(SwaggerParser.validate(structuredClone(all['openapi.json']) as any)).resolves.toBeDefined();
});
const message={protocolVersion:1,type:'object.transform.commit',operationId:'op',sessionEpoch:1,controlEpoch:1,objectId:'a',expectedObjectRevision:0,leaseId:'l',fencingToken:1,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1}};
it('JSON Schema accepts transform and rejects missing fence / forged role',()=>{
  const validate=ajv.compile(all['ws-inbound.schema.json']);expect(validate(message)).toBe(true);
  const {fencingToken,...missing}=message;expect(validate(missing)).toBe(false);expect(validate({...message,role:'client'})).toBe(false);
});
it('runtime enforces size, unknown types, malformed JSON, bounds and quaternion norm',()=>{
  expect(parseInbound(JSON.stringify(message))).toEqual(message);
  for(const raw of ['{',JSON.stringify({...message,type:'admin'}),JSON.stringify({...message,type:'toString'}),' '.repeat(16385),JSON.stringify({...message,transform:{...message.transform,rotation:[0,0,0,0]}})])expect(()=>parseInbound(raw)).toThrow();
  expect(validTransform({...message.transform,scale:NaN})).toBe(false);expect(validTransform({...message.transform,scale:-1})).toBe(false);
});
it('100 planned records are valid drafts but none are releasable',()=>{
  const catalog=JSON.parse(readFileSync('specs/002-assets-100/catalog.planned.json','utf8'));
  expect(catalog).toHaveLength(100);
  for(const asset of catalog){expect(assetDraftSchema.safeParse(asset).success).toBe(true);expect(()=>validateRelease(asset)).toThrow();}
});
// Open-source edition: traceability.json (internal evidence map) is not published → this case reports SKIPPED.
it.skipIf(!existsSync('specs/001-sandtray/traceability.json'))('AC14 removing a requirement or tasks/acceptance/evidence mapping fails',()=>{
  const rows=JSON.parse(readFileSync('specs/001-sandtray/traceability.json','utf8'));
  expect(()=>checkTraceability(rows)).not.toThrow();expect(()=>checkTraceability(rows.slice(1))).toThrow();
  // L11-2: each critical mapping must fail independently when deliberately removed.
  for(const removeMapping of [
    (row:any)=>delete row.tasks,
    (row:any)=>delete row.acceptance,
    (row:any)=>delete row.evidence,
  ]) {
    const mutated=structuredClone(rows);removeMapping(mutated[0]);
    expect(()=>checkTraceability(mutated)).toThrow();
  }
  const bad=structuredClone(rows);
  bad[0].acceptance='A01';bad[0].status='VERIFIED';bad[0].evidence=[];expect(()=>checkTraceability(bad)).toThrow();
  // V8-L11-2 (AC14): the contiguous-numbering rule alone let the highest REQ rows be deleted silently; every REQ declared in the spec must stay mapped.
  expect(()=>checkTraceability(rows.filter((r:any)=>r.id!=='REQ-019'))).toThrow(/REQ-019/);expect(()=>checkTraceability(rows.filter((r:any)=>!['REQ-018','REQ-019'].includes(r.id)))).toThrow(/REQ-018/);
});
export function releaseFixture() {
 const hash='a'.repeat(64);return {assetId:'ST-007',assetVersion:'v1',status:'RELEASED',nameZhTW:'test',category:'人物',tags:[],animationClass:'H',
 source:{promptVersion:'v1',imageHashes:[hash],canonicalImageHash:hash,imageInterface:'fixture',imageModel:'unknown',generatedAt:'2026-09-06T00:00:00Z',reconstructionProvider:'blender-manual',reconstructionVersion:'test',termsReviewId:'review'},
 outputs:{glbKey:`published/ST-007/v1/${hash}.glb`,glbSha256:hash,lodKeys:['published/ST-007/v1/lod.glb'],thumbnailKey:'published/ST-007/v1/thumb.png',sourceBlendKey:'working/ST-007/v1/source.blend'},
 metrics:{triangles:2000,drawCalls:2,transferBytes:500000,textureBytes:200000},defaultScale:1,bounds:[1,2,1],editableMaterials:['shirt'],clips:['idle','walk','wave'].map(id=>({id,durationMs:1000,loop:false})),
 license:{licenseSource:'fixture',licenseText:'test only',attribution:'',webDistributionAllowed:true},qa:{checks:['AS01','AS02','AS03','AS04','AS05','AS06','AS07','AS08'],reviewer:'fixture',reviewedAt:'2026-09-06T00:00:00Z',reportKey:'working/ST-007/v1/qa.json'}};
}
it('release gate checks permissions, actual required clips, distinct checks and immutable hashes',()=>{
  expect(()=>validateRelease(releaseFixture())).not.toThrow();
  const cases=[(a:any)=>a.license.webDistributionAllowed=false,(a:any)=>a.clips.pop(),(a:any)=>a.qa.checks.fill('AS01'),(a:any)=>a.outputs.glbKey='published/ST-007/v1/fake.glb',(a:any)=>a.source.canonicalImageHash='b'.repeat(64)];
  for(const change of cases){const a=releaseFixture();change(a);expect(()=>validateRelease(a)).toThrow();}
});
