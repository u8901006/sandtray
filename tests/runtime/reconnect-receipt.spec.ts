import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function attach(page:Page,id:string,takeover=false){await page.goto('/');return page.evaluate(({id,takeover})=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket${takeover?'?takeover=1':''}`);w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),{id,takeover});}
async function info(page:Page,id:string):Promise<{sessionEpoch:number;controlEpoch:number}>{return page.evaluate(async id=>{const {sessionEpoch,controlEpoch}=await (await fetch(`/api/rooms/${id}/info`)).json() as {sessionEpoch:number;controlEpoch:number};return {sessionEpoch,controlEpoch};},id);}
async function send(page:Page,id:string,input:Record<string,unknown>){const state=await info(page,id);const operationId=(input.operationId as string)??crypto.randomUUID();await page.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),{protocolVersion:1,operationId,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...input});await expect.poll(()=>page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId),{timeout:5000}).toBeTruthy();return page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId);}
test('A09: lost ACK survives reconnect; changed epoch cannot apply the operation twice',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const {id}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();
 const {token}=await (await post(request,`/api/rooms/${id}/invites`)).json();
 const clientApi=await playwright.request.newContext({baseURL:origin});
 const redeemed=await (await post(clientApi,'/api/invites/redeem',{token,nickname:'虛構'})).json();
 await post(request,`/api/rooms/${id}/admit`,{participantId:redeemed.participantId});
 const cc=await browser.newContext({storageState:await clientApi.storageState()});
 const tc=await browser.newContext({storageState:await request.storageState()});
 try{
  const c=await cc.newPage();expect(await attach(c,id)).toBe(true);
  const state=await info(c,id);
  const cmd={protocolVersion:1,type:'object.create',operationId:crypto.randomUUID(),...state,objectId:'retry-rock',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1}};
  await c.evaluate(cmd=>{const w=window as any;w.ws.onmessage=(event:MessageEvent)=>{const message=JSON.parse(event.data);if(message.type!=='operation.ack')w.events.push(message);};w.ws.send(JSON.stringify(cmd));},cmd);
  await expect.poll(async()=>(await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json()).sceneRevision).toBe(1);
  expect(await c.evaluate(op=>(window as any).events.some((e:any)=>e.operationId===op),cmd.operationId)).toBe(false);
  const counts=await (await request.get(`/__test/room/${id}/inspect`)).json();
  const c2=await cc.newPage();expect(await attach(c2,id,true)).toBe(true);
  const replay=await send(c2,id,cmd);expect(replay.type).toBe('operation.ack');expect(replay.sessionEpoch).toBe(state.sessionEpoch);expect(replay.sceneRevision).toBe(1);
  await c2.evaluate(()=>(window as any).events=[]);
  expect(await send(c2,id,cmd)).toEqual(replay);
  await c2.evaluate(()=>(window as any).events=[]);
  expect((await send(c2,id,{...cmd,...await info(c2,id)})).code).toBe('INVALID_PAYLOAD');
  expect(await (await request.get(`/__test/room/${id}/inspect`)).json()).toEqual(counts);
  const t=await tc.newPage();expect(await attach(t,id)).toBe(true);
  expect((await send(t,id,{...cmd,...await info(t,id)})).code).toBe('PERMISSION_DENIED');
  const revoke={protocolVersion:1,type:'control.revokeAll',operationId:crypto.randomUUID(),...await info(c2,id)};
  const ack=await send(c2,id,revoke);expect(ack.type).toBe('operation.ack');
  await c2.evaluate(()=>(window as any).events=[]);
  expect(await send(c2,id,revoke)).toEqual(ack);
  expect((await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json()).sceneRevision).toBe(1);
  expect((await send(c2,id,{...cmd,operationId:crypto.randomUUID()})).code).toBe('STALE_EPOCH');
 }finally{await post(clientApi,`/api/rooms/${id}/close`);await cc.close();await tc.close();await clientApi.dispose();}
});
