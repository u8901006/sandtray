import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function attach(page:Page,id:string){await page.goto('/');return page.evaluate(id=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket`);w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),id);}
async function info(page:Page,id:string):Promise<{sessionEpoch:number;controlEpoch:number}>{return page.evaluate(async id=>(await fetch(`/api/rooms/${id}/info`)).json(),id);}
async function send(page:Page,id:string,input:Record<string,unknown>){const state=await info(page,id);const operationId=(input.operationId as string)??crypto.randomUUID();await page.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),{protocolVersion:1,operationId,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...input});await expect.poll(()=>page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId),{timeout:5000}).toBeTruthy();return page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId);}
// S1 (R1 §5, user-authorized 2026-09-17): a command that fails protocol parsing (here transform z=-9, outside the wire
// range; was z=-4 until REQ-016 A6 widened the range to +/-8.34 on 2026-09-30, keeping this a parse failure) must be rejected with INVALID_PAYLOAD *attributed to the original operationId*. Previously the
// reply carried operationId:'invalid' and clients could not attribute it (C12: root cause of three misread runs).
// Invariant guarded here: a parse-failed command leaves no persistence (no object, no receipt). Re-using the
// same operationId with a valid payload afterwards must therefore be processed as a fresh command and be acked.
test('S1: invalid payload is rejected with the original operationId and leaves no object or receipt',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const {id}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();
 const {token}=await (await post(request,`/api/rooms/${id}/invites`)).json();
 const clientApi=await playwright.request.newContext({baseURL:origin});
 const redeemed=await (await post(clientApi,'/api/invites/redeem',{token,nickname:'虛構'})).json();
 await post(request,`/api/rooms/${id}/admit`,{participantId:redeemed.participantId});
 const cc=await browser.newContext({storageState:await clientApi.storageState()});
 try{
  const c=await cc.newPage();expect(await attach(c,id)).toBe(true);
  const operationId='s1-attributed-'+crypto.randomUUID();
  const bad=await send(c,id,{type:'object.create',operationId,objectId:'s1-rock',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[0,0,-9],rotation:[0,0,0,1],scale:1}});
  expect(bad.type).toBe('operation.rejected');expect(bad.code).toBe('INVALID_PAYLOAD');expect(bad.operationId).toBe(operationId);expect(bad.retryAfterMs).toBeUndefined();
  const snapshot=await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json();
  expect(snapshot.objects.map((o:any)=>o.id)).not.toContain('s1-rock');
  // same operationId, now valid: must ack (proves no receipt was stored for the parse-failed attempt).
  // clear the page's event buffer first so send() does not match the earlier rejection for the same id.
  await c.evaluate(()=>{(window as any).events=[];});
  const good=await send(c,id,{type:'object.create',operationId,objectId:'s1-rock',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1}});
  expect(good.type).toBe('operation.ack');
  const after=await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json();
  expect(after.objects.map((o:any)=>o.id)).toContain('s1-rock');
  // a payload whose operationId itself violates the id rule still gets 'invalid' (never echo arbitrary text)
  const weird=await c.evaluate(()=>new Promise<any>(resolve=>{const w=window as any;const before=w.events.length;w.ws.send(JSON.stringify({protocolVersion:1,operationId:'not valid!',sessionEpoch:1,controlEpoch:1,type:'object.create'}));const poll=()=>{const e=w.events.slice(before).find((x:any)=>x.type==='operation.rejected');if(e)resolve(e);else setTimeout(poll,50);};poll();}));
  expect(weird.code).toBe('INVALID_PAYLOAD');expect(weird.operationId).toBe('invalid');
  // non-JSON payload: still a rejection with 'invalid', socket stays usable
  const garbage=await c.evaluate(()=>new Promise<any>(resolve=>{const w=window as any;const before=w.events.length;w.ws.send('{not json');const poll=()=>{const e=w.events.slice(before).find((x:any)=>x.type==='operation.rejected');if(e)resolve(e);else setTimeout(poll,50);};poll();}));
  expect(garbage.code).toBe('INVALID_PAYLOAD');expect(garbage.operationId).toBe('invalid');
  // oversize frame (> 16 KiB cap in parseInbound): rejected as 'invalid' without echoing the embedded id (C21-F1), socket stays usable
  const big=await c.evaluate(()=>new Promise<any>(resolve=>{const w=window as any;const before=w.events.length;w.ws.send(JSON.stringify({protocolVersion:1,operationId:'s1-oversize-id',sessionEpoch:1,controlEpoch:1,type:'object.create',pad:'x'.repeat(20000)}));const poll=()=>{const e=w.events.slice(before).find((x:any)=>x.type==='operation.rejected');if(e)resolve(e);else setTimeout(poll,50);};poll();}));
  expect(big.code).toBe('INVALID_PAYLOAD');expect(big.operationId).toBe('invalid');
  expect((await send(c,id,{type:'presence.heartbeat'})).type).toBe('operation.ack');
 }finally{await cc.close();await clientApi.dispose();}
});
