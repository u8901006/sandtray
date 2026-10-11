import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function attach(page:Page,id:string){await page.goto('/');return page.evaluate(id=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket`);w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),id);}
async function info(page:Page,id:string):Promise<{sessionEpoch:number;controlEpoch:number}>{return page.evaluate(async id=>(await fetch(`/api/rooms/${id}/info`)).json(),id);}
async function send(page:Page,id:string,input:Record<string,unknown>){const state=await info(page,id);const operationId=(input.operationId as string)??crypto.randomUUID();await page.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),{protocolVersion:1,operationId,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...input});await expect.poll(()=>page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId),{timeout:5000}).toBeTruthy();return page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId);}
// G23 / C5 #20（v5）：同一連線同一 tick 對「同物件」排隊兩個操作——兩筆都在任何回覆前進入 in-flight。
// 伺服器必須序列化：恰一筆 create 勝出被 ack 並帶新 sceneRevision；落敗筆對勝出後的狀態被拒
// （INVALID_PAYLOAD）、歸因到自己的 operationId（S1）；snapshot 與唯一被套用的操作一致。
// 勝出筆依 receipt 原樣重送不得推進 revision；之後的 commit 觀察到嚴格遞增（單調）。
test('G23: same-tick queued creates for one object resolve to exactly one ack and a consistent snapshot',async({request,playwright,browser})=>{
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
  const pair=await c.evaluate(async({state})=>{
   const w=window as any;const before=w.events.length;
   const base={protocolVersion:1,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,type:'object.create',objectId:'g23-tick-rock',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1}};
   const first={...base,operationId:'tick-a-'+crypto.randomUUID()};
   const second={...base,operationId:'tick-b-'+crypto.randomUUID()};
   w.ws.send(JSON.stringify(first));w.ws.send(JSON.stringify(second)); // same tick, same object, both in flight before any reply
   const terminal=(op:string)=>(w.events.slice(before) as any[]).find(e=>e.operationId===op&&(e.type==='operation.ack'||e.type==='operation.rejected'));
   const deadline=Date.now()+5000;
   while(Date.now()<deadline&&(!terminal(first.operationId)||!terminal(second.operationId)))await new Promise(resolve=>setTimeout(resolve,10));
   return {first,second,firstReply:terminal(first.operationId)??null,secondReply:terminal(second.operationId)??null};
  },{state});
  expect(pair.firstReply).toBeTruthy();expect(pair.secondReply).toBeTruthy();
  expect([pair.firstReply.type,pair.secondReply.type].sort()).toEqual(['operation.ack','operation.rejected']);
  const winner=pair.firstReply.type==='operation.ack'?pair.firstReply:pair.secondReply;
  const loser=pair.firstReply.type==='operation.ack'?pair.secondReply:pair.firstReply;
  // the loser raced against the winner's post-state and is rejected, attributed to its own operationId
  expect(loser.code).toBe('INVALID_PAYLOAD');
  expect(loser.operationId).not.toBe(winner.operationId);
  expect([pair.first.operationId,pair.second.operationId]).toContain(loser.operationId);
  expect(winner.sceneRevision).toBe(1);
  let snap=await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json();
  expect(snap.sceneRevision).toBe(1);expect(snap.objects.map((o:any)=>o.id)).toEqual(['g23-tick-rock']);expect(snap.objects[0].revision).toBe(0);
  // receipt replay of the winner: identical command returns the stored ack and must not move anything
  const replay=await c.evaluate(async({command})=>{
   const w=window as any;const before=w.events.length;w.ws.send(JSON.stringify(command));
   const deadline=Date.now()+5000;
   while(Date.now()<deadline&&!(w.events.slice(before) as any[]).some(e=>e.operationId===command.operationId&&(e.type==='operation.ack'||e.type==='operation.rejected')))await new Promise(resolve=>setTimeout(resolve,10));
   return (w.events.slice(before) as any[]).find(e=>e.operationId===command.operationId)??null;
  },{command:pair.firstReply.type==='operation.ack'?pair.first:pair.second});
  expect(replay?.type).toBe('operation.ack');expect(replay?.sceneRevision).toBe(1);
  snap=await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json();
  expect(snap.sceneRevision).toBe(1);expect(snap.objects.map((o:any)=>o.id)).toEqual(['g23-tick-rock']);
  // a later commit observes a strictly higher revision (monotonic after the queued pair)
  const later=await send(c,id,{type:'object.create',objectId:'g23-tick-rock-2',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1}});
  expect(later.type).toBe('operation.ack');expect(later.sceneRevision).toBe(2);
  snap=await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json();
  expect(snap.sceneRevision).toBe(2);expect(snap.objects.map((o:any)=>o.id).sort()).toEqual(['g23-tick-rock','g23-tick-rock-2']);
 }finally{await cc.close();await clientApi.dispose();}
});
