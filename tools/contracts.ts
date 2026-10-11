import { z } from 'zod';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { id, restoreVersionSchema, inviteInspectSchema, inviteRedeemSchema, sceneSnapshotV1Schema, sceneSnapshotV2Schema, inboundSchemas, outboundSchemas, assetDraftSchema, assetReleaseSchema, grantSchema, leaseSchema, roomTraysSchema } from '../packages/protocol/src/index';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dir = resolve(root, 'specs/001-sandtray/contracts');
export function artifacts() {
  const json = (schema: z.ZodType) => z.toJSONSchema(schema);
  const sceneV2Json = {...json(sceneSnapshotV2Schema)} as Record<string, unknown>;
  sceneV2Json['x-sandtray-invariants'] = [
    'trays[0] is dry and trays[1] is wet; tray ids are unique',
    'heightmap.w = sizeCm.w * 2 and heightmap.h = sizeCm.h * 2',
    'base64-decoded heightmap byte count equals heightmap.w * heightmap.h',
    'square, circle and octagon trays have equal width and height',
    'dry tray waterLevel is exactly 0',
    'each object trayId references one of the two tray ids',
    'object ids are unique',
  ];
  const schemas = {Scene: sceneV2Json, SceneV1: json(sceneSnapshotV1Schema), AssetRelease: json(assetReleaseSchema)};
  const paths: Record<string, unknown> = {};
  const add = (path: string, method: string, summary: string, body?: z.ZodType, response: unknown = {type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string'}}}, success = '200', publicRoute = false) => {
    const operation = {summary, operationId: `${method}_${path.replace(/[^a-zA-Z]+/g,'_')}`, security: publicRoute ? [] : [{sessionCookie:[]}],
      parameters: [...path.matchAll(/\{(\w+)\}/g)].map(m=>({name:m[1],in:'path',required:true,schema:json(id)})),
      ...(body ? {requestBody:{required:true,content:{'application/json':{schema:json(body)}}}} : {}),
      responses:{[success]:{description:summary, ...(success==='101'||success==='204'||success==='302'?{}:{content:{'application/json':{schema:response}}})},
        '400':{$ref:'#/components/responses/Error'},'401':{$ref:'#/components/responses/Error'},'403':{$ref:'#/components/responses/Error'},'409':{$ref:'#/components/responses/Error'},'503':{$ref:'#/components/responses/Error'},'501':{$ref:'#/components/responses/NotImplemented'}}};
    paths[path] = {...paths[path] as object, [method]:operation};
  };
  const empty = z.strictObject({});
  add('/auth/login','get','OIDC authorization redirect (T02)',undefined,undefined,'302',true);
  add('/auth/callback','get','Validate state, nonce and PKCE (T02)',undefined,undefined,'302',true);
  add('/auth/logout','post','Revoke server session',empty,undefined,'204');
  // 2026-10-11 治療師加入碼＋管理員後台：每個 /api/admin 請求都向 D1 重驗管理權；加入碼只回傳一次、資料庫只存雜湊。
  add('/auth/enroll','get','Start Google login carrying a one-time enrollment code (?code=); dead codes redirect to /?enroll=invalid',undefined,undefined,'302',true);
  add('/api/admin/me','get','Whether the current therapist is an active administrator',undefined,{type:'object',additionalProperties:false,required:['isAdmin'],properties:{isAdmin:{type:'boolean'}}});
  add('/api/admin/directory','get','Administrators only: own clinic therapists, pending enrollment codes, last 50 audit entries',undefined,{type:'object'});
  add('/api/admin/enrollments','post','Administrators only: create a 24 h one-time enrollment link',z.strictObject({displayName:z.string().min(1).max(60),grantAdmin:z.boolean()}),{type:'object',additionalProperties:false,required:['id','link','expiresAt'],properties:{id:{type:'string'},link:{type:'string'},expiresAt:{type:'integer'}}});
  add('/api/admin/enrollments/{id}/revoke','post','Administrators only: revoke an unused enrollment code',empty);
  add('/api/admin/therapists/{id}/deactivate','post','Administrators only: deactivate a therapist and revoke all sessions; the last active administrator cannot be removed (409 LAST_ADMIN)',empty);
  add('/api/rooms','post','Create room; therapist and clinic assignment required',z.strictObject({retentionMode:z.literal('session-only'),policyVersion:id,trays:roomTraysSchema.optional()}));
  add('/api/rooms/{id}/invites','post','Rotate one-time invite',empty,{type:'object',additionalProperties:false,required:['token','expiresAt'],properties:{token:{type:'string',minLength:22},expiresAt:{type:'integer'}}});
  add('/api/invites/redeem','post','Redeem invite into waiting seat',inviteRedeemSchema,undefined,'200',true);
  const versionStatus={type:'object',additionalProperties:false,required:['id','status','sceneRevision','expiresAt'],properties:{id:json(id),name:{type:'string'},status:{type:'string',enum:['PENDING','COMPLETE']},sceneRevision:{type:'integer',minimum:0},expiresAt:{type:'integer'},attempts:{type:'integer',minimum:0}}};
  add('/api/invites/inspect','post','Read retention disclosure using an unconsumed invite; no scene or identity',inviteInspectSchema,{type:'object',additionalProperties:false,required:['retentionMode','policyVersion'],properties:{retentionMode:{enum:['cloud','session-only']},policyVersion:json(id),ttlMs:{type:'integer'}}},'200',true);
  add('/api/rooms/{id}/waiting/cancel','post','Room owner cancels only the specified unadmitted waiting seat',z.strictObject({participantId:id}));
  add('/api/rooms/{id}/admit','post','Admit waiting client',z.strictObject({participantId:id}));
  add('/api/rooms/{id}/socket','get','Same-origin cookie, admitted seat; 16 KiB inbound maximum',undefined,undefined,'101');
  add('/api/assets','get','Authorized released assets only',undefined,{type:'array',maxItems:100,items:{$ref:'#/components/schemas/AssetRelease'}});
  const modelPath='/api/assets/{assetId}/{assetVersion}/model.glb';
  const modelHeaders={'Cache-Control':{schema:{type:'string',const:'private, no-store'}},ETag:{schema:{type:'string'}},'Content-Length':{schema:{type:'string'}}};
  for(const method of ['get','head']){
    paths[modelPath]={...paths[modelPath] as object,[method]:{
      summary:'REQ018-A room-authorized immutable model stream; public path retirement is separate',operationId:method+'_private_model',security:[{sessionCookie:[]}],
      parameters:[{name:'assetId',in:'path',required:true,schema:json(id)},{name:'assetVersion',in:'path',required:true,schema:json(id)},{name:'roomId',in:'query',required:true,schema:json(id)}],
      responses:{'200':{description:'Pinned R2 model, authorization rechecked after storage read; never 304',headers:modelHeaders,...(method==='get'?{content:{'model/gltf-binary':{schema:{type:'string',format:'binary'}}}}:{})},
       ...Object.fromEntries([401,403,404,405,503].map(status=>[status,{$ref:'#/components/responses/Error'}])),
       '429':{description:'Session budget exhausted (600/minute)',headers:{'Retry-After':{schema:{type:'string'}}}}}
    }};
  }
  add('/api/rooms/{id}/snapshot','get','Private confirmed scene, maximum 1 MiB; Cache-Control no-store',undefined,{$ref:'#/components/schemas/Scene'});
  // L07-2B C4 (2026-09-30): old single-tray clients (no X-Sandtray-Protocol: 2 header / sandtray.v2 subprotocol) get 426 UPGRADE_REQUIRED
  // after authentication and before any scene or state change.
  for (const route of ['/api/rooms/{id}/socket','/api/rooms/{id}/snapshot']) ((paths[route] as any).get.responses)['426'] = {$ref:'#/components/responses/Error'};
  add('/api/scenes/{id}/exports','post','Assignment and separate export consent',z.strictObject({format:z.literal('png'),consentVersion:id,expectedSceneRevision:z.number().int().nonnegative().optional()}));
  add('/api/rooms/{id}/close','post','End the session and erase it; session-only rooms: owning therapist only (V8-L12-1A)',empty,undefined,'204');
  add('/api/rooms/{id}/leave','post','Client leaves without ending the session: withdraws all grants, frees the seat, revokes the client session (V8-L12-1A)',empty);
  const deletionStatus={type:'object',additionalProperties:false,required:['status','deletedAt'],properties:{status:{type:'string',enum:['PENDING','COMPLETE']},deletedAt:{type:'integer'}}};
  return {
    'openapi.json': {openapi:'3.1.0',info:{title:'Sandtray API',version:'0.1.0',description:'T00 target contract. Business endpoints are fail-closed placeholders until T02–T05; not an implementation claim.'},paths,components:{schemas,securitySchemes:{sessionCookie:{type:'apiKey',in:'cookie',name:'sandtray_session'}},responses:{Error:{description:'Request rejected',content:{'application/json':{schema:{type:'object',additionalProperties:false,required:['code','requestId'],properties:{code:{type:'string'},requestId:{type:'string'}}}}}},NotImplemented:{description:'Not implemented; no scene is returned'}}}},
    'ws-inbound.schema.json': {$schema:'https://json-schema.org/draft/2020-12/schema',oneOf:Object.values(inboundSchemas).map(json)},
    'ws-outbound.schema.json': {$schema:'https://json-schema.org/draft/2020-12/schema',oneOf:Object.values(outboundSchemas).map(json)},
    'scene.schema.json':sceneV2Json,'scene-v1.schema.json':json(sceneSnapshotV1Schema),'grant.schema.json':json(grantSchema),'lease.schema.json':json(leaseSchema),
    'asset-draft.schema.json':json(assetDraftSchema),'asset-release.schema.json':json(assetReleaseSchema),
  };
}
// V8-L11-2 (AC14): requirements declared by the spec itself -- IDs cited in spec.md plus every req-NNN-*.md file.
// Numbering contiguity alone cannot catch deletion of the highest REQ rows, so the declared set is checked too.
export function declaredRequirementIds(specDir=resolve(root,'specs/001-sandtray')):string[] {
  const ids=new Set(readFileSync(resolve(specDir,'spec.md'),'utf8').match(/REQ-\d{3}/g)??[]);
  for(const file of readdirSync(specDir)){const m=/^req-(\d{3})-.+\.md$/.exec(file);if(m)ids.add(`REQ-${m[1]}`);}
  return [...ids].sort();
}
export function checkTraceability(rows: any[], declared: string[] = declaredRequirementIds()) {
  for(const required of declared) if(!rows.some(r=>r.id===required)) throw new Error(`Missing declared requirement ${required}`);
  // REQ-001…REQ-N must be contiguous with no gaps or duplicates; the original 15 are the floor, new requirements append.
  if (rows.length<15 || new Set(rows.map(r=>r.id)).size!==rows.length) throw new Error('Missing/duplicate requirement');
  for(let n=1;n<=rows.length;n++) {
    const row=rows.find(r=>r.id===`REQ-${String(n).padStart(3,'0')}`);
    if(!row) throw new Error('Missing/duplicate requirement');
    if(!row.tasks || !row.acceptance || !row.contract || !Array.isArray(row.evidence)) throw new Error('Incomplete mapping');
    if(row.status!=='NOT_IMPLEMENTED' && !row.evidence.length) throw new Error('Evidence required');
    for(const evidence of row.evidence) if(typeof evidence!=='string' || !existsSync(resolve(root,evidence))) throw new Error('Missing evidence file');
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  mkdirSync(dir,{recursive:true});
  for(const [name,value] of Object.entries(artifacts())) {
    const content=JSON.stringify(value,null,2)+'\n'; const path=resolve(dir,name);
    if(process.argv.includes('--write')) writeFileSync(path,content);
    else if(!existsSync(path)||readFileSync(path,'utf8')!==content) throw new Error(`Contract drift: ${name}; run npx tsx tools/contracts.ts --write`);
  }
  // Open-source edition: traceability.json maps requirements to internal evidence files that are not published here.
  // Without it the mapping gate is reported as SKIPPED, never PASS.
  const traceability=resolve(root,'specs/001-sandtray/traceability.json');
  if(existsSync(traceability)){checkTraceability(JSON.parse(readFileSync(traceability,'utf8')));console.log('PASS: nine executable contracts and requirement mappings');}
  else console.log('PASS: nine executable contracts; SKIPPED: requirement traceability (specs/001-sandtray/traceability.json not present)');
}
