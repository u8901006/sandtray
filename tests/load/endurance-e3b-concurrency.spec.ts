import {test,expect,type APIRequestContext,type BrowserContext} from '@playwright/test';
import {writeFileSync} from 'node:fs';
// E3b：並行度對 ACK 延遲的影響（E3 的後續判別）。E3 單連線：heartbeat 14.3ms／create 18.7ms；
// run3 與 ten-rooms 的 10 房並行：p50 167–188ms。假說：延遲來自同一 workerd isolate 上多個
// DO 的 SQLite 提交排隊（併發數 × 單次提交成本），而非傳輸層。本實驗以 N 房並行 create
// （delete+create 淨零輪替，避開每房 100 件上限）量測 ackMs；N=1 應與 E3 相當，N=10 應接近 190ms。
// 僅量測，不判 AC13 門檻、不改產品碼。
const origin='http://127.0.0.1:8788';
const ROOMS=Number(process.env.E3B_ROOMS??10);
const TICKS=Number(process.env.E3B_TICKS??120);
const GAP_MS=Number(process.env.E3B_GAP_MS??100);
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
const percentile=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return{count:sorted.length,p50Ms:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],p99Ms:sorted[Math.ceil(sorted.length*.99)-1],maxMs:sorted[sorted.length-1]};};
test('E3b measures concurrent-room create ACK latency',async({request,playwright,browser},testInfo)=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const pages:{id:string;page:any}[]=[];
 const contexts:BrowserContext[]=[],apis:APIRequestContext[]=[],ids:string[]=[];
 try{
  for(let index=0;index<ROOMS;index++){
   const response=await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'});expect(response.status()).toBe(200);
   const {id}=await response.json();ids.push(id);
   const {token}=await(await post(request,`/api/rooms/${id}/invites`)).json();
   const api=await playwright.request.newContext({baseURL:origin});apis.push(api);
   const redeemed=await post(api,'/api/invites/redeem',{token,nickname:`e3b-${index}`});expect(redeemed.status()).toBe(200);
   expect((await post(request,`/api/rooms/${id}/admit`,{participantId:(await redeemed.json()).participantId})).status()).toBe(200);
   const context=await browser.newContext({storageState:await api.storageState()});contexts.push(context);
   const page=await context.newPage();
   await page.goto('/api/health');
   await page.evaluate(id=>new Promise<boolean>(resolve=>{
    const w=window as any;w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket`);
    w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);
   }),id);
   pages.push({id,page});
  }
  const samples=await Promise.all(pages.map((room,index)=>{
   const measureRoom=async(setup:{id:string;index:number;ticks:number;gapMs:number})=>{
    const state=await(await fetch(`/api/rooms/${setup.id}/info`)).json() as {sessionEpoch:number;controlEpoch:number};
    const ws=(window as any).ws as WebSocket;
    const sendMeasured=(command:Record<string,unknown>)=>new Promise<number>((resolve,reject)=>{
     const began=performance.now();
     const onMessage=(event:MessageEvent)=>{const value=JSON.parse(event.data);if(value.operationId===command.operationId){ws.removeEventListener('message',onMessage);clearTimeout(timer);resolve(performance.now()-began);}};
     const timer=setTimeout(()=>{ws.removeEventListener('message',onMessage);reject(new Error('ACK deadline exceeded'));},10000);
     ws.addEventListener('message',onMessage);ws.send(JSON.stringify({protocolVersion:1,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...command}));
    });
    const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
    const ackMs:number[]=[];
    await sendMeasured({type:'object.create',operationId:`e3b-seed-${setup.index}`,objectId:`e3b-obj-${setup.index}`,assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1}});
    for(let tick=0;tick<setup.ticks;tick++){
     await sendMeasured({type:'object.delete',operationId:`e3b-del-${setup.index}-${tick}`,objectId:tick===0?`e3b-obj-${setup.index}`:`e3b-obj-${setup.index}-${tick-1}`,expectedObjectRevision:0});
     const created=await sendMeasured({type:'object.create',operationId:`e3b-create-${setup.index}-${tick}`,objectId:`e3b-obj-${setup.index}-${tick}`,assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1}});
     ackMs.push(created);
     await sleep(setup.gapMs);
    }
    return ackMs;
   };
   return room.page.evaluate(measureRoom,{id:room.id,index,ticks:TICKS,gapMs:GAP_MS});
  }));
  const flat=samples.flat();
  expect(flat.length).toBe(ROOMS*TICKS);
  const result={
   scope:'E3b measurement only. Concurrency discriminator for open-items #16; not an AC13 gate; no product code changed.',
   env:{rooms:ROOMS,ticks:TICKS,gapMs:GAP_MS,sockets:ROOMS},
   createAck:percentile(flat),
   perRoomP50:samples.map((roomSamples,index)=>({room:index,p50Ms:percentile(roomSamples).p50Ms}))
  };
  writeFileSync(testInfo.outputPath('e3b-concurrency.json'),JSON.stringify(result,null,2)+'\n');
  console.log('E3b result: '+JSON.stringify(result,null,1));
 }finally{
  for(const id of ids)await post(request,`/api/rooms/${id}/close`).catch(()=>{});
  for(const context of contexts)await context.close();for(const api of apis)await api.dispose();
 }
});
