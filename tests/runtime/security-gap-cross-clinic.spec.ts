import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function attach(page:Page,id:string){await page.goto('/');return page.evaluate(id=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket`);w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),id);}
async function info(page:Page,id:string):Promise<{sessionEpoch:number;controlEpoch:number}>{return page.evaluate(async id=>(await fetch(`/api/rooms/${id}/info`)).json(),id);}
async function send(page:Page,id:string,input:Record<string,unknown>){const state=await info(page,id);const operationId=(input.operationId as string)??crypto.randomUUID();await page.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),{protocolVersion:1,operationId,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...input});await expect.poll(()=>page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId),{timeout:5000}).toBeTruthy();return page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId);}
// G2-C2 gap: a second clinic's therapist must not reach rooms, scenes or exports of clinic-a.
// All scene endpoints name their DO as clinicId:sceneId, and room membership checks clinicId.
test('G2 A01 A05: another clinic is denied room access, scene export and websocket attach',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const outsiderApi=await playwright.request.newContext({baseURL:origin});
 await (await outsiderApi.post('/__test/login',{data:{name:'outsider'}})).status();
 const {id,sceneId}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();
 const {token}=await (await post(request,`/api/rooms/${id}/invites`)).json();
 const clientApi=await playwright.request.newContext({baseURL:origin});
 const redeemed=await (await post(clientApi,'/api/invites/redeem',{token,nickname:'虛構'})).json();
 await post(request,`/api/rooms/${id}/admit`,{participantId:redeemed.participantId});
 const tc=await browser.newContext({storageState:await request.storageState()}),cc=await browser.newContext({storageState:await clientApi.storageState()}),oc=await browser.newContext({storageState:await outsiderApi.storageState()});
 try{
  const t=await tc.newPage(),o=await oc.newPage(),c=await cc.newPage();
  expect(await attach(t,id)).toBe(true);expect(await attach(c,id)).toBe(true);
  const transform={position:[0,0,0],rotation:[0,0,0,1],scale:1};
  expect((await send(c,id,{type:'object.create',objectId:'clinic-a-rock',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform})).type).toBe('operation.ack');
  // clinic-b therapist over HTTP: room, scene export and version listing all denied
  expect((await outsiderApi.get(`/api/rooms/${id}/info`)).status()).toBe(403);
  expect((await outsiderApi.get(`/api/rooms/${id}/snapshot`)).status()).toBe(403);
  // V8-L12-8：以合法的 PNG 格式送出，確保請求真的走到跨診所拒絕，而不是在格式驗證就被擋下
  expect((await outsiderApi.post(`/api/scenes/${sceneId}/exports`,{data:{format:'png',consentVersion:'fabricated',expectedSceneRevision:1},headers:{Origin:origin}})).status()).toBe(403);
  expect((await outsiderApi.get(`/api/rooms/${id}/versions`)).status()).toBe(403);// 版本路由已隨 L12-3 移除，任何人都是 403
  // clinic-b therapist over websocket: attach refused
  expect(await attach(o,id)).toBe(false);
  // clinic-a room untouched and still fully functional for its own participants
  const snap=await (await request.get(`/api/rooms/${id}/snapshot`)).json();
  expect(snap.sceneRevision).toBe(1);
  expect(snap.objects[0].id).toBe('clinic-a-rock');
  expect((await send(c,id,{type:'object.create',objectId:'clinic-a-rock-2',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform})).type).toBe('operation.ack');
  expect((await (await request.get(`/api/rooms/${id}/snapshot`)).json()).sceneRevision).toBe(2);
 }finally{await post(request,`/api/rooms/${id}/close`);await oc.close();await cc.close();await tc.close();await clientApi.dispose();await outsiderApi.dispose();}
});
