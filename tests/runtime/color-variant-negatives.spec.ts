import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
// V7-G02 (GLM-5.3-flash) per V7-C02 #5: promoted from working/opus-v7c/i02-negatives.spec.ts (Claude Opus 5.5,
// 2026-09-23) into the runtime suite, plus the cross-room denial that REQ-019 verification-matrix item 2 lists
// but no spec covered. The therapist, stale revision/epoch, unknown code, missing object, duplicate/replay and
// cross-room paths must all be rejected without changing sceneRevision or the object.
// V7-G03 (GLM-5.3-flash) per V7-C03: absorbed working/opus-v7c3/i03-split.spec.ts (Claude Opus 5.5) — the two
// legacy appearance fields are guarded separately, so each must be caught on its own: a hidden-only tamper and a
// materialOverrides-only tamper are both INVALID_PAYLOAD even when the other field echoes the current value.
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function attach(page:Page,id:string){await page.goto('/api/health');return page.evaluate(id=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+'/api/rooms/'+id+'/socket');w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),id);}
async function info(api:APIRequestContext,id:string){return (await api.get('/api/rooms/'+id+'/info')).json() as Promise<{sessionEpoch:number;controlEpoch:number}>;}
async function send(page:Page,api:APIRequestContext,id:string,input:Record<string,unknown>,raw?:Record<string,unknown>){const state=await info(api,id);const operationId=(input.operationId as string)??crypto.randomUUID();const cmd={protocolVersion:1,operationId,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...input,...(raw??{})};
 const seen=await page.evaluate(op=>(window as any).events.filter((e:any)=>e.operationId===op).length,operationId);
 await page.evaluate(c=>(window as any).ws.send(JSON.stringify(c)),cmd);
 await expect.poll(()=>page.evaluate(op=>(window as any).events.filter((e:any)=>e.operationId===op).length,operationId),{timeout:5000}).toBeGreaterThan(seen);
 return page.evaluate(op=>(window as any).events.filter((e:any)=>e.operationId===op).at(-1),operationId);}
const stripUpdatedAt=(v:any)=>{const{updatedAt,...rest}=v;return rest;};

test('REQ-019 appearance.commit negatives leave scene unchanged',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const room=await(await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json() as {id:string};
 const {token}=await(await post(request,'/api/rooms/'+room.id+'/invites')).json() as {token:string};
 const client=await playwright.request.newContext({baseURL:origin});
 const redeemed=await(await post(client,'/api/invites/redeem',{token,nickname:'膚色反證'})).json() as {participantId:string};
 await post(request,'/api/rooms/'+room.id+'/admit',{participantId:redeemed.participantId});
 const cc=await browser.newContext({storageState:await client.storageState()});
 const tc=await browser.newContext({storageState:await request.storageState()});
 try{
  const page=await cc.newPage();expect(await attach(page,room.id)).toBe(true);
  const transform={position:[0,0,0],rotation:[0,0,0,1],scale:1};
  expect((await send(page,client,room.id,{type:'object.create',objectId:'p',assetId:'IMP_ULTIMATE_Casual_Male',assetVersion:'import-34b06e07f9ec3f26',transform})).type).toBe('operation.ack');
  const snap=async()=>(await client.get('/api/rooms/'+room.id+'/snapshot')).json();
  let s=await snap();const base=s.objects.find((o:any)=>o.id==='p');
  expect(base.colorVariant,'server default t2 on create').toBe('t2');
  const baseRevision=s.sceneRevision;
  // therapist socket
  const tp=await tc.newPage();expect(await attach(tp,room.id)).toBe(true);
  const therapist=await send(tp,request,room.id,{type:'object.appearance.commit',objectId:'p',expectedObjectRevision:0,materialOverrides:{},hidden:false,colorVariant:'t5'});
  const staleRevision=await send(page,client,room.id,{type:'object.appearance.commit',objectId:'p',expectedObjectRevision:7,materialOverrides:{},hidden:false,colorVariant:'t5'});
  const staleEpoch=await send(page,client,room.id,{type:'object.appearance.commit',objectId:'p',expectedObjectRevision:0,materialOverrides:{},hidden:false,colorVariant:'t5'},{sessionEpoch:0});
  const unknownCode=await send(page,client,room.id,{type:'object.appearance.commit',objectId:'p',expectedObjectRevision:0,materialOverrides:{},hidden:false,colorVariant:'purple'});
  const missingObject=await send(page,client,room.id,{type:'object.appearance.commit',objectId:'nope',expectedObjectRevision:0,materialOverrides:{},hidden:false,colorVariant:'t5'});
  expect(therapist).toMatchObject({type:'operation.rejected',code:'PERMISSION_DENIED'});
  expect(staleRevision).toMatchObject({type:'operation.rejected',code:'REVISION_CONFLICT'});
  expect(staleEpoch).toMatchObject({type:'operation.rejected',code:'STALE_EPOCH'});
  expect(unknownCode).toMatchObject({type:'operation.rejected',code:'INVALID_PAYLOAD'});
  expect(missingObject).toMatchObject({type:'operation.rejected',code:'PERMISSION_DENIED'});
  s=await snap();expect(s.sceneRevision,'no negative changed sceneRevision').toBe(baseRevision);expect(stripUpdatedAt(s.objects.find((o:any)=>o.id==='p'))).toEqual(stripUpdatedAt(base));
  // duplicate: same operationId/payload twice → same durable ack, single revision bump
  const op={type:'object.appearance.commit',operationId:'dup-1',objectId:'p',expectedObjectRevision:0,materialOverrides:{},hidden:false,colorVariant:'t4'};
  const first=await send(page,client,room.id,op);const second=await send(page,client,room.id,op);
  expect(second).toEqual(first);
  s=await snap();expect(s.objects.find((o:any)=>o.id==='p')).toMatchObject({colorVariant:'t4',revision:1});expect(s.sceneRevision).toBe(baseRevision+1);
  const reused=await send(page,client,room.id,{...op,colorVariant:'t1'});
  expect(reused).toMatchObject({type:'operation.rejected',code:'INVALID_PAYLOAD'});
 }finally{await post(request,'/api/rooms/'+room.id+'/close').catch(()=>{});await cc.close();await tc.close();await client.dispose();}
});

