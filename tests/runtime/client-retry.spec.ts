import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:8788';
for(const [retryType,disconnect] of [['object.create',true],['scene.undo',true],['object.create',false]] as const) test('A09 UI retries '+retryType+' after lost ACK '+(disconnect?'with disconnect':'on an open socket')+' without a duplicate or stale next edit',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const {id}=await (await request.post('/api/rooms',{data:{retentionMode:'session-only',policyVersion:'dev-v1'},headers:{Origin:origin}})).json();
 const {token}=await (await request.post(`/api/rooms/${id}/invites`,{data:{},headers:{Origin:origin}})).json();
 const clientApi=await playwright.request.newContext({baseURL:origin});
 const {participantId}=await (await clientApi.post('/api/invites/redeem',{data:{token,nickname:'虛構'},headers:{Origin:origin}})).json();
 await request.post(`/api/rooms/${id}/admit`,{data:{participantId},headers:{Origin:origin}});
 const context=await browser.newContext({storageState:await clientApi.storageState()});
 try{
 await context.addInitScript(({retryType,disconnect})=>{
  const Native=WebSocket;const w=window as any;w.sentCommands=[];w.dropAck=true;
  class LossySocket extends Native{
   constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);this.addEventListener('message',event=>{const m=JSON.parse(event.data);if(w.dropAck&&m.type==='operation.ack'&&w.sentCommands.some((c:any)=>c.operationId===m.operationId)){w.dropAck=false;event.stopImmediatePropagation();if(disconnect)this.close();}});}
   override send(data:string|ArrayBufferLike|Blob|ArrayBufferView){if(typeof data==='string'){const m=JSON.parse(data);if(m.type===retryType)w.sentCommands.push(m);}super.send(data);}
  }
  window.WebSocket=LossySocket;
 },{retryType,disconnect});
 const page=await context.newPage();await page.goto(`/?room=${id}`);
 const add=async()=>{await page.getByRole('button',{name:'● 圓石 練習物件'}).click();await page.getByRole('button',{name:'放在中央'}).click();};
 await expect(page.getByRole('button',{name:'● 圓石 練習物件'})).toBeEnabled();await add();
 if(retryType==='scene.undo'){await expect(page.getByTestId('viewport')).toHaveAttribute('data-items','1');await page.getByRole('button',{name:'復原',exact:true}).click();}
 await expect.poll(()=>page.evaluate(()=>(window as any).sentCommands.length),{message:'UI must send the target command through the instrumented socket'}).toBe(1);
 await expect.poll(()=>page.evaluate(()=>(window as any).dropAck),{message:'The durable ACK must actually be dropped before reconnect'}).toBe(false);
 await expect(page.getByRole('button',{name:'重新連線'})).toBeVisible({timeout:12000});await page.getByRole('button',{name:'重新連線'}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).sentCommands.length)).toBe(2);
 const sent=await page.evaluate(()=>(window as any).sentCommands);expect(sent[1]).toEqual(sent[0]);
 await expect(page.getByTestId('viewport')).toHaveAttribute('data-items',retryType==='scene.undo'?'0':'1');
 await expect.poll(async()=>(await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json()).sceneRevision).toBe(retryType==='scene.undo'?2:1);
 await add();await expect(page.getByTestId('viewport')).toHaveAttribute('data-items',retryType==='scene.undo'?'1':'2');
 await expect.poll(async()=>(await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json()).sceneRevision).toBe(retryType==='scene.undo'?3:2);
 }finally{await context.close();await clientApi.dispose();}
});



