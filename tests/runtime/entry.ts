// This entry is local test infrastructure; it is never imported by the production Worker.
import worker from '../../apps/worker/src/index';
import {purgeExpiredTombstones} from '../../apps/worker/src/tombstones';
import {SceneCoordinatorDurableObject as ProductionCoordinator} from '../../apps/worker/src/coordinator';
export class SceneCoordinatorDurableObject extends ProductionCoordinator {
 private failMarker=false;
 private failPurgeState=false;
 private failPurgeDelete=false;
 private failPurgeDeleteAll=false;
 private holdPurgeRead=false;private purgeReadReached=false;private purgeReadCalls=0;private releasePurgeRead:(()=>void)|undefined;
 async storageInspect(){const count=(t:string)=>this.ctx.storage.sql.exec<{n:number}>(`SELECT COUNT(*) AS n FROM ${t}`).one().n;const tables=this.ctx.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'").toArray().map(r=>r.name).filter(name=>name!=='__miniflare_do_name');return {tables,deletionRows:tables.includes('deletion')?count('deletion'):0,writerRows:tables.includes('writer')?count('writer'):0,sceneRooms:tables.includes('scene_rooms')?count('scene_rooms'):0,sceneGenerationRows:tables.includes('scene_generation')?count('scene_generation'):0,alarm:await this.ctx.storage.getAlarm()};}
 async deletionFail(target:'marker'|null){this.failMarker=target==='marker';return {ok:true};}
 async purgeStateFail(fail:boolean){this.failPurgeState=fail;return {ok:true};}
 async purgeFailure(target:'d1-delete'|'delete-all',fail:boolean){if(target==='d1-delete')this.failPurgeDelete=fail;if(target==='delete-all')this.failPurgeDeleteAll=fail;return {ok:true};}
 async purgeReadGate(hold?:boolean){if(hold===true){this.holdPurgeRead=true;this.purgeReadReached=false;this.purgeReadCalls=0;}if(hold===false){this.holdPurgeRead=false;this.releasePurgeRead?.();}return {reached:this.purgeReadReached,calls:this.purgeReadCalls};}
 override async readPurgeTombstone(clinicId:string,sceneId:string){this.purgeReadCalls++;if(this.holdPurgeRead&&this.purgeReadCalls===1){this.purgeReadReached=true;await new Promise<void>(resolve=>{this.releasePurgeRead=resolve;});}return super.readPurgeTombstone(clinicId,sceneId);}
 // L12-6 (Claude Opus 5.5, 2026-09-27): a concurrent actor changes the D1 tombstone between deleteAll and the conditional
 // DELETE, so the DELETE reports changes=0. 'delete' = another sweep already removed it; 'rewrite' = deleted_at moved.
 private purgeD1Race:'delete'|'rewrite'|null=null;
 async purgeD1RaceMode(mode:'delete'|'rewrite'|null){this.purgeD1Race=mode;return {ok:true};}
 override async deletePurgeTombstone(clinicId:string,sceneId:string,deletedAt:number,ttlMs:number,now:number){
  if(this.failPurgeDelete)throw new Error('injected D1 tombstone delete failure');
  const race=this.purgeD1Race;this.purgeD1Race=null;
  if(race==='delete')await this.env.DIRECTORY!.prepare('DELETE FROM scene_tombstones WHERE clinic_id=? AND scene_id=?').bind(clinicId,sceneId).run();
  if(race==='rewrite')await this.env.DIRECTORY!.prepare('UPDATE scene_tombstones SET deleted_at=? WHERE clinic_id=? AND scene_id=?').bind(Date.now(),clinicId,sceneId).run();
  return super.deletePurgeTombstone(clinicId,sceneId,deletedAt,ttlMs,now);
 }
 // L12-6: isolate restart seam, same pattern as the Room DO A10 hook; the UUID proves a fresh instance.
 private readonly coordinatorInstanceId=crypto.randomUUID();
 async coordinatorInstance(){return {instanceId:this.coordinatorInstanceId};}
 async coordinatorRestart(){this.ctx.abort('L12-6 test: discard this coordinator instance');}
 protected override async deleteCoordinatorStorage(){if(this.failPurgeDeleteAll)throw new Error('injected coordinator deleteAll failure');return super.deleteCoordinatorStorage();}
 async directoryMissingFailClosed(clinicId:string,sceneId:string,deployment:'staging'|'production'){
  const directory=this.env.DIRECTORY,priorDeployment=this.env.DEPLOY_ENV,prior=this.ctx.storage.sql.exec<{clinic_id:string;scene_id:string;deleted_at:number;status:string}>('SELECT * FROM deletion WHERE id=1').toArray()[0],priorAlarm=await this.ctx.storage.getAlarm();
  if(!prior)throw new Error('test requires a completed deletion marker');
  this.ctx.storage.sql.exec('DELETE FROM deletion WHERE id=1');this.env.DIRECTORY=undefined;this.env.DEPLOY_ENV=deployment;
  let state:{denied:boolean;localStatus:string|null;alarm:boolean}={denied:false,localStatus:null,alarm:false};
  try{
   try{await this.isDeleted();}catch{state.denied=true;}
   this.ctx.storage.sql.exec("INSERT OR REPLACE INTO deletion VALUES(1,?,?,?,'COMPLETE')",clinicId,sceneId,prior.deleted_at);
   await this.ctx.storage.setAlarm(Date.now()+60000);await this.alarm();
   const local=this.ctx.storage.sql.exec<{status:string}>('SELECT status FROM deletion WHERE id=1').toArray()[0];
   state={denied:state.denied,localStatus:local?.status??null,alarm:(await this.ctx.storage.getAlarm())!==null};
  }finally{
   this.env.DIRECTORY=directory;this.env.DEPLOY_ENV=priorDeployment;
   this.ctx.storage.sql.exec("INSERT OR REPLACE INTO deletion VALUES(1,?,?,?,?)",prior.clinic_id,prior.scene_id,prior.deleted_at,prior.status);
   if(priorAlarm===null)await this.ctx.storage.deleteAlarm();else await this.ctx.storage.setAlarm(priorAlarm);
  }
  const marker=await directory!.prepare('SELECT 1 FROM scene_tombstones WHERE clinic_id=? AND scene_id=?').bind(clinicId,sceneId).first();
  return {...state,tombstoneRetained:!!marker};
 }
 protected override prepareCoordinatorPurge(clinicId:string,sceneId:string,deletedAt:number){const prepared=super.prepareCoordinatorPurge(clinicId,sceneId,deletedAt);if(this.failPurgeState)throw new Error('injected coordinator purge-state failure');return prepared;}
 // C09-F1（Claude Opus 5.5, 2026-09-26）：讓 Room DO 對 coordinator 的刪除登記失敗，驗「登記失敗會由 room_cleanup outbox 重試」。
 private failRegister=false;
 async registerFail(fail:boolean){this.failRegister=fail;return {ok:true};}
 override async registerSessionEnd(clinicId:string,sceneId:string,roomId:string){if(this.failRegister)throw new Error('injected registration failure');return super.registerSessionEnd(clinicId,sceneId,roomId);}
 protected override async writeDeletionMarker(row:{clinic_id:string;scene_id:string;deleted_at:number}){if(this.holdDeletion){this.deletionReached=true;await new Promise<void>(resolve=>{this.releaseDeletion=resolve;});}if(this.failMarker)throw new Error('injected deletion marker failure');return super.writeDeletionMarker(row);}
 // G28（KEY_MISMATCH／BUSY 補案）：把真實 processDeletion 停在 marker 寫入點，重現「scheduled 清除趕上
 // 重試中的刪除」的並發；retarget／pending 僅改測試狀態（對應 D1 與 DO 本地列發散／墜毀後重試）。
 private holdDeletion=false;private deletionReached=false;private releaseDeletion:(()=>void)|undefined;
 async deletionGate(hold?:boolean){if(hold===true){this.holdDeletion=true;this.deletionReached=false;}if(hold===false){this.holdDeletion=false;this.releaseDeletion?.();}return {reached:this.deletionReached};}
 async deletionRetarget(clinicId:string,sceneId:string){this.ctx.storage.sql.exec('UPDATE deletion SET clinic_id=?,scene_id=? WHERE id=1',clinicId,sceneId);return {ok:true};}
 // L12-2：讀取刪除狀態（PENDING／COMPLETE）以驗「失敗留 PENDING、重試到 COMPLETE」。唯讀。
 async deletionState(){const row=this.ctx.storage.sql.exec<{status:string;clinic_id:string;scene_id:string;deleted_at:number}>('SELECT * FROM deletion WHERE id=1').toArray()[0];return {deletion:row??null};}
 async deletionStateForTest(){const exists=this.ctx.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='deletion'").one().n>0;return exists?this.deletionState():{deletion:null};}
 async deletionPending(){this.ctx.storage.sql.exec("UPDATE deletion SET status='PENDING' WHERE id=1");return {ok:true};}
 async deletionStatusForTest(status:'PENDING'|'COMPLETE'){const exists=this.ctx.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='deletion'").one().n>0;if(exists)this.ctx.storage.sql.exec('UPDATE deletion SET status=? WHERE id=1',status);return {ok:true};}
 // G28：真實 process() 在刪除分支開頭 await coordinator.isDeleted()（versions.ts delete path）；對已刪除
 // 場景的版本列必走此分支，故在此 RPC 上挂 gate 把 process() 停在半途（running=true），重現
 // 「purge 趕上仍在排水的版本」。僅在顯式 hold 時生效，其他流程原樣通過。
 private holdErasureCheck=false;private erasureCheckReached=false;private releaseErasureCheck:(()=>void)|undefined;
 async erasureCheckGate(hold?:boolean){if(hold===true){this.holdErasureCheck=true;this.erasureCheckReached=false;}if(hold===false){this.holdErasureCheck=false;this.releaseErasureCheck?.();}return {reached:this.erasureCheckReached};}
 override async isDeleted(){if(this.holdErasureCheck){this.erasureCheckReached=true;await new Promise<void>(resolve=>{this.releaseErasureCheck=resolve;});}return super.isDeleted();}
}
import {RoomDurableObject as ProductionRoom} from '../../apps/worker/src/sync';
export class RoomDurableObject extends ProductionRoom {
 // V8-C-L12-3 F1：讓 close 的移除步驟可注入失敗，驗「失敗必須整筆回滾」。只影響 runtime harness。
 private failClear=false;
 async closeFailure(fail:boolean){this.failClear=fail;return {ok:true};}
 private failInitialAlarm=false;
 async initialAlarmFailure(fail:boolean){this.failInitialAlarm=fail;return {ok:true};}
 protected override async scheduleInitialExpiryAlarm(){if(this.failInitialAlarm){await super.scheduleInitialExpiryAlarm();throw new Error('injected initial alarm failure');}return super.scheduleInitialExpiryAlarm();}
 protected override clearActiveRoom(){if(this.failClear)throw new Error('SAVE_FAILED');super.clearActiveRoom();}
 private assetHeld=false;private assetReached=false;private releaseAsset:(()=>void)|undefined;
 async assetReadGate(hold?:boolean){if(hold===true){this.assetHeld=true;this.assetReached=false;}if(hold===false){this.assetHeld=false;this.releaseAsset?.();}return {reached:this.assetReached};}
 async waitForAssetRead(){if(this.assetHeld){this.assetReached=true;await new Promise<void>(resolve=>{this.releaseAsset=resolve;});}}

 async deletionInit(participantId:string,active=true){
  const row=this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM room WHERE id=1').toArray()[0];const clinicId=row?JSON.parse(row.data).clinicId:this.ctx.storage.sql.exec<{clinic_id:string}>('SELECT clinic_id FROM room_erasure WHERE id=1').one().clinic_id;
  await this.env.DIRECTORY!.prepare('CREATE TABLE IF NOT EXISTS data_managers (clinic_id TEXT NOT NULL,participant_id TEXT NOT NULL,active INTEGER NOT NULL,PRIMARY KEY(clinic_id,participant_id))').run();
  await this.env.DIRECTORY!.prepare('CREATE TABLE IF NOT EXISTS scene_tombstones (clinic_id TEXT NOT NULL,scene_id TEXT NOT NULL,deleted_at INTEGER NOT NULL,PRIMARY KEY(clinic_id,scene_id))').run();
  await this.env.DIRECTORY!.prepare('INSERT OR REPLACE INTO data_managers VALUES(?,?,?)').bind(clinicId,participantId,active?1:0).run();return {ok:true};
 }
 private readonly instanceId=crypto.randomUUID();
 async instance(){return {instanceId:this.instanceId};}
 async restart(){this.ctx.abort('A10 test: discard this Durable Object instance');}
 async inspect(){return {room:this.ctx.storage.sql.exec('SELECT * FROM room').toArray().length,operations:this.ctx.storage.sql.exec('SELECT * FROM operations').toArray().length,history:this.ctx.storage.sql.exec('SELECT * FROM history').toArray().length};}
 async roomStorageInspect(){const has=(t:string)=>this.ctx.storage.sql.exec<{n:number}>(`SELECT COUNT(*) AS n FROM ${t}`).one().n;const tables=this.ctx.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'").toArray().map(r=>r.name).filter(name=>name!=='__miniflare_do_name');return {tables,erasure:tables.includes('room_erasure')?has('room_erasure'):0,versions:tables.includes('versions')?has('versions'):0,room:tables.includes('room')?has('room'):0,operations:tables.includes('operations')?has('operations'):0,history:tables.includes('history')?has('history'):0,roomCleanup:tables.includes('room_cleanup')?has('room_cleanup'):0,trays:tables.includes('trays')?has('trays'):0,trayHistory:tables.includes('tray_history')?has('tray_history'):0,sockets:this.ctx.getWebSockets().length,alarm:await this.ctx.storage.getAlarm()};}
 // G27（C27-F1 反證）：真實 WS 在抹除後無法再通過驗證掛上（房間列已刪、eraseScene 會 close 全部
 // socket），因此以 server 端 WebSocketPair 直接 accept——與 production getWebSockets() 計數同一來源。
 async testSocket(open?:boolean){if(open===true)this.ctx.acceptWebSocket(Object.values(new WebSocketPair())[1]);else if(open===false)for(const ws of this.ctx.getWebSockets())ws.close(1000,'TEST_DETACH');return {sockets:this.ctx.getWebSockets().length};}
 private failPurgeErasure=false;
 async purgeErasureFailure(fail:boolean){this.failPurgeErasure=fail;return {ok:true};}
 override async purgeErasure(clinicId:string,sceneId:string){if(this.failPurgeErasure)throw new Error('injected Room DO erasure purge failure');return super.purgeErasure(clinicId,sceneId);}
 private holdSocketCommands=false;private socketCommandIds:string[]=[];private completedSocketCommandIds:string[]=[];private releaseSocketCommands:Array<()=>void>=[];
 async socketCommandGate(hold?:boolean){if(hold===true){this.holdSocketCommands=true;this.socketCommandIds=[];this.completedSocketCommandIds=[];this.releaseSocketCommands=[];}if(hold===false){this.holdSocketCommands=false;for(const release of this.releaseSocketCommands.splice(0))release();}return {reached:this.socketCommandIds.length,completed:[...this.completedSocketCommandIds],operationIds:[...this.socketCommandIds]};}
 override async webSocketMessage(ws:WebSocket,raw:string|ArrayBuffer){let tracked=false,operationId='unknown';if(this.holdSocketCommands){tracked=true;try{const text=typeof raw==='string'?raw:new TextDecoder().decode(raw);operationId=String((JSON.parse(text) as {operationId?:unknown}).operationId??'unknown');}catch{}this.socketCommandIds.push(operationId);await new Promise<void>(resolve=>{this.releaseSocketCommands.push(resolve);});}try{return await super.webSocketMessage(ws,raw);}finally{if(tracked)this.completedSocketCommandIds.push(operationId);}}
 // 2026-09-29 (GPT-5.6-sol review remediation): infrastructure fault injection and query-plan inspection for the receipt lookup.
 private injectedFault:'before-commit'|'after-ack'|null=null;
 async injectFault(mode:'before-commit'|'after-ack'|null){this.injectedFault=mode;return {ok:true};}
 override async assertAvailable(){if(this.injectedFault==='before-commit'){this.injectedFault=null;throw new Error('injected storage failure');}return super.assertAvailable();}
 protected override async schedule(s:Parameters<ProductionRoom['schedule']>[0]){if(this.injectedFault==='after-ack'){this.injectedFault=null;throw new Error('injected alarm scheduling failure');}return super.schedule(s);}
 async operationsPlan(){const plan=this.ctx.storage.sql.exec<{detail:string}>('EXPLAIN QUERY PLAN SELECT command,ack FROM operations WHERE actor=? AND op=? ORDER BY epoch LIMIT 1','a','b').toArray().map(r=>r.detail);const indexes=this.ctx.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='operations'").toArray().map(r=>r.name);return {plan,indexes};}
 async expire(){const s=this.read();s.lastActivity=Date.now()-7200001;this.save(s);await this.alarm();return this.inspect();}
 // V8-L02-6（2026-09-26）：「無人操作兩小時」回歸用——只把 lastActivity 往回撥（不觸發 alarm），
 // 讓測試在撥回後送 heartbeat 等純讀取指令，再以 runAlarm 判定房間是否到期。
 async idleAge(ms:number){const s=this.read();s.lastActivity=Date.now()-ms;this.save(s);return {lastActivity:s.lastActivity};}
 async lastActivityNow(){return {lastActivity:this.read().lastActivity};}
 async runAlarm(){await this.alarm();return this.inspect();}
 // 2026-10-11 GPT-6 F2 回歸：房間撤銷通知注入失敗。
 private failInvalidate=false;
 async invalidateFailure(fail:boolean){this.failInvalidate=fail;return {ok:true};}
 override async invalidateSession(hash:string){if(this.failInvalidate)throw new Error('injected ROOM_DO invalidateSession failure');return super.invalidateSession(hash);}
}
import {AuthDurableObject as ProductionAuth} from '../../apps/worker/src/sessions';
export class AuthDurableObject extends ProductionAuth {
 async expireTestSession(hash:string){this.ctx.storage.sql.exec('UPDATE auth_entries SET expires=? WHERE key=?',Date.now()-1,'s:'+hash);}
 async expireInviteGenerationForTest(roomId:string){this.ctx.storage.sql.exec('UPDATE auth_entries SET expires=? WHERE key=?',Date.now()-1,'ig:'+roomId);}
 async expireClosedRoomMarkersForTest(roomId:string,clinicId:string,sceneId:string){this.ctx.storage.sql.exec('UPDATE auth_entries SET expires=? WHERE key IN (?,?)',Date.now()-1,'x:'+roomId,'xc:'+clinicId+':'+sceneId);}
 private holdRoomRegister=false;private roomRegisterReached=false;private releaseRoomRegister:(()=>void)|undefined;
 async roomRegisterGate(action:'arm'|'status'|'release'){
  if(action==='arm'){this.holdRoomRegister=true;this.roomRegisterReached=false;this.releaseRoomRegister=undefined;}
  if(action==='release'){this.holdRoomRegister=false;this.releaseRoomRegister?.();this.releaseRoomRegister=undefined;}
  return {armed:this.holdRoomRegister,reached:this.roomRegisterReached};
 }
 async waitBeforeRoomRegister(){if(!this.holdRoomRegister)return;this.roomRegisterReached=true;await new Promise<void>(resolve=>{this.releaseRoomRegister=resolve;});}
 private holdSessionCreate=false;private sessionCreateReached=false;private releaseSessionCreate:(()=>void)|undefined;
 async sessionCreateGate(action:'arm'|'status'|'release'){
  if(action==='arm'){this.holdSessionCreate=true;this.sessionCreateReached=false;this.releaseSessionCreate=undefined;}
  if(action==='release'){this.holdSessionCreate=false;this.releaseSessionCreate?.();this.releaseSessionCreate=undefined;}
  return {armed:this.holdSessionCreate,reached:this.sessionCreateReached};
 }
 async waitBeforeSessionCreate(){if(!this.holdSessionCreate)return;this.sessionCreateReached=true;await new Promise<void>(resolve=>{this.releaseSessionCreate=resolve;});}
 override async createSession(identity:Parameters<ProductionAuth['createSession']>[0]){await this.waitBeforeSessionCreate();return super.createSession(identity);}
 // 2026-10-11 GPT-6 F1／F3 回歸（移植自 GPT-6 審查夾具）：以閘門強制合法交錯，不替換任何安全判斷。
 private adminBarrier=0;private adminArrived=0;private adminReleases:Array<()=>void>=[];
 private holdClear=false;private clearReached=false;private releaseClear:(()=>void)|undefined;
 async adminGate(action:'two'|'hold-clear'|'release-clear'|'status'){
  if(action==='two'){this.adminBarrier=2;this.adminArrived=0;this.adminReleases=[];}
  if(action==='hold-clear'){this.holdClear=true;this.clearReached=false;}
  if(action==='release-clear'){this.holdClear=false;this.releaseClear?.();this.releaseClear=undefined;}
  return {arrived:this.adminArrived,clearReached:this.clearReached};
 }
 override async deactivatedAmong(ids:string[]){const result=await super.deactivatedAmong(ids);if(this.adminBarrier>0){this.adminArrived++;if(this.adminArrived<this.adminBarrier)await new Promise<void>(r=>this.adminReleases.push(r));else{this.adminBarrier=0;for(const r of this.adminReleases.splice(0))r();}}return result;}
 override async clearDeactivated(id:string,expected:number){if(this.holdClear){this.clearReached=true;await new Promise<void>(r=>{this.releaseClear=r;});}return super.clearDeactivated(id,expected);}
 // 測試間重置：直接刪停用標記與世代（產品路徑只能 compare-and-clear）。
 async resetDeactivatedForTest(ids:string[]){for(const id of ids)this.ctx.storage.sql.exec('DELETE FROM auth_entries WHERE key IN (?,?)','pd:'+id,'pdg:'+id);return {ok:true};}
 async seedSessionsInRoomForTest(participantId:string,clinicId:string,roomId:string){
  const tokens:string[]=[];
  for(let i=0;i<2;i++){const {token}=await super.createSession({participantId,clinicId,role:'therapist'});tokens.push(token);await super.attachRoom(await hashToken(token),roomId);}
  return {tokens};
 }
 async sessionsOfForTest(participantId:string){return this.ctx.storage.sql.exec<{key:string;value:string}>("SELECT key,value FROM auth_entries WHERE key LIKE 's:%'").toArray().filter(row=>(JSON.parse(row.value) as {participantId:string}).participantId===participantId).length;}
 async onlyPermanentForTest(){this.ctx.storage.sql.exec('DELETE FROM auth_entries');await this.ctx.storage.deleteAlarm();await super.markDeactivated('alone');try{const result=await super.revokeParticipant('alone');await this.alarm();return {error:null,result,alarm:await this.ctx.storage.getAlarm(),fenced:await super.isDeactivated('alone')};}catch(e){return {error:e instanceof Error?e.message:String(e)};}}
}
import {authenticate,finishLogin} from '../../apps/worker/src/auth';
import {pinnedModels} from '../../packages/asset-catalog/src/index';
import {resolvePrivateModel} from '../../apps/worker/src/asset-delivery';
const importedAssets=pinnedModels;
import type {Env} from '../../apps/worker/src/env';
import {error,hashToken,json,randomToken,sessionCookie} from '../../apps/worker/src/http';
async function countedFetch(request:Request,env:Env){
 const countRoom=request.headers.get('X-Test-Count-Room-DO')==='1'||request.headers.get('X-Test-Count-Resources')==='1';
 const countScene=request.headers.get('X-Test-Count-Resources')==='1';let roomCalls=0,sceneCalls=0;
 const countedEnv=countRoom||countScene?new Proxy(env,{get(target,property,receiver){
  if(property!=='ROOM_DO'&&property!=='SCENE_COORDINATOR_DO')return Reflect.get(target,property,receiver);
  const namespace=Reflect.get(target,property,receiver) as typeof env.ROOM_DO|typeof env.SCENE_COORDINATOR_DO;
  return new Proxy(namespace,{get(ns,method,nsReceiver){
   if(method==='getByName')return (name:string)=>{if(property==='ROOM_DO')roomCalls++;else sceneCalls++;return namespace.getByName(name);};
   const value=Reflect.get(ns,method,nsReceiver);return typeof value==='function'?value.bind(ns):value;
  }});
 }}):env;
 const response=await worker.fetch(request,countedEnv);if(response.status===101)return response;
 const copy=new Response(response.body,response);
 if(countRoom)copy.headers.set('X-Test-Room-DO-Calls',String(roomCalls));
 if(countScene)copy.headers.set('X-Test-Scene-Coordinator-DO-Calls',String(sceneCalls));
 const cookie=copy.headers.get('Set-Cookie');if(cookie)copy.headers.set('Set-Cookie',cookie.replaceAll('; Secure',''));
 return copy;
}
export default {scheduled:worker.scheduled,async fetch(request:Request,env:Env):Promise<Response>{
 const url=new URL(request.url);
 // Private-assets test fixtures: this module is absent from the production bundle.
 if(url.pathname==='/__test/asset-store'&&request.method==='POST'){
  const {id,version,corrupt,remove}=await request.json() as {id:string;version:string;corrupt?:boolean;remove?:boolean};
  const source=importedAssets.find(a=>a.id===id&&a.version===version),model=resolvePrivateModel(id,version);
  if(!source||!model)return json({},404);
  if(remove){await env.PRIVATE_ASSETS!.delete(model.key);return json({ok:true});}
  const response=await env.ASSETS.fetch(new Request(new URL(source.url,url.origin)));
  const bytes=corrupt?new Uint8Array([1,2,3]).buffer:await response.arrayBuffer();
  await env.PRIVATE_ASSETS!.put(model.key,bytes,{...(corrupt?{}:{sha256:model.sha256}),httpMetadata:{cacheControl:'public, max-age=31536000'}});
  return json({ok:true});
 }
 // T18-B: seed every hash-pinned catalog model into the run's local R2 (runtime globalSetup), from the built public copies.
 if(url.pathname==='/__test/asset-store-all'&&request.method==='POST'){
  let stored=0,skipped=0;
  for(const source of importedAssets){
   const model=resolvePrivateModel(source.id,source.version);if(!model){skipped++;continue;}
   if(await env.PRIVATE_ASSETS!.head(model.key)){stored++;continue;}
   if(source.privateSource){skipped++;continue;}// no public copy: global-setup uploads it from disk via /__test/asset-put
   const response=await env.ASSETS.fetch(new Request(new URL(source.url,url.origin)));if(!response.ok){skipped++;continue;}
   await env.PRIVATE_ASSETS!.put(model.key,await response.arrayBuffer(),{sha256:model.sha256});stored++;
  }
  return json({ok:true,stored,skipped});
 }
 if(url.pathname==='/__test/asset-put'&&request.method==='POST'){
  const model=resolvePrivateModel(request.headers.get('x-asset-id')??'',request.headers.get('x-asset-version')??'');if(!model)return json({},404);
  if(await env.PRIVATE_ASSETS!.head(model.key))return json({ok:true,existed:true});
  await env.PRIVATE_ASSETS!.put(model.key,await request.arrayBuffer(),{sha256:model.sha256});return json({ok:true});
 }
 if(url.pathname==='/__test/asset-session'&&request.method==='POST'){
  const auth=await authenticate(request,env);if(!auth)return json({},401);
  const input=await request.json() as {expire?:boolean;consume?:number;rooms?:string[]};
  const stub=env.AUTH_DO.getByName('sessions');
  if(input.expire)await (stub as unknown as DurableObjectStub<AuthDurableObject>).expireTestSession(auth.hash);
  for(let i=0;i<Math.min(600,input.consume??0);i++)await stub.consumeAssetRequest(auth.hash);
  const attached:boolean[]=[];for(const roomId of input.rooms??[])attached.push(await stub.attachRoom(auth.hash,roomId));
  return json({ok:true,attached});
 }
 const roomRegisterGate=url.pathname.match(/^\/__test\/room-register-gate\/([A-Za-z0-9_-]+)$/);
 if(roomRegisterGate){
  const store=env.AUTH_DO.getByName('sessions') as unknown as DurableObjectStub<AuthDurableObject>;
  if(request.method==='GET')return json(await store.roomRegisterGate('status'));
  if(request.method==='POST'){const input=await request.json() as {action:'arm'|'release'};return json(await store.roomRegisterGate(input.action));}
 }
 if(url.pathname==='/__test/session-create-gate'){
  const store=env.AUTH_DO.getByName('sessions') as unknown as DurableObjectStub<AuthDurableObject>;
  if(request.method==='GET')return json(await store.sessionCreateGate('status'));
  if(request.method==='POST'){const input=await request.json() as {action:'arm'|'release'};return json(await store.sessionCreateGate(input.action));}
 }
 const closedRoomMarkers=url.pathname.match(/^\/__test\/closed-room-markers\/([A-Za-z0-9_-]+)$/);
 if(closedRoomMarkers&&request.method==='POST'){
  const input=await request.json() as {clinicId:string;sceneId:string};
  const store=env.AUTH_DO.getByName('sessions') as unknown as DurableObjectStub<AuthDurableObject>;
  await store.expireClosedRoomMarkersForTest(closedRoomMarkers[1],input.clinicId,input.sceneId);return json({expired:true});
 }
 const lateRoomRegistration=url.pathname.match(/^\/__test\/late-room-registration\/([A-Za-z0-9_-]+)\/(info|invites)$/);
 if(lateRoomRegistration&&request.method==='POST'){
  const [,roomId,action]=lateRoomRegistration,auth=await authenticate(request,env);if(!auth)return json({},401);
  const room=env.ROOM_DO.getByName(roomId) as unknown as DurableObjectStub<RoomDurableObject>;
  const inviteHash=action==='invites'?await hashToken(randomToken()):null;
  const invite=inviteHash?await room.invite(auth.session,inviteHash):null;
  const info=await room.info(auth.session),store=env.AUTH_DO.getByName('sessions') as unknown as DurableObjectStub<AuthDurableObject>;
  await store.waitBeforeRoomRegister();
  const registered=await store.registerRoom(roomId,auth.session.clinicId,info.sceneId,auth.session.expiresAt) as boolean|undefined;
  if(registered===false)return error('PERMISSION_DENIED',403);
  if(invite&&inviteHash&&!await store.registerInviteRoom(roomId,invite.expiresAt,inviteHash,invite.generation))return error('PERMISSION_DENIED',403);
  return json({registered:registered??null});
 }
 const roomRegistry=url.pathname.match(/^\/__test\/room-registry\/([A-Za-z0-9_-]+)$/);
 if(roomRegistry&&request.method==='GET'){
  const auth=await authenticate(request,env);if(!auth)return json({},401);const clinicId=url.searchParams.get('clinicId')??'',sceneId=url.searchParams.get('sceneId')??'',store=env.AUTH_DO.getByName('sessions');
  return json({room:await store.canAddressRoom(auth.hash,roomRegistry[1]),scene:await store.hasActiveScene(clinicId,sceneId)});
 }
 const inviteIndex=url.pathname.match(/^\/__test\/invite-index\/([A-Za-z0-9_-]+)$/);
 if(inviteIndex&&request.method==='GET'){const registration=await env.AUTH_DO.getByName('sessions').activeInviteRegistration(inviteIndex[1]);return json({active:registration!==null,registration});}
 if(inviteIndex&&request.method==='POST'){
  const auth=env.AUTH_DO.getByName('sessions') as DurableObjectStub<AuthDurableObject>,input=await request.json() as {action:'register';expiresAt:number;tokenHash:string;generation:number}|{action:'clear';expected:{expiresAt:number;tokenHash:string|null;generation:number}|null}|{action:'expire-generation'};
  if(input.action==='register')return json({registered:await auth.registerInviteRoom(inviteIndex[1],input.expiresAt,input.tokenHash,input.generation)});
  if(input.action==='clear')return json({cleared:await auth.clearInviteRoom(inviteIndex[1],input.expected)});
  await auth.expireInviteGenerationForTest(inviteIndex[1]);return json({expired:true});
 }
 const assetGate=url.pathname.match(/^\/__test\/asset-gate\/([A-Za-z0-9_-]+)$/);
 if(assetGate){const room=env.ROOM_DO.getByName(assetGate[1]) as unknown as DurableObjectStub<RoomDurableObject>;
  return json(await room.assetReadGate(request.method==='POST'?(await request.json() as {hold:boolean}).hold:undefined));}
 if(url.pathname.startsWith('/api/assets/')){
  const roomId=url.searchParams.get('roomId');const bucket=env.PRIVATE_ASSETS!;
  const wrapped=new Proxy(bucket,{get(target,key){
   if(key==='get')return async(key:string)=>{const object=await target.get(key);if(roomId&&/^[A-Za-z0-9_-]+$/.test(roomId))await (env.ROOM_DO.getByName(roomId) as unknown as DurableObjectStub<RoomDurableObject>).waitForAssetRead();return object;};
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  return countedFetch(request,{...env,PRIVATE_ASSETS:wrapped});
 }

 // V8-C（Claude Opus 5, 2026-09-26）：wrangler dev 不套用 apps/worker/migrations，D1 表格過去靠各網域 fixture
 // 順手建立（G61 曾因此讓子集跑必 400）。本端點以與 migration 相同的 DDL 建立 worker 會讀到的表，
 // 讓不屬任何網域 fixture 的案例（例如排程清除）不必依賴執行順序。純 DDL、不寫入資料。
 if(url.pathname==='/__test/migrate'&&request.method==='POST'){
  const statements=[
   'CREATE TABLE IF NOT EXISTS scene_archive (clinic_id TEXT NOT NULL,scene_id TEXT NOT NULL,owner_id TEXT NOT NULL,source_room_id TEXT NOT NULL,version_id TEXT NOT NULL,scene_revision INTEGER NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,room_fence INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(clinic_id,scene_id,version_id))',
   'CREATE TABLE IF NOT EXISTS scene_versions (clinic_id TEXT NOT NULL,scene_id TEXT NOT NULL,version_id TEXT NOT NULL,scene_revision INTEGER NOT NULL,object_key TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(clinic_id,scene_id,version_id))',
   'CREATE TABLE IF NOT EXISTS scene_tombstones (clinic_id TEXT NOT NULL,scene_id TEXT NOT NULL,deleted_at INTEGER NOT NULL,PRIMARY KEY(clinic_id,scene_id))',
   'CREATE TABLE IF NOT EXISTS data_managers (clinic_id TEXT NOT NULL,participant_id TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(clinic_id,participant_id))',
  ];
  for(const statement of statements)await env.DIRECTORY!.prepare(statement).run();
  return json({ok:true});
 }
 // V8-C F3：驗「排程只清 tombstone、不產生備份」需要看得到 R2 與 D1 的殘留量；兩個端點都只讀不寫。
 if(url.pathname==='/__test/private-scene-objects'&&request.method==='GET'){
  const objects=await env.PRIVATE_SCENES!.list({limit:1000});
  return json({keys:objects.objects.map(o=>o.key),truncated:objects.truncated});
 }
 if(url.pathname==='/__test/archive-rows'&&request.method==='GET'){
  const archive=await env.DIRECTORY!.prepare('SELECT COUNT(*) AS n FROM scene_archive').first<{n:number}>();
  const versions=await env.DIRECTORY!.prepare('SELECT COUNT(*) AS n FROM scene_versions').first<{n:number}>();
  return json({rows:(archive?.n??0)+(versions?.n??0)});
 }
 if(url.pathname==='/__test/purge-tombstones'&&request.method==='POST'){try{return json(await purgeExpiredTombstones(env));}catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},500);}}
 if(url.pathname==='/__test/scheduled'&&request.method==='POST'){try{await worker.scheduled({scheduledTime:Date.now(),cron:'manual',noRetry(){}} as unknown as ScheduledController,env);return json({ok:true});}catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},500);}}
 // L12-3 B2：此分派器保留會談內與抹除相關的 fixture；版本／checkpoint 系列隨 VersionStore 一併移除。
   const initTest=url.pathname.match(/^\/__test\/room\/([A-Za-z0-9_-]+)\/(init-alarm-fail|initialize-fail)$/);
   if(initTest&&request.method==='POST'){const [,roomId,action]=initTest,room=env.ROOM_DO.getByName(roomId) as unknown as DurableObjectStub<RoomDurableObject>;
    if(action==='init-alarm-fail')return json(await room.initialAlarmFailure((await request.json() as {fail:boolean}).fail));
    const auth=await authenticate(request,env);if(!auth)return json({},401);const sceneId=crypto.randomUUID();
    try{return json({ok:true,result:await room.initialize(auth.session,roomId,sceneId,'dev-v1')});}
    catch(error){const inspect=await room.inspect(),storage=await room.roomStorageInspect(),active=await env.SCENE_COORDINATOR_DO.getByName(auth.session.clinicId+':'+sceneId).active();return json({ok:false,error:error instanceof Error?error.message:String(error),inspect,active,alarm:storage.alarm},500);}
   }
   if(url.pathname.startsWith('/__test/room/')){const [, , , roomId,action]=url.pathname.split('/');const room=env.ROOM_DO.getByName(roomId) as unknown as DurableObjectStub<RoomDurableObject>;if(action==='close-fail'&&request.method==='POST')return json(await room.closeFailure((await request.json() as {fail:boolean}).fail));if(action==='purge-fail'&&request.method==='POST')return json(await room.purgeErasureFailure((await request.json() as {fail:boolean}).fail));if(action==='socket-command-gate')return json(await room.socketCommandGate(request.method==='POST'?(await request.json() as {hold:boolean}).hold:undefined));if(action==='deletion-init'&&request.method==='POST'){const input=await request.json() as {participantId:string;active?:boolean};return json(await room.deletionInit(input.participantId,input.active));}if(action==='storage-inspect')return json(await room.roomStorageInspect());if(action==='test-socket')return json(await room.testSocket(request.method==='POST'?(await request.json() as {open:boolean}).open:undefined));if(action==='purge-erasure'&&request.method==='POST'){const input=await request.json() as {clinicId:string;sceneId:string};return json(await room.purgeErasure(input.clinicId,input.sceneId));}if(action==='inject-fault'&&request.method==='POST')return json(await room.injectFault((await request.json() as {mode:'before-commit'|'after-ack'|null}).mode));if(action==='operations-plan')return json(await room.operationsPlan());if(action==='idle-age'&&request.method==='POST')return json(await room.idleAge((await request.json() as {ms:number}).ms));if(action==='last-activity')return json(await room.lastActivityNow());if(action==='run-alarm'&&request.method==='POST')return json(await room.runAlarm());if(action==='instance')return json(await room.instance());if(action==='restart'&&request.method==='POST'){try{await room.restart();}catch{/* abort deliberately rejects the RPC; UUID verification proves reconstruction */}return json({restartRequested:true});}return json(action==='expire'?await room.expire():await room.inspect());}
 // L12-3：/__test/saved-pages 與 saved-pages-cleanup 隨保存作品列表（及其 spec）一併移除。
 if(url.pathname.startsWith('/__test/scene/')){
  const [, , , sceneId,action]=url.pathname.split('/'),clinicId=url.searchParams.get('clinic')??'clinic-a';
  if(action==='tombstone-age'&&request.method==='POST'){const {ageMs}=await request.json() as {ageMs:number};const r=await env.DIRECTORY!.prepare('UPDATE scene_tombstones SET deleted_at=? WHERE clinic_id=? AND scene_id=?').bind(Date.now()-ageMs,clinicId,sceneId).run();return json({changed:r.meta.changes});}
  if(action==='residue-fixture'&&request.method==='POST'){
   const input=await request.json() as {operation:'seed'|'clear';target:'r2'|'version'|'archive'};
   const key=clinicId+'/'+sceneId+'/legacy-fixture.bin',version='legacy-fixture',now=Date.now();
   if(input.operation==='seed'){
    if(input.target==='r2')await env.PRIVATE_SCENES!.put(key,'synthetic legacy residue');
    if(input.target==='version')await env.DIRECTORY!.prepare('INSERT OR REPLACE INTO scene_versions VALUES(?,?,?,?,?,?)').bind(clinicId,sceneId,version,1,key,now+86400000).run();
    if(input.target==='archive')await env.DIRECTORY!.prepare('INSERT OR REPLACE INTO scene_archive VALUES(?,?,?,?,?,?,?,?,?)').bind(clinicId,sceneId,'therapist','legacy-room',version,1,now+86400000,now,1).run();
   }else{
    if(input.target==='r2')await env.PRIVATE_SCENES!.delete(key);
    if(input.target==='version')await env.DIRECTORY!.prepare('DELETE FROM scene_versions WHERE clinic_id=? AND scene_id=? AND version_id=?').bind(clinicId,sceneId,version).run();
    if(input.target==='archive')await env.DIRECTORY!.prepare('DELETE FROM scene_archive WHERE clinic_id=? AND scene_id=? AND version_id=?').bind(clinicId,sceneId,version).run();
   }
   return json({ok:true});
  }
  if(action==='coordinator-instance'||action==='coordinator-restart'||action==='purge-d1-race'){
   const co=env.SCENE_COORDINATOR_DO.getByName(clinicId+':'+sceneId) as unknown as DurableObjectStub<SceneCoordinatorDurableObject>;
   if(action==='coordinator-instance')return json(await co.coordinatorInstance());
   if(action==='purge-d1-race'&&request.method==='POST')return json(await co.purgeD1RaceMode((await request.json() as {mode:'delete'|'rewrite'|null}).mode));
   if(request.method==='POST'){try{await co.coordinatorRestart();}catch{/* abort rejects the RPC; the instance UUID proves reconstruction */}return json({restartRequested:true});}
  }
  if(action==='tombstone-inspect')return json({tombstone:await env.DIRECTORY!.prepare('SELECT * FROM scene_tombstones WHERE clinic_id=? AND scene_id=?').bind(clinicId,sceneId).first(),coordinator:await (env.SCENE_COORDINATOR_DO.getByName(clinicId+':'+sceneId) as unknown as DurableObjectStub<SceneCoordinatorDurableObject>).storageInspect()});
   if(action==='register-fail'&&request.method==='POST'){const co=env.SCENE_COORDINATOR_DO.getByName(clinicId+':'+sceneId) as unknown as DurableObjectStub<SceneCoordinatorDurableObject>;return json(await co.registerFail((await request.json() as {fail:boolean}).fail));}
   if(action==='purge-failure'&&request.method==='POST'){const input=await request.json() as {target:'d1-delete'|'delete-all';fail:boolean};const co=env.SCENE_COORDINATOR_DO.getByName(clinicId+':'+sceneId) as unknown as DurableObjectStub<SceneCoordinatorDurableObject>;return json(await co.purgeFailure(input.target,input.fail));}
   if(action==='purge-read-gate') {const co=env.SCENE_COORDINATOR_DO.getByName(clinicId+':'+sceneId) as unknown as DurableObjectStub<SceneCoordinatorDurableObject>;return json(await co.purgeReadGate(request.method==='POST'?(await request.json() as {hold:boolean}).hold:undefined));}
   if(action==='directory-missing-fail-closed'&&request.method==='POST'){const input=await request.json() as {deployment:'staging'|'production'};const co=env.SCENE_COORDINATOR_DO.getByName(clinicId+':'+sceneId) as unknown as DurableObjectStub<SceneCoordinatorDurableObject>;return json(await co.directoryMissingFailClosed(clinicId,sceneId,input.deployment));}
  if(action==='purge-state-fail'&&request.method==='POST'){const co=env.SCENE_COORDINATOR_DO.getByName(clinicId+':'+sceneId) as unknown as DurableObjectStub<SceneCoordinatorDurableObject>;return json(await co.purgeStateFail((await request.json() as {fail:boolean}).fail));}
  if(action==='deletion-fail'){const co=env.SCENE_COORDINATOR_DO.getByName(clinicId+':'+sceneId) as unknown as DurableObjectStub<SceneCoordinatorDurableObject>;return json(await co.deletionFail((await request.json() as {target:'marker'|null}).target));}
  // G28：直呼真實 purgeTombstone（與 scheduled 同一方法）以觀察拒絕 reason；BUSY／KEY_MISMATCH 拒絕路徑無副作用。
   if(action==='purge-tombstone'&&request.method==='POST'){try{return json(await env.SCENE_COORDINATOR_DO.getByName(clinicId+':'+sceneId).purgeTombstone(clinicId,sceneId));}catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},500);}}
  if(action==='deletion-retarget'&&request.method==='POST'){const input=await request.json() as {clinicId:string;sceneId:string};return json(await (env.SCENE_COORDINATOR_DO.getByName(clinicId+':'+sceneId) as unknown as DurableObjectStub<SceneCoordinatorDurableObject>).deletionRetarget(input.clinicId,input.sceneId));}
  if(action==='deletion-state')return json(await (env.SCENE_COORDINATOR_DO.getByName(clinicId+':'+sceneId) as unknown as DurableObjectStub<SceneCoordinatorDurableObject>).deletionStateForTest());
  if(action==='deletion-status'&&request.method==='POST'){const {status}=await request.json() as {status:'PENDING'|'COMPLETE'};return json(await (env.SCENE_COORDINATOR_DO.getByName(clinicId+':'+sceneId) as unknown as DurableObjectStub<SceneCoordinatorDurableObject>).deletionStatusForTest(status));}
  if(action==='deletion-pending'&&request.method==='POST')return json(await (env.SCENE_COORDINATOR_DO.getByName(clinicId+':'+sceneId) as unknown as DurableObjectStub<SceneCoordinatorDurableObject>).deletionPending());
  if(action==='deletion-gate')return json(await (env.SCENE_COORDINATOR_DO.getByName(clinicId+':'+sceneId) as unknown as DurableObjectStub<SceneCoordinatorDurableObject>).deletionGate(request.method==='POST'?(await request.json() as {hold:boolean}).hold:undefined));
  if(action==='erasure-check-gate')return json(await (env.SCENE_COORDINATOR_DO.getByName(clinicId+':'+sceneId) as unknown as DurableObjectStub<SceneCoordinatorDurableObject>).erasureCheckGate(request.method==='POST'?(await request.json() as {hold:boolean}).hold:undefined));
  if(action==='deletion-process'){await env.SCENE_COORDINATOR_DO.getByName(clinicId+':'+sceneId).processDeletion();return json({ok:true});}
  if(action==='deletion-inspect')return json({r2Keys:(await env.PRIVATE_SCENES!.list({prefix:clinicId+'/'+sceneId+'/'})).objects.map(o=>o.key),versionRows:(await env.DIRECTORY!.prepare('SELECT * FROM scene_versions WHERE clinic_id=? AND scene_id=?').bind(clinicId,sceneId).all()).results,archiveRows:(await env.DIRECTORY!.prepare('SELECT * FROM scene_archive WHERE clinic_id=? AND scene_id=?').bind(clinicId,sceneId).all()).results});
 }
 // 2026-10-11 管理員後台：spec 讀 apps/worker/migrations 的真實 SQL 逐句送來執行（wrangler dev 不套 migration）；
 // ALTER TABLE 重跑的「duplicate column」視為已套用。oidc-finish 以假 subject 走真正的 finishLogin（ID token 驗證另有 unit 測試）。
 if(url.pathname==='/__test/d1-exec'&&request.method==='POST'){
  const {statements}=await request.json() as {statements:string[]};const results:unknown[]=[];
  for(const statement of statements){try{results.push((await env.DIRECTORY!.prepare(statement).all()).results);}catch(e){const message=e instanceof Error?e.message:String(e);if(!/duplicate column/i.test(message))return json({ok:false,statement,error:message},500);results.push('duplicate-column');}}
  return json({ok:true,results});
 }
 if(url.pathname==='/__test/clear-deactivated'&&request.method==='POST'){const {ids}=await request.json() as {ids:string[]};return json(await (env.AUTH_DO.getByName('sessions') as unknown as DurableObjectStub<AuthDurableObject>).resetDeactivatedForTest(ids));}
 // 2026-10-11 GPT-6 F1–F6 回歸用 hook（只存在於 runtime harness）。
 if(url.pathname.startsWith('/__test/admin-')&&request.method==='POST'){
  const input=await request.json() as {action?:'two'|'hold-clear'|'release-clear'|'status';id?:string;clinicId?:string;roomId?:string;fail?:boolean};
  const store=env.AUTH_DO.getByName('sessions') as unknown as DurableObjectStub<AuthDurableObject>;
  if(url.pathname==='/__test/admin-gate')return json(await store.adminGate(input.action??'status'));
  if(url.pathname==='/__test/admin-fence'){await store.markDeactivated(input.id!);return json({ok:true});}
  if(url.pathname==='/__test/admin-fence-status')return json({fenced:await store.isDeactivated(input.id!)});
  if(url.pathname==='/__test/admin-seed-sessions')return json(await store.seedSessionsInRoomForTest(input.id!,input.clinicId!,input.roomId!));
  if(url.pathname==='/__test/admin-sessions')return json({count:await store.sessionsOfForTest(input.id!)});
  if(url.pathname==='/__test/admin-room-failure')return json(await (env.ROOM_DO.getByName(input.roomId!) as unknown as DurableObjectStub<RoomDurableObject>).invalidateFailure(input.fail===true));
  if(url.pathname==='/__test/admin-only-permanent')return json(await (env.AUTH_DO.getByName('admin-alarm-isolated') as unknown as DurableObjectStub<AuthDurableObject>).onlyPermanentForTest());
 }
 if(url.pathname==='/__test/oidc-finish'&&request.method==='POST'){
  const input=await request.json() as {subject:string;code?:string};
  const response=await finishLogin(request,env,'https://accounts.google.test',input.subject,input.code?await hashToken(input.code):undefined);
  const headers=new Headers(response.headers);headers.delete('Set-Cookie');for(const cookie of response.headers.getSetCookie())headers.append('Set-Cookie',cookie.replace('; Secure',''));
  return new Response(response.body,{status:response.status,headers});
 }
 if(url.pathname==='/__test/login'&&request.method==='POST'){
  const value=await request.json() as {name:string};
  if(!['therapist','other','outsider'].includes(value.name))return json({},400);
  const {token}=await env.AUTH_DO.getByName('sessions').createSession({participantId:value.name,clinicId:value.name==='outsider'?'clinic-b':'clinic-a',role:'therapist'});
  return json({ok:true},200,{'Set-Cookie':sessionCookie(token).replace('; Secure','')});
 }
 return countedFetch(request,env);
}};


