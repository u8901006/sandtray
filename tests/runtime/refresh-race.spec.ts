import {test,expect,type Route} from '@playwright/test';
import {roomContext} from './open-panels';
const origin='http://127.0.0.1:8788';
// C55 (2026-09-21): deterministic reproduction of the shared-room refresh race GPT-6's review found behind the
// historical ui.spec transform flake. Sequence forced on the therapist page: lock.acquire is ACKed → the ACK's
// refresh (R_b) is held at /info → a client-side scene change broadcasts and starts a newer refresh (R_c), also held →
// R_b is released first. Before the fix R_b resolved as "superseded" without applying, send() returned, transform()
// read leases[objectId].id from a state that never saw the lease, threw, and the commit was never sent (client stays
// at 0). After the fix R_b waits for R_c, the lease is present, and the commit lands.
test('a superseded refresh must not let transform() run on state that predates the lock ACK',async({request,playwright,browser},testInfo)=>{
 test.setTimeout(60000);
 await request.post('/__test/login',{data:{name:'therapist'}});const {id}=await (await request.post('/api/rooms',{data:{retentionMode:'session-only',policyVersion:'dev-v1'},headers:{Origin:origin}})).json();const {token}=await (await request.post(`/api/rooms/${id}/invites`,{data:{},headers:{Origin:origin}})).json();
 const clientApi=await playwright.request.newContext({baseURL:origin});const {participantId}=await (await clientApi.post('/api/invites/redeem',{data:{token,nickname:'虛構競態案主'},headers:{Origin:origin}})).json();await request.post(`/api/rooms/${id}/admit`,{data:{participantId},headers:{Origin:origin}});
 const tc=await roomContext(browser,{storageState:await request.storageState()}),cc=await roomContext(browser,{storageState:await clientApi.storageState()});
 try{const t=await tc.newPage(),c=await cc.newPage();
  let holding=false;const held:Route[]=[];const infoResponses:number[]=[];const frames:string[]=[];
  const brief=(dir:string,payload:string|Buffer)=>{try{const m=JSON.parse(String(payload));frames.push(`${Date.now()%100000} ${dir} ${m.type}${m.code?' '+m.code:''}${m.objectId?' '+m.objectId.slice(0,6):''}`);}catch{}};
  t.on('websocket',ws=>{ws.on('framesent',f=>{brief('>',f.payload);if(String(f.payload).includes('"object.lock.acquire"'))holding=true;});ws.on('framereceived',f=>brief('<',f.payload));});
  t.on('response',r=>{if(r.url().includes(`/api/rooms/${id}/info`))infoResponses.push(r.status());});
  await t.route(`**/api/rooms/${id}/info`,route=>{if(holding)held.push(route);else void route.continue();});
  await t.goto(`/?room=${id}`);await c.goto(`/?room=${id}`);
  for(let i=0;i<2;i++){await c.getByRole('button',{name:'● 圓石 練習物件'}).click();await c.getByRole('button',{name:'放在中央'}).click();}await expect(t.getByTestId('viewport')).toHaveAttribute('data-items','2');
  await t.getByRole('button',{name:'圓石 1',exact:true}).click();await t.getByRole('button',{name:'請求操作選中物件'}).click();await c.getByRole('button',{name:'同意上述動作'}).click();
  await expect(t.getByLabel('物件大小')).toBeEnabled();await c.getByRole('button',{name:'圓石 2',exact:true}).click();
  // Therapist commits a move: transform() → refresh (passes, holding is still false) → lock.acquire (framesent flips
  // holding) → lock.changed broadcast + ACK each start a refresh that is now held at /info.
  await t.getByLabel('左右位置').fill('2');
  await expect.poll(()=>held.length,{intervals:[50,100,200],timeout:10000}).toBeGreaterThanOrEqual(2);
  const firstBatch=held.splice(0,held.length);
  // A client-side move of the other rock reaches the therapist as a broadcast and starts a NEWER refresh, also held.
  // (Kept cheap so the whole window stays well inside the 3 s lock lease.)
  await c.getByLabel('左右位置').fill('-3');
  await expect.poll(()=>held.length,{intervals:[50,100,200],timeout:10000}).toBeGreaterThanOrEqual(1);
  // Release the ACK-era refreshes first and let the page process their responses while the newer one is still held.
  const before=infoResponses.length;for(const r of firstBatch)void r.continue();
  await expect.poll(()=>infoResponses.length,{intervals:[50,100,200],timeout:10000}).toBeGreaterThanOrEqual(before+firstBatch.length);await t.waitForTimeout(100);
  holding=false;for(const r of held.splice(0,held.length))void r.continue();
  // The move must land on the client: the commit is only sent when transform() saw the lease from a refresh that
  // actually applied after the ACK.
  await c.getByRole('button',{name:'圓石 1',exact:true}).click();
  const diagnose=async()=>console.log(`[refresh-race] session=${await t.locator('.session').textContent()} info=${infoResponses.join(',')} held=${held.length} frames=${JSON.stringify(frames)}`);
  try{await expect.poll(async()=>JSON.parse((await c.getByTestId('transform').textContent())!).position[0],{timeout:10000}).toBe(2);}catch(e){await diagnose();throw e;}
  // Server truth: the commit landed. The therapist status line is not asserted to a single string — under full-suite load the
  // 3 s lock lease can lapse while /info is held, so the trailing lock.release may report STALE_FENCE after a successful commit.
  const objects=(await (await request.get(`/api/rooms/${id}/snapshot`)).json()).objects as any[];expect(objects.map(o=>o.transform.position[0]).sort()).toEqual([-3,2]);
  await expect(t.locator('.session')).not.toContainText('Cannot read properties');
  await t.screenshot({path:testInfo.outputPath('refresh-race-therapist.png'),fullPage:true});
 }finally{await tc.close();await cc.close();await clientApi.dispose();}
});
