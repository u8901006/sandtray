import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import {createStandardHeightmap,strokeTray} from '../../packages/sand-engine/src/tray';
import {base64ToBytes} from '../../packages/sand-engine/src/core';
// REQ-016 L07 product slice (Claude Opus 5.5, 2026-09-30): sand.stroke / tray.water are server-authoritative. The client digs
// directly; the therapist is always refused (user ruling 2026-09-30, no tray grants). Each refusal must leave the heightmap, water level,
// tray revision and sceneRevision unchanged; accepted strokes are durable before ACK, idempotent on retry, survive a reconnect,
// and are removed with the room when the session ends.
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function attach(page:Page,id:string){await page.goto('/api/health');return page.evaluate(id=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+'/api/rooms/'+id+'/socket');w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),id);}
async function info(api:APIRequestContext,id:string){return (await api.get('/api/rooms/'+id+'/info')).json() as Promise<{sessionEpoch:number;controlEpoch:number}>;}
async function send(page:Page,api:APIRequestContext,id:string,input:Record<string,unknown>,raw?:Record<string,unknown>){const state=await info(api,id);const operationId=(input.operationId as string)??crypto.randomUUID();const cmd={protocolVersion:1,operationId,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...input,...(raw??{})};
 const seen=await page.evaluate(op=>(window as any).events.filter((e:any)=>e.operationId===op&&e.type!=='tray.changed').length,operationId);
 await page.evaluate(c=>(window as any).ws.send(JSON.stringify(c)),cmd);
 await expect.poll(()=>page.evaluate(op=>(window as any).events.filter((e:any)=>e.operationId===op&&e.type!=='tray.changed').length,operationId),{timeout:5000}).toBeGreaterThan(seen);
 return page.evaluate(op=>(window as any).events.filter((e:any)=>e.operationId===op&&e.type!=='tray.changed').at(-1),operationId);}
const trayState=(snapshot:any,id:'dry'|'wet')=>{const t=snapshot.trays.find((x:any)=>x.id===id);return {data:t.heightmap.data as string,water:t.waterLevel as number,revision:t.revision as number};};

