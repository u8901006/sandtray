import {DurableObject} from 'cloudflare:workers';
import type {Env,Identity} from './env';
import {Rejected,type RoomState} from '../../../packages/room-core/src/index';
import type {z} from 'zod';
import {sceneObjectSchema,sceneSchema,roomTraysSchema,type RoomTrays} from '../../../packages/protocol/src/index';
import {TRAYS_TABLE,TRAY_HISTORY_TABLE,readTrays,trayJson} from './trays';
export interface RoomRecord extends Omit<RoomState,'objects'> {
 // L12-3 B2（L01-4：會談即焚）：只剩會談內保存，retentionMode 收斂為 'session-only'；
 // 欄位保留在持久化狀態裡，讓既有房間紀錄與 /info 的契約不變。
 sceneId:string; ownerId:string; policyVersion:string; retentionMode:'session-only';
 objects:Record<string,z.infer<typeof sceneObjectSchema>>;
 cloudConsent?:{participantId:string;policyVersion:string;acceptedAt:number};
 exportConsent?:{version:string;epoch:number;formats:string[]};
 invite?:{hash:string;expiresAt:number;generation:number};inviteGeneration?:number;waitingClient?:string;
 lastActivity:number;serverSeq:number; connections:Record<string,string>;
 lastCheckpointAt?:number;checkpointRevision?:number;checkpointId?:string;
 checkpointRetryAt?:number;checkpointFailed?:boolean;
 activeRoomFence?:number;
}
export class AdmissionRoom extends DurableObject<Env> {
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)');
  // L12-3 B2：room_erasure 原本由 VersionStore 的建構子建立。版本 outbox 移除後，抹除標記仍是
  // 「這個房間的場景已被刪除」的唯一證據（read() 每次都查它），所以改由這裡建立。
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room_erasure (id INTEGER PRIMARY KEY CHECK(id=1), clinic_id TEXT NOT NULL, scene_id TEXT NOT NULL)');
  ctx.storage.sql.exec(TRAYS_TABLE);ctx.storage.sql.exec(TRAY_HISTORY_TABLE);
 }
 protected read():RoomRecord {if(this.ctx.storage.sql.exec('SELECT id FROM room_erasure').toArray().length)throw new Rejected('PERMISSION_DENIED');const row=this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM room WHERE id=1').toArray()[0];if(!row)throw new Rejected('PERMISSION_DENIED');const s=JSON.parse(row.data) as RoomRecord;if(s.status!=='ACTIVE'||s.lastActivity+7200000<=Date.now())throw new Rejected('ROOM_CLOSED');return s;}
 protected save(s:RoomRecord){this.ctx.storage.sql.exec('INSERT OR REPLACE INTO room VALUES(1,?)',JSON.stringify(s));}
 protected member(s:RoomRecord,p:Identity,admitted=true){const member=Object.hasOwn(s.participants,p.participantId)?s.participants[p.participantId]:undefined;if(p.clinicId!==s.clinicId||!member||member.role!==p.role||(admitted&&!member.admitted)||(p.role==='client'&&p.roomId!==s.roomId))throw new Rejected('PERMISSION_DENIED');return member;}
 async authorizeAsset(sessionHash:string){
  const initial=this.read();
  if(await this.env.SCENE_COORDINATOR_DO.getByName(initial.clinicId+':'+initial.sceneId).isDeleted())throw new Rejected('PERMISSION_DENIED');
  // Check session last: a slow tombstone lookup must not extend a logged-out session snapshot.
  const session=await this.env.AUTH_DO.getByName('sessions').lookup(sessionHash);
  if(!session||session.expiresAt<=Date.now())throw new Rejected('UNAUTHENTICATED');
  this.member(this.read(),session);
 }
 async assertAvailable(){const s=this.read();if(await this.env.SCENE_COORDINATOR_DO.getByName(s.clinicId+':'+s.sceneId).isDeleted())throw new Rejected('PERMISSION_DENIED');this.read();}
 protected owner(s:RoomRecord,p:Identity){this.member(s,p);if(p.role!=='therapist'||s.ownerId!==p.participantId)throw new Rejected('PERMISSION_DENIED');}
 async initialize(p:Identity,roomId:string,sceneId:string,policyVersion:string,retentionMode:RoomRecord['retentionMode']='session-only',seed?:z.infer<typeof sceneSchema>,sessionHash?:string,seedExpiresAt?:number,trays?:RoomTrays){
  if(p.role!=='therapist')throw new Rejected('PERMISSION_DENIED');
  // REQ-016 A6: tray shape and size are fixed at creation; re-validated here because RPC callers are not trusted to have parsed them.
  const trayConfig=trays===undefined?undefined:roomTraysSchema.safeParse(trays);if(trayConfig&&!trayConfig.success)throw new Rejected('INVALID_PAYLOAD');
  if(this.ctx.storage.sql.exec('SELECT id FROM room').toArray().length)throw new Rejected('ROOM_FULL');
  const s:RoomRecord={roomId,sceneId,ownerId:p.participantId,clinicId:p.clinicId,policyVersion,retentionMode,status:'ACTIVE',sessionEpoch:1,controlEpoch:1,clientLiveUntil:0,writerLeaseUntil:0,sceneRevision:0,nextFence:0,lastActivity:Date.now(),serverSeq:0,connections:{},participants:{},objects:{},grants:{},leases:{},...(trayConfig?{trays:trayConfig.data}:{})};
  // L12-3 B2：seed（備份還原／重開舊作品）隨 cloud 一併移除；建房不再接受任何場景種子。
  const coordinator=this.env.SCENE_COORDINATOR_DO.getByName(p.clinicId+':'+sceneId);
  s.lastCheckpointAt=Date.now();s.checkpointRevision=s.sceneRevision;
  const writer=await coordinator.claim(roomId);s.writerLeaseUntil=writer.expiresAt;s.activeRoomFence=writer.fence;
  try{
   if(seed){const current=sessionHash?await this.env.AUTH_DO.getByName('sessions').lookup(sessionHash):null;if(!current||current.role!=='therapist'||current.participantId!==p.participantId||current.clinicId!==p.clinicId)throw new Rejected('UNAUTHENTICATED');if(!seedExpiresAt||seedExpiresAt<=Date.now())throw new Rejected('PERMISSION_DENIED');}
   if(writer.expiresAt<=Date.now())throw new Rejected('REVISION_CONFLICT');
   if(this.ctx.storage.sql.exec('SELECT id FROM room_erasure').toArray().length)throw new Rejected('PERMISSION_DENIED');
  s.participants[p.participantId]={id:p.participantId,clinicId:p.clinicId,role:'therapist',sessionEpoch:1,admitted:true};this.save(s);await this.scheduleInitialExpiryAlarm();return {id:roomId,sceneId};
  }catch(e){this.ctx.storage.sql.exec('DELETE FROM room WHERE id=1');try{await this.ctx.storage.deleteAlarm();}catch{/* empty room has no usable state; stale alarm will be a no-op */}try{await coordinator.release(roomId);}catch{/* the coordinator's short writer lease will expire */}throw e;}
 }
 protected scheduleInitialExpiryAlarm(){return this.ctx.storage.setAlarm(Date.now()+7200000);}
 async invite(p:Identity,hash:string){const s=this.read();this.owner(s,p);if(s.waitingClient)throw new Rejected('ROOM_FULL');const generation=(s.inviteGeneration??0)+1;s.inviteGeneration=generation;s.invite={hash,expiresAt:Date.now()+1800000,generation};s.lastActivity=Date.now();this.save(s);return {expiresAt:s.invite.expiresAt,generation};}
 async inspectInvite(hash:string){const s=this.read();if(!s.invite||s.invite.hash!==hash||s.invite.expiresAt<=Date.now()||s.waitingClient)throw new Rejected('PERMISSION_DENIED');return {retentionMode:s.retentionMode,policyVersion:s.policyVersion,};}
 async redeem(hash:string,acceptedPolicyVersion?:string):Promise<Identity>{return this.ctx.storage.transactionSync(()=>{const s=this.read();if(!s.invite||s.invite.hash!==hash||s.invite.expiresAt<=Date.now()||s.waitingClient)throw new Rejected('PERMISSION_DENIED');const participantId=crypto.randomUUID();s.waitingClient=participantId;delete s.invite;s.participants[participantId]={id:participantId,clinicId:s.clinicId,role:'client',sessionEpoch:s.sessionEpoch,admitted:false};s.lastActivity=Date.now();this.save(s);return {participantId,clinicId:s.clinicId,role:'client',roomId:s.roomId,sceneId:s.sceneId};});}
 async cancelWaiting(p:Identity,participantId:string){return this.ctx.storage.transactionSync(()=>{const s=this.read();this.owner(s,p);if(s.waitingClient!==participantId||!Object.hasOwn(s.participants,participantId)||s.participants[participantId].admitted)throw new Rejected('PERMISSION_DENIED');delete s.participants[participantId];delete s.waitingClient;delete s.invite;delete s.cloudConsent;s.lastActivity=Date.now();this.save(s);return {id:participantId};});}
 async admit(p:Identity,participantId:string){const s=this.read();this.owner(s,p);if(s.waitingClient!==participantId)throw new Rejected('PERMISSION_DENIED');s.participants[participantId].admitted=true;s.lastActivity=Date.now();this.save(s);return {id:participantId};}
 async info(p:Identity){const s=this.read();this.member(s,p,false);return {retentionMode:s.retentionMode,policyVersion:s.policyVersion,roomId:s.roomId,sceneId:s.sceneId,role:p.role,participantId:p.participantId,admitted:s.participants[p.participantId].admitted,waitingClient:p.role==='therapist'&&s.waitingClient&&!s.participants[s.waitingClient]?.admitted?s.waitingClient:undefined,sessionEpoch:s.sessionEpoch,controlEpoch:s.controlEpoch,serverSeq:s.serverSeq,serverNow:Date.now(),...(s.participants[p.participantId].admitted?{grants:s.grants,leases:s.leases,exportConsent:s.exportConsent,requests:(s as RoomRecord & {requests?:unknown}).requests??{}}:{})};}
 // REQ-016 (2026-09-30): the snapshot is scene v2 (openapi Scene): two trays with heightmaps, every object carries trayId (legacy objects -> dry).
 async snapshot(p:Identity){const s=this.read();this.member(s,p);return {schemaVersion:2,sceneId:s.sceneId,sceneRevision:s.sceneRevision,trays:readTrays(this.ctx.storage.sql,s.trays).map(tray=>trayJson(tray,s.trays)),objects:Object.values(s.objects).map(o=>({...o,trayId:o.trayId??'dry'})),environment:{sandColor:'#deceac',backgroundColor:'#e9e5db'},updatedAt:s.lastActivity};}
 async consent(p:Identity,formats:string[]){const s=this.read();this.member(s,p);if(p.role!=='client')throw new Rejected('PERMISSION_DENIED');s.exportConsent={version:crypto.randomUUID(),epoch:s.sessionEpoch,formats};this.save(s);return {version:s.exportConsent.version};}
 async exportScene(p:Identity,format:string,consentVersion:string,expectedSceneRevision?:number){const s=this.read();this.member(s,p);if(p.role!=='client'&&(!s.exportConsent||s.exportConsent.version!==consentVersion||s.exportConsent.epoch!==s.sessionEpoch||!s.exportConsent.formats.includes(format)))throw new Rejected('PERMISSION_DENIED');if(format==='png'){if(expectedSceneRevision===undefined)throw new Rejected('INVALID_PAYLOAD');if(expectedSceneRevision!==s.sceneRevision||Object.values(s.objects).some(o=>o.animation?.state==='playing'))throw new Rejected('REVISION_CONFLICT');}return format==='json'?await this.snapshot(p):{authorized:true,sceneRevision:s.sceneRevision};}
 async close(p:Identity){const s=this.read();this.member(s,p);s.status='CLOSED';s.objects={};s.grants={};s.leases={};s.participants={};s.connections={};delete s.invite;delete s.waitingClient;this.save(s);for(const ws of this.ctx.getWebSockets())ws.close(1000,'ROOM_CLOSED');return {id:s.roomId,clinicId:s.clinicId,sceneId:s.sceneId};}
 async alarm(){const row=this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM room WHERE id=1').toArray()[0];if(!row)return;const s=JSON.parse(row.data) as RoomRecord;if(s.lastActivity+7200000<=Date.now()){this.ctx.storage.sql.exec('DELETE FROM room');for(const ws of this.ctx.getWebSockets())ws.close(1000,'EXPIRED');}else await this.ctx.storage.setAlarm(s.lastActivity+7200000);}
}




