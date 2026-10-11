import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function attach(page:Page,id:string){await page.goto('/');return page.evaluate(id=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket`);w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),id);}
async function info(page:Page,id:string):Promise<{sessionEpoch:number;controlEpoch:number}>{return page.evaluate(async id=>(await fetch(`/api/rooms/${id}/info`)).json(),id);}
// G2 gap: replaying an acknowledged operationId with a tampered payload must be rejected server-side
// and must not change revision, transform or scene state (idempotency tampering).
test('G2 A05: tampered replay of an acknowledged operationId is rejected and changes nothing',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const {id}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();
 const {token}=await (await post(request,`/api/rooms/${id}/invites`)).json();
 const clientApi=await playwright.request.newContext({baseURL:origin});
 const redeemed=await (await post(clientApi,'/api/invites/redeem',{token,nickname:'虛構'})).json();
 await post(request,`/api/rooms/${id}/admit`,{participantId:redeemed.participantId});
 const cc=await browser.newContext({storageState:await clientApi.storageState()});
 try{
  const c=await cc.newPage();expect(await attach(c,id)).toBe(true);
  const transform={position:[0,0,0],rotation:[0,0,0,1],scale:1};
  expect((await send(c,id,{type:'object.create',objectId:'gap-rock',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform})).type).toBe('operation.ack');
  expect((await send(c,id,{type:'object.lock.acquire',objectId:'gap-rock',actions:['translate']})).type).toBe('operation.ack');
  const lease=await c.evaluate(()=>(window as any).events.filter((e:any)=>e.type==='lock.changed'&&e.lease).at(-1).lease);
  const {sessionEpoch,controlEpoch}=await info(c,id);
  const commit={protocolVersion:1,type:'object.transform.commit',operationId:crypto.randomUUID(),sessionEpoch,controlEpoch,objectId:'gap-rock',expectedObjectRevision:0,leaseId:lease.leaseId,fencingToken:lease.fencingToken,transform:{...transform,position:[1,0,0]}};
  await c.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),commit);
  await expect.poll(()=>c.evaluate(op=>(window as any).events.some((e:any)=>e.operationId===op),commit.operationId),{timeout:5000}).toBe(true);
  const firstResponses=await c.evaluate(op=>(window as any).events.filter((e:any)=>e.operationId===op),commit.operationId);
  expect(firstResponses.some((e:any)=>e.type==='operation.ack')).toBe(true);
  // tampered replay: same operationId, schema-valid payload but different transform and revision —
  // must reach the durable receipt comparison and be rejected there
  const tampered={...commit,transform:{...transform,position:[2,0,0]},expectedObjectRevision:1};
  await c.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),tampered);
  await expect.poll(()=>c.evaluate(op=>(window as any).events.some((e:any)=>e.operationId===op&&e.type==='operation.rejected'),commit.operationId),{timeout:5000}).toBe(true);
  expect((await c.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op&&e.type==='operation.rejected'),commit.operationId)).code).toBe('INVALID_PAYLOAD');
  let snap=await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json();
  expect(snap.sceneRevision).toBe(2);
  expect(snap.objects[0].revision).toBe(1);
  expect(snap.objects[0].transform.position).toEqual([1,0,0]);
  // identical replay still returns the original ack and still applies nothing new
  await c.evaluate(()=>(window as any).events=[]);
  await c.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),commit);
  await expect.poll(()=>c.evaluate(op=>(window as any).events.some((e:any)=>e.operationId===op&&e.type==='operation.ack'),commit.operationId)).toBe(true);
  expect((await c.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op&&e.type==='operation.ack'),commit.operationId)).sceneRevision).toBe(2);
  snap=await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json();
  expect(snap.sceneRevision).toBe(2);
  expect(snap.objects[0].transform.position).toEqual([1,0,0]);
 }finally{await post(clientApi,`/api/rooms/${id}/close`);await cc.close();await clientApi.dispose();}
});
async function send(page:Page,id:string,input:Record<string,unknown>){const state=await info(page,id);const operationId=(input.operationId as string)??crypto.randomUUID();await page.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),{protocolVersion:1,operationId,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...input});await expect.poll(()=>page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId),{timeout:5000}).toBeTruthy();return page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId);}
