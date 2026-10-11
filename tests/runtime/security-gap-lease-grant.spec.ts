import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function attach(page:Page,id:string){await page.goto('/');return page.evaluate(id=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket`);w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),id);}
async function info(page:Page,id:string):Promise<{sessionEpoch:number;controlEpoch:number}>{return page.evaluate(async id=>(await fetch(`/api/rooms/${id}/info`)).json(),id);}
async function send(page:Page,id:string,input:Record<string,unknown>){const state=await info(page,id);const operationId=(input.operationId as string)??crypto.randomUUID();await page.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),{protocolVersion:1,operationId,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...input});await expect.poll(()=>page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId),{timeout:5000}).toBeTruthy();return page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId);}
// G2 gap: lease release, stale fencing tokens and grant expiry must each be rejected server-side
// with the object left unchanged; a fresh grant must restore normal operation.
test('G2 A05 A09: released lease, stale fence and expired grant are rejected without mutating the object',async({request,playwright,browser})=>{
 test.setTimeout(45000);
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
  expect((await send(c,id,{type:'object.create',objectId:'gap-lease',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform})).type).toBe('operation.ack');
  const grantTalk=async(durationMs:number)=>{
   const req=await send(t,id,{type:'permission.request',objectId:'gap-lease',actions:['translate']});
   expect((await send(c,id,{type:'permission.grant',objectId:'gap-lease',requestId:req.operationId,actions:['translate'],durationMs})).type).toBe('operation.ack');
   return (await t.evaluate(()=>(window as any).events.filter((e:any)=>e.type==='permission.changed'&&e.grant).at(-1).grant)) as {grantId:string;grantVersion:number};
  };
  const acquire=async(grant:{grantId:string;grantVersion:number})=>{
   expect((await send(t,id,{type:'object.lock.acquire',objectId:'gap-lease',actions:['translate'],grantId:grant.grantId,grantVersion:grant.grantVersion})).type).toBe('operation.ack');
   return (await t.evaluate(()=>(window as any).events.filter((e:any)=>e.type==='lock.changed'&&e.lease).at(-1).lease)) as {leaseId:string;fencingToken:number};
  };
  const commit=(lease:{leaseId:string;fencingToken:number},grant:{grantId:string;grantVersion:number},position:number[],expectedObjectRevision:number)=>send(t,id,{type:'object.transform.commit',objectId:'gap-lease',expectedObjectRevision,leaseId:lease.leaseId,fencingToken:lease.fencingToken,grantId:grant.grantId,grantVersion:grant.grantVersion,transform:{...transform,position}});
  // phase 1: released lease must not authorize a commit
  let grant=await grantTalk(300000);let lease=await acquire(grant);
  expect((await commit(lease,grant,[1,0,0],0)).type).toBe('operation.ack');
  expect((await send(t,id,{type:'object.lock.release',objectId:'gap-lease',leaseId:lease.leaseId,fencingToken:lease.fencingToken})).type).toBe('operation.ack');
  const rejectedRelease=await send(t,id,{type:'object.transform.commit',objectId:'gap-lease',expectedObjectRevision:1,leaseId:lease.leaseId,fencingToken:lease.fencingToken,grantId:grant.grantId,grantVersion:grant.grantVersion,transform:{...transform,position:[3,0,0]}});
  expect(rejectedRelease.code).toBe('LOCKED');
  let snap=await snapshot();
  expect(snap.sceneRevision).toBe(2);expect(snap.objects[0].revision).toBe(1);expect(snap.objects[0].transform.position).toEqual([1,0,0]);
  // phase 2: after re-acquire the old fencing token is stale; the new one works
  lease=await acquire(grant);
  expect((await send(t,id,{type:'object.transform.commit',objectId:'gap-lease',expectedObjectRevision:1,leaseId:lease.leaseId,fencingToken:lease.fencingToken-1,grantId:grant.grantId,grantVersion:grant.grantVersion,transform:{...transform,position:[2,0,0]}})).code).toBe('STALE_FENCE');
  snap=await snapshot();
  expect(snap.objects[0].revision).toBe(1);expect(snap.objects[0].transform.position).toEqual([1,0,0]);
  expect((await commit(lease,grant,[2,0,0],1)).type).toBe('operation.ack');
  snap=await snapshot();
  expect(snap.objects[0].revision).toBe(2);expect(snap.objects[0].transform.position).toEqual([2,0,0]);
  // phase 3: an expired grant denies commit and re-lock; a fresh grant restores operation
  await send(c,id,{type:'presence.heartbeat'});
  // Leave ample time for grant setup plus the info/WS round trips before expiry; this suite
  // runs many browser cases serially, so a 1.2 s test grant can expire before the first acquire.
  const shortGrantMs=5000;
  grant=await grantTalk(shortGrantMs);
  lease=await acquire(grant);
  await new Promise(resolve=>setTimeout(resolve,shortGrantMs+1000));
  const rejectedExpiry=await send(t,id,{type:'object.transform.commit',objectId:'gap-lease',expectedObjectRevision:2,leaseId:lease.leaseId,fencingToken:lease.fencingToken,grantId:grant.grantId,grantVersion:grant.grantVersion,transform:{...transform,position:[4,0,0]}});
  expect(['GRANT_EXPIRED','LOCKED','STALE_FENCE']).toContain(rejectedExpiry.code);
  expect((await send(t,id,{type:'object.lock.acquire',objectId:'gap-lease',actions:['translate'],grantId:grant.grantId,grantVersion:grant.grantVersion})).code).toBe('GRANT_EXPIRED');
  snap=await snapshot();
  expect(snap.objects[0].revision).toBe(2);expect(snap.objects[0].transform.position).toEqual([2,0,0]);
  await send(c,id,{type:'presence.heartbeat'});
  grant=await grantTalk(300000);lease=await acquire(grant);
  expect((await commit(lease,grant,[3,0,0],2)).type).toBe('operation.ack');
  snap=await snapshot();
  expect(snap.objects[0].revision).toBe(3);expect(snap.objects[0].transform.position).toEqual([3,0,0]);
 }finally{await post(clientApi,`/api/rooms/${id}/close`);await cc.close();await tc.close();await clientApi.dispose();}
});
