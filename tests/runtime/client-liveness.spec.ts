import {test,expect} from '@playwright/test';
import {roomContext} from './open-panels';
const origin='http://127.0.0.1:8788';
// C55 (2026-09-21): the historical ui.spec "transform poll timeout" flake reproduced with WS frames shows
// object.lock.acquire → permission.changed(grant:null) → operation.rejected GRANT_EXPIRED right after the client
// granted. Cause: every WebSocket connect reset clientLiveUntil to 0 — including the THERAPIST's — so whenever the
// therapist's socket attached after the client's, the client counted as absent until its next heartbeat (up to 5 s)
// and any grant issued in that window was deactivated on the therapist's first command. The same reset ran in
// disconnect() for a therapist leaving. Client liveness may only be reset by the client's own connect/disconnect.
async function seats({request,playwright,browser}:{request:any;playwright:any;browser:any}){
 await request.post('/__test/login',{data:{name:'therapist'}});const {id}=await (await request.post('/api/rooms',{data:{retentionMode:'session-only',policyVersion:'dev-v1'},headers:{Origin:origin}})).json();const {token}=await (await request.post(`/api/rooms/${id}/invites`,{data:{},headers:{Origin:origin}})).json();
 const clientApi=await playwright.request.newContext({baseURL:origin});const {participantId}=await (await clientApi.post('/api/invites/redeem',{data:{token,nickname:'虛構在場案主'},headers:{Origin:origin}})).json();await request.post(`/api/rooms/${id}/admit`,{data:{participantId},headers:{Origin:origin}});
 const tc=await roomContext(browser,{storageState:await request.storageState()}),cc=await roomContext(browser,{storageState:await clientApi.storageState()});
 return {id,tc,cc,clientApi};
}
const frames=(page:import('@playwright/test').Page)=>{const list:string[]=[];page.on('websocket',ws=>ws.on('framereceived',f=>{try{const m=JSON.parse(String(f.payload));if(m.type==='operation.rejected')list.push(m.code);}catch{}}));return list;};
async function grantAndMove(t:import('@playwright/test').Page,c:import('@playwright/test').Page,x:string,rejected:string[]){
 await t.getByRole('button',{name:'圓石 1',exact:true}).click();await t.getByRole('button',{name:'請求操作選中物件'}).click();await c.getByRole('button',{name:'同意上述動作'}).click();
 await expect(t.getByLabel('物件大小')).toBeEnabled();await t.getByLabel('左右位置').fill(x);
 // Settle on either outcome, then name the server rejection (pre-fix: GRANT_EXPIRED) instead of a bare timeout.
 await expect.poll(async()=>rejected.length>0||JSON.parse((await c.getByTestId('transform').textContent())!).position[0]===Number(x),{timeout:10000}).toBe(true);
 expect(rejected).toEqual([]);expect(JSON.parse((await c.getByTestId('transform').textContent())!).position[0]).toBe(Number(x));
}
test('a therapist socket attaching after the client does not reset the client presence window',async({request,playwright,browser})=>{
 test.setTimeout(60000);const {id,tc,cc,clientApi}=await seats({request,playwright,browser});
 try{const c=await cc.newPage();await c.goto(`/?room=${id}`);await expect(c.locator('.session')).toContainText('已連線');
  await c.getByRole('button',{name:'● 圓石 練習物件'}).click();await c.getByRole('button',{name:'放在中央'}).click();
  // Therapist attaches strictly AFTER the client and acts inside the client's 5 s heartbeat gap.
  const t=await tc.newPage();const rejected=frames(t);await t.goto(`/?room=${id}`);await expect(t.locator('.session')).toContainText('已連線');await expect(t.getByTestId('viewport')).toHaveAttribute('data-items','1');
  await grantAndMove(t,c,'2',rejected);
 }finally{await tc.close();await cc.close();await clientApi.dispose();}
});
test('a therapist page reload (disconnect + reconnect) does not reset the client presence window',async({request,playwright,browser})=>{
 test.setTimeout(60000);const {id,tc,cc,clientApi}=await seats({request,playwright,browser});
 try{const c=await cc.newPage();await c.goto(`/?room=${id}`);await expect(c.locator('.session')).toContainText('已連線');
  await c.getByRole('button',{name:'● 圓石 練習物件'}).click();await c.getByRole('button',{name:'放在中央'}).click();
  const t=await tc.newPage();await t.goto(`/?room=${id}`);await expect(t.locator('.session')).toContainText('已連線');
  // Wait for at least one client heartbeat so the client is unambiguously live before the therapist bounces.
  await t.waitForTimeout(5500);
  const rejected=frames(t);await t.reload();await expect(t.locator('.session')).toContainText('已連線');await expect(t.getByTestId('viewport')).toHaveAttribute('data-items','1');
  await grantAndMove(t,c,'-2',rejected);
 }finally{await tc.close();await cc.close();await clientApi.dispose();}
});
test('the client leaving still ends its presence window: a fresh grant cannot be used',async({request,playwright,browser})=>{
 test.setTimeout(60000);const {id,tc,cc,clientApi}=await seats({request,playwright,browser});
 try{const c=await cc.newPage();await c.goto(`/?room=${id}`);await expect(c.locator('.session')).toContainText('已連線');
  await c.getByRole('button',{name:'● 圓石 練習物件'}).click();await c.getByRole('button',{name:'放在中央'}).click();
  const t=await tc.newPage();await t.goto(`/?room=${id}`);await expect(t.locator('.session')).toContainText('已連線');await expect(t.getByTestId('viewport')).toHaveAttribute('data-items','1');
  await t.getByRole('button',{name:'圓石 1',exact:true}).click();await t.getByRole('button',{name:'請求操作選中物件'}).click();await c.getByRole('button',{name:'同意上述動作'}).click();await expect(t.getByLabel('物件大小')).toBeEnabled();
  await c.close();
  // The client's disconnect clears grants and its presence: the therapist's control must drop, never a silent success.
  await expect(t.getByLabel('物件大小')).toBeDisabled({timeout:10000});
  const info=await (await request.get(`/api/rooms/${id}/info`)).json();expect(Object.values(info.grants??{}).some((g:any)=>g.active)).toBe(false);
 }finally{await tc.close();await cc.close();await clientApi.dispose();}
});
test('a fresh therapist socket does not create presence after the client left: lock on a real object stays GRANT_EXPIRED',async({request,playwright,browser})=>{
 test.setTimeout(60000);const {id,tc,cc,clientApi}=await seats({request,playwright,browser});
 try{const c=await cc.newPage();await c.goto(`/?room=${id}`);await expect(c.locator('.session')).toContainText('已連線');
  await c.getByRole('button',{name:'● 圓石 練習物件'}).click();await c.getByRole('button',{name:'放在中央'}).click();
  const t=await tc.newPage();await t.goto(`/?room=${id}`);await expect(t.locator('.session')).toContainText('已連線');await expect(t.getByTestId('viewport')).toHaveAttribute('data-items','1');
  const objectId=(await (await request.get(`/api/rooms/${id}/snapshot`)).json()).objects[0].id as string;
  // The client leaves (presence → 0). A brand-new therapist socket then attaches: it must not stand in for the client's
  // presence, so the lock on the still-existing object is refused by the presence gate, not merely for lacking a grant.
  await c.close();const rejected=frames(t);await t.reload();await expect(t.locator('.session')).toContainText('已連線');
  await t.evaluate(async({roomId,objectId}:{roomId:string;objectId:string})=>{const ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${roomId}/socket?takeover=1`);await new Promise(r=>{ws.onopen=r;});
   const i=await (await fetch(`/api/rooms/${roomId}/info`,{cache:'no-store'})).json() as any;
   ws.send(JSON.stringify({protocolVersion:1,operationId:crypto.randomUUID(),sessionEpoch:i.sessionEpoch,controlEpoch:i.controlEpoch,type:'object.lock.acquire',objectId,actions:['translate']}));
   await new Promise(r=>setTimeout(r,1500));ws.close();},{roomId:id,objectId});
  await expect.poll(()=>rejected.length,{timeout:10000}).toBeGreaterThan(0);expect(rejected).toContain('GRANT_EXPIRED');
 }finally{await tc.close();await cc.close();await clientApi.dispose();}
});
