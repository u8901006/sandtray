import {test,expect} from '@playwright/test';
import {roomContext} from './open-panels';
const origin='http://127.0.0.1:8788';
// G57: DEV_PUPPET restores the version-scoped clip negative with a DEV_ONLY two-release practice model.
// V8-L12-3：「重開舊作品時沿用原 assetVersion」測試隨 cloud 重開功能移除（使用者裁定 L01-4／L01-9；A11 不適用）。
// G57: the pinned v1 release of DEV_PUPPET lacks 原地行走 (clip-1), so a legacy model must get
// INVALID_PAYLOAD for the newer-only clip while the same clip id plays on the current release —
// proving the rejection is version-scoped, not clip-id-scoped (coverage restored from the removed trex).
test('old DEV_PUPPET release rejects a newer-only clip while the current release plays it',async({request,playwright,browser},testInfo)=>{
 test.setTimeout(120000);await request.post('/__test/login',{data:{name:'therapist'}});const post=(path:string,data:unknown={})=>request.post(path,{data,headers:{Origin:origin}});
 const {id}=await(await post('/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();const {token}=await(await post(`/api/rooms/${id}/invites`)).json();const client=await playwright.request.newContext({baseURL:origin});
 const {participantId}=await(await client.post('/api/invites/redeem',{data:{token,nickname:'版本負向虛構案主',acceptedPolicyVersion:'dev-v1'},headers:{Origin:origin}})).json();await post(`/api/rooms/${id}/admit`,{participantId});
 const cc=await roomContext(browser,{storageState:await client.storageState()});const oldVersion='puppet-v1';
 try{
  const c=await cc.newPage();const modelRequests:string[]=[];c.on('request',r=>{if(r.url().endsWith('.glb'))modelRequests.push(new URL(r.url()).pathname);});
  await c.addInitScript(({version})=>{
   const w=window as any;w.__legacyOnce=true;w.__badClipOnce=true;w.__events=[];w.__lastAnimation='';const original=WebSocket.prototype.send;const observed=new WeakSet<WebSocket>();
   WebSocket.prototype.send=function(data:any){
    if(!observed.has(this)){observed.add(this);this.addEventListener('message',e=>w.__events.push(JSON.parse(e.data)));}
    if(typeof data==='string'){
     const command=JSON.parse(data);
     if(command.type==='object.create'&&w.__legacyOnce){w.__legacyOnce=false;command.assetVersion=version;data=JSON.stringify(command);}
     if(command.type==='animation.set'){w.__lastAnimation=command.operationId;if(w.__badClipOnce){w.__badClipOnce=false;command.clipId='clip-1';data=JSON.stringify(command);}}
    }
    return original.call(this,data);
   };
  },{version:oldVersion});
  await c.goto('/?room='+id);await c.getByLabel('搜尋物件').fill('練習玩偶');await c.getByRole('button',{name:'♟ 練習玩偶 練習物件'}).click();await c.getByRole('button',{name:'放在中央'}).click();await expect(c.getByTestId('load-status')).toHaveText('3D 模型已載入',{timeout:45000});
  expect(modelRequests).toContain('/dev-assets/puppet-v1.glb');await expect(c.getByLabel('角色動作',{exact:true}).locator('option')).toHaveCount(1);
  const snapshot=async()=>(await(await client.get(`/api/rooms/${id}/snapshot`)).json());expect((await snapshot()).objects[0].assetVersion).toBe(oldVersion);
  await c.getByRole('button',{name:'播放角色動作'}).click();await expect.poll(()=>c.evaluate(()=>(window as any).__events.find((e:any)=>e.operationId===(window as any).__lastAnimation)?.code)).toBe('INVALID_PAYLOAD');expect((await snapshot()).objects[0].animation?.state).not.toBe('playing');
  await c.getByRole('button',{name:'播放角色動作'}).click();await expect.poll(async()=>(await snapshot()).objects[0].animation?.state).toBe('playing');await c.getByRole('button',{name:'停止所有動作',exact:true}).click();
  await c.getByRole('button',{name:'♟ 練習玩偶 練習物件'}).click();await c.getByRole('button',{name:'放在中央'}).click();await expect(c.getByTestId('load-status')).toHaveText('3D 模型已載入',{timeout:45000});expect(modelRequests).toContain('/dev-assets/puppet-v2.glb');
  await expect(c.getByLabel('角色動作',{exact:true}).locator('option')).toHaveCount(2);
  await c.getByLabel('角色動作',{exact:true}).selectOption({label:'原地行走'});await c.getByRole('button',{name:'播放角色動作'}).click();await expect.poll(async()=>(await snapshot()).objects.find((o:any)=>o.assetVersion==='puppet-v2')?.animation?.clipId).toBe('clip-1');
  await c.getByRole('button',{name:'停止所有動作',exact:true}).click();await c.screenshot({path:testInfo.outputPath('dev-puppet-versions.png'),fullPage:true});
  expect((await snapshot()).objects.map((o:any)=>o.assetVersion).sort()).toEqual(['puppet-v1','puppet-v2']);
 }finally{await cc.close();await client.dispose();}
});
