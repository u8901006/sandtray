import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
// 2026-10-11 使用者指示：會談中側欄預設收起，讓沙盤更大——治療師左右兩側都收起、案主只收右側（物件細節）。
// 每個角色各自記住展開／收起；本機探索維持兩側展開。
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
const panels=async(page:Page)=>({library:await page.locator('aside.library').getAttribute('class'),inspector:await page.locator('aside.inspector').getAttribute('class')});

test('in a room the therapist starts with both side panels folded and the client with the right one folded',async({request,browser})=>{
 test.setTimeout(90000);
 await request.post('/__test/login',{data:{name:'therapist'}});
 const tc=await browser.newContext({storageState:await request.storageState(),viewport:{width:1600,height:900}}),cc=await browser.newContext({viewport:{width:1600,height:900}});
 let id:string|undefined;
 try{
  const t=await tc.newPage(),c=await cc.newPage();
  // Local exploration (before a room) keeps both panels open.
  await t.goto('/');await expect(t.getByRole('button',{name:'收起物件架'})).toBeVisible();await expect(t.getByRole('button',{name:'收起物件細節'})).toBeVisible();
  // Even an earlier device-wide "open" preference does not override the new room defaults.
  await t.evaluate(()=>{localStorage.setItem('sandtray.libraryOpen','1');localStorage.setItem('sandtray.inspectorOpen','1');});
  await t.getByRole('button',{name:'建立虛構資料會談'}).click();await expect(t).toHaveURL(/\?room=/);id=new URL(t.url()).searchParams.get('room')!;
  await expect(t.getByRole('button',{name:'展開物件架'})).toBeVisible();await expect(t.getByRole('button',{name:'展開物件細節'})).toBeVisible();
  expect(await panels(t)).toEqual({library:'library collapsed',inspector:'inspector collapsed'});
  const viewportT=(await t.getByTestId('viewport').boundingBox())!;expect(viewportT.width).toBeGreaterThan(1300);
  await t.getByRole('button',{name:'產生邀請連結'}).click();const invitation=await t.getByLabel('邀請連結').inputValue();
  await c.goto(invitation);
  await c.getByRole('checkbox',{name:/我知道指定治療師看得到作品/}).check();await c.getByRole('button',{name:'進入等候室'}).click();await expect(c).toHaveURL(/\?room=/);
  await t.getByRole('button',{name:'確認等候者入房'}).click();await expect(c.getByRole('button',{name:'離開會談'})).toBeVisible();
  // Client: object shelf open (they place the objects), details folded.
  await expect(c.getByRole('button',{name:'收起物件架'})).toBeVisible();await expect(c.getByRole('button',{name:'展開物件細節'})).toBeVisible();
  expect(await panels(c)).toEqual({library:'library',inspector:'inspector collapsed'});
  // Each role remembers its own choice: the therapist opens the shelf, reloads, and it stays open; the client is unaffected.
  await t.getByRole('button',{name:'展開物件架'}).click();await expect(t.getByRole('button',{name:'收起物件架'})).toBeVisible();
  await t.reload();await expect(t.getByRole('button',{name:'收起物件架'})).toBeVisible();await expect(t.getByRole('button',{name:'展開物件細節'})).toBeVisible();
  await c.reload();await expect(c.getByRole('button',{name:'展開物件細節'})).toBeVisible();
 }finally{if(id)await post(request,`/api/rooms/${id}/close`).catch(()=>{});await cc.close();await tc.close();}
});
