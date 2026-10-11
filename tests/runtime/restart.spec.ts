import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
const origin='http://127.0.0.1:8788';
// G60/G61: the server bumps lastActivity (=snapshot updatedAt) for EVERY accepted command including the client's
// ephemeral presence.heartbeat (apps/worker/src/sync.ts:75 → :131), so one landing inside the DO-restart window
// legitimately changes updatedAt. The invariant under test — the restart preserves the durable scene — is carried
// by objects and sceneRevision, so compare without updatedAt and assert sceneRevision explicitly (stronger than
// the old bare toEqual, not weaker).
const stripUpdatedAt=(v:any)=>{const{updatedAt,...rest}=v;return rest;};
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function attach(page:Page,id:string){await page.goto('/api/health');return page.evaluate(id=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket?takeover=1`);w.ws.onmessage=(e:MessageEvent)=>w.events.push(JSON.parse(e.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),id);}
async function epochs(page:Page,id:string){return page.evaluate(async id=>{const s=await(await fetch(`/api/rooms/${id}/info`)).json() as {sessionEpoch:number;controlEpoch:number};return {sessionEpoch:s.sessionEpoch,controlEpoch:s.controlEpoch};},id);}
async function send(page:Page,id:string,input:Record<string,unknown>){const cmd={protocolVersion:1,operationId:crypto.randomUUID(),...await epochs(page,id),...input};await page.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),cmd);await expect.poll(()=>page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),cmd.operationId)).toBeTruthy();return page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),cmd.operationId);}

test('A10 A09: actual DO abort reconstructs the instance, preserves durable ACK and discards preview authority',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const {id}=await(await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();
 const {token}=await(await post(request,`/api/rooms/${id}/invites`)).json();
 const clientApi=await playwright.request.newContext({baseURL:origin});
 const admitted=await(await post(clientApi,'/api/invites/redeem',{token,nickname:'重啟測試虛構'})).json();
 await post(request,`/api/rooms/${id}/admit`,{participantId:admitted.participantId});
 const cc=await browser.newContext({storageState:await clientApi.storageState()});
 const tc=await browser.newContext({storageState:await request.storageState()});
 try{
  const c=await cc.newPage(),t=await tc.newPage();expect(await attach(t,id)).toBe(true);expect(await attach(c,id)).toBe(true);
  const transform={position:[0,0,0],rotation:[0,0,0,1],scale:1};
  expect((await send(c,id,{type:'object.create',objectId:'restart-rock',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform})).type).toBe('operation.ack');
  const permission=await send(t,id,{type:'permission.request',objectId:'restart-rock',actions:['translate']});
  expect((await send(c,id,{type:'permission.grant',objectId:'restart-rock',requestId:permission.operationId,actions:['translate'],durationMs:300000})).type).toBe('operation.ack');
  const grant=await c.evaluate(()=>(window as any).events.filter((e:any)=>e.type==='permission.changed'&&e.grant).at(-1).grant);
  expect((await send(t,id,{type:'object.lock.acquire',objectId:'restart-rock',actions:['translate'],grantId:grant.grantId,grantVersion:grant.grantVersion})).type).toBe('operation.ack');
  const lease=await t.evaluate(()=>(window as any).events.filter((e:any)=>e.type==='lock.changed'&&e.lease).at(-1).lease);
  const commit={protocolVersion:1,type:'object.transform.commit',operationId:crypto.randomUUID(),...await epochs(t,id),objectId:'restart-rock',expectedObjectRevision:0,leaseId:lease.leaseId,fencingToken:lease.fencingToken,grantId:grant.grantId,grantVersion:grant.grantVersion,transform:{...transform,position:[1,0,0]}};
  const ack=await send(t,id,commit);expect(ack.type).toBe('operation.ack');
  const preview={...commit,type:'object.transform.preview',operationId:crypto.randomUUID(),transform:{...transform,position:[4,0,0]}};
  delete (preview as Partial<typeof commit>).expectedObjectRevision;
  await t.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),preview);
  await expect.poll(()=>c.evaluate(()=>(window as any).events.some((e:any)=>e.type==='object.preview'&&e.transform.position[0]===4))).toBe(true);
  const before=await(await clientApi.get(`/api/rooms/${id}/snapshot`)).json();
  expect(before.objects[0].transform.position).toEqual([1,0,0]);expect(before.sceneRevision).toBe(2);
  const counts=await(await request.get(`/__test/room/${id}/inspect`)).json();
  const instance=await(await request.get(`/__test/room/${id}/instance`)).json();
  expect(instance.instanceId).toMatch(/^[0-9a-f-]{36}$/);
  expect((await post(request,`/__test/room/${id}/restart`)).ok()).toBe(true);
  const rebuilt=await(await request.get(`/__test/room/${id}/instance`)).json();
  expect(rebuilt.instanceId).toMatch(/^[0-9a-f-]{36}$/);expect(rebuilt.instanceId).not.toBe(instance.instanceId);
  const preserved=await(await clientApi.get(`/api/rooms/${id}/snapshot`)).json();expect(stripUpdatedAt(preserved)).toEqual(stripUpdatedAt(before));expect(preserved.sceneRevision).toBe(before.sceneRevision);
  const c2=await cc.newPage(),t2=await tc.newPage();expect(await attach(c2,id)).toBe(true);expect(await attach(t2,id)).toBe(true);await send(c2,id,{type:'presence.heartbeat'});
  // New connections discard all previous object authority; replay only reads a receipt.
  expect(await send(t2,id,commit)).toEqual(ack);
  expect((await send(t2,id,{...commit,operationId:crypto.randomUUID(),...await epochs(t2,id),expectedObjectRevision:1})).code).toBe('PERMISSION_DENIED');
  expect((await send(t2,id,{type:'object.lock.acquire',objectId:'restart-rock',actions:['translate'],grantId:grant.grantId,grantVersion:grant.grantVersion})).code).toBe('PERMISSION_DENIED');
  expect(await(await request.get(`/__test/room/${id}/inspect`)).json()).toEqual(counts);
  const after=await(await clientApi.get(`/api/rooms/${id}/snapshot`)).json();expect(after.objects).toEqual(before.objects);expect(after.sceneRevision).toBe(2);
 }finally{await post(clientApi,`/api/rooms/${id}/close`);await cc.close();await tc.close();await clientApi.dispose();}
});

