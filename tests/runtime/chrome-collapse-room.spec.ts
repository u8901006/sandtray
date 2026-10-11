import {test,expect,type APIRequestContext} from '@playwright/test';
// 2026-10-10 使用者指示：治療師畫面收起上方面板只留沙盤。收起時會談工具仍掛載（邀請連結不丟），
// 有人等候入房時收起列要提示，點提示展開後可直接確認入房。
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});

test('therapist collapses the top panels in a room and still sees the waiting client',async({request,browser})=>{
 test.setTimeout(60000);
 await request.post('/__test/login',{data:{name:'therapist'}});
 const tc=await browser.newContext({storageState:await request.storageState(),viewport:{width:1600,height:900}}),cc=await browser.newContext();
 let id:string|undefined;
 try{
  const t=await tc.newPage(),c=await cc.newPage();await t.goto('/');
  await t.getByRole('button',{name:'建立虛構資料會談'}).click();await expect(t).toHaveURL(/\?room=/);id=new URL(t.url()).searchParams.get('room')!;
  await t.getByRole('button',{name:'產生邀請連結'}).click();const invitation=await t.getByLabel('邀請連結').inputValue();
  const before=(await t.getByTestId('viewport').boundingBox())!;
  await t.getByRole('button',{name:'收起上方面板'}).click();
  await expect(t.getByRole('button',{name:'結束會談並刪除作品'})).toBeHidden();
  await expect(t.getByTestId('chrome-bar')).toContainText('治療師');
  await expect.poll(async()=>(await t.getByTestId('viewport').boundingBox())?.height??0).toBeGreaterThan(before.height+150);
  await expect(t.getByRole('button',{name:'有人在等候入房'})).toHaveCount(0);
  await c.goto(invitation);
  await c.getByRole('checkbox',{name:/我知道指定治療師看得到作品/}).check();await c.getByRole('button',{name:'進入等候室'}).click();await expect(c).toHaveURL(/\?room=/);
  await t.getByRole('button',{name:'有人在等候入房'}).click();
  await expect(t.locator('header')).toBeVisible();
  await expect(t.getByLabel('邀請連結')).toHaveValue(invitation); // 收起期間會談工具沒有卸載
  await t.getByRole('button',{name:'確認等候者入房'}).click();
  await expect(c.getByRole('button',{name:'離開會談'})).toBeVisible();
 }finally{if(id)await post(request,`/api/rooms/${id}/close`).catch(()=>{});await cc.close();await tc.close();}
});
