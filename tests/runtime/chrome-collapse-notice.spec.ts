import {test,expect,type APIRequestContext} from '@playwright/test';
// GPT-6 review 2026-10-10 F1：匯出 PNG 等待授權時收起上方面板，之後失敗；連線仍正常，
// 失敗訊息必須出現在收起列（原本只在被 hidden 的會談工具內）。也涵蓋「先有錯誤再收起」。
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});

test('an export that fails after the top panels were collapsed is still reported on the collapsed bar',async({request,browser})=>{
 test.setTimeout(60000);
 await request.post('/__test/login',{data:{name:'therapist'}});
 const tc=await browser.newContext({storageState:await request.storageState(),viewport:{width:1600,height:900}});
 let id:string|undefined;
 try{
  const t=await tc.newPage();await t.goto('/');
  await t.getByRole('button',{name:'建立虛構資料會談'}).click();await expect(t).toHaveURL(/\?room=/);id=new URL(t.url()).searchParams.get('room')!;
  const exportButton=t.getByRole('button',{name:'匯出 PNG'});await expect(exportButton).toBeEnabled();
  let arrived=false,release!:()=>void;const released=new Promise<void>(resolve=>{release=resolve;});
  await t.route('**/api/scenes/*/exports',async route=>{arrived=true;await released;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'EXPORT_CONSENT_REQUIRED'})});});
  await exportButton.click();
  await expect.poll(()=>arrived).toBe(true);
  await t.getByRole('button',{name:'收起上方面板'}).click();
  await expect(t.getByTestId('chrome-bar')).toBeVisible();
  await expect(t.getByTestId('chrome-notice')).toHaveCount(0);
  release();
  await expect(t.getByTestId('chrome-notice')).toBeVisible();
  await expect(t.getByTestId('chrome-notice')).toContainText('EXPORT_CONSENT_REQUIRED');
  await expect(t.getByRole('button',{name:'連線中斷'})).toHaveCount(0); // 連線正常，提示不是靠斷線提示帶出
  await t.getByTestId('chrome-notice').getByRole('button').click();
  await expect(t.locator('header')).toBeVisible();
  await expect(t.locator('.session-tools [role=alert]')).toContainText('EXPORT_CONSENT_REQUIRED');
  await t.getByRole('button',{name:'收起上方面板'}).click(); // 先有錯誤再收起
  await expect(t.getByTestId('chrome-notice')).toContainText('EXPORT_CONSENT_REQUIRED');
 }finally{if(id)await post(request,`/api/rooms/${id}/close`).catch(()=>{});await tc.close();}
});
