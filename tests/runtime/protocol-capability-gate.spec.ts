import {test,expect,type Page,type BrowserContext} from '@playwright/test';
// L07-2B C4 (Claude Opus 5.5, 2026-09-30; GPT-6 review F1): a client that does not declare the two-tray capability
// (HTTP X-Sandtray-Protocol: 2, or WebSocket subprotocol sandtray.v2) gets 426 UPGRADE_REQUIRED before any state is sent or changed:
// no snapshot body, no socket, no room.snapshot broadcast to the other seat, epochs / objects / trays / revision / receipts unchanged.
// The harness config sends the header for every other test; here the old client overrides it with a wrong value.
const origin='http://127.0.0.1:8788';
const OLD={'X-Sandtray-Protocol':'1'};
async function attach(page:Page,id:string,protocols?:string|string[]){await page.goto('/api/health');return page.evaluate(({id,protocols})=>new Promise<{open:boolean;protocol:string}>(resolve=>{const w=window as any;w.events=[];w.ws=protocols===undefined?new WebSocket(location.origin.replace('http','ws')+'/api/rooms/'+id+'/socket'):new WebSocket(location.origin.replace('http','ws')+'/api/rooms/'+id+'/socket',protocols);w.ws.onmessage=(event:MessageEvent)=>w.events.push(JSON.parse(event.data));w.ws.onopen=()=>resolve({open:true,protocol:w.ws.protocol});w.ws.onerror=()=>resolve({open:false,protocol:''});}),{id,protocols});}
const events=(page:Page)=>page.evaluate(()=>(window as any).events.length as number);

test('L07-2B C4: old single-tray clients get UPGRADE_REQUIRED before any state; v2 clients proceed',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const post=(path:string,data:unknown={})=>request.post(path,{data,headers:{Origin:origin}});
 const room=await(await post('/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json() as {id:string};
 const {token}=await(await post('/api/rooms/'+room.id+'/invites')).json() as {token:string};
 const client=await playwright.request.newContext({baseURL:origin,extraHTTPHeaders:{'X-Sandtray-Protocol':'2'}});
 const redeemed=await(await client.post('/api/invites/redeem',{data:{token},headers:{Origin:origin}})).json() as {participantId:string};
 await post('/api/rooms/'+room.id+'/admit',{participantId:redeemed.participantId});
 const contexts:BrowserContext[]=[];
 try{
  const state=async()=>{const info=await(await client.get('/api/rooms/'+room.id+'/info')).json();const snapshot=await(await client.get('/api/rooms/'+room.id+'/snapshot')).json();const rows=await(await request.get('/__test/room/'+room.id+'/inspect')).json();return {epochs:[info.sessionEpoch,info.controlEpoch],sceneRevision:snapshot.sceneRevision,objects:snapshot.objects,trays:snapshot.trays,rows};};
  // HTML shell is revalidated on every load (C4 c).
  const html=await request.get('/');expect(html.headers()['content-type']).toContain('text/html');expect(html.headers()['cache-control']).toBe('no-cache');

  // 1. HTTP snapshot: missing or wrong capability -> 426, no scene in the body. Auth still comes first (outsider 401, not 426).
  const oldApi=await playwright.request.newContext({baseURL:origin,storageState:await client.storageState()});
  for(const headers of [OLD,{'X-Sandtray-Protocol':''}]){const response=await oldApi.get('/api/rooms/'+room.id+'/snapshot',{headers});expect(response.status()).toBe(426);const body=await response.json();expect(body.code).toBe('UPGRADE_REQUIRED');expect(body.objects).toBeUndefined();expect(body.trays).toBeUndefined();}
  // Header entirely absent: Playwright contexts inherit the config header, so use plain fetch with the client's session cookie.
  const cookie=(await client.storageState()).cookies.map(c=>c.name+'='+c.value).join('; ');
  const bare=await fetch(origin+'/api/rooms/'+room.id+'/snapshot',{headers:{Cookie:cookie}});expect(bare.status).toBe(426);expect(((await bare.json()) as {code:string}).code).toBe('UPGRADE_REQUIRED');
  const anonymous=await playwright.request.newContext({baseURL:origin});expect((await anonymous.get('/api/rooms/'+room.id+'/snapshot',{headers:OLD})).status()).toBe(401);await anonymous.dispose();
  expect((await client.get('/api/rooms/'+room.id+'/snapshot')).status()).toBe(200);

  // 2. The v2 therapist seat is connected by subprotocol only (header overridden to the old value) and sees the negotiated protocol.
  const tc=await browser.newContext({storageState:await request.storageState(),extraHTTPHeaders:OLD});contexts.push(tc);
  const t=await tc.newPage();expect(await attach(t,room.id,'sandtray.v2')).toEqual({open:true,protocol:'sandtray.v2'});
  await expect.poll(()=>t.evaluate(()=>(window as any).events.filter((e:any)=>e.type==='room.snapshot').length)).toBeGreaterThan(0);
  const before=await state();const therapistEvents=await events(t);

  // 3. Old client sockets: no subprotocol, or an unknown one -> refused before the Room DO bumps epochs or broadcasts.
  const oc=await browser.newContext({storageState:await client.storageState(),extraHTTPHeaders:OLD});contexts.push(oc);
  for(const protocols of [undefined,'sandtray.v1']){const o=await oc.newPage();expect(await attach(o,room.id,protocols)).toEqual({open:false,protocol:''});expect(await events(o)).toBe(0);await o.close();}
  await t.waitForTimeout(300);
  expect(await events(t)).toBe(therapistEvents);
  expect(await state()).toEqual(before);

  // 4. The same client upgraded (reload = new bundle, memory-only receipts gone) connects with sandtray.v2 and its operations are accepted.
  const c=await oc.newPage();expect(await attach(c,room.id,['sandtray.v2'])).toEqual({open:true,protocol:'sandtray.v2'});
  const info=await(await client.get('/api/rooms/'+room.id+'/info')).json();
  const operationId=crypto.randomUUID();
  await c.evaluate(cmd=>(window as any).ws.send(JSON.stringify(cmd)),{protocolVersion:1,type:'object.create',operationId,sessionEpoch:info.sessionEpoch,controlEpoch:info.controlEpoch,objectId:'gate-tree',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1}});
  await expect.poll(()=>c.evaluate(op=>(window as any).events.find((e:any)=>e.operationId===op)?.type,operationId)).toBe('operation.ack');
  const after=await(await client.get('/api/rooms/'+room.id+'/snapshot')).json();expect(after.objects.map((o:any)=>o.id)).toEqual(['gate-tree']);expect(after.sceneRevision).toBe(before.sceneRevision+1);
  // Still refused afterwards; the refusal leaves the upgraded client's state alone.
  const settled=await state();const o=await oc.newPage();expect((await attach(o,room.id)).open).toBe(false);await c.waitForTimeout(300);expect(await state()).toEqual(settled);
 }finally{for(const context of contexts)await context.close();await client.dispose();}
});
