import {test,expect,type APIRequestContext} from '@playwright/test';
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});

test('admitted client stops /info polling after session revocation closes WS 4003',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const room=await(await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json() as {id:string};
 const invite=await(await post(request,'/api/rooms/'+room.id+'/invites')).json() as {token:string};
 const clientApi=await playwright.request.newContext({baseURL:origin});
 const redeemed=await(await post(clientApi,'/api/invites/redeem',{token:invite.token,nickname:'4003回歸'})).json() as {participantId:string};
 await post(request,'/api/rooms/'+room.id+'/admit',{participantId:redeemed.participantId});
 const clientContext=await browser.newContext({storageState:await clientApi.storageState()});
 const page=await clientContext.newPage();
 const counter={n:0};
 page.on('request',entry=>{if(entry.url()===origin+'/api/rooms/'+room.id+'/info')counter.n++;});
 try{
  await page.goto('/?room='+room.id);
  const sessionStatus=page.locator('.session-tools').getByRole('status');
  await expect(sessionStatus).toContainText('已連線',{timeout:20000});
  expect((await post(clientApi,'/auth/logout')).status()).toBe(204);
  await expect(sessionStatus).toContainText('登入已失效',{timeout:10000});
  // Allow any /info request that was already in flight before the close event
  // to settle; the following observation window must remain flat.
  await page.waitForTimeout(3000);
  const settled=counter.n;
  await page.waitForTimeout(2500);
  expect(counter.n,'admitted 4003 client must not re-enter 1 Hz /info polling').toBe(settled);
 }finally{
  await post(request,'/api/rooms/'+room.id+'/close').catch(()=>{});
  await clientContext.close();
  await clientApi.dispose();
 }
});
