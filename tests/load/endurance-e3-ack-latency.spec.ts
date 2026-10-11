import {test,expect,type Page,type APIRequestContext,type BrowserContext} from '@playwright/test';
import {writeFileSync} from 'node:fs';
// E3：ACK 延遲組成判別實驗（C6 §3.3、2026-09-15 09:50 使用者裁定）。僅量測，不判 AC13 門檻、不改產品碼。
// 假說：object.create／object.delete 的回覆是 scene.patch＋operation.ack 兩個連續小 frame
// （sync.ts:132 先 broadcast（含發送者）後 ws.send(ack)）；Windows loopback delayed-ACK/Nagle
// 可能讓第二個小 frame 延遲約 200ms 才抵達 → create/delete ACK p50 落在 ~187ms。
// presence.heartbeat 無 scene.patch（sync.ts:70-71 ephemeral、events 空），僅單一 ack frame，應不受影響。
// 判讀：heartbeat 明顯快於 create（且 create 內 patch 先到、ack 落後 ~200ms）→ 傳輸假象；
// 兩者皆 ~187ms → 環境常態。各組 ≥200 樣本（E3_SAMPLES 可調）。
const origin='http://127.0.0.1:8788';
const SAMPLES=Number(process.env.E3_SAMPLES??210);
const GAP_MS=Number(process.env.E3_GAP_MS??60);
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
const percentile=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return{count:sorted.length,p50Ms:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],p99Ms:sorted[Math.ceil(sorted.length*.99)-1],maxMs:sorted[sorted.length-1]};};
test('E3 heartbeat versus create ACK latency composition on a single connection',async({request,playwright,browser},testInfo)=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const response=await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'});expect(response.status()).toBe(200);
 const {id}=await response.json();
 const {token}=await(await post(request,`/api/rooms/${id}/invites`)).json();
 const api=await playwright.request.newContext({baseURL:origin});
 const redeemed=await post(api,'/api/invites/redeem',{token,nickname:'e3-client'});expect(redeemed.status()).toBe(200);
 expect((await post(request,`/api/rooms/${id}/admit`,{participantId:(await redeemed.json()).participantId})).status()).toBe(200);
 const context=await browser.newContext({storageState:await api.storageState()});
 const page=await context.newPage();
 try{
  await page.goto('/api/health');
  const samples=await page.evaluate(async({id,samples,gapMs})=>{
   const w=window as any;
   await new Promise<boolean>(resolve=>{
    w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket`);
    w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);
   });
   const state=await(await fetch(`/api/rooms/${id}/info`)).json() as {sessionEpoch:number;controlEpoch:number};
   const envelope=(command:Record<string,unknown>)=>JSON.stringify({protocolVersion:1,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...command});
   const ws=w.ws as WebSocket;
   const sendMeasured=(command:Record<string,unknown>)=>new Promise<{ackMs:number;patchMs:number|null}>((resolve,reject)=>{
    const began=performance.now();let patchMs:number|null=null;
    const onMessage=(event:MessageEvent)=>{
     const value=JSON.parse(event.data);
     if(value.type==='scene.patch'&&patchMs===null)patchMs=performance.now()-began;
     if(value.operationId===command.operationId){ws.removeEventListener('message',onMessage);clearTimeout(timer);resolve({ackMs:performance.now()-began,patchMs});}
    };
    const timer=setTimeout(()=>{ws.removeEventListener('message',onMessage);reject(new Error('ACK deadline exceeded'));},10000);
    ws.addEventListener('message',onMessage);ws.send(envelope(command));
   });
   const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
   const heartbeat:{ackMs:number}[]=[],create:{ackMs:number;patchMs:number|null}[]=[],remove:{ackMs:number}[]=[];
   for(let index=0;index<samples;index++){
    const hb=await sendMeasured({type:'presence.heartbeat',operationId:`e3-hb-${index}`});heartbeat.push({ackMs:hb.ackMs});
    await sleep(gapMs);
    if(index>0){const del=await sendMeasured({type:'object.delete',operationId:`e3-del-${index}`,objectId:`e3-obj-${index-1}`,expectedObjectRevision:0});remove.push({ackMs:del.ackMs});await sleep(gapMs);}
    const created=await sendMeasured({type:'object.create',operationId:`e3-create-${index}`,objectId:`e3-obj-${index}`,assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1}});
    create.push({ackMs:created.ackMs,patchMs:created.patchMs});
    await sleep(gapMs);
   }
   return {heartbeat,create,remove};
  },{id,samples:SAMPLES,gapMs:GAP_MS});
  expect(samples.heartbeat).toHaveLength(SAMPLES);expect(samples.create).toHaveLength(SAMPLES);expect(samples.remove).toHaveLength(SAMPLES-1);
  const patchLead=samples.create.filter(s=>s.patchMs!==null).map(s=>s.ackMs-(s.patchMs as number));
  const patchAbsent=samples.create.filter(s=>s.patchMs===null).length;
  const result={
   scope:'E3 measurement only (C6 §3.3). Not an AC13 endurance gate; no product code changed.',
   env:{samples:SAMPLES,gapMs:GAP_MS,rooms:1,sockets:1},
   heartbeat:percentile(samples.heartbeat.map(s=>s.ackMs)),
   create:percentile(samples.create.map(s=>s.ackMs)),
   remove:percentile(samples.remove.map(s=>s.ackMs)),
   createPatchLeadMs:percentile(patchLead),
   createPatchObserved:`${SAMPLES-patchAbsent}/${SAMPLES}`,
   interpretationHint:'patchLead ≈ 0 with create/ remove >> heartbeat ⇒ second frame (ack) delayed by transport (Nagle/delayed-ACK); create ≈ heartbeat ⇒ environment norm.'
  };
  writeFileSync(testInfo.outputPath('e3-ack-latency.json'),JSON.stringify(result,null,2)+'\n');
  console.log('E3 result: '+JSON.stringify(result,null,1));
 }finally{
  await post(request,`/api/rooms/${id}/close`).catch(()=>{});
  await context.close();await api.dispose();
 }
});
