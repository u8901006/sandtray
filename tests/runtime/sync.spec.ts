import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function attach(page:Page,id:string,takeover=false){await page.goto('/');return page.evaluate(({id,takeover})=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket${takeover?'?takeover=1':''}`);w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),{id,takeover});}
async function info(page:Page,id:string):Promise<{sessionEpoch:number;controlEpoch:number}>{return page.evaluate(async id=>(await fetch(`/api/rooms/${id}/info`)).json(),id);}
async function send(page:Page,id:string,input:Record<string,unknown>){const state=await info(page,id);const operationId=(input.operationId as string)??crypto.randomUUID();await page.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),{protocolVersion:1,operationId,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...input});await expect.poll(()=>page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId),{timeout:5000}).toBeTruthy();return page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId);}
test('A02 A05 A09 A20: websocket commits, duplicate ACK, revoke and explicit takeover',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});const {id}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();
 const {token}=await (await post(request,`/api/rooms/${id}/invites`)).json();const clientApi=await playwright.request.newContext({baseURL:origin});const redeemed=await (await post(clientApi,'/api/invites/redeem',{token,nickname:'虛構'})).json();await post(request,`/api/rooms/${id}/admit`,{participantId:redeemed.participantId});
 const tc=await browser.newContext({storageState:await request.storageState()}),cc=await browser.newContext({storageState:await clientApi.storageState()});
 try{
 const t=await tc.newPage(),c=await cc.newPage();expect(await attach(t,id)).toBe(true);expect(await attach(c,id)).toBe(true);
 const transform={position:[0,0,0],rotation:[0,0,0,1],scale:1};
 expect((await send(t,id,{type:'object.create',objectId:'blocked',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform})).code).toBe('PERMISSION_DENIED');
 expect((await send(c,id,{type:'object.create',objectId:'rock',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform})).type).toBe('operation.ack');
 expect((await send(t,id,{type:'object.lock.acquire',objectId:'rock',actions:['translate']})).code).toBe('PERMISSION_DENIED');
 const req=await send(t,id,{type:'permission.request',objectId:'rock',actions:['translate']});
 expect((await send(c,id,{type:'permission.grant',objectId:'rock',requestId:req.operationId,actions:['translate'],durationMs:300000})).type).toBe('operation.ack');
 const grant=await t.evaluate(()=>(window as any).events.filter((e:any)=>e.type==='permission.changed'&&e.grant).at(-1).grant);
 await send(t,id,{type:'object.lock.acquire',objectId:'rock',actions:['translate'],grantId:grant.grantId,grantVersion:grant.grantVersion});
 const lease=await t.evaluate(()=>(window as any).events.filter((e:any)=>e.type==='lock.changed'&&e.lease).at(-1).lease);
 const state=await info(t,id),operationId=crypto.randomUUID();const commit={protocolVersion:1,type:'object.transform.commit',operationId,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,objectId:'rock',expectedObjectRevision:0,leaseId:lease.leaseId,fencingToken:lease.fencingToken,grantId:grant.grantId,grantVersion:grant.grantVersion,transform:{...transform,position:[1,0,0]}};
 await t.evaluate(cmd=>{(window as any).ws.send(JSON.stringify(cmd));(window as any).ws.send(JSON.stringify(cmd));},commit);
 await expect.poll(()=>t.evaluate(op=>(window as any).events.filter((e:any)=>e.operationId===op&&e.type==='operation.ack').length,operationId)).toBe(2);
 const snap=await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json();expect(snap.sceneRevision).toBe(2);expect(snap.objects[0].assetId).toBe('DEV_ROCK');expect(snap.objects[0].transform.position).toEqual([1,0,0]);
 expect((await send(c,id,{type:'permission.revoke',objectId:'rock',grantId:grant.grantId})).type).toBe('operation.ack');
 expect((await send(t,id,{...commit,operationId:crypto.randomUUID(),expectedObjectRevision:1})).code).toBe('PERMISSION_DENIED');
 expect((await send(c,id,{type:'scene.undo',expectedSceneRevision:2})).type).toBe('operation.ack');
 const undone=await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json();expect(undone.objects[0].transform.position).toEqual([0,0,0]);
 expect((await send(c,id,{type:'scene.redo',expectedSceneRevision:3})).type).toBe('operation.ack');
 const redone=await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json();expect(redone.objects[0].transform.position).toEqual([1,0,0]);
 const current=redone.objects[0];await send(c,id,{type:'object.lock.acquire',objectId:'rock',actions:['animate']});
 const animationLease=await c.evaluate(()=>(window as any).events.filter((e:any)=>e.type==='lock.changed'&&e.lease).at(-1).lease);
 expect((await send(c,id,{type:'animation.set',objectId:'rock',expectedObjectRevision:current.revision,leaseId:animationLease.leaseId,fencingToken:animationLease.fencingToken,clipId:'path',state:'playing',offsetMs:0,speed:1,loop:false,path:{points:[[1,0,0],[3,0,0]],durationMs:10000}})).type).toBe('operation.ack');
 expect((await send(c,id,{type:'animation.stopAll'})).type).toBe('operation.ack');
 const stopped=await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json();expect(stopped.objects[0].animation.state).toBe('stopped');expect(stopped.objects[0].transform.position[0]).toBeGreaterThanOrEqual(1);
 const second=await tc.newPage();expect(await attach(second,id)).toBe(false);expect(await attach(second,id,true)).toBe(true);await send(c,id,{type:'presence.heartbeat'});
 expect((await send(second,id,{type:'object.lock.acquire',objectId:'rock',actions:['translate'],grantId:grant.grantId,grantVersion:grant.grantVersion})).code).toBe('PERMISSION_DENIED');
 expect((await post(clientApi,"/api/rooms/"+id+"/close",{})).status()).toBe(403);/* V8-L12-1A：session-only 會談只由治療師結束 */await post(request,"/api/rooms/"+id+"/close",{});expect(await (await request.get('/__test/room/'+id+'/inspect')).json()).toEqual({room:0,operations:0,history:0});
 }finally{await cc.close();await tc.close();await clientApi.dispose();}
});





