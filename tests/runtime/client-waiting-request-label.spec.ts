import {test,expect,type APIRequestContext} from '@playwright/test';
import {roomContext} from './open-panels';
// 2026-10-10 使用者指示（案主教學影片 UX 觀察 2、3）：
// ②案主等候確認時沙盤上要有明確等候提示，入房後消失；③治療師請求要顯示物件名稱與序號，不顯示物件 ID。
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});

test('a waiting client sees a waiting overlay, and a permission request names the object',async({request,browser})=>{
 test.setTimeout(90000);
 await request.post('/__test/login',{data:{name:'therapist'}});
 const tc=await roomContext(browser,{storageState:await request.storageState()}),cc=await roomContext(browser);
 let id:string|undefined;
 try{
  const t=await tc.newPage(),c=await cc.newPage();await t.goto('/');
  await t.getByRole('button',{name:'建立虛構資料會談'}).click();await expect(t).toHaveURL(/\?room=/);id=new URL(t.url()).searchParams.get('room')!;
  await t.getByRole('button',{name:'產生邀請連結'}).click();const invitation=new URL(await t.getByLabel('邀請連結').inputValue());
  await c.goto('/?gate=1'+invitation.hash);
  await c.getByRole('checkbox',{name:/我知道指定治療師看得到作品/}).check();await c.getByRole('button',{name:'進入等候室'}).click();await expect(c).toHaveURL(/\?room=/);
  const overlay=c.getByTestId('waiting-overlay');
  await expect(overlay).toBeVisible();await expect(overlay).toContainText('正在等候治療師確認入房');
  await expect(c.getByText('你的世界，從這裡開始')).toHaveCount(0);
  // 遮罩蓋住整個沙盤區
  const [o,v]=[(await overlay.boundingBox())!,(await c.getByTestId('viewport').boundingBox())!];
  expect(Math.abs(o.width-v.width)).toBeLessThanOrEqual(2);expect(Math.abs(o.height-v.height)).toBeLessThanOrEqual(2); // 差值只來自 viewport 1px 邊框
  await t.getByRole('button',{name:'確認等候者入房'}).click();
  await expect(c.getByRole('button',{name:'離開會談'})).toBeVisible();await expect(overlay).toHaveCount(0);
  for(let n=1;n<=2;n++){
   await c.getByLabel('搜尋物件').fill('小屋');await c.getByRole('button',{name:'⌂ 小屋 練習物件'}).click();await c.getByRole('button',{name:'放在中央'}).click();
   await expect(t.getByTestId('viewport')).toHaveAttribute('data-items',String(n),{timeout:20000});
  }
  await t.getByRole('button',{name:'小屋 2',exact:true}).click();await t.getByRole('button',{name:'請求操作選中物件'}).click();
  const req=c.locator('.permission-request');await expect(req).toBeVisible({timeout:15000});
  await expect(req).toContainText('治療師請求操作「小屋 2」：移動、旋轉、縮放，5 分鐘');
  const info=await(await request.get(`/api/rooms/${id}/info`)).json();
  const objectId=Object.values(info.requests??{}).map((r:any)=>r.objectId)[0] as string|undefined;
  if(objectId)await expect(req).not.toContainText(objectId.slice(0,8));
 }finally{if(id)await post(request,`/api/rooms/${id}/close`).catch(()=>{});await cc.close();await tc.close();}
});
