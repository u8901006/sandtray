import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
// V8-L12-3 (Claude Opus 5.5, 2026-09-26): cloud named versions were removed by user ruling L01-4 (session-only), so the
// named-save/restore and legacy-version cases went with them. The surviving AC19-3 goals -- a real DO restart and
// in-session undo keep colorVariant, and a missing variant materializes as t2 -- are verified in a session-only room.
// Original header, V7-G02 (GLM-5.3-flash) per V7-C02 #5 NEEDS_EVIDENCE: REQ-019 verification-matrix item 3 at runtime — a named
// save → restore and a real DO restart (A10 abort mechanism) preserve colorVariant, and a legacy (pre-REQ-019)
// version snapshot without the field restores as the server-materialized t2 default, never orig. The legacy
// snapshot is produced by stripping the field from the stored R2 snapshot through the test-only worker hook in
// tests/runtime/entry.ts, which does not exist in the production bundle.
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function attach(page:Page,id:string){await page.goto('/api/health');return page.evaluate(id=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+'/api/rooms/'+id+'/socket');w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),id);}
async function info(api:APIRequestContext,id:string){return (await api.get('/api/rooms/'+id+'/info')).json() as Promise<{sessionEpoch:number;controlEpoch:number}>;}
async function send(page:Page,api:APIRequestContext,id:string,input:Record<string,unknown>){const state=await info(api,id);const operationId=crypto.randomUUID();await page.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),{protocolVersion:1,operationId,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...input});await expect.poll(()=>page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId),{timeout:5000}).toBeTruthy();return page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId);}
async function roomWithClient(request:any,playwright:any,browser:any){
 await request.post('/__test/login',{data:{name:'therapist'}});
 const {id}=await(await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json() as {id:string};
 const {token}=await(await post(request,`/api/rooms/${id}/invites`)).json() as {token:string};
 const client=await playwright.request.newContext({baseURL:origin});
 const redeemed=await(await post(client,'/api/invites/redeem',{token})).json() as {participantId:string};
 await post(request,`/api/rooms/${id}/admit`,{participantId:redeemed.participantId});
 const cc=await browser.newContext({storageState:await client.storageState()});
 const page=await cc.newPage();expect(await attach(page,id)).toBe(true);
 return {id,client,cc,page};
}
const transform={position:[0,0,0],rotation:[0,0,0,1],scale:1};
const PERSON={assetId:'IMP_ULTIMATE_Casual_Male',assetVersion:'import-34b06e07f9ec3f26'};
const variantOf=async(client:APIRequestContext,id:string,objectId:string)=>(await(await client.get(`/api/rooms/${id}/snapshot`)).json()).objects.find((o:any)=>o.id===objectId)?.colorVariant;

test('REQ-019 a real DO restart and in-session undo preserve colorVariant; a missing variant defaults to t2',async({request,playwright,browser})=>{
 test.setTimeout(60000);
 const {id,client,cc,page}=await roomWithClient(request,playwright,browser);
 try{
  expect((await send(page,client,id,{type:'object.create',objectId:'default-person',transform,...PERSON})).type).toBe('operation.ack');
  expect(await variantOf(client,id,'default-person')).toBe('t2');
  expect((await send(page,client,id,{type:'object.create',objectId:'person',transform,...PERSON,colorVariant:'t6'})).type).toBe('operation.ack');
  expect((await send(page,client,id,{type:'object.appearance.commit',objectId:'person',expectedObjectRevision:0,materialOverrides:{},hidden:false,colorVariant:'orig'})).type).toBe('operation.ack');
  // A real DO abort (A10): the reconstructed instance must still report the durable variant.
  expect((await post(request,`/__test/room/${id}/restart`)).status()).toBe(200);
  expect(await variantOf(client,id,'person')).toBe('orig');
  // In-session undo returns the previous appearance (t6); redo brings orig back.
  expect(await attach(page,id)).toBe(true);
  const rev=(await(await client.get(`/api/rooms/${id}/snapshot`)).json()).sceneRevision;
  expect((await send(page,client,id,{type:'scene.undo',expectedSceneRevision:rev})).type).toBe('operation.ack');
  expect(await variantOf(client,id,'person')).toBe('t6');
  expect((await send(page,client,id,{type:'scene.redo',expectedSceneRevision:rev+1})).type).toBe('operation.ack');
  expect(await variantOf(client,id,'person')).toBe('orig');
 }finally{await post(request,`/api/rooms/${id}/close`).catch(()=>{});await cc.close();await client.dispose();}
});
