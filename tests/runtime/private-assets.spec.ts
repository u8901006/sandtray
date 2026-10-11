import {test,expect,type APIRequestContext} from '@playwright/test';
import {createHash} from 'node:crypto';
import imported from '../../packages/asset-catalog/src/imported-v1.json' with {type:'json'};
const origin='http://127.0.0.1:8788',model=imported[0];
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
const asset=(roomId:string,id=model.id,version=model.version)=>`/api/assets/${id}/${version}/model.glb?roomId=${roomId}`;
async function setup(api:APIRequestContext){
 expect((await api.post('/__test/login',{data:{name:'therapist'}})).status()).toBe(200);
 const made=await post(api,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'});expect(made.status()).toBe(200);
 expect((await post(api,'/__test/asset-store',{id:model.id,version:model.version})).status()).toBe(200);
 return await made.json() as {id:string;sceneId:string};
}
test('AC18 anonymous lookup is opaque; admitted members get exact immutable bytes',async({request,playwright})=>{
 const room=await setup(request),anonymous=await playwright.request.newContext({baseURL:origin});
 const client=await playwright.request.newContext({baseURL:origin}),other=await playwright.request.newContext({baseURL:origin});
 try{
  for(const path of [asset(room.id),asset(room.id,'missing'),asset(room.id,model.id,'bad-version'),'/api/assets/anything']){
   const r=await anonymous.get(path);expect(r.status()).toBe(401);expect(r.headers()['cache-control']).toBe('private, no-store');
  }
  const {token}=await (await post(request,`/api/rooms/${room.id}/invites`)).json();
  const {participantId}=await (await post(client,'/api/invites/redeem',{token,nickname:'虛構素材案主'})).json();
  expect((await client.get(asset(room.id))).status()).toBe(403);
  await post(request,`/api/rooms/${room.id}/admit`,{participantId});
  for(const member of [request,client]){
   const r=await member.get(asset(room.id));expect(r.status()).toBe(200);
   expect(createHash('sha256').update(await r.body()).digest('hex')).toBe(model.sha256);
   expect(r.headers()['content-length']).toBe(String(model.bytes));expect(r.headers()['cache-control']).toBe('private, no-store');
   expect(r.headers()['cf-cache-status']).not.toBe('HIT');
   expect((await member.get(asset(room.id,'missing'))).status()).toBe(404);
   expect((await member.get(asset(room.id,model.id,'bad-version'))).status()).toBe(404);
  }
  for(const name of ['other','outsider']){await other.post('/__test/login',{data:{name}});expect((await other.get(asset(room.id))).status()).toBe(403);}
  const second=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();
  expect((await client.get(asset(second.id))).status()).toBe(403);
  expect((await request.get(asset(room.id,'DEV_ROCK','dev-v1'))).status()).toBe(404);
 }finally{await anonymous.dispose();await client.dispose();await other.dispose();}
});
test('AC18 HEAD/conditional requests reauthenticate; expiry cannot use a cached response',async({request})=>{
 const room=await setup(request),url=asset(room.id);
 const head=await request.head(url);expect(head.status()).toBe(200);expect((await head.body()).length).toBe(0);
 const r=await request.get(url,{headers:{'If-None-Match':'"'+model.sha256+'"',Range:'bytes=0-3'}});
 expect(r.status()).toBe(200);expect((await r.body()).length).toBe(model.bytes);
 await post(request,'/__test/asset-session',{expire:true});
 expect((await request.get(url,{headers:{'If-None-Match':r.headers().etag}})).status()).toBe(401);
 expect((await request.head(url)).status()).toBe(401);
});
test('AC18 browser fetch sees room close on the same URL with default cache settings',async({request,browser})=>{
 const room=await setup(request),context=await browser.newContext({storageState:await request.storageState()});
 try{
  const page=await context.newPage();await page.goto(origin+'/api/health');
  const fetchModel=()=>page.evaluate(async url=>{const r=await fetch(url);return {status:r.status,length:(await r.arrayBuffer()).byteLength,cache:r.headers.get('cache-control')};},asset(room.id));
  expect(await fetchModel()).toEqual({status:200,length:model.bytes,cache:'private, no-store'});
  expect((await post(request,`/api/rooms/${room.id}/close`)).status()).toBe(200);
  expect((await fetchModel()).status).toBe(403);
 }finally{await context.close();}
});
for(const event of ['logout','close','expire'] as const)test(`AC18 ${event} during R2 read prevents first response bytes`,async({request})=>{
 const room=await setup(request),gate=`/__test/asset-gate/${room.id}`;
 await post(request,gate,{hold:true});const pending=request.get(asset(room.id));
 try{
  await expect.poll(async()=>(await (await request.get(gate)).json()).reached).toBe(true);
  if(event==='logout')expect((await post(request,'/auth/logout')).status()).toBe(204);
  else if(event==='expire')await post(request,'/__test/asset-session',{expire:true});
  else expect((await post(request,`/api/rooms/${room.id}/close`)).status()).toBe(200);
 }finally{await post(request,gate,{hold:false});}
 const response=await pending;expect(response.status()).toBe(event==='close'?403:401);
 expect(response.headers()['content-type']).toContain('application/json');
});
test('AC18 logout during final tombstone check cannot reuse an earlier session snapshot',async({request})=>{
 const room=await setup(request),readGate=`/__test/asset-gate/${room.id}`,checkGate=`/__test/scene/${room.sceneId}/erasure-check-gate`;
 await post(request,readGate,{hold:true});const pending=request.get(asset(room.id));
 try{
  await expect.poll(async()=>(await (await request.get(readGate)).json()).reached).toBe(true);
  await post(request,checkGate,{hold:true});await post(request,readGate,{hold:false});
  await expect.poll(async()=>(await (await request.get(checkGate)).json()).reached).toBe(true);
  expect((await post(request,'/auth/logout')).status()).toBe(204);
 }finally{await post(request,readGate,{hold:false});await post(request,checkGate,{hold:false});}
 expect((await pending).status()).toBe(401);
});
test('AC18 session budget returns 429 and Retry-After without bypass by HEAD',async({request})=>{
 const room=await setup(request);await post(request,'/__test/asset-session',{consume:599});
 expect((await request.get(asset(room.id))).status()).toBe(200);
 const r=await request.head(asset(room.id));expect(r.status()).toBe(429);
 expect(Number(r.headers()['retry-after'])).toBeGreaterThan(0);expect(r.headers()['cache-control']).toBe('private, no-store');
});
test('AC18 missing/corrupt private objects never fall back to public copies',async({request})=>{
 const room=await setup(request);
 try{
  await post(request,'/__test/asset-store',{id:model.id,version:model.version,remove:true});
  expect((await request.get(asset(room.id))).status()).toBe(404);
  await post(request,'/__test/asset-store',{id:model.id,version:model.version,corrupt:true});
  expect((await request.get(asset(room.id))).status()).toBe(503);
 }finally{await post(request,'/__test/asset-store',{id:model.id,version:model.version});}
});

test('AC18 cancelled waiting seat and an ended session cannot fetch private models',async({request,playwright})=>{
 const room=await setup(request),client=await playwright.request.newContext({baseURL:origin});
 try{
  const {token}=await (await post(request,`/api/rooms/${room.id}/invites`)).json();
  const {participantId}=await (await post(client,'/api/invites/redeem',{token,nickname:'虛構取消席位'})).json();
  expect((await post(request,`/api/rooms/${room.id}/waiting/cancel`,{participantId})).status()).toBe(200);
  expect((await client.get(asset(room.id))).status()).toBe(403);
  // V8-L12-3：場景刪除 API 隨 cloud 管理移除；會談即焚下作品的終點是治療師結束會談，結束後同一席位不得再取私有模型
  expect((await post(request,`/api/rooms/${room.id}/close`)).status()).toBe(200);
  expect((await request.get(asset(room.id))).status()).toBe(403);
 }finally{await client.dispose();}
});


// V8-L12-3：「coordinator 場景刪除期間阻擋模型」隨 cloud 場景刪除 API 移除（使用者裁定 L01-4）；結束會談後阻擋由上一案驗證。
