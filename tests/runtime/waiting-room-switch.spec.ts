import {test,expect,type APIRequestContext} from '@playwright/test';
// V6-G01（2026-09-22，GLM-5.3-flash）：獨立新增案例——等待席位在房間 A 進入 terminal「會談已結束」
// 且輪詢停止後，同一案主帶新房間邀請換到房間 B 時必須重置輪詢、恢復等候並可被正常准入
// （v6 計畫 G01「驗正常准入與換房恢復」；C01 關閉條件「正常准入可連線」）。
// 不涵蓋：登出／過期與網路暫斷文案、首次 info 前即關房（C01 待審分支，另行觀察記錄）。
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});

test('V6-G01 after a closed-room terminal, the same client resumes waiting and can be admitted in a new room',async({request,playwright,browser})=>{
 test.setTimeout(60000);
 await request.post('/__test/login',{data:{name:'therapist'}});
 const createRoom=async()=>{const created=await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'});expect(created.status()).toBe(200);return (await created.json()).id as string;};
 const invite=async(id:string)=>{const invitation=await post(request,`/api/rooms/${id}/invites`);expect(invitation.status()).toBe(200);return (await invitation.json()).token as string;};
 const roomA=await createRoom(),roomB=await createRoom();
 const clientApi=await playwright.request.newContext({baseURL:origin});
 let clientContext:Awaited<ReturnType<typeof browser.newContext>>|undefined;
 try{
  const redeemedA=await post(clientApi,'/api/invites/redeem',{token:await invite(roomA),nickname:'換房恢復測試'});expect(redeemedA.status()).toBe(200);
  clientContext=await browser.newContext({storageState:await clientApi.storageState()});
  const page=await clientContext.newPage();
  let infoA=0;page.on('request',event=>{if(event.url()===`${origin}/api/rooms/${roomA}/info`)infoA++;});
  await page.goto(`/?room=${roomA}`);
  await expect.poll(()=>infoA,{timeout:10000}).toBeGreaterThan(0);
  await expect(page.getByRole('status').filter({hasText:'等候治療師確認入房'})).toBeVisible({timeout:10000});
  expect((await post(request,`/api/rooms/${roomA}/close`)).status()).toBe(200);
  await expect(page.getByRole('status').filter({hasText:'會談已結束'})).toBeVisible({timeout:10000});
  const settledA=infoA;
  await page.waitForTimeout(2200);
  expect(infoA).toBe(settledA);
  // 同一案主換房：session cookie 以新房間兌換結果覆寫後，輪詢與准入必須完整恢復。
  const redeemedB=await post(clientApi,'/api/invites/redeem',{token:await invite(roomB),nickname:'換房恢復測試'});expect(redeemedB.status()).toBe(200);const {participantId}=await redeemedB.json();
  await clientContext.addCookies((await clientApi.storageState()).cookies);
  let infoB=0;page.on('request',event=>{if(event.url()===`${origin}/api/rooms/${roomB}/info`)infoB++;});
  await page.goto(`/?room=${roomB}`);
  await expect.poll(()=>infoB,{timeout:10000}).toBeGreaterThan(0);
  await expect(page.getByRole('status').filter({hasText:'等候治療師確認入房'})).toBeVisible({timeout:10000});
  expect((await post(request,`/api/rooms/${roomB}/admit`,{participantId})).status()).toBe(200);
  await expect(page.getByRole('status').filter({hasText:'已連線'})).toBeVisible({timeout:15000});
 }finally{await post(request,`/api/rooms/${roomA}/close`).catch(()=>{});await post(request,`/api/rooms/${roomB}/close`).catch(()=>{});await clientContext?.close();await clientApi.dispose();}
});
