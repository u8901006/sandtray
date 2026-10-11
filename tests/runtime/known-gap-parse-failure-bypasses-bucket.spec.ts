import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
// C21-F2：每連線每秒最多處理十個 parse-invalid frame；之後必須在 JSON/schema parse 前限流。
// 非法 frame 不得消耗有效 commit bucket 或留下 operation receipt；此為安全回歸測試，不得刪除或 skip。
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function attach(page:Page,id:string){await page.goto('/');return page.evaluate(id=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket`);w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),id);}
async function info(page:Page,id:string):Promise<{sessionEpoch:number;controlEpoch:number}>{return page.evaluate(async id=>(await fetch(`/api/rooms/${id}/info`)).json(),id);}
test('C21-F2: parse-invalid frames are throttled before parsing without consuming valid commit receipts',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const {id}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();
 const {token}=await (await post(request,`/api/rooms/${id}/invites`)).json();
 const clientApi=await playwright.request.newContext({baseURL:origin});
 const redeemed=await (await post(clientApi,'/api/invites/redeem',{token,nickname:'虛構'})).json();
 await post(request,`/api/rooms/${id}/admit`,{participantId:redeemed.participantId});
 const cc=await browser.newContext({storageState:await clientApi.storageState()});
 try{
  const c=await cc.newPage();expect(await attach(c,id)).toBe(true);
  const state=await info(c,id);
  const result=await c.evaluate(async({state})=>{
   const w=window as any;const before=w.events.length;
   // transform z=-9 is outside the wire range (+/-8.34 since REQ-016 A6, 2026-09-30; was z=-4 against +/-3.5): parseInbound throws before any counter is touched (same failure mode as the S1 spec).
   const junk=(op:string)=>({protocolVersion:1,operationId:op,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,type:'object.create',objectId:'gap-junk',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[0,0,-9],rotation:[0,0,0,1],scale:1}});
   const ids=Array.from({length:30},(_,i)=>`gap-${i}-${crypto.randomUUID()}`);
   const began=Date.now();
   for(const op of ids.slice(0,9))w.ws.send(JSON.stringify(junk(op)));
   const valid={protocolVersion:1,operationId:'gap-valid-'+crypto.randomUUID(),sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,type:'object.create',objectId:'gap-valid-rock',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1}};
   w.ws.send(JSON.stringify(valid));
   for(const op of ids.slice(9))w.ws.send(JSON.stringify(junk(op)));
   const terminal=(op:string)=>(w.events.slice(before) as any[]).find(e=>e.operationId===op&&(e.type==='operation.ack'||e.type==='operation.rejected'));
   const gatedReplies=()=>(w.events.slice(before) as any[]).filter(e=>e.type==='operation.rejected'&&e.code==='RATE_LIMITED'&&e.operationId==='invalid');
   const deadline=Date.now()+10000;
   while(Date.now()<deadline&&(!terminal(valid.operationId)||ids.slice(0,10).some(op=>!terminal(op))||gatedReplies().length<20))await new Promise(resolve=>setTimeout(resolve,10));
   const burstElapsedMs=Date.now()-began;const parseInvalidReplies=ids.slice(0,10).map(op=>terminal(op)??null);const limitedReplies=gatedReplies();const validReply=terminal(valid.operationId)??null;
   // Reusing the 11th, gate-rejected frame's operationId next window proves no receipt was persisted.
   const recovery={...valid,operationId:ids[10],objectId:'gap-recovered-rock'};
   await new Promise(resolve=>setTimeout(resolve,1100));const beforeRecovery=w.events.length;w.ws.send(JSON.stringify(recovery));
   const recoveryReply=()=>w.events.slice(beforeRecovery).find((e:any)=>e.operationId===recovery.operationId&&(e.type==='operation.ack'||e.type==='operation.rejected'));
   const recoveryDeadline=Date.now()+10000;while(Date.now()<recoveryDeadline&&!recoveryReply())await new Promise(resolve=>setTimeout(resolve,10));
   return {elapsedMs:burstElapsedMs,validId:valid.operationId,parseInvalidReplies,limitedReplies,validReply,recoveryReply:recoveryReply()??null};
  },{state});
  // All 31 frames in the initial burst must land inside one 1 s window.
  expect(result.elapsedMs).toBeLessThan(1000);
  expect(result.parseInvalidReplies).toHaveLength(10);
  for(const reply of result.parseInvalidReplies){expect(reply?.type).toBe('operation.rejected');expect(reply?.code).toBe('INVALID_PAYLOAD');expect(reply?.retryAfterMs).toBeUndefined();}
  expect(result.limitedReplies).toHaveLength(20);
  for(const reply of result.limitedReplies){expect(reply?.operationId).toBe('invalid');expect(reply?.type).toBe('operation.rejected');expect(reply?.code).toBe('RATE_LIMITED');expect(reply?.retryAfterMs).toBeGreaterThan(0);expect(reply?.retryAfterMs).toBeLessThanOrEqual(1000);}
  expect(new Set(result.limitedReplies.map((reply:any)=>reply.requestId)).size).toBe(20);
  // Nine malformed frames do not consume the valid commit bucket or prevent the valid operation.
  expect(result.validReply?.type).toBe('operation.ack');expect(result.validReply?.retryAfterMs).toBeUndefined();
  expect(result.recoveryReply?.type).toBe('operation.ack');
  const snap=await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json();
  expect(snap.objects.map((o:any)=>o.id)).toEqual(['gap-valid-rock','gap-recovered-rock']);expect(snap.sceneRevision).toBe(2);
 }finally{await cc.close();await clientApi.dispose();}
});
