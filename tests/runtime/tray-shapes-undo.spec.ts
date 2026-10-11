import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import {createTrayHeightmap,strokeTray} from '../../packages/sand-engine/src/tray';
import {base64ToBytes} from '../../packages/sand-engine/src/core';
// REQ-016 (Claude Opus 5.5, 2026-09-30, user /goal): A6 trays chosen at room creation (shape + size, fixed afterwards), sand and water
// in scene.undo / scene.redo with one history step per drag (gestureId), and the user ruling that a therapist is always refused sand
// and water changes, even while holding the client's grant for an object.
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function attach(page:Page,id:string){await page.goto('/api/health');return page.evaluate(id=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+'/api/rooms/'+id+'/socket');w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),id);}
async function info(api:APIRequestContext,id:string){return (await api.get('/api/rooms/'+id+'/info')).json() as Promise<{sessionEpoch:number;controlEpoch:number}>;}
async function send(page:Page,api:APIRequestContext,id:string,input:Record<string,unknown>){const state=await info(api,id);const operationId=(input.operationId as string)??crypto.randomUUID();const cmd={protocolVersion:1,operationId,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...input};
 const reply=(op:string)=>(window as any).events.filter((e:any)=>e.operationId===op&&(e.type==='operation.ack'||e.type==='operation.rejected')).length;
 const seen=await page.evaluate(reply,operationId);
 await page.evaluate(c=>(window as any).ws.send(JSON.stringify(c)),cmd);
 await expect.poll(()=>page.evaluate(reply,operationId),{timeout:5000}).toBeGreaterThan(seen);
 return page.evaluate(op=>(window as any).events.filter((e:any)=>e.operationId===op&&(e.type==='operation.ack'||e.type==='operation.rejected')).at(-1),operationId);}
const trayOf=(snapshot:any,id:'dry'|'wet')=>snapshot.trays.find((x:any)=>x.id===id);
const bytes=(snapshot:any,id:'dry'|'wet')=>Buffer.from(base64ToBytes(trayOf(snapshot,id).heightmap.data));

