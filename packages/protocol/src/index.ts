import { z } from 'zod';

export const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/);
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const time = counter;
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const colorVariantSchema = z.enum(['t1','t2','t3','t4','t5','t6','orig']);
export type ColorVariant = z.infer<typeof colorVariantSchema>;
export const colorVariantHex: Record<Exclude<ColorVariant,'orig'>, string> = {
  t1: '#F6DCC6', t2: '#E8BE9A', t3: '#D4A27C', t4: '#B7835C', t5: '#8A5A3C', t6: '#5A3A28',
};
const text = z.string().min(1).max(200);
// REQ-016 (2026-09-30): positions are tray-local. The standard tray is 72 x 57 cm at 7.2 cm per unit (10 x 7.92 units).
export const TRAY_HALF_Z = 3.96;
// REQ-016 A6 (2026-09-30): trays are chosen at room creation (30-120 cm, 5-10 cm deep), so the wire range covers the largest tray
// (60 cm / 7.2 = 8.34 units half-width; a 10 cm deep tray dug to the floor is y -1.39). The Room enforces the actual tray outline.
export const TRAY_MAX_HALF = 8.34;
const position = z.tuple([z.number().min(-TRAY_MAX_HALF).max(TRAY_MAX_HALF), z.number().min(-1.5).max(5), z.number().min(-TRAY_MAX_HALF).max(TRAY_MAX_HALF)]);
/** REQ-016 A1: every room has a dry tray (left) and a wet tray (right). */
export const trayIdSchema = z.enum(['dry','wet']);
export type TrayId = z.infer<typeof trayIdSchema>;
export const trayShapeSchema = z.enum(['rect','square','circle','octagon']);
export type TrayShape = z.infer<typeof trayShapeSchema>;
/** 7.2 cm per world unit, so the standard 72 cm tray stays the 10-unit tray the assets were scaled for (REQ-016 §2.0). */
export const CM_PER_UNIT = 7.2;
/** REQ-016 §2.0 / A6: w = width (rect) or side / diameter / across-flats (square / circle / octagon, where h must equal w). */
export const trayConfigSchema = z.strictObject({
  shape: trayShapeSchema, w: z.number().int().min(30).max(120), h: z.number().int().min(30).max(120), depth: z.number().int().min(5).max(10),
}).refine(tray => tray.shape === 'rect' || tray.w === tray.h, {message: 'Square, round and octagonal trays require equal width and height'});
export type TrayConfig = z.infer<typeof trayConfigSchema>;
export const roomTraysSchema = z.strictObject({dry: trayConfigSchema, wet: trayConfigSchema});
export type RoomTrays = z.infer<typeof roomTraysSchema>;
export const STANDARD_TRAY_CONFIG: TrayConfig = {shape: 'rect', w: 72, h: 57, depth: 7};
export const STANDARD_ROOM_TRAYS: RoomTrays = {dry: STANDARD_TRAY_CONFIG, wet: STANDARD_TRAY_CONFIG};
/** Half extents of a tray in world units. */
export function trayHalfUnits(tray: TrayConfig) { return {x: tray.w / CM_PER_UNIT / 2, z: tray.h / CM_PER_UNIT / 2}; }
/** Scale factor that brings a tray-local point onto the tray outline (<= 1 means inside). Regular octagon: apothem a, corners cut at |x|+|z| = a*sqrt2. */
export function trayOutlineRatio(tray: TrayConfig, x: number, z: number) {
  const {x: hx, z: hz} = trayHalfUnits(tray), ax = Math.abs(x), az = Math.abs(z);
  if (tray.shape === 'circle') return Math.hypot(x, z) / hx;
  if (tray.shape === 'octagon') return Math.max(ax / hx, az / hx, (ax + az) / (hx * Math.SQRT2));
  return Math.max(ax / hx, az / hz);
}
/** True when a tray-local x/z lies on the sand of that tray (server-side check for object positions). The 0.1 % tolerance keeps
 * positions the earlier client clamped to TRAY_HALF_Z (3.96, the standard half-depth 3.9583 rounded up) valid. */
