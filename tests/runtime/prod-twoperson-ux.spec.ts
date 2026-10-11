import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {roomContext} from './open-panels';
// Production two-person test 2026-10-04 (deployed production, fictitious data): the header said 「本機探索」 inside a room on
// both seats, and after a client scaled an object and then dug sand the status bar showed the raw code 「STALE_FENCE」 (the
// best-effort lease release lost its fence to the sand strokes). Same sequence here: no raw code may reach either seat.
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
const rawCode=async(page:Page)=>(await page.locator('header, [role=status]').allTextContents()).join(' ').match(/\b[A-Z][A-Z_]{3,}\b/)?.[0]??null;
test('room header shows the seat, and scale-then-dig never shows a raw rejection code',async({request,playwright,browser})=>{
 await expect(await request.post('/__test/login',{data:{name:'therapist'}})).toBeOK();
 const room=await(await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json() as {id:string};
 const {token}=await(await post(request,'/api/rooms/'+room.id+'/invites')).json() as {token:string};
 const client=await playwright.request.newContext({baseURL:origin,extraHTTPHeaders:{'X-Sandtray-Protocol':'2'}});
 const redeemed=await(await post(client,'/api/invites/redeem',{token})).json() as {participantId:string};
 await expect(await post(request,'/api/rooms/'+room.id+'/admit',{participantId:redeemed.participantId})).toBeOK();
 const tc=await roomContext(browser,{storageState:await request.storageState()}),cc=await roomContext(browser,{storageState:await client.storageState()});
 try{
  // Production latency: the lease release reached the server ~35 s later, after the 3 s lease (sync.ts lock.acquire) expired. Delay it past expiry.
  await cc.addInitScript(()=>{const N=window.WebSocket;window.WebSocket=class extends N{send(d:any){try{if(JSON.parse(d).type==='object.lock.release'){setTimeout(()=>{try{super.send(d);}catch{}},4000);return;}}catch{}super.send(d);}} as any;});
  const therapist=await tc.newPage(),page=await cc.newPage();
  await therapist.goto('/?room='+room.id);await page.goto('/?room='+room.id);
  await expect(page.getByTestId('session-mode')).toHaveText('雙人會談 · 案主');
  await expect(therapist.getByTestId('session-mode')).toHaveText('雙人會談 · 治療師');
  // 2026-10-11 最下方 footer 拿掉後，治療師／案主顏色圖例改在上方頁首。
  for(const viewer of [page,therapist]){await expect(viewer.locator('footer')).toHaveCount(0);await expect(viewer.getByTestId('role-legend')).toHaveText('治療師案主');}
  await expect(page.getByRole('slider',{name:'濕沙盤水位'})).toBeEnabled();
  await page.getByRole('button',{name:'⌂ 小屋 練習物件'}).click();await page.getByRole('button',{name:'放在中央'}).click();
  await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入');
  const size=page.getByLabel('物件大小');await expect(size).toBeEnabled();
  await size.fill('2');
  await expect.poll(async()=>Object.values((await(await client.get('/api/rooms/'+room.id+'/snapshot')).json()).objects as any[])[0]?.transform.scale).toBe(2);
  // Dig while the release is still held back (no wait for the scale round-trip to settle).
  await page.getByRole('button',{name:'聚焦濕沙盤'}).click();await page.getByRole('button',{name:'挖沙'}).click();
  const box=(await page.locator('.viewport canvas').first().boundingBox())!;const x=box.x+box.width/2-100,y=box.y+box.height/2+40;
  await page.mouse.move(x,y);await page.mouse.down();for(let i=0;i<20;i++){await page.mouse.move(x+i*10,y,{steps:2});await page.waitForTimeout(30);}await page.mouse.up();
  await expect.poll(async()=>{const wet=(await(await client.get('/api/rooms/'+room.id+'/snapshot')).json()).trays.find((t:any)=>t.id==='wet');return wet.revision;}).toBeGreaterThan(0);
  await page.waitForTimeout(4500); // let the delayed release reach the server and be answered
  expect(await rawCode(page)).toBeNull();expect(await rawCode(therapist)).toBeNull();
  await expect(page.getByTestId('water-hint')).toBeVisible();
 }finally{
  await post(request,'/api/rooms/'+room.id+'/close').catch(()=>{});
  await tc.close();await cc.close();await client.dispose();
 }
});
test('an invite that can no longer be used says so instead of loading forever',async({request,playwright,browser})=>{
 await expect(await request.post('/__test/login',{data:{name:'therapist'}})).toBeOK();
 const room=await(await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json() as {id:string};
 const {token}=await(await post(request,'/api/rooms/'+room.id+'/invites')).json() as {token:string};
 const first=await playwright.request.newContext({baseURL:origin,extraHTTPHeaders:{'X-Sandtray-Protocol':'2'}});
 await expect(await post(first,'/api/invites/redeem',{token})).toBeOK(); // the link is now used (someone is waiting)
 const cc=await roomContext(browser);
 try{
  const page=await cc.newPage();
  await page.goto('/#invite='+token);
  await expect(page.getByTestId('invite-failed')).toBeVisible();
  await expect(page.getByText('正在讀取會談保存政策…')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'進入等候室'})).toBeDisabled();
 }finally{
  await post(request,'/api/rooms/'+room.id+'/close').catch(()=>{});
  await cc.close();await first.dispose();
 }
});
