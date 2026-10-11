import {test,expect,type Page,type APIRequestContext,type BrowserContext} from '@playwright/test';
import {writeFileSync} from 'node:fs';
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function connect(page:Page,id:string){
 await page.goto('/api/health');
 expect(await page.evaluate(id=>new Promise<boolean>(resolve=>{
  const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket`);
  w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));
  w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);
 }),id)).toBe(true);
}
async function send(page:Page,id:string,command:Record<string,unknown>){
 return page.evaluate(async({id,command})=>{
  const state=await(await fetch(`/api/rooms/${id}/info`)).json() as {sessionEpoch:number;controlEpoch:number};
  const payload={protocolVersion:1,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...command};
  const ws=(window as any).ws as WebSocket;
  return new Promise<{event:any;ms:number}>((resolve,reject)=>{
   const began=performance.now();
   const finish=(event:MessageEvent)=>{const value=JSON.parse(event.data);if(value.operationId!==command.operationId)return;clearTimeout(timer);ws.removeEventListener('message',finish);resolve({event:value,ms:performance.now()-began});};
   const timer=setTimeout(()=>{ws.removeEventListener('message',finish);reject(new Error('ACK deadline exceeded'));},10000);
   ws.addEventListener('message',finish);ws.send(JSON.stringify(payload));
  });
 },{id,command});
}
test('ten simultaneous two-seat rooms keep commits, receipts and client access isolated',async({request,playwright,browser},testInfo)=>{
 const rooms:{id:string;api:APIRequestContext;c:Page;t:Page;contexts:BrowserContext[]}[]=[];
 const contexts:BrowserContext[]=[],apis:APIRequestContext[]=[],ids:string[]=[],samples:number[]=[];
 await request.post('/__test/login',{data:{name:'therapist'}});
 try{
  for(let index=0;index<10;index++){
   const response=await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'});expect(response.status()).toBe(200);const {id}=await response.json();ids.push(id);
   const {token}=await(await post(request,`/api/rooms/${id}/invites`)).json();
   const api=await playwright.request.newContext({baseURL:origin});apis.push(api);
   const redeemed=await post(api,'/api/invites/redeem',{token,nickname:`synthetic-${index}`});expect(redeemed.status()).toBe(200);
   expect((await post(request,`/api/rooms/${id}/admit`,{participantId:(await redeemed.json()).participantId})).status()).toBe(200);
   const tc=await browser.newContext({storageState:await request.storageState()});contexts.push(tc);
   const cc=await browser.newContext({storageState:await api.storageState()});contexts.push(cc);
   const t=await tc.newPage(),c=await cc.newPage();await connect(t,id);await connect(c,id);
   rooms.push({id,api,c,t,contexts:[tc,cc]});
  }
  for(const room of rooms)for(const page of [room.c,room.t])expect(await page.evaluate(()=>(window as any).ws.readyState)).toBe(1);
  const began=performance.now();
  for(let batch=0;batch<100;batch++){
   const results=await Promise.all(rooms.map(async(room,index)=>{
    const command={type:'object.create',operationId:crypto.randomUUID(),objectId:`room-${index}-object-${batch}`,assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[batch%10-4.5,0,(Math.floor(batch/10)-4.5)*.6],rotation:[0,0,0,1],scale:1}};
    const receipt=await send(room.c,room.id,command);expect(receipt.event.type).toBe('operation.ack');samples.push(receipt.ms);
    if(batch===99){const duplicate=await send(room.c,room.id,command);expect(duplicate.event).toEqual(receipt.event);}
    return receipt;
   }));expect(results).toHaveLength(10);
  }
  const commitDurationMs=performance.now()-began;
  for(const [index,room] of rooms.entries()){
   const snapshot=await(await room.api.get(`/api/rooms/${room.id}/snapshot`)).json();expect(snapshot.sceneRevision).toBe(100);expect(snapshot.objects.map((o:any)=>o.id).sort()).toEqual(Array.from({length:100},(_,i)=>`room-${index}-object-${i}`).sort());
   expect((await room.api.get(`/api/rooms/${rooms[(index+1)%10].id}/snapshot`)).status()).toBe(403);
   for(const page of [room.c,room.t]){
    const paths=await page.evaluate(()=>(window as any).events.filter((e:any)=>e.type==='room.snapshot').map((e:any)=>e.snapshotPath));
    expect(paths.length).toBeGreaterThan(0);expect(new Set(paths)).toEqual(new Set([`/api/rooms/${room.id}/snapshot`]));
   }
   const denied=await send(room.t,room.id,{type:'object.create',operationId:crypto.randomUUID(),objectId:'forbidden',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1}});expect(denied.event.code).toBe('PERMISSION_DENIED');
  }
  expect((await post(rooms[0].api,`/api/rooms/${rooms[0].id}/close`)).status()).toBe(200);
  for(const room of rooms.slice(1))expect((await room.api.get(`/api/rooms/${room.id}/snapshot`)).status()).toBe(200);
  const sorted=[...samples].sort((a,b)=>a-b);
  writeFileSync(testInfo.outputPath('ten-rooms.json'),JSON.stringify({rooms:10,sockets:20,commits:1000,objectsPerRoom:100,duplicateReceipts:10,crossRoomDenials:10,therapistWriteDenials:10,commitDurationMs,ackMedianMs:sorted[Math.floor(sorted.length*.5)],ackP95Ms:sorted[Math.ceil(sorted.length*.95)-1],scope:'Local protocol-only short burst. No rendered scenes, real-device FPS, production throughput or 60-minute endurance acceptance.'},null,2)+'\n');
 }finally{
  for(const id of ids)await post(request,`/api/rooms/${id}/close`).catch(()=>{});
  for(const context of contexts)await context.close();for(const api of apis)await api.dispose();
 }
});