export function insideTray(tray: TrayConfig, x: number, z: number) { return Number.isFinite(x) && Number.isFinite(z) && trayOutlineRatio(tray, x, z) <= 1.001; }
/** Pull a tray-local x/z back onto the tray (client-side clamp while dragging or typing). */
export function clampToTray(tray: TrayConfig, x: number, z: number): [number, number] {
  const ratio = trayOutlineRatio(tray, x, z); return ratio <= 1 ? [x, z] : [x / ratio, z / ratio];
}
export const sandToolSchema = z.enum(['dig','mound','smooth']);
export type SandTool = z.infer<typeof sandToolSchema>;
/** Standard tray heightmap is 144 x 114 cells (2 cells per cm); a stroke point is an integer cell index. */
const cellPoint = z.tuple([z.number().int().min(0).max(239), z.number().int().min(0).max(239)]);
export const transformSchema = z.strictObject({
  position,
  rotation: z.tuple([z.number().min(-1).max(1), z.number().min(-1).max(1), z.number().min(-1).max(1), z.number().min(-1).max(1)]).describe('Unit quaternion x,y,z,w; runtime tolerance 0.0001'),
  scale: z.number().min(0.1).max(5),
});
export type Transform = z.infer<typeof transformSchema>;
export function validTransform(value: unknown): value is Transform {
  const result = transformSchema.safeParse(value);
  return result.success && Math.abs(result.data.rotation.reduce((sum, x) => sum + x*x, 0) - 1) <= 0.0001;
}
export const actionSchema = z.enum(['translate', 'rotate', 'scale', 'animate']);
export type Action = z.infer<typeof actionSchema>;
export const animationSchema = z.strictObject({
  clipId: id, state: z.enum(['playing', 'paused', 'stopped']), serverStartedAt: time,
  offsetMs: time, speed: z.number().min(0.25).max(2), loop: z.boolean(), initiatedBy: id,
  path: z.strictObject({points: z.array(position).min(2).max(64), durationMs: z.number().int().min(100).max(600000)}).optional(),
});
export const sceneObjectSchema = z.strictObject({
  id, assetId: id, assetVersion: id, label: z.string().max(80).optional(),
  transform: transformSchema, materialOverrides: z.record(id, color), colorVariant: colorVariantSchema.optional(), hidden: z.boolean(), revision: counter,
  animation: animationSchema.optional(),
  // REQ-016 C1: the tray the object stands in; absent on objects stored before trays existed, which belong to the dry tray.
  trayId: trayIdSchema.optional(),
});
export const sceneSnapshotV1Schema = z.strictObject({
  schemaVersion: z.literal(1), sceneId: id, sceneRevision: counter,
  objects: z.array(sceneObjectSchema).max(100),
  environment: z.strictObject({sandColor: color, backgroundColor: color}), updatedAt: time,
});
/** Legacy v1 alias retained while Worker persistence and wire negotiation migrate in L07-2B. */
export const sceneSchema = sceneSnapshotV1Schema;
const centimeter = z.number().int().min(30).max(120);
const heightmapSchema = z.strictObject({
  w:z.number().int().min(60).max(240),h:z.number().int().min(60).max(240),
  encoding:z.literal('u8-base64'),data:z.string().max(76800).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).superRefine((map,ctx)=>{
  const expectedBytes=map.w*map.h;
  const padding=map.data.endsWith('==')?2:map.data.endsWith('=')?1:0;
  const decodedBytes=map.data.length===0?0:(map.data.length/4)*3-padding;
  if(decodedBytes!==expectedBytes)ctx.addIssue({code:'custom',message:'Heightmap base64 byte count must match dimensions'});
});
export const traySchema=z.strictObject({
  id,kind:z.enum(['dry','wet']),shape:z.enum(['rect','square','circle','octagon']),
  sizeCm:z.strictObject({w:centimeter,h:centimeter,depth:z.number().int().min(5).max(10)}),
  heightmap:heightmapSchema,waterLevel:z.number().min(0).max(1),baseColor:color,
  // Server tray revision: +1 per accepted sand.stroke / tray.water; clients replay tray.changed only when it is exactly +1.
  revision:counter.optional(),
}).superRefine((tray,ctx)=>{
  if(tray.heightmap.w!==tray.sizeCm.w*2||tray.heightmap.h!==tray.sizeCm.h*2)ctx.addIssue({code:'custom',message:'Heightmap resolution must be two cells per centimeter'});
  if(tray.shape!=='rect'&&tray.sizeCm.w!==tray.sizeCm.h)ctx.addIssue({code:'custom',message:'Square and round trays require equal width and height'});
  if(tray.kind==='dry'&&tray.waterLevel!==0)ctx.addIssue({code:'custom',message:'Dry trays must have waterLevel 0'});
});
export const sceneObjectV2Schema=sceneObjectSchema.extend({trayId:id});
export const sceneSnapshotV2Schema=z.strictObject({
  schemaVersion:z.literal(2),sceneId:id,sceneRevision:counter,
  trays:z.tuple([traySchema,traySchema]),objects:z.array(sceneObjectV2Schema).max(100),
  environment:z.strictObject({sandColor:color,backgroundColor:color}),updatedAt:time,
}).superRefine((scene,ctx)=>{
  const trayIds=new Set(scene.trays.map(tray=>tray.id));
  const kinds=scene.trays.map(tray=>tray.kind);
  const objectIds=new Set(scene.objects.map(object=>object.id));
  if(trayIds.size!==2||new Set(kinds).size!==2||scene.trays[0].kind!=='dry'||scene.trays[1].kind!=='wet')ctx.addIssue({code:'custom',message:'A scene must contain dry-left and wet-right trays with unique ids'});
  if(objectIds.size!==scene.objects.length)ctx.addIssue({code:'custom',message:'Scene object ids must be unique'});
  for(const object of scene.objects)if(!trayIds.has(object.trayId))ctx.addIssue({code:'custom',message:'Unknown trayId: '+object.trayId});
});
export type SceneSnapshotV2=z.infer<typeof sceneSnapshotV2Schema>;
function encodeBase64(bytes:Uint8Array){
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let output='';
  for(let i=0;i<bytes.length;i+=3){
    const a=bytes[i],b=bytes[i+1],c=bytes[i+2];
    output+=alphabet[a>>2]+alphabet[((a&3)<<4)|(b===undefined?0:b>>4)]+(b===undefined?'=':alphabet[((b&15)<<2)|(c===undefined?0:c>>6)])+(c===undefined?'=':alphabet[c&63]);
  }
  return output;
}
/** REQ-016 §3.1: u8 0 = tray floor, 255 = original surface + 3 cm, so the untouched surface of a d-cm tray is round(255*d/(d+3)). */
export function trayInitialSurfaceU8(depthCm:number):number{
  if(!Number.isInteger(depthCm)||depthCm<5||depthCm>10)throw new Error('INVALID_TRAY_DEPTH');
  return Math.round(255*depthCm/(depthCm+3));
}
function defaultTray(kind:'dry'|'wet'){
  const bytes=new Uint8Array(144*114);bytes.fill(trayInitialSurfaceU8(7));
  return {id:kind,kind,shape:'rect' as const,sizeCm:{w:72,h:57,depth:7},heightmap:{w:144,h:114,encoding:'u8-base64' as const,data:encodeBase64(bytes)},waterLevel:0,baseColor:'#1F5F8B'};
}
/** Normalize legacy scene snapshots to v2 using dry/wet standard rectangular trays. */
export function migrateSceneSnapshot(input:unknown):SceneSnapshotV2{
  const current=sceneSnapshotV2Schema.safeParse(input);if(current.success)return current.data;
  const legacy=sceneSnapshotV1Schema.safeParse(input);if(!legacy.success)throw new Error('INVALID_SNAPSHOT');
  return sceneSnapshotV2Schema.parse({
    ...legacy.data,schemaVersion:2,trays:[defaultTray('dry'),defaultTray('wet')],
    objects:legacy.data.objects.map(object=>({...object,trayId:'dry'})),
  });
}
export const grantSchema = z.strictObject({
  grantId: id, roomId: id, sessionEpoch: counter, objectId: id, therapistParticipantId: id,
  actions: z.array(actionSchema).min(1).max(4), issuedAt: time, expiresAt: time,
  grantVersion: counter, status: z.enum(['ACTIVE', 'REVOKED', 'EXPIRED']),
});
export const leaseSchema = z.strictObject({
  leaseId: id, objectId: id, participantId: id, sessionEpoch: counter, controlEpoch: counter,
  fencingToken: counter, expiresAt: time,
});
const base = {protocolVersion: z.literal(1), operationId: id, sessionEpoch: counter, controlEpoch: counter};
const objectBase = {...base, objectId: id};
const fenced = {...objectBase, leaseId: id, fencingToken: counter, grantId: id.optional(), grantVersion: counter.optional()};
const command = <T extends z.ZodRawShape>(type: string, shape: T) => z.strictObject({...base, type: z.literal(type), ...shape});
export const transformCommitSchema = command('object.transform.commit', {...fenced, expectedObjectRevision: counter, transform: transformSchema});
export type TransformCommit = z.infer<typeof transformCommitSchema>;
export const inboundSchemas = {
  'room.hello': command('room.hello', {lastServerSeq: counter}),
  'presence.heartbeat': command('presence.heartbeat', {}),
  'object.create': command('object.create', {objectId: id, assetId: id, assetVersion: id, transform: transformSchema, colorVariant: colorVariantSchema.optional(), trayId: trayIdSchema.optional()}),
  // REQ-016: the server applies the brush with the deterministic sand-engine kernel; radius and strength are fixed server-side.
  // gestureId (2026-09-30): every sand.stroke / tray.water of one drag carries the same id, so undo takes back the whole drag.
  'sand.stroke': command('sand.stroke', {trayId: trayIdSchema, tool: sandToolSchema, points: z.array(cellPoint).min(1).max(8), gestureId: id.optional()}),
  'tray.water': command('tray.water', {trayId: z.literal('wet'), level: z.number().min(0).max(1), gestureId: id.optional()}),
  'object.delete': command('object.delete', {objectId: id, expectedObjectRevision: counter}),
  'object.lock.acquire': command('object.lock.acquire', {objectId: id, actions: z.array(actionSchema).min(1).max(4), grantId: id.optional(), grantVersion: counter.optional()}),
  'object.lock.renew': command('object.lock.renew', fenced),
  'object.lock.release': command('object.lock.release', fenced),
  'object.transform.preview': command('object.transform.preview', {...fenced, transform: transformSchema}),
  'object.transform.commit': transformCommitSchema,
  'object.appearance.commit': command('object.appearance.commit', {...objectBase, expectedObjectRevision: counter, materialOverrides: z.record(id, color), colorVariant: colorVariantSchema.optional(), hidden: z.boolean()}),
  'animation.set': command('animation.set', {...fenced, expectedObjectRevision: counter, clipId: id, state: z.enum(['playing','paused','stopped']), offsetMs: time, speed: z.number().min(0.25).max(2), loop: z.boolean(), path: animationSchema.shape.path}),
  'permission.request': command('permission.request', {objectId: id, actions: z.array(actionSchema).min(1).max(4)}),
  'permission.grant': command('permission.grant', {objectId: id, requestId: id, actions: z.array(actionSchema).min(1).max(4), durationMs: z.number().int().min(1000).max(3600000)}),
  'permission.reject': command('permission.reject', {requestId: id}),
  'permission.revoke': command('permission.revoke', {objectId: id, grantId: id}),
  'control.revokeAll': command('control.revokeAll', {}),
  'animation.stopAll': command('animation.stopAll', {}),
  'scene.undo': command('scene.undo', {expectedSceneRevision: counter}),
  'scene.redo': command('scene.redo', {expectedSceneRevision: counter}),
  'sync.request': command('sync.request', {afterServerSeq: counter}),
};
/** L07-2B C4 (2026-09-30, GPT-6 review F1): a client that understands two trays (snapshot v2) says so explicitly. HTTP requests carry
 * the header; a browser WebSocket cannot set headers, so it offers the subprotocol instead. A request without either is an old
 * single-tray client and gets 426 UPGRADE_REQUIRED before any state is sent or changed. The message envelope stays protocolVersion 1. */
export const PROTOCOL_CAPABILITY_HEADER = 'X-Sandtray-Protocol';
export const PROTOCOL_CAPABILITY = '2';
export const WS_SUBPROTOCOL = 'sandtray.v2';
export function offersWsSubprotocol(headers: Headers) { return (headers.get('Sec-WebSocket-Protocol') ?? '').split(',').some(value => value.trim() === WS_SUBPROTOCOL); }
export function hasV2Capability(headers: Headers) { return headers.get(PROTOCOL_CAPABILITY_HEADER) === PROTOCOL_CAPABILITY || offersWsSubprotocol(headers); }
export const errorCodes = ['UNAUTHENTICATED','ROOM_FULL','ROOM_CLOSED','PERMISSION_DENIED','GRANT_EXPIRED','STALE_EPOCH','LOCKED','STALE_FENCE','REVISION_CONFLICT','INVALID_PAYLOAD','RATE_LIMITED','SAVE_FAILED'] as const;
const out = <T extends z.ZodRawShape>(type: string, shape: T) => z.strictObject({protocolVersion: z.literal(1), type: z.literal(type), sessionEpoch: counter, serverSeq: counter, ...shape});
const member = z.strictObject({participantId: id, role: z.enum(['client','therapist']), online: z.boolean()});
export const outboundSchemas = {
  'room.snapshot': out('room.snapshot', {snapshotPath: z.string().regex(/^\/api\/rooms\/[A-Za-z0-9_-]+\/snapshot$/), controlEpoch: counter}),
  'presence.changed': out('presence.changed', {participants: z.array(member).max(2)}),
  // 2026-09-28 user ruling (AC13): serverMs = Room DO time from frame receipt to ack creation; staging judges ACK latency on it.
  'operation.ack': out('operation.ack', {operationId: id, sceneRevision: counter, objectRevision: counter.optional(), serverMs: z.number().int().nonnegative().optional()}),
  'operation.rejected': out('operation.rejected', {operationId: id, code: z.enum(errorCodes), requestId: id, retryAfterMs: counter.optional()}),
  'object.preview': out('object.preview', {objectId: id, transform: transformSchema, participantId: id, fencingToken: counter}),
  'scene.patch': out('scene.patch', {sceneRevision: counter, upserts: z.array(sceneObjectSchema).max(1), deletedIds: z.array(id).max(1)}),
  'permission.requested': out('permission.requested', {requestId:id,objectId:id,actions:z.array(actionSchema).min(1).max(4),participantId:id}),
  'permission.changed': out('permission.changed', {controlEpoch: counter, grant: grantSchema.nullable()}),
  'lock.changed': out('lock.changed', {objectId: id, lease: leaseSchema.nullable()}),
  'sync.required': out('sync.required', {reason: z.enum(['GAP','NEW_EPOCH','WINDOW_EXCEEDED'])}),
  'room.closed': out('room.closed', {reason: z.enum(['CLOSED','EXPIRED'])}),
  'tray.changed': out('tray.changed', {trayId: trayIdSchema, trayRevision: counter, sceneRevision: counter, operationId: id,
    stroke: z.strictObject({tool: sandToolSchema, points: z.array(cellPoint).min(1).max(8)}).optional(), waterLevel: z.number().min(0).max(1)}),
};
export function parseInbound(raw: string) {
  if (new TextEncoder().encode(raw).length > 16384) throw new Error('INVALID_PAYLOAD');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string' || !Object.hasOwn(inboundSchemas, value.type)) throw new Error('INVALID_PAYLOAD');
  const result = inboundSchemas[value.type as keyof typeof inboundSchemas].parse(value);
  if ('transform' in result && !validTransform(result.transform)) throw new Error('INVALID_PAYLOAD');
  return result;
}

const assetId = z.string().regex(/^ST-(00[1-9]|0[1-9][0-9]|100)$/);
export const assetDraftSchema = z.strictObject({assetId, category: text, nameZhTW: text,
  animationClass: z.enum(['H','M','S']), animationBrief: text, batch: z.enum(['PILOT-10','BATCH']), status: z.literal('PLANNED')});
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const key = z.string().min(1).max(300).regex(/^(published|source|working)\/[A-Za-z0-9_./-]+$/);
export const assetReleaseSchema = z.strictObject({
  assetId, assetVersion: id, status: z.literal('RELEASED'), nameZhTW: text, category: text, tags: z.array(text).max(20),
  animationClass: z.enum(['H','M','S']),
  source: z.strictObject({promptVersion: id, imageHashes: z.array(hash).min(1), canonicalImageHash: hash,
    imageInterface: text, imageModel: text, generatedAt: z.iso.datetime(), reconstructionProvider: text,
    reconstructionVersion: text, termsReviewId: id}),
  outputs: z.strictObject({glbKey: key, glbSha256: hash, lodKeys: z.array(key).min(1), thumbnailKey: key, sourceBlendKey: key}),
  metrics: z.strictObject({triangles: z.number().int().min(4).max(30000), drawCalls: z.number().int().min(1).max(10),
    transferBytes: z.number().int().positive().max(5000000), textureBytes: counter}),
  defaultScale: z.number().min(0.1).max(5), bounds: z.tuple([z.number().positive(),z.number().positive(),z.number().positive()]),
  editableMaterials: z.array(id).max(3),
  clips: z.array(z.strictObject({id, durationMs: z.number().positive().max(600000), loop: z.boolean()})),
  license: z.strictObject({licenseSource: text, licenseText: z.string().min(1).max(10000), attribution: z.string().max(1000), webDistributionAllowed: z.literal(true)}),
  qa: z.strictObject({checks: z.array(z.enum(['AS01','AS02','AS03','AS04','AS05','AS06','AS07','AS08'])).length(8), reviewer: text, reviewedAt: z.iso.datetime(), reportKey: key}),
});
export function validateRelease(value: unknown) {
  const asset = assetReleaseSchema.parse(value);
  if (new Set(asset.qa.checks).size !== 8 || !asset.source.imageHashes.includes(asset.source.canonicalImageHash)) throw new Error('Incomplete QA/provenance');
  const prefix = `published/${asset.assetId}/${asset.assetVersion}/`;
  if (asset.outputs.glbKey !== `${prefix}${asset.outputs.glbSha256}.glb` || [...asset.outputs.lodKeys, asset.outputs.thumbnailKey].some(k=>!k.startsWith(prefix) || k.includes('..'))) throw new Error('Immutable asset path required');
  const clips = new Set(asset.clips.map(c=>c.id));
  if (clips.size !== asset.clips.length || (asset.animationClass==='H' && ['idle','walk','wave'].some(c=>!clips.has(c))) || (asset.animationClass==='M' && !clips.size)) throw new Error('Animation requirements missing');
  return asset;
}


// HTTP version restore is revision/epoch fenced; it never imports authority from a snapshot.
export const restoreVersionSchema=z.strictObject({expectedSceneRevision:counter,sessionEpoch:counter,controlEpoch:counter});
export type RestoreVersionInput=z.infer<typeof restoreVersionSchema>;
export const inviteInspectSchema=z.strictObject({token:z.string().min(22).max(256)});
// V8-L09-5a (2026-09-26, user ruling L01-6: no client personal data): the UI no longer asks for a nickname and the Worker never read it.
// Kept optional only so already-cached clients that still send one are not locked out; the value is discarded unread.
export const inviteRedeemSchema=inviteInspectSchema.extend({nickname:z.string().min(1).max(80).optional(),acceptedPolicyVersion:id.optional()});