test('REQ-019 appearance.commit cannot reach a cross-room object',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const createRoom=async()=>(await(await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json()) as {id:string};
 const roomA=await createRoom(),roomB=await createRoom();
 const admitClient=async(room:{id:string},nickname:string)=>{
  const {token}=await(await post(request,`/api/rooms/${room.id}/invites`)).json() as {token:string};
  const api=await playwright.request.newContext({baseURL:origin});
  const redeemed=await(await post(api,'/api/invites/redeem',{token,nickname})).json() as {participantId:string};
  await post(request,`/api/rooms/${room.id}/admit`,{participantId:redeemed.participantId});
  return api;
 };
 const apiA=await admitClient(roomA,'跨房甲'),apiB=await admitClient(roomB,'跨房乙');
 const ca=await browser.newContext({storageState:await apiA.storageState()});
 const cb=await browser.newContext({storageState:await apiB.storageState()});
 try{
  const pa=await ca.newPage(),pb=await cb.newPage();
  expect(await attach(pa,roomA.id)).toBe(true);expect(await attach(pb,roomB.id)).toBe(true);
  const transform={position:[0,0,0],rotation:[0,0,0,1],scale:1};
  expect((await send(pa,apiA,roomA.id,{type:'object.create',objectId:'room-a-person',assetId:'IMP_ULTIMATE_Casual_Male',assetVersion:'import-34b06e07f9ec3f26',transform})).type).toBe('operation.ack');
  const before=await(await apiA.get(`/api/rooms/${roomA.id}/snapshot`)).json();
  // The objectId only exists in room A; a room-B client recoloring it must be denied and room A untouched.
  const rejected=await send(pb,apiB,roomB.id,{type:'object.appearance.commit',objectId:'room-a-person',expectedObjectRevision:0,materialOverrides:{},hidden:false,colorVariant:'t5'});
  expect(rejected).toMatchObject({type:'operation.rejected',code:'PERMISSION_DENIED'});
  const after=await(await apiA.get(`/api/rooms/${roomA.id}/snapshot`)).json();
  expect(stripUpdatedAt(after)).toEqual(stripUpdatedAt(before));
 }finally{await post(request,`/api/rooms/${roomA.id}/close`).catch(()=>{});await post(request,`/api/rooms/${roomB.id}/close`).catch(()=>{});await ca.close();await cb.close();await apiA.dispose();await apiB.dispose();}
});

for(const tamper of [{name:'hidden only',patch:{materialOverrides:{},hidden:true}},{name:'materialOverrides only',patch:{materialOverrides:{Skin:'#ffffff'},hidden:false}}]){
 test(`REQ-019 appearance.commit rejects ${tamper.name} tamper and leaves scene unchanged`,async({request,playwright,browser})=>{
  await request.post('/__test/login',{data:{name:'therapist'}});
  const room=await(await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json() as {id:string};
  const {token}=await(await post(request,'/api/rooms/'+room.id+'/invites')).json() as {token:string};
  const client=await playwright.request.newContext({baseURL:origin});
  const redeemed=await(await post(client,'/api/invites/redeem',{token,nickname:'拆案竄改'})).json() as {participantId:string};
  await post(request,'/api/rooms/'+room.id+'/admit',{participantId:redeemed.participantId});
  const cc=await browser.newContext({storageState:await client.storageState()});
  try{
   const page=await cc.newPage();expect(await attach(page,room.id)).toBe(true);
   const transform={position:[0,0,0],rotation:[0,0,0,1],scale:1};
   expect((await send(page,client,room.id,{type:'object.create',objectId:'p',assetId:'IMP_ULTIMATE_Casual_Male',assetVersion:'import-34b06e07f9ec3f26',transform})).type).toBe('operation.ack');
   const before=await(await client.get('/api/rooms/'+room.id+'/snapshot')).json();
   const o=before.objects.find((x:any)=>x.id==='p');
   expect(o).toMatchObject({colorVariant:'t2',hidden:false,materialOverrides:{}});
   const rejected=await send(page,client,room.id,{type:'object.appearance.commit',objectId:'p',expectedObjectRevision:o.revision,colorVariant:'t4',...tamper.patch});
   expect(rejected).toMatchObject({type:'operation.rejected',code:'INVALID_PAYLOAD'});
   const after=await(await client.get('/api/rooms/'+room.id+'/snapshot')).json();
   expect(after.sceneRevision).toBe(before.sceneRevision);
   expect(stripUpdatedAt(after.objects.find((x:any)=>x.id==='p'))).toEqual(stripUpdatedAt(o));
   // positive control: echoing the current hidden/materialOverrides while recoloring is accepted
   expect((await send(page,client,room.id,{type:'object.appearance.commit',objectId:'p',expectedObjectRevision:o.revision,materialOverrides:{},hidden:false,colorVariant:'t4'})).type).toBe('operation.ack');
  }finally{await post(request,'/api/rooms/'+room.id+'/close').catch(()=>{});await cc.close();await client.dispose();}
 });
}
