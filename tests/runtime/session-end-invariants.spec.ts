import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
// V8-C 段（Claude Opus 5, 2026-09-26）：L12-4「不可復活」與 F1／F3 的回歸。
// 依 L01-4 裁定，會談結束後伺服器不得保留或重建任何場景資料。A 段移除跨會談入口時一併刪掉了
// deletion／tombstone-purge 等 11 支 cloud spec，其中兩項保護目標（A13「close 失敗整筆回滾」、
// 「tombstone 擋晚到寫入與復活」）機制仍在程式裡卻失去覆蓋（V8-C-L12-3 的 F1／F2）。本檔補回。
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function session(request:APIRequestContext,playwright:{request:typeof import('@playwright/test').request},browser:import('@playwright/test').Browser){
 await request.post('/__test/login',{data:{name:'therapist'}});
 const {id,sceneId}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json() as {id:string;sceneId:string};
 const {token}=await (await post(request,`/api/rooms/${id}/invites`)).json() as {token:string};
 const clientApi=await playwright.request.newContext({baseURL:origin});
 const {participantId}=await (await post(clientApi,'/api/invites/redeem',{token,nickname:'結束後復活虛構案主'})).json() as {participantId:string};
 await post(request,`/api/rooms/${id}/admit`,{participantId});
 const cc=await browser.newContext({storageState:await clientApi.storageState()});
 return {id,sceneId,clientApi,cc};
}
// A raw socket so a command can be sent after the room has been closed, which the UI would never do.
async function attach(page:Page,id:string){
 await page.goto('/api/health');
 return page.evaluate(id=>new Promise<boolean>(resolve=>{
  const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket`);
  w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));
  w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);w.ws.onclose=()=>resolve(false);
 }),id);
}
const send=(page:Page,command:Record<string,unknown>)=>page.evaluate(c=>{(window as any).ws.send(JSON.stringify(c));},command);
const events=(page:Page)=>page.evaluate(()=>(window as any).events as Array<Record<string,any>>);

test('F1 a failed close rolls back every write: the confirmed scene and its history survive, and a later close still works',async({request,playwright,browser})=>{
 test.setTimeout(60000);const {id,clientApi,cc}=await session(request,playwright,browser);
 try{
  const c=await cc.newPage();expect(await attach(c,id)).toBe(true);
  const info=await (await clientApi.get(`/api/rooms/${id}/info`)).json() as {sessionEpoch:number;controlEpoch:number};
  await send(c,{protocolVersion:1,operationId:crypto.randomUUID(),sessionEpoch:info.sessionEpoch,controlEpoch:info.controlEpoch,type:'object.create',objectId:'rollback-rock',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[1,0,0],rotation:[0,0,0,1],scale:1}});
  await expect.poll(async()=>(await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json() as {objects:unknown[]}).objects.length).toBe(1);
  const before=await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json();
  // The removal step inside close's transaction fails.
  expect((await post(request,`/__test/room/${id}/close-fail`,{fail:true})).status()).toBe(200);
  expect((await post(request,`/api/rooms/${id}/close`)).status()).not.toBe(200);
  // Nothing may be half-deleted: the room still answers and the confirmed scene is byte-identical.
  const after=await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json() as Record<string,unknown>;
  const strip=(v:Record<string,unknown>)=>{const{updatedAt,...rest}=v;return rest;};
  expect(strip(after)).toEqual(strip(before as Record<string,unknown>));
  expect((await post(request,`/__test/room/${id}/close-fail`,{fail:false})).status()).toBe(200);
  expect((await post(request,`/api/rooms/${id}/close`)).status()).toBe(200);
  expect((await clientApi.get(`/api/rooms/${id}/snapshot`)).status()).not.toBe(200);
 }finally{await post(request,`/__test/room/${id}/close-fail`,{fail:false}).catch(()=>{});await cc.close();await clientApi.dispose();}
});

test('L12-4 (a)(d) a server-received in-flight command and ACK replay cannot mutate or ACK after session deletion',async({request,playwright,browser})=>{
 test.setTimeout(60000);const {id,clientApi,cc}=await session(request,playwright,browser);
 try{
  const c=await cc.newPage();expect(await attach(c,id)).toBe(true);
  const info=await (await clientApi.get(`/api/rooms/${id}/info`)).json() as {sessionEpoch:number;controlEpoch:number};
  const acked=crypto.randomUUID();
  const create={protocolVersion:1,operationId:acked,sessionEpoch:info.sessionEpoch,controlEpoch:info.controlEpoch,type:'object.create',objectId:'late-rock',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1}};
  await send(c,create);
  await expect.poll(async()=>(await events(c)).some(e=>e.type==='operation.ack'&&e.operationId===acked)).toBe(true);
  const lateId=crypto.randomUUID();
  expect((await post(request,`/__test/room/${id}/socket-command-gate`,{hold:true})).status()).toBe(200);
  await send(c,{...create,operationId:lateId,objectId:'zombie-rock'});
  await expect.poll(async()=>await (await request.get(`/__test/room/${id}/socket-command-gate`)).json()).toEqual({reached:1,completed:[],operationIds:[lateId]});
  // Replay the already-ACKed id as a second frame; both have entered the server handler before close.
  await send(c,create);
  await expect.poll(async()=>await (await request.get(`/__test/room/${id}/socket-command-gate`)).json()).toEqual({reached:2,completed:[],operationIds:[lateId,acked]});
  expect((await post(request,`/api/rooms/${id}/close`)).status()).toBe(200);
  // Release only after the durable tombstone and erasure completed. The fixture gate is inside
  // RoomDurableObject.webSocketMessage, so the command arrival is server-observed, not inferred from send().
  expect((await post(request,`/__test/room/${id}/socket-command-gate`,{hold:false})).status()).toBe(200);
  await expect.poll(async()=>{const state=await (await request.get(`/__test/room/${id}/socket-command-gate`)).json() as {reached:number;completed:string[];operationIds:string[]};return {...state,completed:[...state.completed].sort()};}).toEqual({reached:2,completed:[lateId,acked].sort(),operationIds:[lateId,acked]});
  await c.waitForTimeout(1500);
  expect((await clientApi.get(`/api/rooms/${id}/snapshot`)).status()).not.toBe(200);
  // The therapist cannot see a resurrected scene either; only the pre-close ACK exists, with no late ACK/replay.
  expect((await request.get(`/api/rooms/${id}/snapshot`)).status()).not.toBe(200);
  expect((await events(c)).filter(e=>e.type==='operation.ack').map(e=>e.operationId)).toEqual([acked]);
  }finally{await post(request,`/__test/room/${id}/socket-command-gate`,{hold:false}).catch(()=>{});await cc.close();await clientApi.dispose();}
});

test('L12-4 (b)(c) after the session ends, the old invite cannot be inspected or redeemed and addressing the room does not resurrect it',async({request,playwright,browser})=>{
 test.setTimeout(60000);
 await request.post('/__test/login',{data:{name:'therapist'}});
 const {id}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json() as {id:string};
 const {token}=await (await post(request,`/api/rooms/${id}/invites`)).json() as {token:string};
 const outsider=await playwright.request.newContext({baseURL:origin});
 try{
  expect((await post(request,`/api/rooms/${id}/close`)).status()).toBe(200);
  // (b) the invite that was valid one moment ago is worthless once the session is over.
  expect((await post(outsider,'/api/invites/inspect',{token})).status()).not.toBe(200);
  expect((await post(outsider,'/api/invites/redeem',{token,nickname:'不得復活虛構案主'})).status()).not.toBe(200);
  // (c) addressing the same roomId must not recreate a usable room, and must not let a new invite be minted.
  for(const path of [`/api/rooms/${id}/info`,`/api/rooms/${id}/snapshot`])expect((await request.get(path)).status()).not.toBe(200);
  expect((await post(request,`/api/rooms/${id}/invites`)).status()).not.toBe(200);
  expect((await post(request,`/api/rooms/${id}/admit`,{participantId:crypto.randomUUID()})).status()).not.toBe(200);
  // Re-initialising the same id is refused too: a closed room id is spent, not reusable.
  expect((await post(request,`/api/rooms/${id}/leave`)).status()).not.toBe(200);
 }finally{await outsider.dispose();}
});

test('F3 the scheduled handler only purges tombstones: it creates no backup object and no archive row',async({request})=>{
 test.setTimeout(60000);
 await request.post('/__test/login',{data:{name:'therapist'}});
 // D1 DDL 不由 wrangler dev 套用；本案不屬任何網域 fixture，自行確保表格存在（純 DDL）。
 expect((await post(request,'/__test/migrate')).status()).toBe(200);
 const {id}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json() as {id:string};
 expect((await post(request,`/api/rooms/${id}/close`)).status()).toBe(200);
 const scheduled=await post(request,'/__test/scheduled');
 expect({status:scheduled.status(),body:await scheduled.text()}).toEqual({status:200,body:'{"ok":true}'});
 // Daily backups were removed with L12-3: the R2 bucket and the D1 archive must stay empty after a scheduled run.
 const store=await (await request.get('/__test/private-scene-objects')).json() as {keys:string[]};
 expect(store.keys.filter(k=>k.includes('/backups/'))).toEqual([]);
 const archive=await (await request.get('/__test/archive-rows')).json() as {rows:number};
 expect(archive.rows).toBe(0);
});
