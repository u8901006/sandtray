import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
// GPT-6 (Codex) re-review 2026-10-04 B-F2: interleavings around settleRoomWater that had no individual runtime case.
//  1. the socket drops while undo waits for an unacknowledged water ACK → undo is never sent; tray.water is not replayed on
//     reconnect (receipts cover object/scene only), the server's applied 0.6 shows and is one history step (undo → 0.3);
//  2. the slider moves again while undo waits → the undo (expectedSceneRevision = 0.6 ACK revision) is rejected REVISION_CONFLICT,
//     0.8 stays, history holds 0.6 and 0.8 as two steps (Codex B-F2 recheck: the earlier version could pass with undo silently lost);
//  3. receipts replay (positive) and late events from the replaced socket: an object.create whose ACK is held is replayed on
//     reconnect with the same operationId and stored once; releasing the old socket's held events afterwards changes nothing.
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
const release=(page:Page)=>page.evaluate(()=>{(window as any).__holdWater=false;for(const r of (window as any).__held.splice(0))r();});
test('B-F2 1: socket drop while undo waits for the water ACK — no undo, no water replay, one history step',async({request,playwright,browser})=>{
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
   (window as any).__sent=[];(window as any).__sentOps=[];
   window.WebSocket=class extends Native{
    constructor(url:string|URL,protocols?:string|string[]){
     super(url,protocols);
     ((window as any).__sockets??=[]).push(this);
     const replayed=new WeakSet<Event>();
     this.addEventListener('message',event=>{
      if(!replayed.has(event))try{const m=JSON.parse((event as MessageEvent).data);if(m.type==='operation.ack'||m.type==='operation.rejected')((window as any).__recv??=[]).push({type:m.type,op:m.operationId,code:m.code,rev:m.sceneRevision});}catch{}
      if(replayed.has(event)||!(window as any).__holdWater)return;
      event.stopImmediatePropagation();
      (window as any).__held.push(()=>{
       const copy=new MessageEvent('message',{data:event.data});
       replayed.add(copy);this.dispatchEvent(copy);
      });
     });
    }
    send(data:string|ArrayBufferLike|Blob|ArrayBufferView){
     if(typeof data==='string')try{const c=JSON.parse(data);(window as any).__sent.push(c.type);(window as any).__sentOps.push({type:c.type,op:c.operationId,level:c.level,rev:c.expectedSceneRevision});}catch{}
     super.send(data);
    }
   };
  });
  const page=await context.newPage();
  await page.goto('/?room='+room.id);
  const water=page.getByRole('slider',{name:'濕沙盤水位'});
  const undo=page.getByRole('button',{name:'復原',exact:true});
  const snap=async()=>(await(await client.get('/api/rooms/'+room.id+'/snapshot')).json());
  const level=async()=>(await snap()).trays.find((t:any)=>t.id==='wet').waterLevel as number;
  await expect(water).toBeEnabled();
  await water.fill('0.3');await expect.poll(level).toBe(.3);
  await page.waitForTimeout(1800);
  await page.evaluate(()=>{(window as any).__holdWater=true;(window as any).__sent=[];(window as any).__sentOps=[];});
  await water.fill('0.6');
  await expect.poll(()=>page.evaluate(()=>(window as any).__sent.includes('tray.water'))).toBe(true);
  await expect.poll(level).toBe(.6);
  await undo.click();
  await page.waitForTimeout(150);
  // Drop the connection while undo is still waiting for the held water ACK.
  await page.evaluate(()=>{for(const s of (window as any).__sockets)s.close();(window as any).__holdWater=false;(window as any).__held.length=0;});
  await expect(page.getByRole('button',{name:'重新連線',exact:true})).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(()=>(window as any).__sent.filter((t:string)=>t==='scene.undo'))).toEqual([]);
  const waterOp=await page.evaluate(()=>(window as any).__sentOps.find((c:any)=>c.type==='tray.water').op);
  await page.getByRole('button',{name:'重新連線',exact:true}).click();
  await expect(undo).toBeEnabled();
  // ReceiptRetry replays object/scene commands only (apps/web/src/receipt-retry.ts); tray.* is not replayed. The server already
  // applied the 0.6 before the ACK was held, so after reconnect the slider shows the server level and history holds it once.
  await page.waitForTimeout(500);
  expect(await page.evaluate(op=>(window as any).__sentOps.filter((c:any)=>c.op===op).length,waterOp)).toBe(1);
  expect(await page.evaluate(()=>(window as any).__sent.filter((t:string)=>t==='scene.undo'))).toEqual([]);
  await expect.poll(level).toBe(.6);await expect(water).toHaveValue('0.6');
  // One history step for the water change: a single undo returns to 0.3, a second leaves the empty start (0).
  await undo.click();await expect.poll(level).toBe(.3);await expect(water).toHaveValue('0.3');
  await undo.click();await expect.poll(level).toBe(0);
 }finally{
  await post(request,'/api/rooms/'+room.id+'/close').catch(()=>{});
  await context.close();await client.dispose();
 }
});
test('B-F2 2: slider moved again while undo waits — the stale undo is rejected, the newest level stays, history holds both steps',async({request,playwright,browser})=>{
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
   (window as any).__sent=[];(window as any).__sentOps=[];
   window.WebSocket=class extends Native{
    constructor(url:string|URL,protocols?:string|string[]){
     super(url,protocols);
     ((window as any).__sockets??=[]).push(this);
     const replayed=new WeakSet<Event>();
     this.addEventListener('message',event=>{
      if(!replayed.has(event))try{const m=JSON.parse((event as MessageEvent).data);if(m.type==='operation.ack'||m.type==='operation.rejected')((window as any).__recv??=[]).push({type:m.type,op:m.operationId,code:m.code,rev:m.sceneRevision});}catch{}
      if(replayed.has(event)||!(window as any).__holdWater)return;
      event.stopImmediatePropagation();
      (window as any).__held.push(()=>{
       const copy=new MessageEvent('message',{data:event.data});
       replayed.add(copy);this.dispatchEvent(copy);
      });
     });
    }
    send(data:string|ArrayBufferLike|Blob|ArrayBufferView){
     if(typeof data==='string')try{const c=JSON.parse(data);(window as any).__sent.push(c.type);(window as any).__sentOps.push({type:c.type,op:c.operationId,level:c.level,rev:c.expectedSceneRevision});}catch{}
     super.send(data);
    }
   };
  });
  const page=await context.newPage();
  await page.goto('/?room='+room.id);
  const water=page.getByRole('slider',{name:'濕沙盤水位'});
  const undo=page.getByRole('button',{name:'復原',exact:true});
  const snap=async()=>(await(await client.get('/api/rooms/'+room.id+'/snapshot')).json());
  const level=async()=>(await snap()).trays.find((t:any)=>t.id==='wet').waterLevel as number;
  await expect(water).toBeEnabled();
  await water.fill('0.3');await expect.poll(level).toBe(.3);
  await page.waitForTimeout(1800);
  await page.evaluate(()=>{(window as any).__holdWater=true;(window as any).__sent=[];(window as any).__sentOps=[];});
  await water.fill('0.6');
  await expect.poll(()=>page.evaluate(()=>(window as any).__sent.includes('tray.water'))).toBe(true);
  await expect.poll(level).toBe(.6);
  const ack06=await page.evaluate(()=>(window as any).__sentOps.find((c:any)=>c.type==='tray.water').op);
  await undo.click();
  await page.waitForTimeout(150);
  // While undo waits for the held 0.6 ACK, the user moves the slider again and its 200 ms timer sends 0.8.
  await water.fill('0.8');
  await expect.poll(()=>page.evaluate(()=>(window as any).__sentOps.filter((c:any)=>c.type==='tray.water').map((c:any)=>c.level))).toEqual([.6,.8]);
  await expect.poll(level).toBe(.8);
  expect(await page.evaluate(()=>(window as any).__sent.filter((t:string)=>t==='scene.undo'))).toEqual([]);
  await release(page);
  // Defined semantics (server-authoritative, sync.ts scene.undo): the waiting undo names the revision of the 0.6 ACK; the 0.8 step
  // is newer, so the server rejects it with REVISION_CONFLICT instead of silently undoing the change the user just made.
  await expect.poll(()=>page.evaluate(()=>(window as any).__sentOps.filter((c:any)=>c.type==='scene.undo').length)).toBe(1);
  const undoCmd=await page.evaluate(()=>(window as any).__sentOps.find((c:any)=>c.type==='scene.undo'));
  const ack=await page.evaluate(op=>(window as any).__recv.find((r:any)=>r.op===op),ack06);
  expect(ack.type).toBe('operation.ack');expect(undoCmd.rev).toBe(ack.rev);
  await expect.poll(()=>page.evaluate(op=>(window as any).__recv.find((r:any)=>r.op===op)?.code,undoCmd.op)).toBe('REVISION_CONFLICT');
  await page.waitForTimeout(800);
  expect(await level()).toBe(.8);await expect(water).toHaveValue('0.8');
  // History holds exactly the two water steps: undo -> 0.6, undo -> 0.3.
  await undo.click();await expect.poll(level).toBe(.6);await expect(water).toHaveValue('0.6');
  await undo.click();await expect.poll(level).toBe(.3);await expect(water).toHaveValue('0.3');
 }finally{
  await post(request,'/api/rooms/'+room.id+'/close').catch(()=>{});
  await context.close();await client.dispose();
 }
});
test('B-F2 3: object.create receipt is replayed once on reconnect; late events from the replaced socket are ignored',async({request,playwright,browser})=>{
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
   (window as any).__sent=[];(window as any).__sentOps=[];
   window.WebSocket=class extends Native{
    constructor(url:string|URL,protocols?:string|string[]){
     super(url,protocols);
     ((window as any).__sockets??=[]).push(this);const sock=(window as any).__sockets.length-1;
     const replayed=new WeakSet<Event>();(this as any).__replayed=replayed;
     this.addEventListener('message',event=>{
      if(!replayed.has(event))try{const m=JSON.parse((event as MessageEvent).data);if(m.type==='operation.ack'||m.type==='operation.rejected')((window as any).__recv??=[]).push({type:m.type,op:m.operationId,code:m.code,rev:m.sceneRevision,sock});}catch{}
      if(replayed.has(event)||!(window as any).__holdWater)return;
      event.stopImmediatePropagation();
      try{const m=JSON.parse((event as MessageEvent).data);((window as any).__heldMeta??=[]).push({sock,type:m.type,op:m.operationId});}catch{}
      (window as any).__held.push(()=>{
       const copy=new MessageEvent('message',{data:event.data});
       replayed.add(copy);this.dispatchEvent(copy);
      });
     });
    }
    __inject(data:string){const copy=new MessageEvent('message',{data});(this as any).__replayed.add(copy);this.dispatchEvent(copy);}
    send(data:string|ArrayBufferLike|Blob|ArrayBufferView){
     if(typeof data==='string')try{const c=JSON.parse(data);(window as any).__sent.push(c.type);(window as any).__sentOps.push({type:c.type,op:c.operationId,level:c.level,rev:c.expectedSceneRevision});}catch{}
     super.send(data);
    }
   };
  });
  const page=await context.newPage();
  await page.goto('/?room='+room.id);
  const slider=page.getByRole('slider',{name:'濕沙盤水位'});
  const objects=async()=>Object.keys((await(await client.get('/api/rooms/'+room.id+'/snapshot')).json()).objects??{}).length;
  await expect(slider).toBeEnabled();
  await page.evaluate(()=>{(window as any).__holdWater=true;(window as any).__sentOps=[];(window as any).__sent=[];});
  await page.getByRole('button',{name:'⌂ 小屋 練習物件'}).click();await page.getByRole('button',{name:'放在中央'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__sentOps.filter((c:any)=>c.type==='object.create').length)).toBe(1);
  await expect.poll(objects).toBe(1);
  const createOp=await page.evaluate(()=>(window as any).__sentOps.find((c:any)=>c.type==='object.create').op);
  // Drop the socket with the ACK still held; keep the old socket's held events for the late-arrival check.
  await page.evaluate(()=>{for(const s of (window as any).__sockets)s.close();(window as any).__holdWater=false;});
  await expect(page.getByRole('button',{name:'重新連線',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'重新連線',exact:true}).click();
  await expect(slider).toBeEnabled();
  await expect.poll(()=>page.evaluate(op=>(window as any).__sentOps.filter((c:any)=>c.op===op).length,createOp)).toBe(2);
  // Codex re-review item 3: the ACK must come on the NEW socket (index 1); the old socket's held ACK must not satisfy this.
  await expect.poll(()=>page.evaluate(op=>(window as any).__recv.filter((r:any)=>r.op===op&&r.type==='operation.ack'&&r.sock===1).length,createOp)).toBe(1);
  expect(await objects()).toBe(1);
  // Item 4: there really are held events from the replaced socket, including the original create ACK.
  const held=await page.evaluate(()=>(window as any).__heldMeta.filter((m:any)=>m.sock===0));
  expect(held.length).toBeGreaterThan(0);
  expect(held.some((m:any)=>m.type==='operation.ack'&&m.op===createOp)).toBe(true);
  // Late arrival with a harmful payload: if the replaced socket's handler still ran, advanceEpochs would adopt sessionEpoch 999 and
  // every following command would be rejected. Ignoring it keeps the next operation working.
  await page.evaluate(()=>{for(const r of (window as any).__held.splice(0))r();(window as any).__sockets[0].__inject(JSON.stringify({type:'room.snapshot',sessionEpoch:999,controlEpoch:999,serverSeq:999}));});
  await page.waitForTimeout(800);
  await expect(slider).toBeEnabled();
  await page.getByRole('button',{name:'⌂ 小屋 練習物件'}).click();await page.getByRole('button',{name:'放在中央'}).click();
  await expect.poll(objects).toBe(2);
  expect(await page.evaluate(()=>(window as any).__recv.filter((r:any)=>r.type==='operation.rejected'&&r.sock===1).map((r:any)=>r.code))).toEqual([]);
  expect(await page.evaluate(()=>(window as any).__sentOps.filter((c:any)=>c.type==='object.create').length)).toBe(3);
  expect(await page.evaluate(()=>(window as any).__sent.filter((t:string)=>t==='scene.undo'||t==='scene.redo'))).toEqual([]);
 }finally{
  await post(request,'/api/rooms/'+room.id+'/close').catch(()=>{});
  await context.close();await client.dispose();
 }
});
