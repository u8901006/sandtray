import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function attach(page:Page,id:string){await page.goto('/');return page.evaluate(id=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket`);w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),id);}
async function info(page:Page,id:string):Promise<{sessionEpoch:number;controlEpoch:number}>{return page.evaluate(async id=>(await fetch(`/api/rooms/${id}/info`)).json(),id);}
// Sends `count` object.create commands back-to-back on the page's socket (same 1 s window) and returns the
// reply for each operationId in order (null when none arrived within 10 s).
async function burst(page:Page,state:{sessionEpoch:number;controlEpoch:number},prefix:string,count:number){
 return page.evaluate(async({state,prefix,count})=>{
  const w=window as any;const ids:string[]=[];const before=w.events.length;
  for(let i=0;i<count;i++){const operationId=`${prefix}-${i}-${crypto.randomUUID()}`;ids.push(operationId);
   w.ws.send(JSON.stringify({protocolVersion:1,operationId,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,type:'object.create',objectId:`${prefix}-${i}`,assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1}}));}
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){const got=ids.map(op=>w.events.slice(before).find((e:any)=>e.operationId===op));if(got.every(Boolean))return got as any[];await new Promise(r=>setTimeout(r,25));}
  return ids.map(op=>w.events.slice(before).find((e:any)=>e.operationId===op)??null) as any[];
 },{state,prefix,count});
}
// S2 (R1 §5, user-authorized 2026-09-17): the per-connection commit bucket (sync.ts: 10 commits per 1 s window)
// is unchanged; a RATE_LIMITED rejection now carries retryAfterMs = remaining window so clients and load tests
// can back off precisely instead of guessing. Guarded: bucket size (11th commit in one second is rejected),
// retryAfterMs in (0,1000], acks never carry it, and a commit sent after waiting retryAfterMs is acked.
test('S2: 11th commit within one second is RATE_LIMITED with retryAfterMs, and succeeds after waiting',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const {id}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();
 const {token}=await (await post(request,`/api/rooms/${id}/invites`)).json();
 const clientApi=await playwright.request.newContext({baseURL:origin});
 const redeemed=await (await post(clientApi,'/api/invites/redeem',{token,nickname:'虛構'})).json();
 await post(request,`/api/rooms/${id}/admit`,{participantId:redeemed.participantId});
 const cc=await browser.newContext({storageState:await clientApi.storageState()});
 try{
  const c=await cc.newPage();expect(await attach(c,id)).toBe(true);
  const results=await burst(c,await info(c,id),'s2-burst',11);
  expect(results.every(Boolean)).toBe(true);
  const limited=results.filter(r=>r.type==='operation.rejected'&&r.code==='RATE_LIMITED');
  const acked=results.filter(r=>r.type==='operation.ack');
  expect(acked.length).toBe(10);expect(limited.length).toBe(1);
  expect(typeof limited[0].retryAfterMs).toBe('number');expect(limited[0].retryAfterMs).toBeGreaterThan(0);expect(limited[0].retryAfterMs).toBeLessThanOrEqual(1000);
  for(const a of acked)expect(a.retryAfterMs).toBeUndefined();
  const snapshot=await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json();expect(snapshot.objects.length).toBe(10);
  await c.waitForTimeout(limited[0].retryAfterMs+20);
  const after=await burst(c,await info(c,id),'s2-after',1);
  expect(after[0]?.type).toBe('operation.ack');expect(after[0].retryAfterMs).toBeUndefined();
  const final=await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json();expect(final.objects.length).toBe(11);
 }finally{await cc.close();await clientApi.dispose();}
});
