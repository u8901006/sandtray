import {test,expect,type APIRequestContext} from '@playwright/test';

const origin='http://127.0.0.1:8788';
const secret='x'.repeat(24);
const countedPost=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin,'X-Test-Count-Room-DO':'1'}});
const countedGet=(api:APIRequestContext,path:string)=>api.get(path,{headers:{'X-Test-Count-Room-DO':'1'}});
const countedResourcePost=(api:APIRequestContext,path:string,data:unknown)=>api.post(path,{data,headers:{Origin:origin,'X-Test-Count-Resources':'1'}});
const countedResourceGet=(api:APIRequestContext,path:string)=>api.get(path,{headers:{'X-Test-Count-Resources':'1'}});

test('L03-4: 1,000 random invite room IDs are rejected before any Room DO lookup',async({request})=>{
 test.setTimeout(120000);
 for(let offset=0;offset<1000;offset+=25){
  const batch=await Promise.all(Array.from({length:25},(_,index)=>{
   const n=offset+index,roomId=crypto.randomUUID();
   return n%2===0
    ?countedPost(request,'/api/invites/inspect',{token:`${roomId}.${secret}`})
    :countedPost(request,'/api/invites/redeem',{token:`${roomId}.${secret}`,acceptedPolicyVersion:'dev-v1'});
  }));
  for(const response of batch){
   expect(response.status()).toBe(403);
   expect(response.headers()['x-test-room-do-calls']).toBe('0');
  }
 }
});

test('L03-4: an authenticated session cannot create a Room DO by addressing a random room ID',async({request})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const response=await countedGet(request,`/api/rooms/${crypto.randomUUID()}/info`);
 expect(response.status()).toBe(403);
 expect(response.headers()['x-test-room-do-calls']).toBe('0');
});

test('L03-4: private asset delivery rejects a random room before Room DO lookup',async({request})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const response=await countedResourceGet(request,`/api/assets/USR_ANIMAL_panda/user-dd75ca9a09d57d91/model.glb?roomId=${crypto.randomUUID()}`);
 expect(response.status()).toBe(403);
 expect(response.headers()['x-test-room-do-calls']).toBe('0');
});

test('L03-4: scene export rejects a random scene before Coordinator or Room DO lookup',async({request})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const response=await countedResourcePost(request,`/api/scenes/${crypto.randomUUID()}/exports`,{format:'png',consentVersion:'guessed',expectedSceneRevision:0});
 expect(response.status()).toBe(403);
 expect(response.headers()['x-test-room-do-calls']).toBe('0');
 expect(response.headers()['x-test-scene-coordinator-do-calls']).toBe('0');
});

test('L03-4: create and close do not permanently consume the session room-tracking cap',async({request})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const created=await countedPost(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'});
 expect(created.status()).toBe(200);const roomId=String((await created.json()).id);
 const fill=await request.post('/__test/asset-session',{data:{rooms:[roomId,...Array.from({length:99},()=>crypto.randomUUID())]}});
 expect((await fill.json()).attached.every(Boolean)).toBe(true);
 expect((await request.post(`/api/rooms/${roomId}/close`,{data:{},headers:{Origin:origin}})).status()).toBe(200);
 const after=await request.post('/__test/asset-session',{data:{rooms:[crypto.randomUUID()]}});
 expect((await after.json()).attached).toEqual([true]);
});

test('L03-4: idle room expiry detaches tracked sessions before clearing its cleanup outbox',async({request})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const created=await countedPost(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'});
 expect(created.status()).toBe(200);const roomId=String((await created.json()).id);
 const fill=await request.post('/__test/asset-session',{data:{rooms:[roomId,...Array.from({length:99},()=>crypto.randomUUID())]}});
 expect((await fill.json()).attached.every(Boolean)).toBe(true);
 const expired=await request.post(`/__test/room/${roomId}/expire`);
 expect(expired.ok()).toBe(true);
 const after=await request.post('/__test/asset-session',{data:{rooms:[crypto.randomUUID()]}});
 expect((await after.json()).attached).toEqual([true]);
});

test('L03-4: failed initial alarm leaves no persisted room or coordinator writer',async({request})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const roomId=crypto.randomUUID();
 await request.post(`/__test/room/${roomId}/init-alarm-fail`,{data:{fail:true}});
 const response=await request.post(`/__test/room/${roomId}/initialize-fail`,{data:{},headers:{Origin:origin}});
 expect(response.status()).toBe(500);const result=await response.json();
 expect(result.ok).toBe(false);expect(result.inspect).toEqual({room:0,operations:0,history:0});expect(result.active).toBeNull();expect(result.alarm).toBeNull();
});

