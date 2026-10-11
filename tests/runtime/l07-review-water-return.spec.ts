import {test,expect,type APIRequestContext} from '@playwright/test';
// GPT-6 (Codex) static review 2026-10-04 B-F1: sendRoomWater compared the pending level with the confirmed level only, so
// 0.3 → 0.7 (sent, ACK held) → back to 0.3 was dropped as a no-op and the room stayed at 0.7.

const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});

test('GPT-6 review 2026-10-04 B-F1: returning to the confirmed level while an earlier water change is unacknowledged is still sent',async({request,playwright,browser})=>{
 await expect(await request.post('/__test/login',{data:{name:'therapist'}})).toBeOK();
 const room=await(await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json() as {id:string};
 const {token}=await(await post(request,'/api/rooms/'+room.id+'/invites')).json() as {token:string};
 const client=await playwright.request.newContext({baseURL:origin,extraHTTPHeaders:{'X-Sandtray-Protocol':'2'}});
 const redeemed=await(await post(client,'/api/invites/redeem',{token})).json() as {participantId:string};
 await expect(await post(request,'/api/rooms/'+room.id+'/admit',{participantId:redeemed.participantId})).toBeOK();
 const context=await browser.newContext({storageState:await client.storageState()});
 try{
  // Hold incoming events only; the real socket and server retain their normal send order.
  await context.addInitScript(()=>{
   const Native=window.WebSocket;
   (window as any).__holdWater=false;
   (window as any).__held=[];
   (window as any).__sent=[];
   window.WebSocket=class extends Native{
    constructor(url:string|URL,protocols?:string|string[]){
     super(url,protocols);
     const replayed=new WeakSet<Event>();
     this.addEventListener('message',event=>{
      if(replayed.has(event)||!(window as any).__holdWater)return;
      event.stopImmediatePropagation();
      (window as any).__held.push(()=>{
       const copy=new MessageEvent('message',{data:event.data});
       replayed.add(copy);this.dispatchEvent(copy);
      });
     });
    }
    send(data:string|ArrayBufferLike|Blob|ArrayBufferView){
     if(typeof data==='string')try{(window as any).__sent.push(JSON.parse(data).type);}catch{}
     super.send(data);
    }
   };
  });
  const page=await context.newPage();
  await page.goto('/?room='+room.id);
  const water=page.getByRole('slider',{name:'濕沙盤水位'});
  const level=async()=>((await(await client.get('/api/rooms/'+room.id+'/snapshot')).json()).trays.find((t:any)=>t.id==='wet').waterLevel) as number;
  await expect(water).toBeEnabled();
  await water.fill('0.3');await expect.poll(level).toBe(.3);
  await page.waitForTimeout(1800);
  await page.evaluate(()=>{(window as any).__holdWater=true;(window as any).__sent=[];});
  await water.fill('0.7');
  await expect.poll(()=>page.evaluate(()=>(window as any).__sent.filter((t:string)=>t==='tray.water').length)).toBe(1);
  await expect.poll(level).toBe(.7);
  await expect.poll(()=>page.evaluate(()=>(window as any).__held.length)).toBeGreaterThan(0);
  // Back to the level the client still believes is confirmed, while the 0.7 ACK is held; let the 200 ms debounce fire.
  await water.fill('0.3');
  await page.waitForTimeout(600);
  await page.evaluate(()=>{(window as any).__holdWater=false;for(const release of (window as any).__held.splice(0))release();});
  await expect.poll(level,{timeout:5000}).toBe(.3);
  await expect(water).toHaveValue('0.3');
 }finally{
  await post(request,'/api/rooms/'+room.id+'/close').catch(()=>{});
  await context.close();await client.dispose();
 }
});
