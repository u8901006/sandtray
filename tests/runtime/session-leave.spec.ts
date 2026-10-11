import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
// V8-L12-1A（使用者裁定 L01-4，2026-09-25）：會談只在「治療師結束會談、雙方明確離開、無人操作兩小時」時結束並刪除。
// 案主一人按下結束不得刪除整個會談（L09-1 F-2）：session-only 房間的 close 只限擁有者治療師；
// 案主改用 leave——撤銷全部授權、登出該 session、讓出席位，會談與作品保留，治療師可再邀請。
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function attach(page:Page,id:string){await page.goto('/');return page.evaluate(id=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.closed=null;w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket`);w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onclose=(event:CloseEvent)=>{w.closed=event.code;};w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),id);}
async function send(page:Page,id:string,input:Record<string,unknown>){
 const state:{sessionEpoch:number;controlEpoch:number}=await page.evaluate(async id=>(await fetch(`/api/rooms/${id}/info`)).json(),id);const operationId=crypto.randomUUID();
 await page.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),{protocolVersion:1,operationId,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...input});
 await expect.poll(()=>page.evaluate(op=>(window as any).events.some((e:any)=>e.operationId===op),operationId)).toBe(true);
 return page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId);
}
async function setup(request:APIRequestContext,playwright:any,browser:any){
 await request.post('/__test/login',{data:{name:'therapist'}});const {id}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();
 const {token}=await (await post(request,`/api/rooms/${id}/invites`)).json();const client=await playwright.request.newContext({baseURL:origin});
 const redeemed=await (await post(client,'/api/invites/redeem',{token})).json();await post(request,`/api/rooms/${id}/admit`,{participantId:redeemed.participantId});
 const tc=await browser.newContext({storageState:await request.storageState()}),cc=await browser.newContext({storageState:await client.storageState()});
 const t=await tc.newPage(),c=await cc.newPage();expect(await attach(t,id)).toBe(true);expect(await attach(c,id)).toBe(true);
 expect((await send(c,id,{type:'object.create',objectId:'rock',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1}})).type).toBe('operation.ack');
 const req=await send(t,id,{type:'permission.request',objectId:'rock',actions:['translate']});
 expect((await send(c,id,{type:'permission.grant',objectId:'rock',requestId:req.operationId,actions:['translate'],durationMs:300000})).type).toBe('operation.ack');
 return {id,client,t,c,close:async()=>{await cc.close();await tc.close();await client.dispose();}};
}

test('L12-1A a client cannot end a session-only room; the room and its work survive',async({request,playwright,browser})=>{
 const room=await setup(request,playwright,browser);
 try{
  expect((await post(room.client,`/api/rooms/${room.id}/close`)).status()).toBe(403);
  const info=await (await request.get(`/api/rooms/${room.id}/info`)).json();expect(Object.keys(info.grants).length).toBe(1);
  expect((await (await request.get(`/api/rooms/${room.id}/snapshot`)).json()).objects.map((o:any)=>o.id)).toEqual(['rock']);
 }finally{await post(request,`/api/rooms/${room.id}/close`).catch(()=>{});await room.close();}
});

test('L12-1A client leave revokes authority and the session but keeps the room for the therapist',async({request,playwright,browser})=>{
 const room=await setup(request,playwright,browser);
 try{
  expect((await post(room.client,`/api/rooms/${room.id}/leave`)).status()).toBe(200);
  // 案主：session 失效、socket 被關閉，無法再讀房間
  await expect.poll(()=>room.c.evaluate(()=>(window as any).closed)).not.toBeNull();
  expect((await room.client.get(`/api/rooms/${room.id}/info`)).status()).toBe(401);
  // 治療師：房間與作品仍在，案主給的授權全數撤銷，可以重新邀請
  const info=await (await request.get(`/api/rooms/${room.id}/info`)).json();
  expect(info.grants).toEqual({});expect(info.leases).toEqual({});expect(info.exportConsent).toBeUndefined();
  expect((await (await request.get(`/api/rooms/${room.id}/snapshot`)).json()).objects.map((o:any)=>o.id)).toEqual(['rock']);
  // 案主已離開：治療師用舊授權搶鎖必須被拒（伺服器先判定案主不在場，回 GRANT_EXPIRED；無授權則 PERMISSION_DENIED），且鎖沒有被建立
  const lock=await send(room.t,room.id,{type:'object.lock.acquire',objectId:'rock',actions:['translate']});
  expect(lock.type).toBe('operation.rejected');expect(['PERMISSION_DENIED','GRANT_EXPIRED']).toContain(lock.code);
  expect((await (await request.get(`/api/rooms/${room.id}/info`)).json()).leases).toEqual({});
  expect((await post(request,`/api/rooms/${room.id}/invites`)).status()).toBe(200);
  // 治療師不能用 leave（治療師要結束請用 close）
  expect((await post(request,`/api/rooms/${room.id}/leave`)).status()).toBe(403);
  // 治療師結束會談才刪除
  expect((await post(request,`/api/rooms/${room.id}/close`)).status()).toBe(200);
  expect(await (await request.get(`/__test/room/${room.id}/inspect`)).json()).toEqual({room:0,operations:0,history:0});
 }finally{await room.close();}
});
