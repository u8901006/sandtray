import {test,expect,type APIRequestContext} from '@playwright/test';
// L12-2（使用者裁定 L01-4：會談結束後伺服器不留任何場景資料。Claude Opus 5, 2026-09-26）
// 治療師結束會談與兩小時無操作到期都必須刪除整個場景：Room DO 儲存、R2 物件、D1 scene_versions／
// scene_archive；tombstone 留下只為擋晚到寫入與復活（L12-4）。刪除中途失敗必須留 PENDING 並重試到
// COMPLETE，且重試期間任何讀寫都被拒絕——不得出現「宣稱結束但資料還在」或「半途刪除後靜默放棄」。
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function sessionWithWork(request:APIRequestContext,playwright:{request:typeof import('@playwright/test').request}){
 await request.post('/__test/login',{data:{name:'therapist'}});
 expect((await post(request,'/__test/migrate')).status()).toBe(200);
 const {id,sceneId}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json() as {id:string;sceneId:string};
 const {token}=await (await post(request,`/api/rooms/${id}/invites`)).json() as {token:string};
 const clientApi=await playwright.request.newContext({baseURL:origin});
 const {participantId}=await (await post(clientApi,'/api/invites/redeem',{token,nickname:'結束即焚虛構案主'})).json() as {participantId:string};
 await post(request,`/api/rooms/${id}/admit`,{participantId});
 return {id,sceneId,clientApi};
}
type Residue={r2Keys:string[];versionRows:unknown[];archiveRows:unknown[]};
type Deletion={status?:string;deleted_at?:number};
const residue=async(api:APIRequestContext,sceneId:string)=>(await (await api.get(`/__test/scene/${sceneId}/deletion-inspect`)).json()) as Residue;
const deletion=async(api:APIRequestContext,sceneId:string)=>{
 const marker=(await (await api.get(`/__test/scene/${sceneId}/tombstone-inspect`)).json()) as {tombstone:Deletion|null};
 const state=(await (await api.get(`/__test/scene/${sceneId}/deletion-state`)).json()) as {deletion:Deletion|null};
 return {tombstone:marker.tombstone,coordinator:state.deletion};
};
const roomStorage=async(api:APIRequestContext,roomId:string)=>(await (await api.get(`/__test/room/${roomId}/storage-inspect`)).json()) as Record<string,unknown>;
const coordinatorStorage=async(api:APIRequestContext,sceneId:string)=>((await (await api.get(`/__test/scene/${sceneId}/tombstone-inspect`)).json()) as {coordinator:{tables:string[];deletionRows:number;writerRows:number;sceneRooms:number;sceneGenerationRows:number;alarm:number|null}}).coordinator;
async function seedSceneContent(request:APIRequestContext,browser:import('@playwright/test').Browser,id:string,clientApi:APIRequestContext){
 const context=await browser.newContext({storageState:await clientApi.storageState()});
 try{
  const page=await context.newPage();await page.goto('/api/health');
  const connected=await page.evaluate((roomId:string)=>new Promise<boolean>(resolve=>{
   const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${roomId}/socket`);
   w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);w.ws.onclose=()=>resolve(false);
  }),id);
  expect(connected).toBe(true);
  const info=await (await clientApi.get(`/api/rooms/${id}/info`)).json() as {sessionEpoch:number;controlEpoch:number};
  const operationId=crypto.randomUUID();
  const command={protocolVersion:1,operationId,sessionEpoch:info.sessionEpoch,controlEpoch:info.controlEpoch,type:'object.create',objectId:'seeded-rock',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[1,0,0],rotation:[0,0,0,1],scale:1}};
  await page.evaluate(value=>(window as any).ws.send(JSON.stringify(value)),command);
  await expect.poll(async()=>await page.evaluate((op:string)=>(window as any).events.some((event:any)=>event.type==='operation.ack'&&event.operationId===op),operationId),{timeout:10000}).toBe(true);
  expect(((await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json()) as {objects:unknown[]}).objects).toHaveLength(1);
  const state=await roomStorage(request,id);
  expect(state.operations as number).toBeGreaterThan(0);expect(state.history as number).toBeGreaterThan(0);
 }finally{await context.close();}
}

test('L12-2 the therapist ending the session erases seeded scene data everywhere and leaves only the tombstone',async({request,playwright,browser})=>{
 test.setTimeout(60000);const {id,sceneId,clientApi}=await sessionWithWork(request,playwright);
 try{
  await seedSceneContent(request,browser,id,clientApi);
  for(const target of ['r2','version','archive'] as const)expect((await post(request,`/__test/scene/${sceneId}/residue-fixture`,{operation:'seed',target})).status()).toBe(200);
  const beforeResidue=await residue(request,sceneId);
  expect(beforeResidue.r2Keys).toHaveLength(1);expect(beforeResidue.versionRows).toHaveLength(1);expect(beforeResidue.archiveRows).toHaveLength(1);
  expect((await clientApi.get(`/api/rooms/${id}/snapshot`)).status()).toBe(200);
  const closed=await post(request,`/api/rooms/${id}/close`);
  expect({status:closed.status(),body:await closed.json()}).toEqual({status:200,body:{id,deletion:'COMPLETE'}});
  // Each storage layer had data before close, and is genuinely empty after deletion.
  expect(await residue(request,sceneId)).toEqual({r2Keys:[],versionRows:[],archiveRows:[]});
  // The Room DO holds no scene data: room, operations and history are all empty.
  const storage=await roomStorage(request,id);
  expect(storage).toMatchObject({room:0,versions:0,operations:0,history:0,roomCleanup:0,erasure:1});
  // Only the tombstone survives, and it exists to block resurrection (L12-4), not as a copy of the work.
  const marker=await deletion(request,sceneId);
  expect(marker.tombstone).not.toBeNull();
  expect(marker.coordinator?.status).toBe('COMPLETE');
  // During the 8 h retention window, tombstone plus coordinator deny/retry state remain to block resurrection.
  // Neither seat can read the scene again.
  expect((await clientApi.get(`/api/rooms/${id}/snapshot`)).status()).not.toBe(200);
  expect((await request.get(`/api/rooms/${id}/snapshot`)).status()).not.toBe(200);
 }finally{await clientApi.dispose();}
});

test('L12-2 two idle hours erase the scene the same way, with no request from either seat',async({request,playwright})=>{
 test.setTimeout(60000);const {id,sceneId,clientApi}=await sessionWithWork(request,playwright);
 try{
  // Age the room past the two-hour idle limit and run its alarm, exactly as the platform would.
  expect((await post(request,`/__test/room/${id}/idle-age`,{ms:7200001})).status()).toBe(200);
  expect((await post(request,`/__test/room/${id}/run-alarm`)).status()).toBe(200);
  // The room's alarm may only register the deletion (calling it inline would re-enter this DO), so the
  // coordinator's own alarm finishes it. Poll until COMPLETE instead of assuming a single pass.
  await expect.poll(async()=>(await deletion(request,sceneId)).coordinator?.status,{timeout:20000}).toBe('COMPLETE');
  expect(await residue(request,sceneId)).toEqual({r2Keys:[],versionRows:[],archiveRows:[]});
  expect((await deletion(request,sceneId)).tombstone).not.toBeNull();
  expect((await clientApi.get(`/api/rooms/${id}/snapshot`)).status()).not.toBe(200);
 }finally{await clientApi.dispose();}
});

test('L12-2 a deletion that fails mid-way stays PENDING, keeps refusing access and completes on retry',async({request,playwright})=>{
 test.setTimeout(60000);const {id,sceneId,clientApi}=await sessionWithWork(request,playwright);
 try{
  // The tombstone write fails: the scene must not be reported as deleted, and must not be readable either.
  expect((await post(request,`/__test/scene/${sceneId}/deletion-fail`,{target:'marker'})).status()).toBe(200);
  const closed=await post(request,`/api/rooms/${id}/close`);
  expect(closed.status()).toBe(200);
  expect((await closed.json() as {deletion:string}).deletion).toBe('PENDING');
  expect((await deletion(request,sceneId)).coordinator?.status).toBe('PENDING');
  // Refused while pending — the work is neither readable nor resurrectable in this window.
  for(const path of [`/api/rooms/${id}/snapshot`,`/api/rooms/${id}/info`])expect((await request.get(path)).status()).not.toBe(200);
  expect((await post(request,`/api/rooms/${id}/invites`)).status()).not.toBe(200);
  // Clear the fault: the retry must finish the deletion, not leave it half-done.
  expect((await post(request,`/__test/scene/${sceneId}/deletion-fail`,{target:null})).status()).toBe(200);
  expect((await post(request,`/__test/scene/${sceneId}/deletion-process`)).status()).toBe(200);
  await expect.poll(async()=>(await deletion(request,sceneId)).coordinator?.status,{timeout:20000}).toBe('COMPLETE');
  expect(await residue(request,sceneId)).toEqual({r2Keys:[],versionRows:[],archiveRows:[]});
 }finally{await post(request,`/__test/scene/${sceneId}/deletion-fail`,{target:null}).catch(()=>{});await clientApi.dispose();}
});

// C09-F1（Claude Opus 5.5, 2026-09-26）：兩小時到期時 Room DO 已經清掉作用中的房間，之後才向 coordinator 登記刪除。
// 登記那一刻若失敗，下一次 alarm 看到的是「沒有房間」——舊實作在此直接 return，重試永遠不會發生，場景的
// tombstone／R2／D1 清除就此遺失。登記必須跟著 room_cleanup outbox 一起重試。
test('L12-2 an idle expiry whose deletion registration fails is retried until the scene is erased',async({request,playwright})=>{
 test.setTimeout(60000);const {id,sceneId,clientApi}=await sessionWithWork(request,playwright);
 try{
  expect((await post(request,`/__test/scene/${sceneId}/register-fail`,{fail:true})).status()).toBe(200);
  expect((await post(request,`/__test/room/${id}/idle-age`,{ms:7200001})).status()).toBe(200);
  expect((await post(request,`/__test/room/${id}/run-alarm`)).status()).toBe(200);
  // Registration failed: nothing is recorded yet, and the room is already unreadable.
  expect((await deletion(request,sceneId)).coordinator).toBeNull();
  expect((await clientApi.get(`/api/rooms/${id}/snapshot`)).status()).not.toBe(200);
  // Clear the fault. The next alarm of the room must retry the registration on its own.
  expect((await post(request,`/__test/scene/${sceneId}/register-fail`,{fail:false})).status()).toBe(200);
  await expect.poll(async()=>{await post(request,`/__test/room/${id}/run-alarm`);return (await deletion(request,sceneId)).coordinator?.status;},{timeout:20000}).toBe('COMPLETE');
  expect(await residue(request,sceneId)).toEqual({r2Keys:[],versionRows:[],archiveRows:[]});
 expect((await deletion(request,sceneId)).tombstone).not.toBeNull();
 }finally{await post(request,`/__test/scene/${sceneId}/register-fail`,{fail:false}).catch(()=>{});await clientApi.dispose();}
});

test('L12-6 an expired tombstone remains the retry index when coordinator purge storage fails',async({request,playwright})=>{
 test.setTimeout(60000);const {id,sceneId,clientApi}=await sessionWithWork(request,playwright);
 try{
  const closed=await post(request,`/api/rooms/${id}/close`);
   expect(closed.status()).toBe(200);
   expect((await closed.json() as {deletion:string}).deletion).toBe('COMPLETE');
   expect(await residue(request,sceneId)).toEqual({r2Keys:[],versionRows:[],archiveRows:[]});
   // Leave a one-minute margin so HTTP/runtime scheduling cannot cross the exact 8 h boundary before the assertion.
   expect((await post(request,`/__test/scene/${sceneId}/tombstone-age`,{ageMs:28800000-60000})).status()).toBe(200);
   const beforeExpiry=await post(request,'/__test/purge-tombstones');
   expect(beforeExpiry.status()).toBe(200);
   expect(await beforeExpiry.json()).toEqual({purged:0,skipped:0});
   expect((await deletion(request,sceneId)).tombstone).not.toBeNull();
   expect((await post(request,`/__test/scene/${sceneId}/tombstone-age`,{ageMs:28800000+1000})).status()).toBe(200);
  expect((await post(request,`/__test/scene/${sceneId}/purge-state-fail`,{fail:true})).status()).toBe(200);
  // Inject a coordinator purge-state failure before deleteAll; the tombstone remains the independent retry index.
  expect((await post(request,'/__test/purge-tombstones')).status()).toBe(500);
  const retained=await deletion(request,sceneId);
  expect(retained.tombstone).not.toBeNull();
  expect(retained.coordinator?.status).toBe('COMPLETE');
  expect(await residue(request,sceneId)).toEqual({r2Keys:[],versionRows:[],archiveRows:[]});
  const afterFailure=(await (await request.get(`/__test/scene/${sceneId}/tombstone-inspect`)).json()) as {coordinator:{deletionRows:number;writerRows:number;sceneRooms:number;alarm:number|null}};
  expect(afterFailure.coordinator.deletionRows).toBe(1);
  expect(afterFailure.coordinator.writerRows).toBe(0);
  expect(afterFailure.coordinator.sceneRooms).toBe(0);
  expect(afterFailure.coordinator.alarm).not.toBeNull();

  expect((await post(request,`/__test/scene/${sceneId}/purge-state-fail`,{fail:false})).status()).toBe(200);
  expect((await post(request,'/__test/purge-tombstones')).status()).toBe(200);
  const purged=await deletion(request,sceneId);
  expect(purged.tombstone).toBeNull();
  expect(purged.coordinator).toBeNull();
  const afterSuccess=(await (await request.get(`/__test/scene/${sceneId}/tombstone-inspect`)).json()) as {coordinator:{deletionRows:number}};
  expect(afterSuccess.coordinator.deletionRows).toBe(0);
  // Once the 8 h window and all cleanup preconditions are satisfied, no coordinator application state or alarm remains.
  expect(await coordinatorStorage(request,sceneId)).toEqual({tables:[],deletionRows:0,writerRows:0,sceneRooms:0,sceneGenerationRows:0,alarm:null});
 }finally{
  await post(request,`/__test/scene/${sceneId}/purge-state-fail`,{fail:false}).catch(()=>{});
  await clientApi.dispose();
 }
});

test('L12-6 an expired tombstone stays until deletion is COMPLETE and every legacy residue is gone',async({request,playwright})=>{
 test.setTimeout(90000);const {id,sceneId,clientApi}=await sessionWithWork(request,playwright);
 const seed=(target:'r2'|'version'|'archive')=>post(request,`/__test/scene/${sceneId}/residue-fixture`,{operation:'seed',target});
 const clear=(target:'r2'|'version'|'archive')=>post(request,`/__test/scene/${sceneId}/residue-fixture`,{operation:'clear',target});
 try{
  expect((await post(request,`/api/rooms/${id}/close`)).status()).toBe(200);
  expect((await post(request,`/__test/scene/${sceneId}/tombstone-age`,{ageMs:28800000+1000})).status()).toBe(200);
  // Even after 8 h, an incomplete deletion must remain denied and indexed for retry.
  expect((await post(request,`/__test/scene/${sceneId}/deletion-status`,{status:'PENDING'})).status()).toBe(200);
  expect(await (await (await post(request,'/__test/purge-tombstones')).json())).toEqual({purged:0,skipped:1});
  expect((await deletion(request,sceneId)).tombstone).not.toBeNull();
  expect((await deletion(request,sceneId)).coordinator?.status).toBe('PENDING');
  expect((await clientApi.get(`/api/rooms/${id}/snapshot`)).status()).not.toBe(200);

  expect((await post(request,`/__test/scene/${sceneId}/deletion-status`,{status:'COMPLETE'})).status()).toBe(200);
  for(const target of ['version','archive','r2'] as const){
   expect((await seed(target)).status()).toBe(200);
   const before=await residue(request,sceneId);
   if(target==='version')expect(before.versionRows).toHaveLength(1);
   if(target==='archive')expect(before.archiveRows).toHaveLength(1);
   if(target==='r2')expect(before.r2Keys).toHaveLength(1);
   expect((await post(request,'/__test/purge-tombstones')).status()).toBe(200);
   expect(await (await (await post(request,'/__test/purge-tombstones')).json())).toEqual({purged:0,skipped:1});
   expect((await deletion(request,sceneId)).tombstone).not.toBeNull();
   expect((await clientApi.get(`/api/rooms/${id}/snapshot`)).status()).not.toBe(200);
   expect((await clear(target)).status()).toBe(200);
  }
  expect(await (await (await post(request,'/__test/purge-tombstones')).json())).toEqual({purged:1,skipped:0});
  expect((await deletion(request,sceneId)).tombstone).toBeNull();
 }finally{
  for(const target of ['version','archive','r2'] as const)await clear(target).catch(()=>{});
  await post(request,`/__test/scene/${sceneId}/deletion-status`,{status:'COMPLETE'}).catch(()=>{});
  await clientApi.dispose();
 }
});

test('L12-2 a purge claim is taken before the first D1 await, so a concurrent sweep cannot pass it',async({request,playwright})=>{
 test.setTimeout(60000);const {id,sceneId,clientApi}=await sessionWithWork(request,playwright);
 const gate=`/__test/scene/${sceneId}/purge-read-gate`;
 try{
  expect((await post(request,`/api/rooms/${id}/close`)).status()).toBe(200);
  expect((await post(request,`/__test/scene/${sceneId}/tombstone-age`,{ageMs:28800000+1000})).status()).toBe(200);
  expect((await post(request,gate,{hold:true})).status()).toBe(200);
  const first=post(request,`/__test/scene/${sceneId}/purge-tombstone`);
  await expect.poll(async()=>await (await request.get(gate)).json()).toEqual({reached:true,calls:1});
  const second=await post(request,`/__test/scene/${sceneId}/purge-tombstone`);
  expect({status:second.status(),body:await second.json()}).toEqual({status:200,body:{purged:false,reason:'BUSY'}});
  // The second call must return at the in-memory claim, without entering the D1 read seam.
  expect(await (await request.get(gate)).json()).toEqual({reached:true,calls:1});
  expect((await post(request,gate,{hold:false})).status()).toBe(200);
  expect({status:(await first).status(),body:await (await first).json()}).toEqual({status:200,body:{purged:true}});
  expect(await deletion(request,sceneId)).toEqual({tombstone:null,coordinator:null});
 }finally{
  await post(request,gate,{hold:false}).catch(()=>{});
  await clientApi.dispose();
 }
});

test('L12-2 and L12-6 named staging fails closed when DIRECTORY is absent during access checks and alarm recovery',async({request,playwright})=>{
 test.setTimeout(60000);const {id,sceneId,clientApi}=await sessionWithWork(request,playwright);
 try{
  expect((await post(request,`/api/rooms/${id}/close`)).status()).toBe(200);
  for(const deployment of ['staging','production'] as const){
   const response=await post(request,`/__test/scene/${sceneId}/directory-missing-fail-closed`,{deployment});
   expect(response.status()).toBe(200);
   expect(await response.json()).toEqual({denied:true,localStatus:'COMPLETE',alarm:true,tombstoneRetained:true});
  }
  const state=await deletion(request,sceneId);
  expect(state.tombstone).not.toBeNull();
  expect(state.coordinator?.status).toBe('COMPLETE');
 }finally{await clientApi.dispose();}
});

test('L12-2 and L12-6 Room DO and coordinator deleteAll failures recover by alarm; D1 failure recovers by scheduled sweep',async({request,playwright})=>{
 test.setTimeout(180000);
 const cases=[{target:'room' as const},{target:'delete-all' as const},{target:'d1-delete' as const}];
 for(const scenario of cases){
  const {id,sceneId,clientApi}=await sessionWithWork(request,playwright);
  try{
   expect((await post(request,`/api/rooms/${id}/close`)).status()).toBe(200);
   expect((await post(request,`/__test/scene/${sceneId}/tombstone-age`,{ageMs:28800000+1000})).status()).toBe(200);
   const setFailure=async(fail:boolean)=>scenario.target==='room'
    ?post(request,`/__test/room/${id}/purge-fail`,{fail})
    :post(request,`/__test/scene/${sceneId}/purge-failure`,{target:scenario.target,fail});
   expect((await setFailure(true)).status()).toBe(200);
   expect((await post(request,`/__test/scene/${sceneId}/purge-tombstone`)).status()).toBe(500);
   const retained=await deletion(request,sceneId);
   expect(retained.tombstone).not.toBeNull();
   if(scenario.target==='d1-delete'){
    // deleteAll already succeeded; D1 is now the sole durable retry index and no DO alarm/storage may be recreated.
    expect(retained.coordinator).toBeNull();
    expect(await coordinatorStorage(request,sceneId)).toEqual({tables:[],deletionRows:0,writerRows:0,sceneRooms:0,sceneGenerationRows:0,alarm:null});
   }else{
    expect(retained.coordinator?.status).toBe('COMPLETE');
    const inspect=await coordinatorStorage(request,sceneId);
    expect(inspect.alarm).not.toBeNull();
   }
   expect(await residue(request,sceneId)).toEqual({r2Keys:[],versionRows:[],archiveRows:[]});
   // A Room/deleteAll failure retains the DO alarm. A post-deleteAll D1 failure leaves only the D1 index,
   // so the same scheduled sweep used by the hourly cron must discover and finish the retry.
   expect((await setFailure(false)).status()).toBe(200);
   if(scenario.target==='d1-delete'){
    const retried=await post(request,'/__test/purge-tombstones');
    expect({status:retried.status(),body:await retried.json()}).toEqual({status:200,body:{purged:1,skipped:0}});
   }else{
    await expect.poll(async()=>await deletion(request,sceneId),{timeout:25000,intervals:[250,500,1000,2000]}).toEqual({tombstone:null,coordinator:null});
   }
   expect(await residue(request,sceneId)).toEqual({r2Keys:[],versionRows:[],archiveRows:[]});
   expect(await coordinatorStorage(request,sceneId)).toEqual({tables:[],deletionRows:0,writerRows:0,sceneRooms:0,sceneGenerationRows:0,alarm:null});
  }finally{
   if(scenario.target==='room')await post(request,`/__test/room/${id}/purge-fail`,{fail:false}).catch(()=>{});
   else await post(request,`/__test/scene/${sceneId}/purge-failure`,{target:scenario.target,fail:false}).catch(()=>{});
   await clientApi.dispose();
  }
 }
});

// L12-6 (Claude Opus 5.5, 2026-09-27): the post-deleteAll D1 failure case above retries on the same warm instance. Here the
// coordinator isolate is discarded in between, so every in-memory fence (coordinatorStorageCleared, maintenanceRunning) is lost
// and only the D1 tombstone can drive recovery. A fresh instance must stay denied and the scheduled sweep must still converge.
test('L12-6 a coordinator isolate restart after a post-deleteAll D1 failure still converges through the scheduled sweep',async({request,playwright})=>{
 test.setTimeout(90000);const {id,sceneId,clientApi}=await sessionWithWork(request,playwright);
 const instance=async()=>((await (await request.get(`/__test/scene/${sceneId}/coordinator-instance`)).json()) as {instanceId:string}).instanceId;
 try{
  expect((await post(request,`/api/rooms/${id}/close`)).status()).toBe(200);
  expect((await post(request,`/__test/scene/${sceneId}/tombstone-age`,{ageMs:28800000+1000})).status()).toBe(200);
  expect((await post(request,`/__test/scene/${sceneId}/purge-failure`,{target:'d1-delete',fail:true})).status()).toBe(200);
  expect((await post(request,`/__test/scene/${sceneId}/purge-tombstone`)).status()).toBe(500);
  expect(await coordinatorStorage(request,sceneId)).toEqual({tables:[],deletionRows:0,writerRows:0,sceneRooms:0,sceneGenerationRows:0,alarm:null});
  const before=await instance();
  expect((await post(request,`/__test/scene/${sceneId}/coordinator-restart`)).status()).toBe(200);
  await expect.poll(instance,{timeout:10000}).not.toBe(before);
  // The injected failure flag lived in the discarded isolate; the fresh one has no local marker and no alarm.
  const woken=await coordinatorStorage(request,sceneId);
  expect(woken.deletionRows).toBe(0);expect(woken.writerRows).toBe(0);expect(woken.sceneRooms).toBe(0);expect(woken.alarm).toBeNull();
  // The D1 tombstone alone still denies access and remains the retry index.
  expect((await deletion(request,sceneId)).tombstone).not.toBeNull();
  expect((await clientApi.get(`/api/rooms/${id}/snapshot`)).status()).not.toBe(200);
  expect(await residue(request,sceneId)).toEqual({r2Keys:[],versionRows:[],archiveRows:[]});
  const retried=await post(request,'/__test/purge-tombstones');
  expect({status:retried.status(),body:await retried.json()}).toEqual({status:200,body:{purged:1,skipped:0}});
  expect(await deletion(request,sceneId)).toEqual({tombstone:null,coordinator:null});
  expect(await coordinatorStorage(request,sceneId)).toEqual({tables:[],deletionRows:0,writerRows:0,sceneRooms:0,sceneGenerationRows:0,alarm:null});
  expect(await residue(request,sceneId)).toEqual({r2Keys:[],versionRows:[],archiveRows:[]});
 }finally{
  await post(request,`/__test/scene/${sceneId}/purge-failure`,{target:'d1-delete',fail:false}).catch(()=>{});
  await clientApi.dispose();
 }
});

// L12-6: the conditional D1 DELETE runs after deleteAll. If the tombstone changed underneath it (changes=0), the purge must
// report MARKER_CHANGED without recreating coordinator state; a rewritten tombstone keeps denying access and stays indexed.
test('L12-6 a conditional tombstone DELETE with changes=0 reports MARKER_CHANGED and never resurrects coordinator state',async({request,playwright})=>{
 test.setTimeout(120000);
 for(const mode of ['delete','rewrite'] as const){
  const {id,sceneId,clientApi}=await sessionWithWork(request,playwright);
  try{
   expect((await post(request,`/api/rooms/${id}/close`)).status()).toBe(200);
   expect((await post(request,`/__test/scene/${sceneId}/tombstone-age`,{ageMs:28800000+1000})).status()).toBe(200);
   expect((await post(request,`/__test/scene/${sceneId}/purge-d1-race`,{mode})).status()).toBe(200);
   const raced=await post(request,`/__test/scene/${sceneId}/purge-tombstone`);
   expect({status:raced.status(),body:await raced.json()}).toEqual({status:200,body:{purged:false,reason:'MARKER_CHANGED'}});
   expect(await coordinatorStorage(request,sceneId)).toEqual({tables:[],deletionRows:0,writerRows:0,sceneRooms:0,sceneGenerationRows:0,alarm:null});
   expect(await residue(request,sceneId)).toEqual({r2Keys:[],versionRows:[],archiveRows:[]});
   const state=await deletion(request,sceneId);
   expect(state.coordinator).toBeNull();
   if(mode==='delete'){
    expect(state.tombstone).toBeNull();
   }else{
    // A newer tombstone is inside its own 8 h window: still denied, not purged, and not duplicated into DO state.
    expect(state.tombstone).not.toBeNull();
    expect((await clientApi.get(`/api/rooms/${id}/snapshot`)).status()).not.toBe(200);
    expect(await (await (await post(request,'/__test/purge-tombstones')).json())).toEqual({purged:0,skipped:0});
    expect((await deletion(request,sceneId)).tombstone).not.toBeNull();
   }
  }finally{
   await post(request,`/__test/scene/${sceneId}/purge-d1-race`,{mode:null}).catch(()=>{});
   await clientApi.dispose();
  }
 }
});
