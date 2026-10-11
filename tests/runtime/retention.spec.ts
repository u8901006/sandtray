import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:8788';
test('A17 session-only close and idle expiry remove operation/history data',async({request})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 for(const action of ['close','expire']){const created=await (await request.post('/api/rooms',{data:{retentionMode:'session-only',policyVersion:'dev-v1'},headers:{Origin:origin}})).json();
 if(action==='close')await request.post(`/api/rooms/${created.id}/close`,{data:{},headers:{Origin:origin}});else await request.get(`/__test/room/${created.id}/expire`);
 const rows=await (await request.get(`/__test/room/${created.id}/inspect`)).json();expect(rows).toEqual({room:0,operations:0,history:0});expect((await request.get(`/api/rooms/${created.id}/snapshot`)).status()).toBe(403);
 }
});
test('export requires independent client consent, not therapist membership',async({request,playwright})=>{
 const post=(path:string,data:unknown)=>request.post(path,{data,headers:{Origin:origin}});await request.post('/__test/login',{data:{name:'therapist'}});
 const {id,sceneId}=await (await post('/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();const {token}=await (await post(`/api/rooms/${id}/invites`,{})).json();const client=await playwright.request.newContext({baseURL:origin});try{
 const {participantId}=await (await client.post('/api/invites/redeem',{data:{token,nickname:'測試'},headers:{Origin:origin}})).json();await post(`/api/rooms/${id}/admit`,{participantId});
 // V8-L12-8（使用者裁定 L01-9：取消 JSON 匯出）：原本以 JSON 為載體的同意檢查改用 PNG，保護目標不變；JSON 一律拒絕
 expect((await post(`/api/scenes/${sceneId}/exports`,{format:'png',consentVersion:'guessed',expectedSceneRevision:0})).status()).toBe(403);
 expect((await post(`/api/rooms/${id}/export-consent`,{formats:['png']})).status()).toBe(403);
 expect((await client.post(`/api/rooms/${id}/versions`,{data:{name:'不可轉存',expectedSceneRevision:0},headers:{Origin:origin}})).status()).toBe(403);
 expect((await client.post(`/api/rooms/${id}/export-consent`,{data:{formats:['json']},headers:{Origin:origin}})).status()).toBe(400);
 const consent=await client.post(`/api/rooms/${id}/export-consent`,{data:{formats:['png']},headers:{Origin:origin}});expect(consent.status()).toBe(200);const {version}=await consent.json();
 const result=await post(`/api/scenes/${sceneId}/exports`,{format:'png',consentVersion:version,expectedSceneRevision:0});expect(result.status()).toBe(200);expect(await result.json()).toEqual({authorized:true,sceneRevision:0});expect(result.headers()['cache-control']).toBe('no-store');
 expect((await post(`/api/scenes/${sceneId}/exports`,{format:'json',consentVersion:version})).status()).toBe(400);
 await client.post(`/api/rooms/${id}/export-consent`,{data:{formats:[]},headers:{Origin:origin}});expect((await post(`/api/scenes/${sceneId}/exports`,{format:'png',consentVersion:version,expectedSceneRevision:0})).status()).toBe(403);
 }finally{await client.dispose();}
});


// V8-L12-3（使用者裁定 L01-4：會談即焚）：cloud 保存、重開舊作品與其管理面全部移除——入口必須在 server 端拒絕，
// 不能只是 UI 看不到。建房只收 session-only；已移除的路由對已登入的治療師一律 403（落到預設拒絕）。
test('L12-3 cloud retention, reopening and the saved-scene management surfaces are refused server-side',async({request})=>{
 const post=(path:string,data:unknown)=>request.post(path,{data,headers:{Origin:origin}});await request.post('/__test/login',{data:{name:'therapist'}});
 expect((await post('/api/rooms',{retentionMode:'cloud',policyVersion:'dev-v1'})).status()).toBe(400);
 expect((await post('/api/rooms',{sceneId:'s1',sourceRoomId:'r1',versionId:'v1',retentionMode:'session-only',policyVersion:'dev-v1'})).status()).toBe(400);
 const {id,sceneId}=await (await post('/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();
 try{
  for(const path of ['/api/retention-policy','/api/scenes','/api/data-management',`/api/scenes/${sceneId}/management`,`/api/scenes/${sceneId}/backups`,`/api/scenes/${sceneId}/deletion`,`/api/rooms/${id}/versions`])expect((await request.get(path)).status(),path).toBe(403);
  expect((await post(`/api/scenes/${sceneId}/backups`,{})).status()).toBe(403);
  expect((await request.delete(`/api/scenes/${sceneId}`,{headers:{Origin:origin}})).status()).toBe(403);
  expect((await post(`/api/rooms/${id}/versions/v1/restore`,{expectedSceneRevision:0,sessionEpoch:1,controlEpoch:1})).status()).toBe(403);
 }finally{await post(`/api/rooms/${id}/close`,{});}
});
