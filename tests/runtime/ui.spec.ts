import {test,expect} from '@playwright/test';
import {roomContext} from './open-panels';
const origin='http://127.0.0.1:8788';
test('two-page UI: client creation, therapist read-only and explicit consent',async({request,playwright,browser},testInfo)=>{
 await request.post('/__test/login',{data:{name:'therapist'}});const {id}=await (await request.post('/api/rooms',{data:{retentionMode:'session-only',policyVersion:'dev-v1'},headers:{Origin:origin}})).json();const {token}=await (await request.post(`/api/rooms/${id}/invites`,{data:{},headers:{Origin:origin}})).json();
 const clientApi=await playwright.request.newContext({baseURL:origin});const {participantId}=await (await clientApi.post('/api/invites/redeem',{data:{token,nickname:'虛構'},headers:{Origin:origin}})).json();await request.post(`/api/rooms/${id}/admit`,{data:{participantId},headers:{Origin:origin}});
 const tc=await roomContext(browser,{storageState:await request.storageState()}),cc=await roomContext(browser,{storageState:await clientApi.storageState()});
 try{const t=await tc.newPage(),c=await cc.newPage();await t.goto(`/?room=${id}`);await c.goto(`/?room=${id}`);
 await expect(c.getByRole('button',{name:'● 圓石 練習物件'})).toBeEnabled();await expect(t.getByRole('button',{name:'● 圓石 練習物件'})).toBeDisabled();
 await c.getByRole('button',{name:'● 圓石 練習物件'}).click();await c.getByRole('button',{name:'放在中央'}).click();await expect(t.getByTestId('viewport')).toHaveAttribute('data-items','1');
 await t.getByRole('button',{name:'圓石 1',exact:true}).click();await expect(t.getByLabel('物件大小')).toBeDisabled();await t.getByRole('button',{name:'請求操作選中物件'}).click();await c.getByRole('button',{name:'同意上述動作'}).click();
 await expect(t.getByLabel('物件大小')).toBeEnabled();await t.getByLabel('左右位置').fill('2');await expect.poll(async()=>JSON.parse((await c.getByTestId('transform').textContent())!).position[0]).toBe(2);
 await c.getByRole('button',{name:'收回全部操作'}).click();await expect(t.getByLabel('物件大小')).toBeDisabled();
 await c.screenshot({path:testInfo.outputPath('shared-client.png'),fullPage:true});
 }finally{await tc.close();await cc.close();await clientApi.dispose();}
});
