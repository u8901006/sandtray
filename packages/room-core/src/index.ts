import { transformCommitSchema, validTransform, insideTray, STANDARD_TRAY_CONFIG, type Transform, type TransformCommit, type Action, type RoomTrays, type TrayId } from '../../protocol/src/index';
export interface Participant {id:string; clinicId:string; role:'client'|'therapist'; sessionEpoch:number; admitted:boolean}
export interface Grant {id:string; objectId:string; participantId:string; actions:Action[]; version:number; sessionEpoch:number; expiresAt:number; active:boolean}
export interface Lease {id:string; participantId:string; fence:number; expiresAt:number; sessionEpoch:number; controlEpoch:number}
export interface RoomState {
  roomId:string; clinicId:string; sessionEpoch:number; controlEpoch:number; status:'ACTIVE'|'CLOSED';
  clientLiveUntil:number; writerLeaseUntil:number; sceneRevision:number;
  participants:Record<string,Participant>; objects:Record<string,{transform:Transform;revision:number;trayId?:TrayId}>;
  /** REQ-016 A6: tray shapes/sizes chosen at room creation; absent = both standard 72 x 57 x 7 cm. */
  trays?:RoomTrays;
  grants:Record<string,Grant>; leases:Record<string,Lease>; nextFence:number;
}
// Only the adapter may supply connection identity, after authentication.
export interface Connection {participantId:string; clinicId:string; sessionEpoch:number}
export class Rejected extends Error {constructor(public code:string,public retryAfterMs?:number){super(code);}}
const deny=(code:string):never=>{throw new Rejected(code);};
/** REQ-016 A6: an object must stand on the sand of its own tray (rect / square / circle / octagon outline). */
export function objectInTray(state:Pick<RoomState,'trays'>,trayId:TrayId|undefined,position:readonly number[]){return insideTray(state.trays?.[trayId??'dry']??STANDARD_TRAY_CONFIG,position[0],position[2]);}
function member(state:RoomState, connection:Connection) {
  if(state.status!=='ACTIVE') deny('ROOM_CLOSED');
  const participant=Object.hasOwn(state.participants,connection.participantId)?state.participants[connection.participantId]:undefined;
  if(!participant?.admitted || participant.clinicId!==state.clinicId || connection.clinicId!==state.clinicId) return deny('UNAUTHENTICATED');
  if(connection.sessionEpoch!==state.sessionEpoch || participant.sessionEpoch!==state.sessionEpoch) deny('STALE_EPOCH');
  return participant;
}
function grantFor(state:RoomState, participant:Participant, objectId:string, grantId:string|undefined, version:number|undefined, actions:Action[], now:number) {
  if(participant.role==='client') return;
  if(state.clientLiveUntil<=now) deny('GRANT_EXPIRED');
  const grant=grantId && Object.hasOwn(state.grants,grantId)?state.grants[grantId]:undefined;
  if(!grant?.active || grant.objectId!==objectId || grant.participantId!==participant.id || grant.version!==version || grant.sessionEpoch!==state.sessionEpoch) deny('PERMISSION_DENIED');
  if(grant!.expiresAt<=now) deny('GRANT_EXPIRED');
  if(actions.some(action=>!grant!.actions.includes(action))) deny('PERMISSION_DENIED');
}
export function authorizeTransform(state:RoomState, connection:Connection, input:unknown, now:number):TransformCommit {
  const parsed=transformCommitSchema.safeParse(input);
  if(!Number.isFinite(now)||!parsed.success||!validTransform(parsed.data.transform)) return deny('INVALID_PAYLOAD');
  const cmd=parsed.data; const participant=member(state,connection);
  if(cmd.sessionEpoch!==state.sessionEpoch || cmd.controlEpoch!==state.controlEpoch) deny('STALE_EPOCH');
  if(state.writerLeaseUntil<=now) deny('STALE_FENCE');
  const object=Object.hasOwn(state.objects,cmd.objectId)?state.objects[cmd.objectId]:undefined;
  if(!object) return deny('PERMISSION_DENIED');
  if(!objectInTray(state,object.trayId,cmd.transform.position)) deny('INVALID_PAYLOAD');
  const actions:Action[]=[];
  if(object.transform.position.some((v,i)=>v!==cmd.transform.position[i])) actions.push('translate');
  if(object.transform.rotation.some((v,i)=>v!==cmd.transform.rotation[i])) actions.push('rotate');
  if(object.transform.scale!==cmd.transform.scale) actions.push('scale');
  grantFor(state,participant,cmd.objectId,cmd.grantId,cmd.grantVersion,actions,now);
  const lease=state.leases[cmd.objectId];
  if(!lease || lease.participantId!==participant.id || lease.id!==cmd.leaseId || lease.expiresAt<=now) deny('LOCKED');
  if(lease.fence!==cmd.fencingToken || lease.sessionEpoch!==state.sessionEpoch || lease.controlEpoch!==state.controlEpoch) deny('STALE_FENCE');
  if(object.revision!==cmd.expectedObjectRevision) deny('REVISION_CONFLICT');
  return cmd;
}
// Pure candidate reducer. This is NOT a durable ACK: T04 must persist in a transaction first.
export function reduceTransform(state:RoomState,connection:Connection,input:unknown,now:number):RoomState {
  const cmd=authorizeTransform(state,connection,input,now);
  const next=structuredClone(state);
  next.objects[cmd.objectId]={...next.objects[cmd.objectId],transform:structuredClone(cmd.transform),revision:state.objects[cmd.objectId].revision+1};
  next.sceneRevision++;
  return next;
}
export function acquireLease(state:RoomState,connection:Connection,objectId:string,actions:Action[],now:number,leaseId:string,grantId?:string,grantVersion?:number):RoomState {
  const participant=member(state,connection);
  if(!Number.isFinite(now)||!actions.length||actions.some(a=>!['translate','rotate','scale','animate'].includes(a))) deny('INVALID_PAYLOAD');
  if(!Object.hasOwn(state.objects,objectId)) deny('PERMISSION_DENIED');
  if(state.writerLeaseUntil<=now) deny('STALE_FENCE');
  grantFor(state,participant,objectId,grantId,grantVersion,actions,now);
  if(state.leases[objectId]?.expiresAt>now) deny('LOCKED');
  const next=structuredClone(state);
  next.leases[objectId]={id:leaseId,participantId:participant.id,fence:++next.nextFence,
    expiresAt:Math.min(now+15000,state.writerLeaseUntil,participant.role==='therapist'?state.clientLiveUntil:Infinity),
    sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch};
  return next;
}
export function revokeAll(state:RoomState,connection:Connection):RoomState {
  if(member(state,connection).role!=='client') deny('PERMISSION_DENIED');
  const next=structuredClone(state); next.controlEpoch++; next.leases={};
  for(const grant of Object.values(next.grants)){grant.active=false;grant.version++;}
  return next;
}
// C55 (2026-09-21): clientLiveUntil is evidence about the CLIENT's presence (master-plan: 案主在場 lease 15 秒, refreshed by
// the client's heartbeat). Only the client's own socket lifecycle may move it: connect/heartbeat re-arm it, disconnect ends
// it. A therapist's socket attaching or leaving must neither shorten it (the ui.spec GRANT_EXPIRED flake) nor extend it.
export const CLIENT_PRESENCE_MS=15000;
export function clientPresence(current:number,role:'client'|'therapist',event:'connect'|'heartbeat'|'disconnect',now:number):number {
  if(role!=='client') return current;
  return event==='disconnect'?0:now+CLIENT_PRESENCE_MS;
}
// Adapter calls after verified reconnect; no payload can invoke this server transition.
export function resetSession(state:RoomState):RoomState {
  const next=structuredClone(state);next.sessionEpoch++;next.controlEpoch++;next.grants={};next.leases={};next.clientLiveUntil=0;
  for(const p of Object.values(next.participants)){p.admitted=false;}
  return next;
}

