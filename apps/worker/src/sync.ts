import {AdmissionRoom,type RoomRecord} from './room';
import type {Env,Identity} from './env';
import {json,error,isInputError} from './http';
import {parseInbound,validTransform,hasV2Capability,offersWsSubprotocol,WS_SUBPROTOCOL,type Action} from '../../../packages/protocol/src/index';
import {acquireLease,reduceTransform,authorizeTransform,revokeAll,clientPresence,Rejected,type Connection} from '../../../packages/room-core/src/index';
import {issueGrant,revokeGrant} from '../../../packages/room-core/src/grant-lifecycle';
import {pathPosition} from '../../../packages/room-core/src/animation';
import {devAssets,validAssetVersion,clipDuration,supportsColorVariants} from '../../../packages/asset-catalog/src/index';
import {parseInboundFrame,recoverRejectedOperationId,type FrameBudget} from './ws-frame-budget';
import {TRAYS_TABLE,TRAY_HISTORY_TABLE,readTrays,writeTray,strokeTray,quantizeWater,recordTrayStep,trayStepStates,type TrayRow} from './trays';
import {bytesToBase64,base64ToBytes} from '../../../packages/sand-engine/src/core';
import {objectInTray} from '../../../packages/room-core/src/index';
// Receipt lookup is by (actor,op) across epochs (retry after reconnect); the PK (actor,epoch,op) cannot serve it. Created in the constructor and after purge.
const OPERATIONS_LOOKUP_INDEX='CREATE INDEX IF NOT EXISTS operations_actor_op ON operations(actor,op,epoch)';
interface Attachment extends FrameBudget {hash:string;identity:Identity;connectionId:string;epoch:number}
interface PendingRequest {objectId:string;participantId:string;actions:Action[];expiresAt:number}
// historyGesture: actor+tray+gestureId of the sand/water drag recorded at historyCursor; later strokes of the same drag extend that step.
interface SharedState extends RoomRecord {requests?:Record<string,PendingRequest>;historyCursor?:number;historyGesture?:string;animationDeadlines?:Record<string,number>}
export class RoomDurableObject extends AdmissionRoom {
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS operations (actor TEXT NOT NULL, epoch INTEGER NOT NULL, op TEXT NOT NULL, command TEXT NOT NULL, ack TEXT NOT NULL, PRIMARY KEY(actor,epoch,op))');ctx.storage.sql.exec(OPERATIONS_LOOKUP_INDEX);ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS history (step INTEGER PRIMARY KEY, before_state TEXT NOT NULL, after_state TEXT NOT NULL)');ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room_cleanup (room_id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL, scene_id TEXT NOT NULL, next_at INTEGER NOT NULL)');}
 private stopAnimations(s:RoomRecord,predicate:(o:RoomRecord['objects'][string])=>boolean,now:number){let changed=false;for(const o of Object.values(s.objects)){const a=o.animation;if(!a||a.state!=='playing'||!predicate(o))continue;const at=s.participants[a.initiatedBy]?.role==='therapist'?Math.max(a.serverStartedAt,Math.min(now,s.clientLiveUntil,(s as SharedState).animationDeadlines?.[o.id]??now)):now;const position=pathPosition(a,at);if(position)o.transform.position=position;a.offsetMs+=Math.max(0,at-a.serverStartedAt)*a.speed;a.state='stopped';o.revision++;changed=true;}if(changed)s.sceneRevision++;return changed;}
 private enforceAnimations(s:RoomRecord,now:number){return this.stopAnimations(s,o=>{const a=o.animation!;const grant=Object.values(s.grants).find(g=>g.active&&g.objectId===o.id&&g.participantId===a.initiatedBy&&g.actions.includes('animate'));return (!a.loop&&(a.path?.durationMs??clipDuration(o.assetId,a.clipId,o.assetVersion))!==undefined&&a.offsetMs+Math.max(0,now-a.serverStartedAt)*a.speed>=(a.path?.durationMs??clipDuration(o.assetId,a.clipId,o.assetVersion)!))||(s.participants[a.initiatedBy]?.role==='therapist'&&(!grant||grant.expiresAt<=now||s.clientLiveUntil<=now));},now);}
 protected async schedule(s:RoomRecord){const now=Date.now();let at=Math.min(s.lastActivity+7200000,this.cleanupDue());for(const o of Object.values(s.objects)){const a=o.animation;if(a?.state!=='playing')continue;const duration=a.path?.durationMs??clipDuration(o.assetId,a.clipId,o.assetVersion);if(!a.loop&&duration!==undefined)at=Math.min(at,a.serverStartedAt+(duration-a.offsetMs)/a.speed);if(s.participants[a.initiatedBy]?.role==='therapist'){at=Math.min(at,s.clientLiveUntil);for(const g of Object.values(s.grants))if(g.active&&g.objectId===o.id&&g.participantId===a.initiatedBy)at=Math.min(at,g.expiresAt);}}await this.ctx.storage.setAlarm(Math.max(now+1,at));}
 private message(s:RoomRecord,type:string,fields:Record<string,unknown>={}){return {protocolVersion:1,type,sessionEpoch:s.sessionEpoch,serverSeq:s.serverSeq,...fields};}
 private broadcast(value:unknown){const text=JSON.stringify(value);for(const ws of this.ctx.getWebSockets()){try{ws.send(text);}catch{/* closed transport; close callback clears authority */}}}
 private snapshotEvent(s:RoomRecord){return this.message(s,'room.snapshot',{snapshotPath:`/api/rooms/${s.roomId}/snapshot`,controlEpoch:s.controlEpoch});}
 private grantEvent(s:RoomRecord,grantId:string){const g=s.grants[grantId];return this.message(s,'permission.changed',{controlEpoch:s.controlEpoch,grant:{grantId:g.id,roomId:s.roomId,sessionEpoch:g.sessionEpoch,objectId:g.objectId,therapistParticipantId:g.participantId,actions:g.actions,issuedAt:0,expiresAt:g.expiresAt,grantVersion:g.version,status:g.active?'ACTIVE':'REVOKED'}});}
 private lockEvent(s:RoomRecord,objectId:string){const l=s.leases[objectId];return this.message(s,'lock.changed',{objectId,lease:l?{leaseId:l.id,objectId,participantId:l.participantId,sessionEpoch:l.sessionEpoch,controlEpoch:l.controlEpoch,fencingToken:l.fence,expiresAt:l.expiresAt}:null});}
 async fetch(request:Request):Promise<Response>{
  try{
   const hash=request.headers.get('X-Session-Hash');if(!hash)return error();
   // L07-2B C4: checked again before any state change; the Worker route already refuses old clients.
   if(!hasV2Capability(request.headers))return error('UPGRADE_REQUIRED',426);
   const identity=await this.env.AUTH_DO.getByName('sessions').lookup(hash);if(!identity)return error();
   const room=this.read();if(!await this.env.AUTH_DO.getByName('sessions').attachRoom(hash,room.roomId))return error();
   const s=this.read();this.member(s,identity);const oldId=s.connections[identity.participantId];
   const oldSocket=this.ctx.getWebSockets().find(ws=>(ws.deserializeAttachment() as Attachment)?.connectionId===oldId);
   if(oldSocket&&new URL(request.url).searchParams.get('takeover')!=='1')return error('ROOM_FULL',409);
   this.stopAnimations(s,()=>true,Date.now());delete s.exportConsent;s.sessionEpoch++;s.controlEpoch++;s.grants={};s.leases={};(s as SharedState).requests={};s.serverSeq++;s.lastActivity=Date.now();
   // C55 (2026-09-21): presence belongs to the client only (room-core clientPresence) — a therapist socket attaching
   // used to zero it and make grants issued before the client's next heartbeat fail with GRANT_EXPIRED (the ui.spec flake).
   // Grants/leases/epochs are still reset above for every connect.
   for(const p of Object.values(s.participants))p.sessionEpoch=s.sessionEpoch;
   const pair=new WebSocketPair();const connectionId=crypto.randomUUID();s.connections[identity.participantId]=connectionId;
   s.clientLiveUntil=clientPresence(s.clientLiveUntil,identity.role,'connect',Date.now());
   this.save(s);this.ctx.acceptWebSocket(pair[1]);
   pair[1].serializeAttachment({hash,identity,connectionId,epoch:s.sessionEpoch,window:Date.now(),normal:0,priority:0,commits:0,previews:0,invalidFrames:0} satisfies Attachment);
   for(const ws of this.ctx.getWebSockets()){if(ws===oldSocket)continue;const a=ws.deserializeAttachment() as Attachment;a.epoch=s.sessionEpoch;ws.serializeAttachment(a);}
   if(oldSocket)oldSocket.close(4001,'SEAT_TAKEN_OVER');
   this.broadcast(this.snapshotEvent(s));await this.schedule(s);return new Response(null,{status:101,webSocket:pair[0],...(offersWsSubprotocol(request.headers)?{headers:{'Sec-WebSocket-Protocol':WS_SUBPROTOCOL}}:{})});
  }catch{return error('PERMISSION_DENIED',403);}
 }
 async webSocketMessage(ws:WebSocket,raw:string|ArrayBuffer){
  let cmd:any;let s:SharedState|undefined;let a:Attachment|undefined;const receivedAt=Date.now();let acked=false;
  try{
   a=ws.deserializeAttachment() as Attachment;cmd=parseInboundFrame(raw,a,Date.now(),parseInbound);const now=Date.now();
   const priority=cmd.type==='control.revokeAll'||cmd.type==='permission.revoke'||cmd.type==='animation.stopAll';
   let limited=priority?++a.priority>10:++a.normal>60;
   if(cmd.type==='object.transform.preview')limited=++a.previews>15||limited;
   if(['object.create','object.delete','object.transform.commit','object.appearance.commit','animation.set','sand.stroke','tray.water'].includes(cmd.type))limited=++a.commits>10||limited;
   ws.serializeAttachment(a);if(limited)throw new Rejected('RATE_LIMITED',Math.max(1,a.window+1000-now));
   const identity=await this.env.AUTH_DO.getByName('sessions').lookup(a.hash);if(!identity){ws.close(4003,'UNAUTHENTICATED');throw new Rejected('UNAUTHENTICATED');}
   await this.assertAvailable();s=this.read();this.member(s,identity);
   if(s.connections[identity.participantId]!==a.connectionId)throw new Rejected('STALE_EPOCH');
   if(a.epoch!==s.sessionEpoch)throw new Rejected('STALE_EPOCH');
   // A retry reads an existing durable receipt; it never restores authority or applies a mutation.
   // Scope receipts to the authenticated actor across reconnect epochs, before command epoch checks.
   const prior=this.ctx.storage.sql.exec<{command:string;ack:string}>('SELECT command,ack FROM operations WHERE actor=? AND op=? ORDER BY epoch LIMIT 1',identity.participantId,cmd.operationId).toArray()[0];
   if(prior){if(prior.command!==JSON.stringify(cmd))throw new Rejected('INVALID_PAYLOAD');ws.send(prior.ack);return;}
   if(cmd.sessionEpoch!==s.sessionEpoch||cmd.controlEpoch!==s.controlEpoch)throw new Rejected('STALE_EPOCH');
   if(s.writerLeaseUntil<=now+5000){const writer=await this.env.SCENE_COORDINATOR_DO.getByName(s.clinicId+':'+s.sceneId).claim(s.roomId);s=this.read();if(a.epoch!==s.sessionEpoch||s.connections[identity.participantId]!==a.connectionId||cmd.controlEpoch!==s.controlEpoch)throw new Rejected('STALE_EPOCH');s.writerLeaseUntil=writer.expiresAt;}
   // No await between authorization, candidate mutation and the SQLite transaction.
   const connection:Connection={participantId:identity.participantId,clinicId:identity.clinicId,sessionEpoch:s.sessionEpoch};
   if(s.clientLiveUntil<=Date.now()&&Object.values(s.grants).some(g=>g.active)){for(const g of Object.values(s.grants)){g.active=false;g.version++;}s.leases={};this.save(s);this.broadcast(this.message(s,'permission.changed',{controlEpoch:s.controlEpoch,grant:null}));}
   if(this.enforceAnimations(s,Date.now())){this.save(s);this.broadcast(this.snapshotEvent(s));}
   const beforeObjects=JSON.stringify(s.objects);const events:unknown[]=[];let changed=false;let ephemeral=false;let historyMove=false;let trayWrite:TrayRow|undefined;let trayHistory:{before:{data:string;water:number};gesture?:string}|undefined;const restoredTrays:TrayRow[]=[];
   const client=()=>{if(identity.role!=='client')throw new Rejected('PERMISSION_DENIED');};
   const object=()=>{if(!Object.hasOwn(s!.objects,cmd.objectId))throw new Rejected('PERMISSION_DENIED');return s!.objects[cmd.objectId];};
   const revision=()=>{if(object().revision!==cmd.expectedObjectRevision)throw new Rejected('REVISION_CONFLICT');};
   switch(cmd.type){
    case 'room.hello':case 'sync.request':events.push(this.snapshotEvent(s));ephemeral=true;break;
    case 'presence.heartbeat':s.clientLiveUntil=clientPresence(s.clientLiveUntil,identity.role,'heartbeat',Date.now());ephemeral=true;break;
    case 'scene.undo':case 'scene.redo':{
     client();if(cmd.expectedSceneRevision!==s.sceneRevision)throw new Rejected('REVISION_CONFLICT');
     const cursor=s.historyCursor??0;const step=cmd.type==='scene.undo'?cursor:cursor+1;
     const row=this.ctx.storage.sql.exec<{before_state:string;after_state:string}>('SELECT before_state,after_state FROM history WHERE step=?',step).toArray()[0];if(!row)throw new Rejected('REVISION_CONFLICT');
     const restored=JSON.parse(cmd.type==='scene.undo'?row.before_state:row.after_state) as RoomRecord['objects'];
     for(const object of Object.values(restored)){object.revision=(s.objects[object.id]?.revision??object.revision)+1;if(object.animation)object.animation.state='stopped';}
     // REQ-016 (2026-09-30): a step that changed sand or water puts those trays back too; each gets a new tray revision and the
     // room.snapshot below makes every client adopt it (TrayModel.adopt accepts only a revision >= its own).
     const current=readTrays(this.ctx.storage.sql,s.trays);
     for(const state of trayStepStates(this.ctx.storage.sql,step,cmd.type==='scene.undo'?'before':'after')){const tray=current.find(t=>t.id===state.id);if(!tray)continue;tray.hm.data.set(base64ToBytes(state.data));tray.water=state.water;tray.revision++;restoredTrays.push(tray);}
     s.objects=restored;s.historyCursor=cmd.type==='scene.undo'?cursor-1:cursor+1;delete s.historyGesture;s.grants={};s.leases={};s.controlEpoch++;s.requests={};changed=true;historyMove=true;events.push(this.snapshotEvent(s));break;
    }
    case 'object.create':{
     client();if(Object.hasOwn(s.objects,cmd.objectId)||Object.keys(s.objects).length>=100)throw new Rejected('INVALID_PAYLOAD');
     if(!objectInTray(s,cmd.trayId,cmd.transform.position))throw new Rejected('INVALID_PAYLOAD');
     if(!validAssetVersion(cmd.assetId,cmd.assetVersion))throw new Rejected('INVALID_PAYLOAD');
     if(['__proto__','constructor','prototype'].includes(cmd.objectId))throw new Rejected('INVALID_PAYLOAD');
     if(cmd.colorVariant!==undefined&&!supportsColorVariants(cmd.assetId,cmd.assetVersion))throw new Rejected('INVALID_PAYLOAD');
     const colorVariant=cmd.colorVariant??(supportsColorVariants(cmd.assetId,cmd.assetVersion)?'t2':undefined);
     s.objects[cmd.objectId]={id:cmd.objectId,assetId:cmd.assetId,assetVersion:cmd.assetVersion,transform:cmd.transform,materialOverrides:{},...(colorVariant?{colorVariant}:{}),hidden:false,revision:0,trayId:cmd.trayId??'dry'};changed=true;break;
    }
    case 'object.delete':client();revision();delete s.objects[cmd.objectId];delete s.leases[cmd.objectId];for(const g of Object.values(s.grants)){if(g.objectId===cmd.objectId){g.active=false;g.version++;}}changed=true;break;
    case 'object.transform.commit':s=reduceTransform(s,connection,cmd,Date.now()) as SharedState;if(s.objects[cmd.objectId].animation)s.objects[cmd.objectId].animation!.state='stopped';changed=true;break;
    case 'object.appearance.commit':{
     client();const o=object();revision();
     if(cmd.colorVariant!==undefined&&!supportsColorVariants(o.assetId,o.assetVersion))throw new Rejected('INVALID_PAYLOAD');
     const nextVariant=cmd.colorVariant??o.colorVariant;
     // REQ-019 owns only colorVariant. The protocol keeps the legacy appearance
     // fields for compatibility, but this path must not become a client-side
     // write primitive for arbitrary materialOverrides/hidden values.
     const overridesChanged=JSON.stringify(o.materialOverrides??{})!==JSON.stringify(cmd.materialOverrides);
     const hiddenChanged=o.hidden!==cmd.hidden;
     if(overridesChanged||hiddenChanged)throw new Rejected('INVALID_PAYLOAD');
     if(o.colorVariant!==nextVariant){if(nextVariant===undefined)delete o.colorVariant;else o.colorVariant=nextVariant;o.revision++;changed=true;}
     break;
    }
    case 'object.transform.preview':{
     const candidate={...cmd,type:'object.transform.commit',expectedObjectRevision:object().revision};authorizeTransform(s,connection,candidate,Date.now());
     this.broadcast(this.message(s,'object.preview',{objectId:cmd.objectId,transform:cmd.transform,participantId:identity.participantId,fencingToken:cmd.fencingToken}));return;
    }
    case 'object.lock.acquire':{
     object();if(identity.role==='client'&&s.leases[cmd.objectId]?.participantId!==identity.participantId){for(const g of Object.values(s.grants)){if(g.objectId===cmd.objectId&&g.active){this.stopAnimations(s,o=>o.id===cmd.objectId&&o.animation?.initiatedBy===g.participantId,Date.now());s=revokeGrant(s,connection,cmd.objectId,g.id) as SharedState;events.push(this.grantEvent(s,g.id));}}}
     s=acquireLease(s,connection,cmd.objectId,cmd.actions,Date.now(),crypto.randomUUID(),cmd.grantId,cmd.grantVersion) as SharedState;
     s.leases[cmd.objectId].expiresAt=Math.min(s.leases[cmd.objectId].expiresAt,Date.now()+3000);events.push(this.lockEvent(s,cmd.objectId));break;
    }
    case 'object.lock.release':case 'object.lock.renew':{
     const l=s.leases[cmd.objectId];if(!l||l.id!==cmd.leaseId||l.participantId!==identity.participantId||l.fence!==cmd.fencingToken||l.expiresAt<=Date.now())throw new Rejected('STALE_FENCE');
     if(cmd.type==='object.lock.release')delete s.leases[cmd.objectId];else {authorizeTransform(s,connection,{...cmd,type:'object.transform.commit',expectedObjectRevision:object().revision,transform:object().transform},Date.now());l.expiresAt=Math.min(Date.now()+3000,s.writerLeaseUntil,identity.role==='therapist'?s.clientLiveUntil:Infinity);}
     events.push(this.lockEvent(s,cmd.objectId));break;
    }
    case 'animation.set':{
     const o=object();revision();authorizeTransform(s,connection,{protocolVersion:1,type:'object.transform.commit',operationId:cmd.operationId,sessionEpoch:cmd.sessionEpoch,controlEpoch:cmd.controlEpoch,objectId:cmd.objectId,leaseId:cmd.leaseId,fencingToken:cmd.fencingToken,grantId:cmd.grantId,grantVersion:cmd.grantVersion,expectedObjectRevision:o.revision,transform:o.transform},Date.now());
     if(identity.role==='therapist'&&!s.grants[cmd.grantId]?.actions.includes('animate'))throw new Rejected('PERMISSION_DENIED');
     if(cmd.clipId==='path'?!cmd.path:(!clipDuration(o.assetId,cmd.clipId,o.assetVersion)||cmd.path!==undefined))throw new Rejected('INVALID_PAYLOAD');
     if(cmd.path?.points.some((point:number[])=>!objectInTray(s!,o.trayId,point)))throw new Rejected('INVALID_PAYLOAD');
     if(cmd.state==='playing'&&o.animation?.state!=='playing'&&Object.values(s.objects).filter(o=>o.animation?.state==='playing').length>=5)throw new Rejected('RATE_LIMITED');
     s.animationDeadlines??={};s.animationDeadlines[o.id]=identity.role==='therapist'?s.grants[cmd.grantId].expiresAt:Number.MAX_SAFE_INTEGER;
     o.animation={clipId:cmd.clipId,state:cmd.state,serverStartedAt:Date.now(),offsetMs:cmd.offsetMs,speed:cmd.speed,loop:cmd.loop,initiatedBy:identity.participantId,path:cmd.path};o.revision++;changed=true;break;
    }
    case 'sand.stroke':case 'tray.water':{
     // User ruling 2026-09-30 (supersedes REQ-016 A4 for trays): only the client changes sand or water. A therapist is always
     // refused, with or without any object grant, and the heightmap, water, history and revisions stay unchanged.
     client();
     const tray=readTrays(this.ctx.storage.sql,s.trays).find(t=>t.id===cmd.trayId)!;
     trayHistory={before:{data:bytesToBase64(tray.hm.data),water:tray.water},...(cmd.gestureId?{gesture:identity.participantId+':'+tray.id+':'+cmd.type+':'+cmd.gestureId}:{})};
     if(cmd.type==='tray.water'){const level=quantizeWater(cmd.level);if(level===tray.water)throw new Rejected('INVALID_PAYLOAD');tray.water=level;}
     else {if(cmd.points.some(([i,j]:[number,number])=>i>=tray.hm.w||j>=tray.hm.h||!tray.hm.mask[j*tray.hm.w+i]))throw new Rejected('INVALID_PAYLOAD');strokeTray(tray.hm,cmd.tool,cmd.points);}
     tray.revision++;s.sceneRevision++;trayWrite=tray;
     events.push(this.message(s,'tray.changed',{trayId:tray.id,trayRevision:tray.revision,sceneRevision:s.sceneRevision,operationId:cmd.operationId,...(cmd.type==='sand.stroke'?{stroke:{tool:cmd.tool,points:cmd.points}}:{}),waterLevel:tray.water}));break;
    }
    case 'animation.stopAll':client();this.stopAnimations(s,()=>true,Date.now());s.controlEpoch++;s.leases={};events.push(this.snapshotEvent(s));break;
    case 'permission.request':{
     if(identity.role!=='therapist')throw new Rejected('PERMISSION_DENIED');object();s.requests??={};if(Object.keys(s.requests).length>=100)throw new Rejected('RATE_LIMITED');
     if(['__proto__','constructor','prototype'].includes(cmd.operationId))throw new Rejected('INVALID_PAYLOAD');
     s.requests[cmd.operationId]={objectId:cmd.objectId,participantId:identity.participantId,actions:cmd.actions,expiresAt:Date.now()+300000};
     events.push(this.message(s,'permission.requested',{requestId:cmd.operationId,objectId:cmd.objectId,actions:cmd.actions,participantId:identity.participantId}));break;
    }
    case 'permission.grant':{
     client();const r=s.requests&&Object.hasOwn(s.requests,cmd.requestId)?s.requests[cmd.requestId]:undefined;if(!r||r.objectId!==cmd.objectId||r.expiresAt<=Date.now()||cmd.actions.some((a:Action)=>!r.actions.includes(a)))throw new Rejected('PERMISSION_DENIED');
     const grantId=crypto.randomUUID();this.stopAnimations(s,o=>o.id===r.objectId&&o.animation?.initiatedBy===r.participantId,Date.now());s=issueGrant(s,connection,{objectId:r.objectId,participantId:r.participantId,actions:cmd.actions,durationMs:cmd.durationMs},Date.now(),grantId) as SharedState;delete s.requests![cmd.requestId];events.push(this.grantEvent(s,grantId));break;
    }
    case 'permission.reject':client();if(s.requests)delete s.requests[cmd.requestId];break;
    case 'permission.revoke':client();this.stopAnimations(s,o=>o.id===cmd.objectId&&o.animation?.initiatedBy!==identity.participantId,Date.now());s=revokeGrant(s,connection,cmd.objectId,cmd.grantId) as SharedState;events.push(this.grantEvent(s,cmd.grantId),this.lockEvent(s,cmd.objectId));break;
    case 'control.revokeAll':client();this.stopAnimations(s,o=>o.animation?.initiatedBy!==identity.participantId,Date.now());s=revokeAll(s,connection) as SharedState;s.requests={};events.push(this.message(s,'permission.changed',{controlEpoch:s.controlEpoch,grant:null}));break;
    default:throw new Rejected('INVALID_PAYLOAD');
   }
   if(changed&&cmd.type!=='object.transform.commit')s.sceneRevision++;
   // V8-L02-6 (2026-09-26, user ruling L01-7): the room expires after two hours with no *operation*. heartbeat, room.hello
   // and sync.request only prove a tab is open, so they must not extend lastActivity; every other accepted command does.
   s.serverSeq++;if(!ephemeral)s.lastActivity=Date.now();
   if(changed)events.push(this.message(s,'scene.patch',{sceneRevision:s.sceneRevision,upserts:s.objects[cmd.objectId]?[s.objects[cmd.objectId]]:[],deletedIds:cmd.type==='object.delete'?[cmd.objectId]:[]}));
   // serverMs (AC13 ruling 2026-09-28): includes the AUTH_DO lookup RPC; excludes the output-gate durability wait below.
   const ack=this.message(s,'operation.ack',{operationId:cmd.operationId,sceneRevision:s.sceneRevision,...(cmd.objectId&&s.objects[cmd.objectId]?{objectRevision:s.objects[cmd.objectId].revision}:{}),serverMs:Math.max(0,Date.now()-receivedAt)});
   const committed=s;this.ctx.storage.transactionSync(()=>{
    const sql=this.ctx.storage.sql;
    const newStep=(objectsBefore:string)=>{const step=(committed.historyCursor??0)+1;for(const table of ['history','tray_history'])sql.exec(`DELETE FROM ${table} WHERE step>=?`,step);sql.exec('INSERT INTO history VALUES(?,?,?)',step,objectsBefore,JSON.stringify(committed.objects));committed.historyCursor=step;for(const table of ['history','tray_history'])sql.exec(`DELETE FROM ${table} WHERE step<?`,step-99);return step;};
    if(changed&&!historyMove){newStep(beforeObjects);delete committed.historyGesture;}
    // Sand/water: one history step per drag (same gestureId), so a single undo takes back the whole drag.
    if(trayWrite&&trayHistory){const merge=trayHistory.gesture!==undefined&&committed.historyGesture===trayHistory.gesture&&(committed.historyCursor??0)>0;const step=merge?committed.historyCursor!:newStep(JSON.stringify(committed.objects));recordTrayStep(sql,step,trayHistory.before,trayWrite);if(trayHistory.gesture)committed.historyGesture=trayHistory.gesture;else delete committed.historyGesture;}
    this.save(committed);if(trayWrite)writeTray(sql,trayWrite);for(const tray of restoredTrays)writeTray(sql,tray);if(!ephemeral)this.ctx.storage.sql.exec('INSERT INTO operations VALUES(?,?,?,?,?)',identity.participantId,committed.sessionEpoch,cmd.operationId,JSON.stringify(cmd),JSON.stringify(ack));});
   // DO output gate withholds sends until the preceding storage writes are durable.
   for(const event of events)this.broadcast({...event as object,serverSeq:s.serverSeq,sessionEpoch:s.sessionEpoch});ws.send(JSON.stringify(ack));acked=true;await this.schedule(s);
  }catch(cause){
   // The ACK is the terminal response: once it is sent (state already durable), a later failure must not add a rejection for the same operation.
   if(acked){console.error(JSON.stringify({event:'ws_post_ack_exception',type:typeof cmd?.type==='string'?cmd.type:null,name:cause instanceof Error?cause.name:typeof cause,message:(cause instanceof Error?cause.message:String(cause)).slice(0,200)}));return;}
   const blockedBeforeParse=cmd===undefined&&cause instanceof Rejected&&cause.code==='RATE_LIMITED';
   if(a&&cmd===undefined&&!blockedBeforeParse){try{ws.serializeAttachment(a);}catch{/* disconnected */}}
   // 2026-09-29 (GPT-5.6-sol review): only client input errors (parse/schema) answer INVALID_PAYLOAD; a non-Rejected infrastructure
   // exception (storage, D1, DO RPC) answers the existing retryable SAVE_FAILED and is logged. No payload or identity logged.
   if(!(cause instanceof Rejected)&&!isInputError(cause))console.error(JSON.stringify({event:'ws_unexpected_exception',type:typeof cmd?.type==='string'?cmd.type:null,name:cause instanceof Error?cause.name:typeof cause,message:(cause instanceof Error?cause.message:String(cause)).slice(0,200)}));
   const code=cause instanceof Rejected?cause.code:isInputError(cause)?'INVALID_PAYLOAD':'SAVE_FAILED';
   let operationId=cmd?.operationId as string|undefined;
   // Parse-failure attribution is best-effort; the pre-parse RATE_LIMITED gate must not inspect raw again.
   if(operationId===undefined)operationId=recoverRejectedOperationId(raw,blockedBeforeParse);
   // S2 (2026-09-17): RATE_LIMITED carries retryAfterMs (remaining ms of the per-connection 1 s window); bucket size and rejection timing unchanged.
   const retryAfterMs=cause instanceof Rejected&&cause.code==='RATE_LIMITED'&&typeof cause.retryAfterMs==='number'?{retryAfterMs:cause.retryAfterMs}:{};
   try{ws.send(JSON.stringify({protocolVersion:1,type:'operation.rejected',sessionEpoch:s?.sessionEpoch??0,serverSeq:s?.serverSeq??0,operationId:operationId??'invalid',code,requestId:crypto.randomUUID(),...retryAfterMs}));}catch{/* already disconnected */}}
 }
 async invalidateSession(hash:string){for(const ws of this.ctx.getWebSockets()){const a=ws.deserializeAttachment() as Attachment;if(a.hash===hash){this.disconnect(ws);ws.close(4003,'UNAUTHENTICATED');}}}
 private cleanupDue(){return this.ctx.storage.sql.exec<{due:number|null}>('SELECT MIN(next_at) AS due FROM room_cleanup').one().due??Infinity;}
 async eraseScene(clinicId:string,sceneId:string){
  const room=this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM room WHERE id=1').toArray()[0];
  if(room){const s=JSON.parse(room.data) as RoomRecord;if(s.clinicId!==clinicId||s.sceneId!==sceneId)throw new Rejected('PERMISSION_DENIED');}
  this.ctx.storage.transactionSync(()=>{
   this.ctx.storage.sql.exec('INSERT OR REPLACE INTO room_erasure VALUES(1,?,?)',clinicId,sceneId);
   for(const table of ['room','history','operations','room_cleanup','trays','tray_history'])this.ctx.storage.sql.exec(`DELETE FROM ${table}`);
  });
  for(const ws of this.ctx.getWebSockets())ws.close(1000,'SCENE_DELETED');
  await this.scheduleRemaining();
  // L12-3 B2：跨會談版本 outbox 已移除，抹除沒有需要排乾的佇列，因此一次就完成。
  return {complete:true};
 }
 // C4 #9 (full erasure, C27-F1): after the scene's tombstone window has passed, the coordinator asks each
 // room that hosted the scene to drop its own storage. The erasure marker only exists to block late
 // version writes; once no version rows remain and no socket is attached there is nothing left to block.
 async purgeErasure(clinicId:string,sceneId:string):Promise<{purged:boolean;reason?:string}>{
  const marker=this.ctx.storage.sql.exec<{clinic_id:string;scene_id:string}>('SELECT clinic_id,scene_id FROM room_erasure WHERE id=1').toArray()[0];
  if(!marker){
   // Never erased here: refuse to touch a room that may belong to a live or unrelated scene.
   if(this.ctx.storage.sql.exec('SELECT id FROM room').toArray().length)return {purged:false,reason:'NOT_ERASED'};
   return {purged:true};
  }
  if(marker.clinic_id!==clinicId||marker.scene_id!==sceneId)return {purged:false,reason:'KEY_MISMATCH'};
  if(this.ctx.getWebSockets().length)return {purged:false,reason:'SOCKETS_ATTACHED'};
  await this.ctx.storage.deleteAlarm();await this.ctx.storage.deleteAll();
  // Same tables the constructors create; the live instance must keep a valid (empty) schema.
  this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)');
  this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room_erasure (id INTEGER PRIMARY KEY CHECK(id=1), clinic_id TEXT NOT NULL, scene_id TEXT NOT NULL)');
  this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS operations (actor TEXT NOT NULL, epoch INTEGER NOT NULL, op TEXT NOT NULL, command TEXT NOT NULL, ack TEXT NOT NULL, PRIMARY KEY(actor,epoch,op))');this.ctx.storage.sql.exec(OPERATIONS_LOOKUP_INDEX);
  this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS history (step INTEGER PRIMARY KEY, before_state TEXT NOT NULL, after_state TEXT NOT NULL)');
  this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room_cleanup (room_id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL, scene_id TEXT NOT NULL, next_at INTEGER NOT NULL)');
  this.ctx.storage.sql.exec(TRAYS_TABLE);this.ctx.storage.sql.exec(TRAY_HISTORY_TABLE);
  return {purged:true};
 }
 private async scheduleRemaining(){const at=this.cleanupDue();if(Number.isFinite(at))await this.ctx.storage.setAlarm(Math.max(Date.now()+1,at));}
 private async releaseClosedRooms(){
  for(const row of this.ctx.storage.sql.exec<{room_id:string;clinic_id:string;scene_id:string}>('SELECT * FROM room_cleanup WHERE next_at<=?',Date.now()).toArray()){
    // C09-F1（Claude Opus 5.5, 2026-09-26；L12-2）：刪除登記跟著這個 outbox 走——它和作用中房間的移除寫在同一個交易，
    // 登記失敗時 next_at 往後推並由 alarm 重試。登記是冪等的（INSERT OR IGNORE），close 路由之後再呼叫 endSession 也無妨。
    // 不可先 release 再刪 outbox：idle 到期時若 registration 失敗，單純釋放 writer 會讓後續 alarm 永久失去刪除來源。
     try{const coordinator=this.env.SCENE_COORDINATOR_DO.getByName(row.clinic_id+':'+row.scene_id);await coordinator.registerSessionEnd(row.clinic_id,row.scene_id,row.room_id);await this.env.AUTH_DO.getByName('sessions').detachRoomFromAll(row.room_id);this.ctx.storage.sql.exec('DELETE FROM room_cleanup WHERE room_id=?',row.room_id);}
   catch{this.ctx.storage.sql.exec('UPDATE room_cleanup SET next_at=? WHERE room_id=?',Date.now()+5000,row.room_id);}
  }
 }
 private finishRoom(s:RoomRecord){
  // The final snapshot and active-data removal are one durable transaction.
  // A failed enqueue rolls back removal; external R2/D1 failure is retried by the outbox.
  this.ctx.storage.transactionSync(()=>{
   this.ctx.storage.sql.exec('INSERT OR REPLACE INTO room_cleanup VALUES(?,?,?,?)',s.roomId,s.clinicId,s.sceneId,Date.now());
   this.clearActiveRoom();
  });
 }
 // V8-C-L12-3 F1 (Claude Opus 5, 2026-09-26): the only injectable failure inside this transaction used to be the cloud
 // checkpoint enqueue, so removing cloud left A13 ("a failed close rolls back every write") with no session-only test.
 // The removal statements live in their own overridable method purely so the runtime harness can fail them; production
 // behaviour is unchanged (same three statements, same transaction).
 protected clearActiveRoom(){
  this.ctx.storage.sql.exec('DELETE FROM operations');this.ctx.storage.sql.exec('DELETE FROM history');this.ctx.storage.sql.exec('DELETE FROM trays');this.ctx.storage.sql.exec('DELETE FROM tray_history');this.ctx.storage.sql.exec('DELETE FROM room');
 }
 async close(p:Identity){
  // V8-L12-1A (user ruling L01-4): a session-only room ends only when its owning therapist ends it (or after two hours with no
  // operation). A client leaving must not delete the session -- clients use leave(). Cloud rooms keep their old rule until L12-3.
  {const current=this.read();this.owner(current,p);}
  // Establish a durable wake-up before deleting the active room, including crash recovery.
  await this.ctx.storage.setAlarm(Date.now()+1);
  const s=this.read();this.member(s,p);this.stopAnimations(s,()=>true,Date.now());this.finishRoom(s);
  for(const ws of this.ctx.getWebSockets())ws.close(1000,'ROOM_CLOSED');
  await this.releaseClosedRooms();await this.scheduleRemaining();
  // L12-2：實際刪除由 worker 在本呼叫返回後請 coordinator 執行（見 index.ts）。這裡回報 clinic／scene，
  // 不在 DO 內直接呼叫 coordinator——那會讓 coordinator 回頭呼叫本 DO 的 eraseScene 形成 re-entrancy。
  return {id:s.roomId,sceneId:s.sceneId,clinicId:s.clinicId};
 }
 // V8-L12-1A: the client leaves without ending the session. All authority the client granted is withdrawn in the same write, the
 // seat is released so the therapist can invite again, and the caller revokes the client's session (closing its sockets).
 async leave(p:Identity){
  return this.ctx.storage.transactionSync(()=>{
   const s=this.read();this.member(s,p,false);if(p.role!=='client')throw new Rejected('PERMISSION_DENIED');
   this.stopAnimations(s,()=>true,Date.now());
   s.grants={};s.leases={};(s as SharedState).requests={};delete s.exportConsent;
   delete s.participants[p.participantId];if(s.waitingClient===p.participantId)delete s.waitingClient;delete s.invite;
   s.controlEpoch++;s.serverSeq++;s.lastActivity=Date.now();this.save(s);
   this.broadcast({...this.message(s,'permission.changed',{controlEpoch:s.controlEpoch,grant:null}) as object,serverSeq:s.serverSeq,sessionEpoch:s.sessionEpoch});
   return {id:s.roomId};
  });
 }
 async alarm(){
  await this.releaseClosedRooms();
  const row=this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM room WHERE id=1').toArray()[0];
  if(!row){await this.scheduleRemaining();return;}
  const s=JSON.parse(row.data) as RoomRecord,now=Date.now();
  if(s.status==='ACTIVE'&&s.lastActivity+7200000>now){
   if(this.enforceAnimations(s,now)){s.serverSeq++;this.save(s);this.broadcast(this.snapshotEvent(s));}
   await this.schedule(s);return;
  }
  this.stopAnimations(s,()=>true,Math.min(now,s.lastActivity+7200000));
  try{this.finishRoom(s);}catch{await this.ctx.storage.setAlarm(now+5000);return;}
  for(const ws of this.ctx.getWebSockets())ws.close(1000,'EXPIRED');
   // L12-2：兩小時無操作到期與治療師結束會談一樣要刪除整個場景。唯一登記來源是下面的 room_cleanup outbox；
   // 直接呼叫 coordinator 會在 outbox 建立前形成不可重試的缺口。outbox 登記失敗會退避並由後續 alarm 重試。
  await this.releaseClosedRooms();await this.scheduleRemaining();
 }
 async webSocketClose(ws:WebSocket){this.disconnect(ws);try{ws.close(1000,'CONNECTION_CLOSED');}catch{/* transport already closed */}}
 async webSocketError(ws:WebSocket){this.disconnect(ws);try{ws.close(1011,'CONNECTION_ERROR');}catch{}}
 private disconnect(ws:WebSocket){try{const a=ws.deserializeAttachment() as Attachment;const s=this.read();if(s.connections[a.identity.participantId]!==a.connectionId)return;delete s.connections[a.identity.participantId];this.stopAnimations(s,()=>true,Date.now());s.grants={};s.leases={};s.controlEpoch++;s.clientLiveUntil=clientPresence(s.clientLiveUntil,a.identity.role,'disconnect',Date.now());s.serverSeq++;this.save(s);this.broadcast(this.snapshotEvent(s));this.ctx.waitUntil(this.schedule(s));}catch{/* expired or closed room */}}
}





