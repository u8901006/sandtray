import {test,expect,type APIRequestContext} from '@playwright/test';
// V8-L12-3：原 version-ui.spec 隨雲端版本功能移除；其中 L09-5a（使用者裁定 L01-6：不蒐集案主個資）與
// L12-5（結束前告知只保留會談期間）的邀請頁斷言移到這裡，以 session-only 實際 UI 流程驗證。
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});

test('L09-5a L12-5 the therapist creates a session-only room in the UI and the invite page asks for no identifying data',async({request,browser})=>{
 test.setTimeout(60000);
 await request.post('/__test/login',{data:{name:'therapist'}});
 const tc=await browser.newContext({storageState:await request.storageState()}),cc=await browser.newContext();
 let id:string|undefined;
 try{
  const t=await tc.newPage(),c=await cc.newPage();await t.goto('/');
  // 不再有保存模式選單；建房一律 session-only
  await expect(t.getByRole('button',{name:'建立虛構資料會談'})).toBeEnabled();await expect(t.getByLabel('保存模式')).toHaveCount(0);
  // 2026-10-09 使用者回報：已登入的治療師不再看到「治療師登入」，並看得到如何產生邀請連結
  await expect(t.getByRole('link',{name:'治療師登入'})).toHaveCount(0);await expect(t.getByTestId('invite-hint')).toContainText('產生邀請連結');
  const created=t.waitForRequest(r=>r.url().endsWith('/api/rooms')&&r.method()==='POST');
  await t.getByRole('button',{name:'建立虛構資料會談'}).click();expect((await created).postDataJSON().retentionMode).toBe('session-only');
  await expect(t).toHaveURL(/\?room=/);id=new URL(t.url()).searchParams.get('room')!;
  await t.getByRole('button',{name:'產生邀請連結'}).click();const invitation=await t.getByLabel('邀請連結').inputValue();await c.goto(invitation);
  await expect(c.getByText(/作品會從伺服器刪除/)).toBeVisible();
  // 政策文字出現後（頁面已渲染）邀請頁不得有暱稱／姓名類輸入欄，兌換請求不得帶 nickname
  await expect(c.getByLabel(/暱稱|姓名|名字|名稱/)).toHaveCount(0);
  await expect(c.getByRole('button',{name:'進入等候室'})).toBeDisabled();
  await c.getByRole('checkbox',{name:/我知道指定治療師看得到作品/}).check();
  const redeemRequest=c.waitForRequest(r=>r.url().endsWith('/api/invites/redeem'));await c.getByRole('button',{name:'進入等候室'}).click();
  expect(Object.keys((await redeemRequest).postDataJSON()??{})).not.toContain('nickname');await expect(c).toHaveURL(/\?room=/);
  await t.getByRole('button',{name:'確認等候者入房'}).click();
  // 入房後：案主只看得到「離開會談」與 PNG 同意，沒有任何 JSON 或雲端版本入口
  await expect(c.getByRole('button',{name:'離開會談'})).toBeVisible();
  // L12-5：入房後兩席都有常駐的結束即刪提醒
  for(const seat of [c,t])await expect(seat.locator('.retention-note')).toContainText('作品將從伺服器刪除且無法再開啟');
  await expect(c.getByRole('button',{name:/JSON/})).toHaveCount(0);await expect(c.getByRole('region',{name:'雲端版本'})).toHaveCount(0);
  await expect(t.getByRole('button',{name:'結束會談並刪除作品'})).toBeVisible();await expect(t.getByRole('button',{name:/JSON/})).toHaveCount(0);
 }finally{if(id)await post(request,`/api/rooms/${id}/close`).catch(()=>{});await cc.close();await tc.close();}
});
