import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function attach(page:Page,id:string){await page.goto('/api/health');return page.evaluate(id=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+'/api/rooms/'+id+'/socket');w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),id);}
async function info(api:APIRequestContext,id:string):Promise<{sessionEpoch:number;controlEpoch:number}>{return (await api.get('/api/rooms/'+id+'/info')).json();}
async function send(page:Page,api:APIRequestContext,id:string,input:Record<string,unknown>){const state=await info(api,id);const operationId=(input.operationId as string)??crypto.randomUUID();await page.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),{protocolVersion:1,operationId,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...input});await expect.poll(()=>page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId),{timeout:5000}).toBeTruthy();return page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId);}
test('REQ-019 color variants validate, persist, and undo/redo safely',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const room=await(await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json() as {id:string};
 const invite=await(await post(request,'/api/rooms/'+room.id+'/invites')).json() as {token:string};
 const client=await playwright.request.newContext({baseURL:origin});
 const redeemed=await(await post(client,'/api/invites/redeem',{token:invite.token,nickname:'膚色測試'})).json() as {participantId:string};
 await post(request,'/api/rooms/'+room.id+'/admit',{participantId:redeemed.participantId});
 const cc=await browser.newContext({storageState:await client.storageState()});
 try{
  const page=await cc.newPage();expect(await attach(page,room.id)).toBe(true);
  const transform={position:[0,0,0],rotation:[0,0,0,1],scale:1};
  const created=await send(page,client,room.id,{type:'object.create',objectId:'variant-person',assetId:'IMP_ULTIMATE_Casual_Male',assetVersion:'import-34b06e07f9ec3f26',transform,colorVariant:'t6'});
  expect(created.type).toBe('operation.ack');
  let snapshot=await(await client.get('/api/rooms/'+room.id+'/snapshot')).json();
  expect(snapshot.objects.find((object:any)=>object.id==='variant-person')).toMatchObject({colorVariant:'t6',revision:0});
  const committed=await send(page,client,room.id,{type:'object.appearance.commit',objectId:'variant-person',expectedObjectRevision:0,materialOverrides:{},hidden:false,colorVariant:'orig'});
  expect(committed.type).toBe('operation.ack');
  snapshot=await(await client.get('/api/rooms/'+room.id+'/snapshot')).json();
  expect(snapshot.objects.find((object:any)=>object.id==='variant-person')).toMatchObject({colorVariant:'orig',revision:1});
  expect((await send(page,client,room.id,{type:'scene.undo',expectedSceneRevision:snapshot.sceneRevision})).type).toBe('operation.ack');
  snapshot=await(await client.get('/api/rooms/'+room.id+'/snapshot')).json();
  expect(snapshot.objects.find((object:any)=>object.id==='variant-person')).toMatchObject({colorVariant:'t6'});
  expect((await send(page,client,room.id,{type:'scene.redo',expectedSceneRevision:snapshot.sceneRevision})).type).toBe('operation.ack');
  snapshot=await(await client.get('/api/rooms/'+room.id+'/snapshot')).json();
  expect(snapshot.objects.find((object:any)=>object.id==='variant-person')).toMatchObject({colorVariant:'orig'});
  const rejectedCreate=await send(page,client,room.id,{type:'object.create',objectId:'invalid-variant',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform,colorVariant:'t3'});
  expect(rejectedCreate).toMatchObject({type:'operation.rejected',code:'INVALID_PAYLOAD'});
  expect((await send(page,client,room.id,{type:'object.create',objectId:'plain-rock',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform})).type).toBe('operation.ack');
  const rejectedAppearance=await send(page,client,room.id,{type:'object.appearance.commit',objectId:'plain-rock',expectedObjectRevision:0,materialOverrides:{},hidden:false,colorVariant:'t3'});
  expect(rejectedAppearance).toMatchObject({type:'operation.rejected',code:'INVALID_PAYLOAD'});
  const final=await(await client.get('/api/rooms/'+room.id+'/snapshot')).json();
  expect(final.objects.find((object:any)=>object.id==='plain-rock')).not.toHaveProperty('colorVariant');
  const beforeTamper=await(await client.get('/api/rooms/'+room.id+'/snapshot')).json();
  const currentVariantObject=beforeTamper.objects.find((object:any)=>object.id==='variant-person');
  const tampered=await send(page,client,room.id,{type:'object.appearance.commit',objectId:'variant-person',expectedObjectRevision:currentVariantObject.revision,materialOverrides:{skin:'#ffffff'},hidden:true,colorVariant:'t6'});
  expect(tampered).toMatchObject({type:'operation.rejected',code:'INVALID_PAYLOAD'});
  const afterTamper=await(await client.get('/api/rooms/'+room.id+'/snapshot')).json();
  expect(afterTamper.sceneRevision).toBe(beforeTamper.sceneRevision);
  expect(afterTamper.objects.find((object:any)=>object.id==='variant-person')).toMatchObject({colorVariant:'orig',hidden:false,materialOverrides:{},revision:currentVariantObject.revision});
 }finally{await cc.close();await client.dispose();}
});
