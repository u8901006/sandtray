import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
// V8-L02-6（2026-09-26 使用者裁定 L01-7）：房間在「無人操作兩小時」後到期。
// presence.heartbeat／room.hello／sync.request 只代表分頁還開著，不算操作，不得延長房間壽命；
// 真正的場景指令（例：object.create）才重置計時。以測試鉤子把 lastActivity 撥到到期前 2 秒，
// 再送指令、等過期限、手動觸發 alarm 判定。
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
const TWO_HOURS=7200000;
async function attach(page:Page,id:string){await page.goto('/');return page.evaluate(id=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket`);w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),id);}
async function send(page:Page,id:string,input:Record<string,unknown>){
 const state:{sessionEpoch:number;controlEpoch:number}=await page.evaluate(async id=>(await fetch(`/api/rooms/${id}/info`)).json(),id);const operationId=crypto.randomUUID();
 await page.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),{protocolVersion:1,operationId,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...input});
 await expect.poll(()=>page.evaluate(op=>(window as any).events.some((e:any)=>e.operationId===op),operationId)).toBe(true);
 return page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId);
}
async function setup(request:APIRequestContext,playwright:any,browser:any){
 await request.post('/__test/login',{data:{name:'therapist'}});const {id}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();
 const {token}=await (await post(request,`/api/rooms/${id}/invites`)).json();const clientApi=await playwright.request.newContext({baseURL:origin});
 const redeemed=await (await post(clientApi,'/api/invites/redeem',{token,nickname:'虛構'})).json();await post(request,`/api/rooms/${id}/admit`,{participantId:redeemed.participantId});
 const tc=await browser.newContext({storageState:await request.storageState()}),cc=await browser.newContext({storageState:await clientApi.storageState()});
 const t=await tc.newPage(),c=await cc.newPage();expect(await attach(t,id)).toBe(true);expect(await attach(c,id)).toBe(true);
 return {id,t,c,close:async()=>{await cc.close();await tc.close();await clientApi.dispose();}};
}
const age=(request:APIRequestContext,id:string)=>request.post(`/__test/room/${id}/idle-age`,{data:{ms:TWO_HOURS-2000}});
const lastActivity=async(request:APIRequestContext,id:string)=>(await (await request.get(`/__test/room/${id}/last-activity`)).json()).lastActivity as number;

test('L02-6 heartbeat, hello and sync.request do not extend the two-hour no-operation expiry',async({request,playwright,browser})=>{
 const room=await setup(request,playwright,browser);
 try{
  await age(request,room.id);const aged=await lastActivity(request,room.id);
  for(const page of [room.c,room.t]){
   expect((await send(page,room.id,{type:'presence.heartbeat'})).type).toBe('operation.ack');
   expect((await send(page,room.id,{type:'sync.request',afterServerSeq:0})).type).toBe('operation.ack');
  }
  // 純讀取指令之後 lastActivity 必須原封不動。
  expect(await lastActivity(request,room.id)).toBe(aged);
  await new Promise(resolve=>setTimeout(resolve,2500));
  expect(await (await request.post(`/__test/room/${room.id}/run-alarm`)).json()).toEqual({room:0,operations:0,history:0});
 }finally{await room.close();}
});

test('L02-6 a real scene operation resets the two-hour no-operation expiry (positive control)',async({request,playwright,browser})=>{
 const room=await setup(request,playwright,browser);
 try{
  await age(request,room.id);const aged=await lastActivity(request,room.id);
  expect((await send(room.c,room.id,{type:'object.create',objectId:'rock',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1}})).type).toBe('operation.ack');
  expect(await lastActivity(request,room.id)).toBeGreaterThan(aged);
  await new Promise(resolve=>setTimeout(resolve,2500));
  const rows=await (await request.post(`/__test/room/${room.id}/run-alarm`)).json();expect(rows.room).toBe(1);
 }finally{await room.close();}
});
