import {test,expect,type APIRequestContext} from '@playwright/test';
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});

test('A01 A20 owner recovers a stranded waiting seat without admitting stale sessions or cancelling a replacement',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const created=await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'});/* V8-L12-3：cloud 模式已移除 */expect(created.status()).toBe(200);const {id}=await created.json();
 const invitation=await post(request,`/api/rooms/${id}/invites`);expect(invitation.status()).toBe(200);const {token}=await invitation.json();
 const old=await playwright.request.newContext({baseURL:origin}),replacement=await playwright.request.newContext({baseURL:origin}),stranger=await playwright.request.newContext({baseURL:origin});
 try{
  // The caller loses the successful response; the server has consumed the invitation.
  const redeemed=await post(old,'/api/invites/redeem',{token,nickname:'遺失回覆測試',acceptedPolicyVersion:'dev-v1'});expect(redeemed.status()).toBe(200);const {participantId}=await redeemed.json();
  expect((await post(old,'/api/invites/redeem',{token,nickname:'重試',acceptedPolicyVersion:'dev-v1'})).status()).toBe(403);
  expect((await post(request,`/api/rooms/${id}/invites`)).status()).toBe(409);
  const cancel=`/api/rooms/${id}/waiting/cancel`;
  expect((await post(old,cancel,{participantId})).status()).toBe(403);
  for(const name of ['other','outsider']){await stranger.post('/__test/login',{data:{name}});expect((await post(stranger,cancel,{participantId})).status()).toBe(403);}
  expect((await(await request.get(`/api/rooms/${id}/info`)).json()).waitingClient).toBe(participantId);
  const cancelled=await post(request,cancel,{participantId});expect(cancelled.status()).toBe(200);expect(await cancelled.json()).toEqual({id:participantId});
  expect((await(await request.get(`/api/rooms/${id}/info`)).json()).waitingClient).toBeUndefined();
  expect((await old.get(`/api/rooms/${id}/info`)).status()).toBe(403);expect((await old.get(`/api/rooms/${id}/snapshot`)).status()).toBe(403);
  expect((await post(request,`/api/rooms/${id}/admit`,{participantId})).status()).toBe(403);
  const oldContext=await browser.newContext({storageState:await old.storageState()});
  try{const page=await oldContext.newPage();await page.goto('/api/health');const connected=await page.evaluate(id=>new Promise<boolean>(resolve=>{const socket=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket`);socket.onopen=()=>{socket.close();resolve(true);};socket.onerror=()=>resolve(false);}),id);expect(connected).toBe(false);}finally{await oldContext.close();}
  const freshInvite=await post(request,`/api/rooms/${id}/invites`);expect(freshInvite.status()).toBe(200);const fresh=await freshInvite.json();
  expect((await post(old,'/api/invites/inspect',{token})).status()).toBe(403);
  const joined=await post(replacement,'/api/invites/redeem',{token:fresh.token,nickname:'新等候者',acceptedPolicyVersion:'dev-v1'});expect(joined.status()).toBe(200);const newId=(await joined.json()).participantId;expect(newId).not.toBe(participantId);
  expect((await post(request,cancel,{participantId})).status()).toBe(403);
  expect((await(await request.get(`/api/rooms/${id}/info`)).json()).waitingClient).toBe(newId);
  expect((await post(request,`/api/rooms/${id}/admit`,{participantId:newId})).status()).toBe(200);
  expect((await post(request,cancel,{participantId:newId})).status()).toBe(403);
  expect((await replacement.get(`/api/rooms/${id}/snapshot`)).status()).toBe(200);
  expect((await old.get(`/api/rooms/${id}/info`)).status()).toBe(403);
 }finally{await old.dispose();await replacement.dispose();await stranger.dispose();}
});


test('a waiting client stops polling after the server closes the room',async({request,playwright,browser})=>{
 test.setTimeout(30000);
 await request.post('/__test/login',{data:{name:'therapist'}});
 const created=await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'});expect(created.status()).toBe(200);const {id}=await created.json();
 const invitation=await post(request,`/api/rooms/${id}/invites`);expect(invitation.status()).toBe(200);const {token}=await invitation.json();
 const clientApi=await playwright.request.newContext({baseURL:origin});
 let clientContext:Awaited<ReturnType<typeof browser.newContext>>|undefined;
 try{
  const redeemed=await post(clientApi,'/api/invites/redeem',{token,nickname:'關房輪詢測試'});expect(redeemed.status()).toBe(200);
  const {participantId}=await redeemed.json();clientContext=await browser.newContext({storageState:await clientApi.storageState()});const page=await clientContext.newPage();let infoRequests=0;
  page.on('request',requestEvent=>{if(requestEvent.url()===`${origin}/api/rooms/${id}/info`)infoRequests++;});
  await page.goto(`/?room=${id}`);
  await expect.poll(()=>infoRequests,{timeout:10000}).toBeGreaterThan(0);
  await expect(page.getByRole('status').filter({hasText:'等候治療師確認入房'})).toBeVisible({timeout:10000});
  expect((await post(request,`/api/rooms/${id}/close`)).status()).toBe(200);
  await expect(page.getByRole('status').filter({hasText:'會談已結束'})).toBeVisible({timeout:10000});
  const settledRequests=infoRequests;
  await page.waitForTimeout(2200);
  expect(infoRequests).toBe(settledRequests);
  expect((await (await request.get(`/api/rooms/${id}/info`)).status())).toBe(403);
  expect(participantId).toBeTruthy();
 }finally{await post(request,'/api/rooms/'+id+'/close').catch(()=>{});await clientContext?.close();await clientApi.dispose();}
});