test('REQ-016 sand and water: client authority, therapist fail-closed, durable, idempotent, erased with the room',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const room=await(await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json() as {id:string};
 const {token}=await(await post(request,'/api/rooms/'+room.id+'/invites')).json() as {token:string};
 const client=await playwright.request.newContext({baseURL:origin});
 const redeemed=await(await post(client,'/api/invites/redeem',{token})).json() as {participantId:string};
 await post(request,'/api/rooms/'+room.id+'/admit',{participantId:redeemed.participantId});
 const cc=await browser.newContext({storageState:await client.storageState()});
 const tc=await browser.newContext({storageState:await request.storageState()});
 let closed=false;
 try{
  const snap=async()=>(await client.get('/api/rooms/'+room.id+'/snapshot')).json();
  const page=await cc.newPage();expect(await attach(page,room.id)).toBe(true);
  const tp=await tc.newPage();expect(await attach(tp,room.id)).toBe(true);
  let s=await snap();
  expect(s.schemaVersion).toBe(2);expect(s.trays.map((t:any)=>[t.id,t.kind,t.heightmap.w,t.heightmap.h,t.sizeCm.depth,t.baseColor])).toEqual([['dry','dry',144,114,7,'#1F5F8B'],['wet','wet',144,114,7,'#1F5F8B']]);
  const flat=trayState(s,'dry');expect(flat.revision).toBe(0);expect([...base64ToBytes(flat.data)].every(v=>v===179)).toBe(true);
  const r0=s.sceneRevision;

  // Client digs: ACK, both sockets receive tray.changed, the stored bytes equal an independent replay of the kernel.
  const points=[[72,57],[73,57],[74,58]];
  const dig=await send(page,client,room.id,{type:'sand.stroke',operationId:'dig-1',trayId:'dry',tool:'dig',points});
  expect(dig).toMatchObject({type:'operation.ack',sceneRevision:r0+1});
  for(const p of [page,tp])await expect.poll(()=>p.evaluate(()=>(window as any).events.filter((e:any)=>e.type==='tray.changed').length)).toBe(1);
  expect(await tp.evaluate(()=>(window as any).events.find((e:any)=>e.type==='tray.changed'))).toMatchObject({trayId:'dry',trayRevision:1,sceneRevision:r0+1,operationId:'dig-1',stroke:{tool:'dig',points}});
  const expected=createStandardHeightmap();strokeTray(expected,'dig',points as [number,number][]);
  s=await snap();expect(Buffer.from(base64ToBytes(trayState(s,'dry').data)).equals(Buffer.from(expected.data))).toBe(true);
  expect(trayState(s,'dry').revision).toBe(1);expect(trayState(s,'wet').revision).toBe(0);expect(s.sceneRevision).toBe(r0+1);

  // Water on the wet tray, quantized to 1 %.
  expect(await send(page,client,room.id,{type:'tray.water',trayId:'wet',level:.456})).toMatchObject({type:'operation.ack'});
  s=await snap();expect(trayState(s,'wet')).toMatchObject({water:.46,revision:1});
  const accepted=await snap();

  // Refusals: nothing may change.
  const therapistDig=await send(tp,request,room.id,{type:'sand.stroke',trayId:'dry',tool:'dig',points:[[10,10]]});
  const therapistWater=await send(tp,request,room.id,{type:'tray.water',trayId:'wet',level:.9});
  const dryWater=await send(page,client,room.id,{type:'tray.water',trayId:'dry',level:.5});
  const outside=await send(page,client,room.id,{type:'sand.stroke',trayId:'dry',tool:'dig',points:[[200,10]]});
  const tooMany=await send(page,client,room.id,{type:'sand.stroke',trayId:'dry',tool:'dig',points:Array.from({length:9},()=>[5,5])});
  const staleEpoch=await send(page,client,room.id,{type:'sand.stroke',trayId:'dry',tool:'dig',points:[[5,5]]},{sessionEpoch:0});
  const sameWater=await send(page,client,room.id,{type:'tray.water',trayId:'wet',level:.46});
  expect(therapistDig).toMatchObject({type:'operation.rejected',code:'PERMISSION_DENIED'});
  expect(therapistWater).toMatchObject({type:'operation.rejected',code:'PERMISSION_DENIED'});
  for(const r of [dryWater,outside,tooMany,sameWater])expect(r).toMatchObject({type:'operation.rejected',code:'INVALID_PAYLOAD'});
  expect(staleEpoch).toMatchObject({type:'operation.rejected',code:'STALE_EPOCH'});
  s=await snap();expect(s.trays).toEqual(accepted.trays);expect(s.sceneRevision).toBe(accepted.sceneRevision);

  // Retry of the same operation returns the durable ACK and does not dig twice.
  const retry=await send(page,client,room.id,{type:'sand.stroke',operationId:'dig-1',trayId:'dry',tool:'dig',points});
  expect(retry).toEqual(dig);s=await snap();expect(s.trays).toEqual(accepted.trays);

  // Objects carry trayId; one created without a trayId belongs to the dry tray.
  const transform={position:[1,0,-3.9],rotation:[0,0,0,1],scale:1};
  expect(await send(page,client,room.id,{type:'object.create',objectId:'boat',assetId:'IMP_ULTIMATE_Casual_Male',assetVersion:'import-34b06e07f9ec3f26',transform,trayId:'wet'})).toMatchObject({type:'operation.ack'});
  expect(await send(page,client,room.id,{type:'object.create',objectId:'house',assetId:'IMP_ULTIMATE_Casual_Male',assetVersion:'import-34b06e07f9ec3f26',transform})).toMatchObject({type:'operation.ack'});
  s=await snap();expect(Object.fromEntries(s.objects.map((o:any)=>[o.id,o.trayId]))).toEqual({boat:'wet',house:'dry'});

  // Reconnect: a fresh socket sees the same trays (nothing depends on the old connection).
  await page.evaluate(()=>(window as any).ws.close());const again=await cc.newPage();expect(await attach(again,room.id)).toBe(true);
  expect((await snap()).trays).toEqual(accepted.trays);
  expect((await (await request.get(`/__test/room/${room.id}/storage-inspect`)).json()).trays).toBe(2);

  // Ending the session removes the tray rows with the room.
  expect((await post(request,'/api/rooms/'+room.id+'/close')).status()).toBeLessThan(300);closed=true;
  await expect.poll(async()=>(await (await request.get(`/__test/room/${room.id}/storage-inspect`)).json()).trays,{timeout:20000}).toBe(0);
 }finally{if(!closed)await post(request,'/api/rooms/'+room.id+'/close').catch(()=>{});await cc.close();await tc.close();await client.dispose();}
});
