import { DurableObject } from 'cloudflare:workers';
import type { Env,Identity,Session } from './env';
import { randomToken,hashToken } from './http';
import { id } from '../../../packages/protocol/src/index';
export interface LoginAttempt {nonce:string;verifier:string;browserHash:string;expiresAt:number;enrollHash?:string}
export interface InviteIndex {expiresAt:number;tokenHash:string|null;generation:number}
// 永久項（停用標記 pd／其世代 pdg）：不會過期，也不得拿來排 alarm（setAlarm 不接受 2189 年以後的日期，GPT-6 F6）。
const PERMANENT=Number.MAX_SAFE_INTEGER;
export class AuthDurableObject extends DurableObject<Env> {
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS auth_entries (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL)');}
 private put(key:string,value:unknown,expires:number){this.ctx.storage.sql.exec('INSERT OR REPLACE INTO auth_entries VALUES (?,?,?)',key,JSON.stringify(value),expires);}
 private get<T>(key:string):T|null {const row=this.ctx.storage.sql.exec<{value:string;expires:number}>('SELECT value,expires FROM auth_entries WHERE key=?',key).toArray()[0];return row&&row.expires>Date.now()?JSON.parse(row.value):null;}
 // 2026-10-11 GPT-6 F2：已停用者的 session 不論是否撤銷完畢都不算數；所有用 session 授權的入口都經過這裡。
 private live<T extends Session>(hash:string):T|null{const session=this.get<T>('s:'+hash);return session&&this.get<number>('pd:'+session.participantId)===null?session:null;}
 private async scheduleExpiryAlarm(){const next=this.ctx.storage.sql.exec<{expires:number|null}>('SELECT MIN(expires) AS expires FROM auth_entries WHERE expires<?',PERMANENT).one().expires;if(next===null)await this.ctx.storage.deleteAlarm();else await this.ctx.storage.setAlarm(Math.max(Date.now()+1,next));}
 async createSession(identity:Identity){const token=randomToken();const hash=await hashToken(token);const session={...identity,expiresAt:Date.now()+8*3600000};if(identity.roomId&&identity.sceneId&&!this.writeRoomIndex(identity.roomId,identity.clinicId,identity.sceneId,session.expiresAt))throw new Error('ROOM_CLOSED');this.put('s:'+hash,session,session.expiresAt);await this.scheduleExpiryAlarm();return {token,session};}
 private extendRoomIndexInTransaction(roomId:string,clinicId:string,sceneId:string,expiresAt:number):number|null{
  const roomKey='r:'+roomId,sceneKey='c:'+clinicId+':'+sceneId;
  const room=this.get<{clinicId:string;sceneId:string;expiresAt:number}>(roomKey),scene=this.get<{roomId:string;expiresAt:number}>(sceneKey);
  if(!room||!scene)return null;
  if(room.clinicId!==clinicId||room.sceneId!==sceneId||scene.roomId!==roomId)throw new Error('ROOM_REGISTRY_CONFLICT');
  const invite=this.normalizeInviteIndex(this.get<number|InviteIndex>('i:'+roomId));
  const expiry=Math.max(expiresAt,room.expiresAt,scene.expiresAt,invite?.expiresAt??0);
  this.put(roomKey,{clinicId,sceneId,expiresAt:expiry},expiry);this.put(sceneKey,{roomId,expiresAt:expiry},expiry);
  const highWater=Math.max(this.get<number>('ig:'+roomId)??0,invite?.generation??0);
  if(highWater>0)this.put('ig:'+roomId,highWater,expiry);
  return expiry;
 }
 private writeRoomIndex(roomId:string,clinicId:string,sceneId:string,expiresAt:number,allowCreate=false){
  id.parse(roomId);id.parse(clinicId);id.parse(sceneId);const now=Date.now();if(!Number.isSafeInteger(expiresAt)||expiresAt<=now||expiresAt>now+8*3600000+60000)throw new Error('INVALID_ROOM_INDEX_EXPIRY');
  return this.ctx.storage.transactionSync(()=>{
   if(this.get('x:'+roomId)||this.get('xc:'+clinicId+':'+sceneId))return false;
   const roomKey='r:'+roomId,sceneKey='c:'+clinicId+':'+sceneId;
   const priorRoom=this.get<{clinicId:string;sceneId:string;expiresAt:number}>(roomKey),priorScene=this.get<{roomId:string;expiresAt:number}>(sceneKey);
   if((priorRoom===null)!==(priorScene===null))return false;
   if(!priorRoom&&!allowCreate)return false;
   if((priorRoom&&(priorRoom.clinicId!==clinicId||priorRoom.sceneId!==sceneId))||(priorScene&&priorScene.roomId!==roomId))throw new Error('ROOM_REGISTRY_CONFLICT');
   if(priorRoom&&priorScene)return this.extendRoomIndexInTransaction(roomId,clinicId,sceneId,expiresAt)!==null;
   const expiry=Math.max(expiresAt,priorRoom?.expiresAt??0,priorScene?.expiresAt??0);
   this.put(roomKey,{clinicId,sceneId,expiresAt:expiry},expiry);this.put(sceneKey,{roomId,expiresAt:expiry},expiry);
   const highWater=this.get<number>('ig:'+roomId)??0;if(highWater>0)this.put('ig:'+roomId,highWater,expiry);
   return true;
  });
 }
 async registerRoom(roomId:string,clinicId:string,sceneId:string,expiresAt:number,allowCreate=false){const registered=this.writeRoomIndex(roomId,clinicId,sceneId,expiresAt,allowCreate);if(registered)await this.scheduleExpiryAlarm();return registered;}
 async unregisterRoom(roomId:string,clinicId:string,sceneId:string){
  this.ctx.storage.transactionSync(()=>{
   const roomKey='r:'+roomId,sceneKey='c:'+clinicId+':'+sceneId;
   const room=this.get<{clinicId:string;sceneId:string;expiresAt:number}>(roomKey),scene=this.get<{roomId:string;expiresAt:number}>(sceneKey);
   if(room&&(room.clinicId!==clinicId||room.sceneId!==sceneId))throw new Error('ROOM_REGISTRY_CONFLICT');
   if(scene&&scene.roomId!==roomId)throw new Error('ROOM_REGISTRY_CONFLICT');
   // Fence late /info, invite, or session-creation continuations for at most the longest session lifetime.
   const expires=Date.now()+8*3600000;
   this.put('x:'+roomId,{clinicId,sceneId},expires);this.put('xc:'+clinicId+':'+sceneId,{roomId},expires);
   for(const key of [roomKey,sceneKey,'i:'+roomId,'ig:'+roomId])this.ctx.storage.sql.exec('DELETE FROM auth_entries WHERE key=?',key);
  });
  await this.scheduleExpiryAlarm();
 }
 private normalizeInviteIndex(value:number|InviteIndex|null):InviteIndex|null{return value===null?null:typeof value==='number'?{expiresAt:value,tokenHash:null,generation:0}:{...value,generation:Number.isSafeInteger(value.generation)?value.generation:0};}
 async registerInviteRoom(roomId:string,expiresAt:number,tokenHash:string,generation:number){
  const now=Date.now();if(!roomId||!Number.isSafeInteger(expiresAt)||expiresAt<=now||expiresAt>now+31*60000||! /^[a-f0-9]{64}$/.test(tokenHash)||!Number.isSafeInteger(generation)||generation<1)throw new Error('INVALID_INVITE_EXPIRY');
  const registered=this.ctx.storage.transactionSync(()=>{
   const room=this.get<{clinicId:string;sceneId:string;expiresAt:number}>('r:'+roomId);if(!room||this.get('x:'+roomId)||this.get('xc:'+room.clinicId+':'+room.sceneId))return false;
   const scene=this.get<{roomId:string;expiresAt:number}>('c:'+room.clinicId+':'+room.sceneId);if(!scene||scene.roomId!==roomId)return false;
   const key='i:'+roomId,prior=this.normalizeInviteIndex(this.get<number|InviteIndex>(key)),highWater=this.get<number>('ig:'+roomId)??0;
   if(prior&&generation===prior.generation){if(prior.tokenHash!==null&&prior.tokenHash!==tokenHash)throw new Error('INVITE_REGISTRY_CONFLICT');if(prior.expiresAt!==expiresAt)throw new Error('INVITE_REGISTRY_CONFLICT');const expiry=this.extendRoomIndexInTransaction(roomId,room.clinicId,room.sceneId,expiresAt);if(expiry===null)return false;this.put('ig:'+roomId,Math.max(highWater,generation),expiry);return true;}
   if(generation<=highWater||(prior&&generation<prior.generation))return false;
   const expiry=this.extendRoomIndexInTransaction(roomId,room.clinicId,room.sceneId,expiresAt);if(expiry===null)return false;
   this.put('ig:'+roomId,generation,expiry);this.put(key,{expiresAt,tokenHash,generation},expiresAt);return true;
  });
  if(registered)await this.scheduleExpiryAlarm();return registered;
 }
 async activeInviteRegistration(roomId:string):Promise<InviteIndex|null>{return this.normalizeInviteIndex(this.get<number|InviteIndex>('i:'+roomId));}
 async clearInviteRoom(roomId:string,expected:InviteIndex|null){const cleared=this.ctx.storage.transactionSync(()=>{const current=this.normalizeInviteIndex(this.get<number|InviteIndex>('i:'+roomId)),target=expected?this.normalizeInviteIndex(expected):null;if(!current||!target||current.expiresAt!==target.expiresAt||current.tokenHash!==target.tokenHash||current.generation!==target.generation)return false;this.ctx.storage.sql.exec('DELETE FROM auth_entries WHERE key=?','i:'+roomId);return true;});if(cleared)await this.scheduleExpiryAlarm();return cleared;}
 async hasActiveInviteRoom(roomId:string){return this.activeInviteRegistration(roomId)!==null;}
 async hasActiveScene(clinicId:string,sceneId:string){id.parse(clinicId);id.parse(sceneId);return this.get('c:'+clinicId+':'+sceneId)!==null;}
 async lookup(hash:string):Promise<Session|null>{return this.live<Session>(hash);}
 async consumeAssetRequest(hash:string){
  if(!this.live<Session>(hash))throw new Error('UNAUTHENTICATED');
  const now=Date.now(),key='asset-rate:'+hash;
  const budget=this.get<{count:number;until:number}>(key)??{count:0,until:now+60000};
  if(budget.count>=600)return Math.max(1,Math.ceil((budget.until-now)/1000));
  budget.count++;this.put(key,budget,budget.until);return 0;
 }
 // Resource-allocation preflight only; Room DO membership remains the authorization boundary.
 // Registry supports current sessions, while roomId/rooms preserve already-live pre-registry sessions.
 async canAddressRoom(hash:string,roomId:string){const session=this.live<Session & {rooms?:string[]}>(hash);return !!session&&(this.get('r:'+roomId)!==null||session.roomId===roomId||session.rooms?.includes(roomId)===true);}
 async attachRoom(hash:string,roomId:string){return this.ctx.storage.transactionSync(()=>{const session=this.live<Session & {rooms?:string[]}>(hash);if(!session)return false;session.rooms=[...new Set([...(session.rooms??[]),roomId])];if(session.rooms.length>100)return false;this.put('s:'+hash,session,session.expiresAt);this.put('m:'+roomId+':'+hash,true,session.expiresAt);return true;});}
 async detachRoom(hash:string,roomId:string){return this.ctx.storage.transactionSync(()=>{const session=this.get<Session & {rooms?:string[]}>('s:'+hash);this.ctx.storage.sql.exec('DELETE FROM auth_entries WHERE key=?','m:'+roomId+':'+hash);if(!session)return false;session.rooms=(session.rooms??[]).filter(id=>id!==roomId);this.put('s:'+hash,session,session.expiresAt);return true;});}
 async detachRoomFromAll(roomId:string){const removed=this.ctx.storage.transactionSync(()=>{const prefix='m:'+roomId+':',rows=this.ctx.storage.sql.exec<{key:string}>('SELECT key FROM auth_entries WHERE key LIKE ? AND expires>?',prefix+'%',Date.now()).toArray();for(const row of rows){const hash=row.key.slice(prefix.length);if(/^[a-f0-9]{64}$/.test(hash)){const session=this.get<Session & {rooms?:string[]}>('s:'+hash);if(session){session.rooms=(session.rooms??[]).filter(id=>id!==roomId);this.put('s:'+hash,session,session.expiresAt);}}this.ctx.storage.sql.exec('DELETE FROM auth_entries WHERE key=?',row.key);}return rows.length;});await this.scheduleExpiryAlarm();return removed;}
 async revoke(hash:string){const session=this.get<Session & {rooms?:string[]}>('s:'+hash);this.ctx.storage.transactionSync(()=>{this.ctx.storage.sql.exec('DELETE FROM auth_entries WHERE key=?','s:'+hash);for(const room of session?.rooms??[])this.ctx.storage.sql.exec('DELETE FROM auth_entries WHERE key=?','m:'+room+':'+hash);});for(const room of session?.rooms??[])await this.env.ROOM_DO.getByName(room).invalidateSession(hash);}
 // 2026-10-11 治療師停用：撤銷該 participant 的所有 session（含本功能上線前建立、沒有索引的舊 session）。
 // GPT-6 F2：先在同一個 storage 交易裡刪光全部 session，再通知房間；房間通知失敗不會留下任何仍有效的 session（lookup 另查 pd）。
 async revokeParticipant(participantId:string){
  const revoked=this.ctx.storage.transactionSync(()=>{
   const out:{hash:string;rooms:string[]}[]=[];
   for(const row of this.ctx.storage.sql.exec<{key:string;value:string}>("SELECT key,value FROM auth_entries WHERE key LIKE 's:%'").toArray()){
    const session=JSON.parse(row.value) as Session & {rooms?:string[]};if(session.participantId!==participantId)continue;
    const hash=row.key.slice(2),rooms=session.rooms??[];
    this.ctx.storage.sql.exec('DELETE FROM auth_entries WHERE key=?',row.key);
    for(const room of rooms)this.ctx.storage.sql.exec('DELETE FROM auth_entries WHERE key=?','m:'+room+':'+hash);
    out.push({hash,rooms});
   }
   return out;
  });
  await this.scheduleExpiryAlarm();
  const notices=await Promise.allSettled(revoked.flatMap(({hash,rooms})=>rooms.map(room=>this.env.ROOM_DO.getByName(room).invalidateSession(hash))));
  const notifyFailed=notices.filter(result=>result.status==='rejected').length;
  if(notifyFailed)console.warn(JSON.stringify({event:'revoke_participant_room_notify_failed',failed:notifyFailed}));
  return {revoked:revoked.length,notifyFailed};
 }
 // 2026-10-11 GPT-6 SPEC CONFLICT：D1 Time Travel 還原會把作廢碼與停用帳號一起還原；這裡的圍欄存在 AUTH_DO，D1 還原碰不到。
 // ef:<codeHash> 已用或已作廢的加入碼（保留到加入碼最長效期之後）。值為 true＝定案；{op}＝某次兌換進行中（GPT-6 F5）。
 async fenceEnrollment(codeHash:string,until:number){this.put('ef:'+codeHash,true,until);await this.scheduleExpiryAlarm();}
 async enrollmentFenced(codeHash:string){return this.get<unknown>('ef:'+codeHash)!==null;}
 /** 兌換前先「保留」：同一個碼同時只有一次兌換能進行；已有任何圍欄（定案或進行中）就拒絕。 */
 async reserveEnrollment(codeHash:string,op:string,until:number){const reserved=this.ctx.storage.transactionSync(()=>{if(this.get<unknown>('ef:'+codeHash)!==null)return false;this.put('ef:'+codeHash,{op},until);return true;});if(reserved)await this.scheduleExpiryAlarm();return reserved;}
 /** 只在 D1 已確認碼仍未使用時呼叫：撤掉自己那次的保留，讓碼在效期內可以重試。別人的保留或已定案的圍欄不動。 */
 async releaseEnrollment(codeHash:string,op:string){return this.ctx.storage.transactionSync(()=>{const current=this.get<{op?:string}|boolean>('ef:'+codeHash);if(typeof current!=='object'||current===null||current.op!==op)return false;this.ctx.storage.sql.exec('DELETE FROM auth_entries WHERE key=?','ef:'+codeHash);return true;});}
 // pd:<participantId>＝停用世代（遞增整數），直到同一人以新加入碼回來才解除；pdg:<participantId> 記世代高水位，清除後也不倒退。
 // GPT-6 F3：解除必須 compare-and-clear 兌換開始前讀到的世代，較晚的停用不會被較舊的兌換抹掉。
 async markDeactivated(participantId:string){return this.ctx.storage.transactionSync(()=>{const generation=Math.max(this.get<number>('pdg:'+participantId)??0,this.get<number>('pd:'+participantId)??0)+1;this.put('pdg:'+participantId,generation,PERMANENT);this.put('pd:'+participantId,generation,PERMANENT);return generation;});}
 async deactivationGeneration(participantId:string){return this.get<number>('pd:'+participantId);}
 async clearDeactivated(participantId:string,expected:number){return this.ctx.storage.transactionSync(()=>{if(this.get<number>('pd:'+participantId)!==expected)return false;this.ctx.storage.sql.exec('DELETE FROM auth_entries WHERE key=?','pd:'+participantId);return true;});}
 async isDeactivated(participantId:string){return this.get<number>('pd:'+participantId)!==null;}
 async deactivatedAmong(participantIds:string[]){return participantIds.filter(id=>this.get<number>('pd:'+id)!==null);}
 async begin(attempt:LoginAttempt){const state=randomToken();this.put('o:'+state,attempt,attempt.expiresAt);await this.scheduleExpiryAlarm();return state;}
 async consume(state:string,browserHash:string):Promise<LoginAttempt|null>{return this.ctx.storage.transactionSync(()=>{const entry=this.get<LoginAttempt>('o:'+state);if(!entry||entry.browserHash!==browserHash)return null;this.ctx.storage.sql.exec('DELETE FROM auth_entries WHERE key=?','o:'+state);return entry;});}
 async alarm(){this.ctx.storage.sql.exec('DELETE FROM auth_entries WHERE expires<=?',Date.now());await this.scheduleExpiryAlarm();}
 private raw<T>(key:string):T|null {const row=this.ctx.storage.sql.exec<{value:string}>('SELECT value FROM auth_entries WHERE key=?',key).toArray()[0];return row?JSON.parse(row.value):null;}
}
