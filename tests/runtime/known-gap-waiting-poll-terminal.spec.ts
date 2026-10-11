import {test,expect,type APIRequestContext} from '@playwright/test';
// V7-I01（GPT-5，2026-09-22）：等待路徑上的不可恢復 /info 拒絕必須停止 1 Hz 輪詢。
// 房間在案主第一次 /info 前關閉時，伺服器仍以既有 PERMISSION_DENIED 契約拒絕；前端不能把
// 無法區分的拒絕誤報成 ROOM_CLOSED，但必須停止輪詢。等待中的登出／session 過期則顯示登入失效，
// 也必須停止輪詢。網路暫斷不屬 terminal，仍保留重試。這兩案是正常回歸案例，不得刪除或 skip。
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function waitingClient({request,playwright,browser}:{request:any;playwright:any;browser:any}){
 // Fail at the real step: an unasserted login let a dev-proxy drop surface later as redeem 400 (Opus 2026-09-27).
 expect((await request.post('/__test/login',{data:{name:'therapist'}})).status()).toBe(200);const {id}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();const {token}=await (await post(request,`/api/rooms/${id}/invites`)).json();
 const clientApi=await playwright.request.newContext({baseURL:origin});expect((await post(clientApi,'/api/invites/redeem',{token,nickname:'等待終止虛構案主'})).status()).toBe(200);
 const cc=await browser.newContext({storageState:await clientApi.storageState()});return {id,clientApi,cc};
}
const countInfo=(page:import('@playwright/test').Page,id:string)=>{const counter={n:0};page.on('request',r=>{if(r.url()===`${origin}/api/rooms/${id}/info`)counter.n++;});return counter;};
test('a room closed before the waiting client\'s first /info stops the 1 Hz waiting poll',async({request,playwright,browser})=>{
 test.setTimeout(45000);const {id,clientApi,cc}=await waitingClient({request,playwright,browser});
 try{expect((await post(request,`/api/rooms/${id}/close`)).status()).toBe(200);
  const c=await cc.newPage();const infos=countInfo(c,id);await c.goto(`/?room=${id}`);
  // Give the first refresh and two poll ticks time to land, then the poll must be over.
  await c.waitForTimeout(3000);const settled=infos.n;await c.waitForTimeout(2200);
  expect(infos.n).toBe(settled);await expect(c.locator('.session')).toContainText('目前沒有這項操作的授權。');
 }finally{await cc.close();await clientApi.dispose();}
});
test('a waiting client whose session is revoked stops polling and shows the sign-in text',async({request,playwright,browser})=>{
 test.setTimeout(45000);const {id,clientApi,cc}=await waitingClient({request,playwright,browser});
 try{const c=await cc.newPage();const infos=countInfo(c,id);await c.goto(`/?room=${id}`);await expect(c.locator('.session')).toContainText('等候治療師確認入房');
  expect((await post(clientApi,'/auth/logout')).status()).toBe(204);
  await c.waitForTimeout(3000);const settled=infos.n;await c.waitForTimeout(2200);
  expect(infos.n).toBe(settled);await expect(c.locator('.session')).toContainText('登入已失效');
 }finally{await post(request,`/api/rooms/${id}/close`).catch(()=>{});await cc.close();await clientApi.dispose();}
});