test('L03-4: redeemed or closed invites release their short-lived registry metadata',async({request,playwright})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const first=await countedPost(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'}),firstId=String((await first.json()).id);
 const invite=await countedPost(request,`/api/rooms/${firstId}/invites`),token=String((await invite.json()).token);
 expect((await (await request.get(`/__test/invite-index/${firstId}`)).json()).active).toBe(true);
 const client=await playwright.request.newContext({baseURL:origin});
 try{expect((await countedPost(client,'/api/invites/redeem',{token,acceptedPolicyVersion:'dev-v1'})).status()).toBe(200);}
 finally{await client.dispose();}
 expect((await (await request.get(`/__test/invite-index/${firstId}`)).json()).active).toBe(false);
 const second=await countedPost(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'}),secondId=String((await second.json()).id);
 await countedPost(request,`/api/rooms/${secondId}/invites`);
 expect((await (await request.get(`/__test/invite-index/${secondId}`)).json()).active).toBe(true);
 expect((await countedPost(request,`/api/rooms/${secondId}/close`,{})).status()).toBe(200);
 expect((await (await request.get(`/__test/invite-index/${secondId}`)).json()).active).toBe(false);
});

test('L03-4: stale invite cleanup and out-of-order registration cannot replace a same-expiry generation',async({request})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const created=await countedPost(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'}),roomId=String((await created.json()).id);
 const invite=await countedPost(request,`/api/rooms/${roomId}/invites`);
 expect(invite.status()).toBe(200);
 const path=`/__test/invite-index/${roomId}`,first=(await (await request.get(path)).json()).registration as {expiresAt:number;tokenHash:string|null;generation:number};
 expect(first.generation).toBeGreaterThan(0);
 const replacement={expiresAt:first.expiresAt,tokenHash:'f'.repeat(64),generation:first.generation+1};
 expect((await (await request.post(path,{data:{action:'register',...replacement}})).json()).registered).toBe(true);
 expect((await (await request.post(path,{data:{action:'clear',expected:first}})).json()).cleared).toBe(false);
 expect((await (await request.post(path,{data:{action:'register',...first}})).json()).registered).toBe(false);
 expect((await (await request.get(path)).json()).registration).toEqual(replacement);
 expect((await (await request.post(path,{data:{action:'clear',expected:replacement}})).json()).cleared).toBe(true);
 expect((await (await request.post(path,{data:{action:'register',...first}})).json()).registered).toBe(false);
 expect((await (await request.post(path,{data:{action:'register',...replacement}})).json()).registered).toBe(false);
 expect((await (await request.get(path)).json()).registration).toBeNull();
 expect((await countedPost(request,`/api/rooms/${roomId}/close`,{})).status()).toBe(200);
});

test('L03-4: late info/invite registration cannot reopen room or scene indexes after close',async({request})=>{
 test.setTimeout(120000);
 await request.post('/__test/login',{data:{name:'therapist'}});
 for(const action of ['info','invites'] as const){
  const created=await countedPost(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'});
  expect(created.status()).toBe(200);const {id:roomId,sceneId}=await created.json() as {id:string;sceneId:string};
  const gatePath=`/__test/room-register-gate/${roomId}`;
  expect((await request.post(gatePath,{data:{action:'arm'}})).ok()).toBe(true);
  const lateRequest=request.post(`/__test/late-room-registration/${roomId}/${action}`,{data:{},headers:{Origin:origin}});
  let reached=false;
  try{
   for(let attempt=0;attempt<200;attempt++){
    const state=await (await request.get(gatePath)).json() as {reached:boolean};
    if(state.reached){reached=true;break;}
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   expect(reached).toBe(true);
   expect((await request.post(`/api/rooms/${roomId}/close`,{data:{},headers:{Origin:origin}})).status()).toBe(200);
  }finally{await request.post(gatePath,{data:{action:'release'}});}
  expect((await lateRequest).status()).toBe(403);
  const registry=await request.get(`/__test/room-registry/${roomId}?clinicId=clinic-a&sceneId=${sceneId}`);
  expect(await registry.json()).toEqual({room:false,scene:false});
  expect((await (await request.get(`/__test/invite-index/${roomId}`)).json()).active).toBe(false);
  const afterClose=await countedGet(request,`/api/rooms/${roomId}/info`);
  expect(afterClose.status()).toBe(403);expect(afterClose.headers()['x-test-room-do-calls']).toBe('0');
 }
});

test('L03-4: extending a live room index also preserves invite generation high-water',async({request,playwright})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const created=await countedPost(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'});
 expect(created.status()).toBe(200);const roomId=String((await created.json()).id);
 const firstResponse=await countedPost(request,`/api/rooms/${roomId}/invites`);
 const firstIndex=(await (await request.get(`/__test/invite-index/${roomId}`)).json()).registration as {expiresAt:number;tokenHash:string|null;generation:number};
 const secondResponse=await countedPost(request,`/api/rooms/${roomId}/invites`);
 const secondToken=String((await secondResponse.json()).token);
 const secondIndex=(await (await request.get(`/__test/invite-index/${roomId}`)).json()).registration as {expiresAt:number;tokenHash:string|null;generation:number};
 expect(firstResponse.status()).toBe(200);expect(secondResponse.status()).toBe(200);
 expect(secondIndex.generation).toBeGreaterThan(firstIndex.generation);
 expect((await request.post(`/__test/invite-index/${roomId}`,{data:{action:'expire-generation'}})).ok()).toBe(true);
 const client=await playwright.request.newContext({baseURL:origin});
 try{expect((await countedPost(client,'/api/invites/redeem',{token:secondToken,acceptedPolicyVersion:'dev-v1'})).status()).toBe(200);}
 finally{await client.dispose();}
 const stale=await request.post(`/__test/invite-index/${roomId}`,{data:{action:'register',...firstIndex}});
 expect((await stale.json()).registered).toBe(false);
 expect((await (await request.get(`/__test/invite-index/${roomId}`)).json()).registration).toBeNull();
 await countedPost(request,`/api/rooms/${roomId}/close`,{});
});

test('L03-4: a delayed redeem cannot recreate closed indexes after the 8-hour fence expires',async({request,playwright})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const created=await countedPost(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'});
 expect(created.status()).toBe(200);const {id:roomId,sceneId}=await created.json() as {id:string;sceneId:string};
 const invite=await countedPost(request,`/api/rooms/${roomId}/invites`),token=String((await invite.json()).token);
 const gate='/__test/session-create-gate';
 expect((await request.post(gate,{data:{action:'arm'}})).ok()).toBe(true);
 const client=await playwright.request.newContext({baseURL:origin});
 const redemption=countedPost(client,'/api/invites/redeem',{token,acceptedPolicyVersion:'dev-v1'});
 let reached=false;
 try{
  for(let attempt=0;attempt<200;attempt++){
   const state=await (await request.get(gate)).json() as {reached:boolean};
   if(state.reached){reached=true;break;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  expect(reached).toBe(true);
  expect((await countedPost(request,`/api/rooms/${roomId}/close`,{})).status()).toBe(200);
  expect((await request.post(`/__test/closed-room-markers/${roomId}`,{data:{clinicId:'clinic-a',sceneId}})).ok()).toBe(true);
 }finally{await request.post(gate,{data:{action:'release'}});}
 const response=await redemption;
 expect(response.status()).toBe(403);expect(response.headers()['set-cookie']).toBeUndefined();
 expect((await client.get('/api/session')).status()).toBe(401);
 await client.dispose();
 expect(await (await request.get(`/__test/room-registry/${roomId}?clinicId=clinic-a&sceneId=${sceneId}`)).json()).toEqual({room:false,scene:false});
 expect((await (await request.get(`/__test/invite-index/${roomId}`)).json()).active).toBe(false);
});

test('L03-4: a room with a live invite still supports owner/client access, inspect and redeem',async({request,playwright})=>{
 test.setTimeout(60000);
 await request.post('/__test/login',{data:{name:'therapist'}});
 let roomId:string|undefined,clientApi:APIRequestContext|undefined;
 try{
  const created=await countedPost(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'});
  expect(created.status()).toBe(200);
  roomId=(await created.json()).id;
  const ownerInfo=await countedGet(request,`/api/rooms/${roomId}/info`);
  expect(ownerInfo.status()).toBe(200);
  expect(Number(ownerInfo.headers()['x-test-room-do-calls'])).toBeGreaterThan(0);
  const invite=await countedPost(request,`/api/rooms/${roomId}/invites`);
  expect(invite.status()).toBe(200);
  const {token}=await invite.json();
  const inspect=await countedPost(request,'/api/invites/inspect',{token});
  expect(inspect.status()).toBe(200);
  expect(Number(inspect.headers()['x-test-room-do-calls'])).toBeGreaterThan(0);
  clientApi=await playwright.request.newContext({baseURL:origin});
  const redeem=await countedPost(clientApi,'/api/invites/redeem',{token,acceptedPolicyVersion:'dev-v1'});
  expect(redeem.status()).toBe(200);
  expect(Number(redeem.headers()['x-test-room-do-calls'])).toBeGreaterThan(0);
  const clientInfo=await countedGet(clientApi,`/api/rooms/${roomId}/info`);
  expect(clientInfo.status()).toBe(200);
  expect(Number(clientInfo.headers()['x-test-room-do-calls'])).toBeGreaterThan(0);
 }finally{
  await clientApi?.dispose();
  if(roomId)await request.post(`/api/rooms/${roomId}/close`,{headers:{Origin:origin}}).catch(()=>{});
 }
});
