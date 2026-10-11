import {test,expect,type APIRequestContext} from '@playwright/test';
// 2026-10-09 遊戲式登入入口（Claude Opus 5.5）：只有已登入治療師與受邀案主可以使用沙盤。
// 本機主機預設不強制入口（既有測試依賴本機探索），這裡一律以 ?gate=1 走部署主機同一條判定。
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});

test('an anonymous visitor gets the title screen and no sandtray, even with a room id',async({browser})=>{
 const context=await browser.newContext();
 try{
  const page=await context.newPage();
  for(const path of ['/?gate=1','/?gate=1&room=00000000-0000-4000-8000-000000000000']){
   await page.goto(path);
   await expect(page.getByTestId('entry-gate')).toHaveAttribute('data-view','title');
   await expect(page.getByRole('link',{name:'登入開始'})).toHaveAttribute('href','/auth/login');
   await expect(page.locator('canvas')).toHaveCount(0);
   await expect(page.getByText('本機探索')).toHaveCount(0);
   await expect(page.getByRole('region',{name:'雙人會談'})).toHaveCount(0);
  }
 }finally{await context.close();}
});

test('an unusable invite link shows a failure on the entry screen, not a practice sandtray',async({browser})=>{
 const context=await browser.newContext();
 try{
  const page=await context.newPage();await page.goto('/?gate=1#invite=00000000-0000-4000-8000-000000000000.nope');
  await expect(page.getByTestId('invite-failed')).toBeVisible();
  await expect(page.getByTestId('entry-gate')).toHaveAttribute('data-view','invite');
  await expect(page.locator('canvas')).toHaveCount(0);
  // token 已自網址列移除
  expect(new URL(page.url()).hash).toBe('');
 }finally{await context.close();}
});

test('a logged-in therapist enters; an invited client enters only their own room through the entry screen',async({request,browser})=>{
 test.setTimeout(60000);
 await request.post('/__test/login',{data:{name:'therapist'}});
 const tc=await browser.newContext({storageState:await request.storageState()}),cc=await browser.newContext();
 let id:string|undefined;
 try{
  const t=await tc.newPage(),c=await cc.newPage();await t.goto('/?gate=1');
  await expect(t.getByRole('button',{name:'建立虛構資料會談'})).toBeEnabled();await expect(t.getByTestId('entry-gate')).toHaveCount(0);
  await t.getByRole('button',{name:'建立虛構資料會談'}).click();await expect(t).toHaveURL(/\?room=/);id=new URL(t.url()).searchParams.get('room')!;
  await t.getByRole('button',{name:'產生邀請連結'}).click();const invitation=new URL(await t.getByLabel('邀請連結').inputValue());
  await c.goto('/?gate=1'+invitation.hash);
  await expect(c.getByTestId('entry-gate')).toHaveAttribute('data-view','invite');
  await expect(c.getByText(/作品會從伺服器刪除/)).toBeVisible();await expect(c.locator('canvas')).toHaveCount(0);
  await expect(c.getByRole('button',{name:'進入等候室'})).toBeDisabled();
  await c.getByRole('checkbox',{name:/我知道指定治療師看得到作品/}).check();await c.getByRole('button',{name:'進入等候室'}).click();
  await expect(c).toHaveURL(new RegExp(`\\?room=${id}&gate=1$`));
  await t.getByRole('button',{name:'確認等候者入房'}).click();
  await expect(c.getByRole('button',{name:'離開會談'})).toBeVisible();
  // 已入房的案主回到首頁會被送回自己的房間，不會得到本機探索沙盤
  await c.goto('/?gate=1');await expect(c).toHaveURL(new RegExp(`\\?room=${id}&gate=1$`));
  await expect(c.getByRole('button',{name:'離開會談'})).toBeVisible();
 }finally{if(id)await post(request,`/api/rooms/${id}/close`).catch(()=>{});await cc.close();await tc.close();}
});
