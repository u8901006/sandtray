import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function attach(page:Page,id:string){await page.goto('/');return page.evaluate(id=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket`);w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),id);}
async function info(page:Page,id:string):Promise<{sessionEpoch:number;controlEpoch:number}>{return page.evaluate(async id=>(await fetch(`/api/rooms/${id}/info`)).json(),id);}
async function send(page:Page,id:string,input:Record<string,unknown>){const state=await info(page,id);const operationId=(input.operationId as string)??crypto.randomUUID();await page.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),{protocolVersion:1,operationId,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...input});await expect.poll(()=>page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId),{timeout:5000}).toBeTruthy();return page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId);}
// G2 gap: objectIds are room-scoped. A participant in room A must not reach the object that only
// exists in room B by reusing its objectId, and room B's object must stay untouched.
test('G2 A05 A09: a cross-room objectId cannot be locked, committed or observed from another room',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const create=async()=>(await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json()).id;
 const roomA=await create(),roomB=await create();
 const inviteB=await (await post(request,`/api/rooms/${roomB}/invites`)).json();
 const clientApi=await playwright.request.newContext({baseURL:origin});
 const redeemed=await (await post(clientApi,'/api/invites/redeem',{token:inviteB.token,nickname:'虛構'})).json();
 await post(request,`/api/rooms/${roomB}/admit`,{participantId:redeemed.participantId});
 const tc=await browser.newContext({storageState:await request.storageState()}),cc=await browser.newContext({storageState:await clientApi.storageState()});
 try{
  const a=await tc.newPage(),b=await cc.newPage();
  expect(await attach(a,roomA)).toBe(true);
  expect(await attach(b,roomB)).toBe(true);
  const transform={position:[2,0,0],rotation:[0,0,0,1],scale:1};
  expect((await send(b,roomB,{type:'object.create',objectId:'shared-name',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform})).type).toBe('operation.ack');
  // room A has no object with this id: lock and commit must both be denied
  expect((await send(a,roomA,{type:'object.lock.acquire',objectId:'shared-name',actions:['translate']})).code).toBe('PERMISSION_DENIED');
  expect((await send(a,roomA,{type:'object.transform.commit',objectId:'shared-name',expectedObjectRevision:0,leaseId:'fabricated',fencingToken:1,transform:{...transform,position:[5,0,0]}})).code).toBe('PERMISSION_DENIED');
  // room B's object: a therapist without a grant is denied. C55 (2026-09-21): the client attached seconds ago and is
  // live, so the denial is PERMISSION_DENIED from the first attempt — the therapist's own attach no longer zeroes the
  // client's presence window (that used to make this first attempt GRANT_EXPIRED). The presence gate itself is
  // asserted below once the client has really left.
  const tB=await tc.newPage();expect(await attach(tB,roomB)).toBe(true);
  expect((await send(tB,roomB,{type:'object.lock.acquire',objectId:'shared-name',actions:['translate']})).code).toBe('PERMISSION_DENIED');
  await send(b,roomB,{type:'presence.heartbeat'});
  expect((await send(tB,roomB,{type:'object.lock.acquire',objectId:'shared-name',actions:['translate']})).code).toBe('PERMISSION_DENIED');
  expect((await send(tB,roomB,{type:'object.transform.commit',objectId:'shared-name',expectedObjectRevision:0,leaseId:'fabricated',fencingToken:1,transform:{...transform,position:[5,0,0]}})).code).toBe('PERMISSION_DENIED');
  // room B state unchanged: same revision, transform and scene revision
  const snap=await (await clientApi.get(`/api/rooms/${roomB}/snapshot`)).json();
  expect(snap.sceneRevision).toBe(1);
  expect(snap.objects[0].revision).toBe(0);
  expect(snap.objects[0].transform.position).toEqual([2,0,0]);
  // room A state unchanged: still empty
  const snapA=await (await request.get(`/api/rooms/${roomA}/snapshot`)).json();
  expect(snapA.objects).toEqual([]);
  // presence gate: once the client's socket is gone its presence window ends and the therapist is denied by
  // GRANT_EXPIRED (not PERMISSION_DENIED) even for room B's own object.
  await b.evaluate(()=>(window as any).ws.close());await expect.poll(async()=>(await send(tB,roomB,{type:'object.lock.acquire',objectId:'shared-name',actions:['translate']})).code,{timeout:10000}).toBe('GRANT_EXPIRED');
 }finally{await post(clientApi,`/api/rooms/${roomB}/close`);await post(request,`/api/rooms/${roomA}/close`);await post(request,`/api/rooms/${roomB}/close`);await cc.close();await tc.close();await clientApi.dispose();}
});
