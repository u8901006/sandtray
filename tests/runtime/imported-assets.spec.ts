import {test,expect} from '@playwright/test';
import {roomContext} from './open-panels';
import {assetById} from '../../packages/asset-catalog/src/index';
const origin='http://127.0.0.1:8788';
test('imported animated model loads on both seats, pins version and stops on revoked permission',async({request,playwright,browser},testInfo)=>{
 test.setTimeout(60000);await request.post('/__test/login',{data:{name:'therapist'}});const post=(path:string,data:unknown={})=>request.post(path,{data,headers:{Origin:origin}});
 const {id}=await(await post('/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();const {token}=await(await post(`/api/rooms/${id}/invites`)).json();const client=await playwright.request.newContext({baseURL:origin});
 const {participantId}=await(await client.post('/api/invites/redeem',{data:{token,nickname:'素材虛構案主',acceptedPolicyVersion:'dev-v1'},headers:{Origin:origin}})).json();await post(`/api/rooms/${id}/admit`,{participantId});
 const tc=await roomContext(browser,{storageState:await request.storageState()}),cc=await roomContext(browser,{storageState:await client.storageState()});
 try{const t=await tc.newPage(),c=await cc.newPage();await t.goto('/?room='+id);await c.goto('/?room='+id);
  await c.getByLabel('搜尋物件').fill('Casual_Female');await c.getByRole('button',{name:'Casual_Female 已匯入素材',exact:true}).click();await c.getByRole('button',{name:'放在中央'}).click();await expect(c.getByTestId('load-status')).toHaveText('3D 模型已載入');await expect(t.getByTestId('viewport')).toHaveAttribute('data-items','1');await t.getByRole('button',{name:'Casual_Female 1',exact:true}).click();await expect(t.getByTestId('load-status')).toHaveText('3D 模型已載入');await expect(t.getByRole('button',{name:'播放角色動作'})).toBeDisabled();
  const snapshot=async()=>(await(await client.get(`/api/rooms/${id}/snapshot`)).json());const initial=await snapshot();expect(initial.objects[0].assetVersion).toBe(assetById.get('IMP_ULTIMATE_Casual_Female')!.version);expect(initial.objects[0].animation?.state).not.toBe('playing');
  await t.getByRole('button',{name:'請求播放選中物件動作'}).click();await c.getByRole('button',{name:'同意上述動作'}).click();await expect(t.getByRole('button',{name:'播放角色動作'})).toBeEnabled();await t.getByLabel('角色動作',{exact:true}).selectOption({label:'Walk'});await t.getByRole('button',{name:'播放角色動作'}).click();await expect.poll(async()=>(await snapshot()).objects[0].animation?.state).toBe('playing');
  await c.getByRole('button',{name:'收回全部操作'}).click();await expect.poll(async()=>(await snapshot()).objects[0].animation?.state).toBe('stopped');await expect(t.getByRole('button',{name:'播放角色動作'})).toBeDisabled();await c.screenshot({path:testInfo.outputPath('imported-shared-ui.png'),fullPage:true});
 }finally{await tc.close();await cc.close();await client.dispose();}
});