test('REQ-016 A6 trays, sand/water undo-redo per drag, therapist always refused',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 // AC16-12: out-of-range or inconsistent trays are refused at creation; nothing is created.
 for(const trays of [{dry:{shape:'rect',w:29,h:57,depth:7},wet:{shape:'rect',w:72,h:57,depth:7}},{dry:{shape:'circle',w:60,h:50,depth:7},wet:{shape:'rect',w:72,h:57,depth:7}},{dry:{shape:'rect',w:72,h:57,depth:11},wet:{shape:'rect',w:72,h:57,depth:7}}])
  expect((await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1',trays})).status()).toBe(400);
 const trays={dry:{shape:'circle',w:60,h:60,depth:7},wet:{shape:'octagon',w:80,h:80,depth:9}};
 const room=await(await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1',trays})).json() as {id:string};
 const {token}=await(await post(request,'/api/rooms/'+room.id+'/invites')).json() as {token:string};
 const client=await playwright.request.newContext({baseURL:origin});
 const redeemed=await(await post(client,'/api/invites/redeem',{token})).json() as {participantId:string};
 await post(request,'/api/rooms/'+room.id+'/admit',{participantId:redeemed.participantId});
 const cc=await browser.newContext({storageState:await client.storageState()});
 const tc=await browser.newContext({storageState:await request.storageState()});
 let closed=false;
 try{
  const snap=async()=>(await client.get('/api/rooms/'+room.id+'/snapshot')).json();
  const c=await cc.newPage();expect(await attach(c,room.id)).toBe(true);
  const t=await tc.newPage();expect(await attach(t,room.id)).toBe(true);
  const empty=await snap();
  expect(empty.trays.map((x:any)=>[x.id,x.shape,x.sizeCm,x.heightmap.w,x.heightmap.h])).toEqual([['dry','circle',{w:60,h:60,depth:7},120,120],['wet','octagon',{w:80,h:80,depth:9},160,160]]);
  const wetFlat=createTrayHeightmap(trays.wet as any);expect(bytes(empty,'wet').equals(Buffer.from(wetFlat.data))).toBe(true);

  // AC16-11: objects must stand inside their tray's outline; sand outside the outline cannot be dug.
  const figure={assetId:'IMP_ULTIMATE_Casual_Male',assetVersion:'import-34b06e07f9ec3f26'};
  const r=60/7.2/2;
  expect(await send(c,client,room.id,{type:'object.create',objectId:'outside',...figure,trayId:'dry',transform:{position:[r*.8,0,r*.8],rotation:[0,0,0,1],scale:1}})).toMatchObject({type:'operation.rejected',code:'INVALID_PAYLOAD'});
  expect(await send(c,client,room.id,{type:'object.create',objectId:'boat',...figure,trayId:'dry',transform:{position:[r*.95,0,0],rotation:[0,0,0,1],scale:1}})).toMatchObject({type:'operation.ack'});
  expect(await send(c,client,room.id,{type:'sand.stroke',trayId:'dry',tool:'dig',points:[[0,0]]})).toMatchObject({type:'operation.rejected',code:'INVALID_PAYLOAD'});

  // One drag = three sand.stroke frames with the same gestureId -> one history step.
  const strokes=[[[80,80],[81,80]],[[82,81]],[[83,82],[84,82],[85,83]]] as [number,number][][];
  for(const points of strokes)expect(await send(c,client,room.id,{type:'sand.stroke',trayId:'wet',tool:'dig',points,gestureId:'drag-1'})).toMatchObject({type:'operation.ack'});
  const dug=createTrayHeightmap(trays.wet as any);for(const points of strokes)strokeTray(dug,'dig',points);
  let s=await snap();expect(bytes(s,'wet').equals(Buffer.from(dug.data))).toBe(true);expect(trayOf(s,'wet').revision).toBe(3);
  const afterDrag=bytes(s,'wet');

  // A separate drag, then a water gesture of two frames.
  expect(await send(c,client,room.id,{type:'sand.stroke',trayId:'wet',tool:'mound',points:[[40,40]],gestureId:'drag-2'})).toMatchObject({type:'operation.ack'});
  const afterMound=bytes(await snap(),'wet');
  for(const level of [.3,.5])expect(await send(c,client,room.id,{type:'tray.water',trayId:'wet',level,gestureId:'water-1'})).toMatchObject({type:'operation.ack'});
  s=await snap();expect(trayOf(s,'wet').waterLevel).toBe(.5);

  // The therapist is refused sand, water and undo even while holding the client's grant for an object; nothing changes.
  const req=await send(t,request,room.id,{type:'permission.request',objectId:'boat',actions:['translate']});
  expect(req).toMatchObject({type:'operation.ack'});
  expect(await send(c,client,room.id,{type:'permission.grant',objectId:'boat',requestId:req.operationId,actions:['translate'],durationMs:60000})).toMatchObject({type:'operation.ack'});
  const granted=await snap();
  for(const cmd of [{type:'sand.stroke',trayId:'wet',tool:'dig',points:[[80,80]]},{type:'sand.stroke',trayId:'dry',tool:'smooth',points:[[60,60]],gestureId:'drag-1'},{type:'tray.water',trayId:'wet',level:.9},{type:'scene.undo',expectedSceneRevision:granted.sceneRevision}])
   expect(await send(t,request,room.id,cmd)).toMatchObject({type:'operation.rejected',code:'PERMISSION_DENIED'});
  expect(await snap()).toEqual(granted);

  const undo=async()=>send(c,client,room.id,{type:'scene.undo',expectedSceneRevision:(await snap()).sceneRevision});
  const redo=async()=>send(c,client,room.id,{type:'scene.redo',expectedSceneRevision:(await snap()).sceneRevision});
  // Undo 1: the whole water gesture (0.5 -> 0), sand untouched.
  expect(await undo()).toMatchObject({type:'operation.ack'});s=await snap();
  expect(trayOf(s,'wet').waterLevel).toBe(0);expect(bytes(s,'wet').equals(afterMound)).toBe(true);expect(trayOf(s,'wet').revision).toBeGreaterThan(trayOf(granted,'wet').revision);
  // Undo 2: the mound drag. Undo 3: the whole three-frame dig drag. The object placed before the drags is still there.
  expect(await undo()).toMatchObject({type:'operation.ack'});expect(bytes(await snap(),'wet').equals(afterDrag)).toBe(true);
  expect(await undo()).toMatchObject({type:'operation.ack'});s=await snap();
  expect(bytes(s,'wet').equals(Buffer.from(wetFlat.data))).toBe(true);expect(s.objects.map((o:any)=>o.id)).toEqual(['boat']);
  expect(bytes(s,'dry').equals(bytes(empty,'dry'))).toBe(true);
  // Redo brings the drag back byte-identically, then the mound, then the water.
  expect(await redo()).toMatchObject({type:'operation.ack'});expect(bytes(await snap(),'wet').equals(afterDrag)).toBe(true);
  expect(await redo()).toMatchObject({type:'operation.ack'});expect(bytes(await snap(),'wet').equals(afterMound)).toBe(true);
  expect(await redo()).toMatchObject({type:'operation.ack'});expect(trayOf(await snap(),'wet').waterLevel).toBe(.5);
  expect(await redo()).toMatchObject({type:'operation.rejected',code:'REVISION_CONFLICT'});

  // Undo, then a new stroke: the redo branch is gone (a new drag with an old gestureId still starts a new step).
  expect(await undo()).toMatchObject({type:'operation.ack'});
  expect(await send(c,client,room.id,{type:'sand.stroke',trayId:'wet',tool:'smooth',points:[[82,81]],gestureId:'water-1'})).toMatchObject({type:'operation.ack'});
  expect(await redo()).toMatchObject({type:'operation.rejected',code:'REVISION_CONFLICT'});
  expect(await undo()).toMatchObject({type:'operation.ack'});expect(bytes(await snap(),'wet').equals(afterMound)).toBe(true);
  expect((await (await request.get(`/__test/room/${room.id}/storage-inspect`)).json()).trayHistory).toBeGreaterThan(0);

  // Ending the session removes the tray history with the room.
  expect((await post(request,'/api/rooms/'+room.id+'/close')).status()).toBeLessThan(300);closed=true;
  await expect.poll(async()=>{const x=await (await request.get(`/__test/room/${room.id}/storage-inspect`)).json();return [x.trays,x.trayHistory];},{timeout:20000}).toEqual([0,0]);
 }finally{if(!closed)await post(request,'/api/rooms/'+room.id+'/close').catch(()=>{});await cc.close();await tc.close();await client.dispose();}
});
