import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
const del=(api:APIRequestContext,path:string)=>api.delete(path,{headers:{Origin:origin}});
async function attach(page:Page,id:string){await page.goto('/');return page.evaluate(id=>new Promise<boolean>(resolve=>{const w=window as any;w.events=[];w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket`);w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);}),id);}
async function info(page:Page,id:string):Promise<{sessionEpoch:number;controlEpoch:number}>{return page.evaluate(async id=>(await fetch(`/api/rooms/${id}/info`)).json(),id);}
async function send(page:Page,id:string,input:Record<string,unknown>){const state=await info(page,id);const operationId=(input.operationId as string)??crypto.randomUUID();await page.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),{protocolVersion:1,operationId,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...input});await expect.poll(()=>page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId),{timeout:5000}).toBeTruthy();return page.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op),operationId);}
// G23 / C5 #20（v5）：security-gap-cross-clinic.spec.ts 已覆蓋房間 info／snapshot／export／version／WS；
// 未覆蓋的跨診所面是 scene-coordinator 端點（management／backups 列舉與 recover／刪除）與
// 未認證的 invite 端點。clinic-b 治療師對 clinic-a 識別字的所有路徑都必須 server-side 拒絕，
// 且被誤址的 coordinator DO（clinic-b:<clinic-a scene>）不得留下任何狀態（writer／deletion／
// scene_rooms 全空）——以儲存狀態為證，不只看狀態碼；原房 snapshot 不受探測影響。
test('G23: clinic-b therapist is denied clinic-a scene management, backups, deletion and invite surfaces without leaving coordinator state',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const {id,sceneId}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();
 // Create the D1 tables /api/scenes and tombstone-inspect read; targeted runs must not depend on other specs' residue.
 expect((await post(request,'/__test/migrate')).status()).toBe(200);
 expect((await post(request,`/__test/room/${id}/deletion-init`,{participantId:'therapist'})).status()).toBe(200);
 const {token}=await (await post(request,`/api/rooms/${id}/invites`)).json();
 const clientApi=await playwright.request.newContext({baseURL:origin});
 const redeemed=await (await post(clientApi,'/api/invites/redeem',{token,nickname:'虛構'})).json();
 await post(request,`/api/rooms/${id}/admit`,{participantId:redeemed.participantId});
 const outsiderApi=await playwright.request.newContext({baseURL:origin});
 await (await outsiderApi.post('/__test/login',{data:{name:'outsider'}})).status();
 const cc=await browser.newContext({storageState:await clientApi.storageState()});
 try{
  const c=await cc.newPage();expect(await attach(c,id)).toBe(true);
  expect((await send(c,id,{type:'object.create',objectId:'g23-cross-rock',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1}})).type).toBe('operation.ack');
  // scene-coordinator surface: every path denies the clinic-b session before any state is written
  expect((await outsiderApi.get(`/api/scenes/${sceneId}/management`)).status()).toBe(403);
  expect((await outsiderApi.get(`/api/scenes/${sceneId}/backups`)).status()).toBe(403);
  expect((await post(outsiderApi,`/api/scenes/${sceneId}/backups/fake-backup/recover`,{})).status()).toBe(403);
  expect((await outsiderApi.get(`/api/scenes/${sceneId}/deletion`)).status()).toBe(403);
  expect((await del(outsiderApi,`/api/scenes/${sceneId}`)).status()).toBe(403);
  // saved-scene listing is clinic+owner scoped: clinic-a's scene never appears for clinic-b
  // V8-L12-3：保存作品列表已移除；management／backups／deletion 也都已移除，任何人一律 403（上方斷言仍成立）
  expect((await outsiderApi.get('/api/scenes')).status()).toBe(403);
  // invite surface: minting invites for clinic-a's room, inspecting and redeeming with wrong secrets are denied
  expect((await post(outsiderApi,`/api/rooms/${id}/invites`,{})).status()).toBe(403);
  expect((await post(outsiderApi,'/api/invites/inspect',{token:`${id}.${'x'.repeat(24)}`})).status()).toBe(403);
  expect((await post(outsiderApi,'/api/invites/redeem',{token:`${id}.${'x'.repeat(24)}`,nickname:'虛構',acceptedPolicyVersion:'dev-v1'})).status()).toBe(403);
  // state evidence: the mis-addressed coordinator DO (clinic-b:<clinic-a scene>) holds nothing after the probes
  const stray=await (await outsiderApi.get(`/__test/scene/${sceneId}/tombstone-inspect?clinic=clinic-b`)).json();
  expect(stray.tombstone).toBeNull();
  expect(stray.coordinator).toMatchObject({deletionRows:0,writerRows:0,sceneRooms:0,alarm:null});
  // the clinic-a room is untouched and still fully usable by its own participants
  const snap=await (await clientApi.get(`/api/rooms/${id}/snapshot`)).json();
  expect(snap.sceneRevision).toBe(1);expect(snap.objects.map((o:any)=>o.id)).toEqual(['g23-cross-rock']);
 }finally{await post(request,`/api/rooms/${id}/close`);await cc.close();await clientApi.dispose();await outsiderApi.dispose();}
});
