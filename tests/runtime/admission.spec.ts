import {test,expect,type APIRequestContext} from '@playwright/test';
const origin='http://127.0.0.1:8788';
async function login(api:APIRequestContext,name='therapist'){expect((await api.post('/__test/login',{data:{name}})).status()).toBe(200);}
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
test('A01 A14: durable invitation, waiting seat, admission and isolation',async({playwright,request})=>{
 await login(request);const created=await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'});expect(created.status()).toBe(200);const {id}=await created.json();
 const invite=await post(request,`/api/rooms/${id}/invites`);expect(invite.status()).toBe(200);const {token}=await invite.json();
 const client=await playwright.request.newContext({baseURL:origin});const other=await playwright.request.newContext({baseURL:origin});
 try{
  const redeemed=await post(client,'/api/invites/redeem',{token,nickname:'虛構案主'});expect(redeemed.status()).toBe(200);const {participantId}=await redeemed.json();
  expect((await client.get(`/api/rooms/${id}/snapshot`)).status()).toBe(403);
  expect((await post(other,'/api/invites/redeem',{token,nickname:'第三人'})).status()).toBe(403);
  expect((await post(request,`/api/rooms/${id}/admit`,{participantId})).status()).toBe(200);
  const snapshot=await client.get(`/api/rooms/${id}/snapshot`);expect(snapshot.status()).toBe(200);expect((await snapshot.json()).objects).toEqual([]);
  await login(other,'outsider');expect((await other.get(`/api/rooms/${id}/snapshot`)).status()).toBe(403);
  await login(other,'other');expect((await other.get(`/api/rooms/${id}/snapshot`)).status()).toBe(403);
  expect((await request.post(`/api/rooms/${id}/invites`,{data:{},headers:{Origin:'https://evil.example'}})).status()).toBe(403);
  expect((await post(client,'/auth/logout')).status()).toBe(204);expect((await client.get(`/api/rooms/${id}/snapshot`)).status()).toBe(401);
 }finally{await client.dispose();await other.dispose();}
});
test('rotating invitations invalidates old token',async({request,playwright})=>{await login(request);const {id}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();const first=await (await post(request,`/api/rooms/${id}/invites`)).json();const second=await (await post(request,`/api/rooms/${id}/invites`)).json();const client=await playwright.request.newContext({baseURL:origin});try{expect((await post(client,'/api/invites/redeem',{token:first.token,nickname:'測試'})).status()).toBe(403);expect((await post(client,'/api/invites/redeem',{token:second.token,nickname:'測試'})).status()).toBe(200);}finally{await client.dispose();}});
