import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function attach(page:Page,id:string){await page.goto('/');return page.evaluate(id=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket`);w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),id);}
async function info(page:Page,id:string):Promise<{sessionEpoch:number;controlEpoch:number}>{return page.evaluate(async id=>(await fetch(`/api/rooms/${id}/info`)).json(),id);}
async function send(page:Page,id:string,input:Record<string,unknown>){const state=await info(page,id);const operationId=(input.operationId as string)??crypto.randomUUID();await page.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),{protocolVersion:1,operationId,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...input});await expect.poll(()=>page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId),{timeout:5000}).toBeTruthy();return page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId);}
// G2-C2 gap: a client revoke and an in-flight therapist commit arriving in the same tick.
// Cross-socket arrival order is genuinely racy; the server-authority invariants are not:
// exactly one order happens, and in BOTH branches the outcome must be the one the order implies.
test('G2 A02 A05: same-tick revoke and commit resolve in one order with consistent state',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const {id}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();
 const {token}=await (await post(request,`/api/rooms/${id}/invites`)).json();
 const clientApi=await playwright.request.newContext({baseURL:origin});
 const redeemed=await (await post(clientApi,'/api/invites/redeem',{token,nickname:'虛構'})).json();
 await post(request,`/api/rooms/${id}/admit`,{participantId:redeemed.participantId});
 const tc=await browser.newContext({storageState:await request.storageState()}),cc=await browser.newContext({storageState:await clientApi.storageState()});
 const snapshot=async()=> (await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json());
 try{
  const t=await tc.newPage(),c=await cc.newPage();
  expect(await attach(t,id)).toBe(true);expect(await attach(c,id)).toBe(true);
  const transform={position:[0,0,0],rotation:[0,0,0,1],scale:1};
  expect((await send(c,id,{type:'object.create',objectId:'race-rock',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform})).type).toBe('operation.ack');
  const req=await send(t,id,{type:'permission.request',objectId:'race-rock',actions:['translate']});
  expect((await send(c,id,{type:'permission.grant',objectId:'race-rock',requestId:req.operationId,actions:['translate'],durationMs:300000})).type).toBe('operation.ack');
  const grant=await t.evaluate(()=>(window as any).events.filter((e:any)=>e.type==='permission.changed'&&e.grant).at(-1).grant);
  expect((await send(t,id,{type:'object.lock.acquire',objectId:'race-rock',actions:['translate'],grantId:grant.grantId,grantVersion:grant.grantVersion})).type).toBe('operation.ack');
  const lease=await t.evaluate(()=>(window as any).events.filter((e:any)=>e.type==='lock.changed'&&e.lease).at(-1).lease);
  // build the commit with pre-revoke epochs, then fire commit and revoke without awaiting either
  const commitState=await info(t,id);
  const commit={protocolVersion:1,type:'object.transform.commit',operationId:crypto.randomUUID(),sessionEpoch:commitState.sessionEpoch,controlEpoch:commitState.controlEpoch,objectId:'race-rock',expectedObjectRevision:0,leaseId:lease.leaseId,fencingToken:lease.fencingToken,grantId:grant.grantId,grantVersion:grant.grantVersion,transform:{...transform,position:[1,0,0]}};
  const revokeOperationId=crypto.randomUUID();
  const revokeState=await info(c,id);
  const revokePacket={protocolVersion:1,type:'permission.revoke',operationId:revokeOperationId,sessionEpoch:revokeState.sessionEpoch,controlEpoch:revokeState.controlEpoch,objectId:'race-rock',grantId:grant.grantId};
  await Promise.all([
   t.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),commit),
   c.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),revokePacket),
  ]);
  // both operations must have produced exactly one terminal response each
  await expect.poll(()=>t.evaluate(op=>(window as any).events.filter((e:any)=>e.operationId===op&&['operation.ack','operation.rejected'].includes(e.type)).length,commit.operationId)).toBe(1);
  await expect.poll(()=>c.evaluate(op=>(window as any).events.filter((e:any)=>e.operationId===op&&e.type==='operation.ack').length,revokeOperationId)).toBe(1);
  const commitResult=await t.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op&&['operation.ack','operation.rejected'].includes(e.type)),commit.operationId);
  const attempt=async()=>{const s=await snapshot();return send(t,id,{type:'object.transform.commit',objectId:'race-rock',expectedObjectRevision:s.objects[0].revision,leaseId:'stale',fencingToken:0,grantId:grant.grantId,grantVersion:grant.grantVersion,transform:{...transform,position:[2,0,0]}});};
  if(commitResult.type==='operation.ack'){
   // order was commit→revoke: the legitimate commit applied, then the revoke still took effect
   let snap=await snapshot();
   expect(snap.sceneRevision).toBe(2);expect(snap.objects[0].revision).toBe(1);expect(snap.objects[0].transform.position).toEqual([1,0,0]);
   expect((await attempt()).code).toBe('PERMISSION_DENIED');
   snap=await snapshot();
   expect(snap.objects[0].revision).toBe(1);expect(snap.objects[0].transform.position).toEqual([1,0,0]);
  }else{
   // order was revoke→commit: the queued commit must not apply with pre-revoke authority
   expect(['STALE_EPOCH','PERMISSION_DENIED']).toContain(commitResult.code);
   const snap=await snapshot();
   expect(snap.sceneRevision).toBe(1);expect(snap.objects[0].revision).toBe(0);expect(snap.objects[0].transform.position).toEqual([0,0,0]);
   expect((await attempt()).code).toBe('PERMISSION_DENIED');
  }
 }finally{await post(clientApi,`/api/rooms/${id}/close`);await cc.close();await tc.close();await clientApi.dispose();}
});
