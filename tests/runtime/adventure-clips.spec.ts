import {test,expect} from '@playwright/test';
import {roomContext} from './open-panels';
import {assetById} from '../../packages/asset-catalog/src/index';
const origin='http://127.0.0.1:8788';
// GPT-6 review 2026-10-10 (NEEDS_EVIDENCE): in a shared room an adventure-v1 figure loads on both seats at its pinned version, and
// the server accepts its merged 行走 (clip-1) / 倒下 (clip-2) clips by id and records the stop.
test('adventure-v1 figure clips play and stop in a shared room',async({request,playwright,browser},testInfo)=>{
 test.setTimeout(60000);await request.post('/__test/login',{data:{name:'therapist'}});const post=(path:string,data:unknown={})=>request.post(path,{data,headers:{Origin:origin}});
 const {id}=await(await post('/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();const {token}=await(await post(`/api/rooms/${id}/invites`)).json();const client=await playwright.request.newContext({baseURL:origin});
 const {participantId}=await(await client.post('/api/invites/redeem',{data:{token,nickname:'冒險虛構案主',acceptedPolicyVersion:'dev-v1'},headers:{Origin:origin}})).json();await post(`/api/rooms/${id}/admit`,{participantId});
 const tc=await roomContext(browser,{storageState:await request.storageState()}),cc=await roomContext(browser,{storageState:await client.storageState()});
 const knight=assetById.get('AV_ADV_Knight')!;
 try{const t=await tc.newPage(),c=await cc.newPage();await t.goto('/?room='+id);await c.goto('/?room='+id);
  await c.getByLabel('搜尋物件').fill(knight.name);await c.getByRole('button',{name:knight.name+' 已匯入素材',exact:true}).click();await c.getByRole('button',{name:'放在中央'}).click();await expect(c.getByTestId('load-status')).toHaveText('3D 模型已載入');
  await expect(t.getByTestId('viewport')).toHaveAttribute('data-items','1');await t.getByRole('button',{name:knight.name+' 1',exact:true}).click();await expect(t.getByTestId('load-status')).toHaveText('3D 模型已載入');
  const snapshot=async()=>(await(await client.get(`/api/rooms/${id}/snapshot`)).json());expect((await snapshot()).objects[0].assetVersion).toBe(knight.version);
  for(const [label,clipId] of [['行走','clip-1'],['倒下','clip-2']]){
   await c.getByLabel('角色動作',{exact:true}).selectOption({label});await c.getByRole('button',{name:'播放角色動作'}).click();
   await expect.poll(async()=>(await snapshot()).objects[0].animation?.clipId).toBe(clipId);
   await c.getByRole('button',{name:'停止角色動作'}).click();await expect.poll(async()=>(await snapshot()).objects[0].animation?.state).not.toBe('playing');
  }
  await c.screenshot({path:testInfo.outputPath('adventure-clips-room.png'),fullPage:true});
 }finally{await tc.close();await cc.close();await client.dispose();}
});
