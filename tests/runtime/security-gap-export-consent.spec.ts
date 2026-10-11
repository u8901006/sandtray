import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function attach(page:Page,id:string){await page.goto('/');return page.evaluate(id=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket`);w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),id);}
// G2-C2F1 regression (user-decided design, 2026-09-15): export consent is bound to sessionEpoch.
// It SURVIVES a client disconnect (therapist may still export per the given consent) and is
// invalidated when the client reconnects (new sessionEpoch deletes the consent).
test('G2 C2-F1: export consent survives client disconnect and is invalidated on reconnect',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const {id,sceneId}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();
 const {token}=await (await post(request,`/api/rooms/${id}/invites`)).json();
 const clientApi=await playwright.request.newContext({baseURL:origin});
 const redeemed=await (await post(clientApi,'/api/invites/redeem',{token,nickname:'虛構'})).json();
 await post(request,`/api/rooms/${id}/admit`,{participantId:redeemed.participantId});
 const cc=await browser.newContext({storageState:await clientApi.storageState()});
 // C2-F1 concerns the THERAPIST's export: consent checks only bind non-clients (room.ts:73).
 // V8-L12-8：JSON 匯出已取消（使用者裁定 L01-9），同意生命週期改以 PNG 授權驗證；場景未變動，sceneRevision 維持 0
 const exportPng=async(version:string)=>request.post(`/api/scenes/${sceneId}/exports`,{data:{format:'png',consentVersion:version,expectedSceneRevision:0},headers:{Origin:origin}});
 try{
  const c=await cc.newPage();expect(await attach(c,id)).toBe(true);
  expect((await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json()).sceneRevision).toBe(0);
  const consent=(await (await post(clientApi,`/api/rooms/${id}/export-consent`,{formats:['png']})).json()) as {version:string};
  expect((await exportPng(consent.version)).status()).toBe(200);
  // the client itself never needs consent to export (room.ts:73 binds only non-clients)
  expect((await clientApi.post(`/api/scenes/${sceneId}/exports`,{data:{format:'png',consentVersion:consent.version,expectedSceneRevision:0},headers:{Origin:origin}})).status()).toBe(200);
  // client disconnects: server clears grants/leases and bumps controlEpoch, keeps exportConsent
  const controlEpochBefore=((await (await request.get(`/api/rooms/${id}/info`)).json()) as {controlEpoch:number}).controlEpoch;
  await c.evaluate(()=>(window as any).ws.close());
  await expect.poll(async()=>((await (await request.get(`/api/rooms/${id}/info`)).json()) as {controlEpoch:number}).controlEpoch).toBeGreaterThan(controlEpochBefore);
  // designed behavior: the already-given consent still authorizes export while the client is away
  expect((await exportPng(consent.version)).status()).toBe(200);
  // client reconnects: new WS bumps sessionEpoch and deletes the consent
  const c2=await cc.newPage();expect(await attach(c2,id)).toBe(true);
  const rejected=await exportPng(consent.version);
  expect(rejected.status()).toBe(403);
  // the room is healthy: a fresh consent restores normal export
  const consent2=(await (await post(clientApi,`/api/rooms/${id}/export-consent`,{formats:['png']})).json()) as {version:string};
  expect((await exportPng(consent2.version)).status()).toBe(200);
 }finally{await post(clientApi,`/api/rooms/${id}/close`);await cc.close();await clientApi.dispose();}
});
