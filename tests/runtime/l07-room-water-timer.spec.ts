import {test,expect,type APIRequestContext} from '@playwright/test';
// GPT-6 recheck handoff (2026-10-01), fixed by Claude Opus 5.5: in a room the water slider sends tray.water 200 ms after the last
// change. An undo pressed inside that window used to reach the server first; the late tray.water then became a new history step
// (and cleared redo), so undo appeared to do nothing. The pending level must be sent and ACKed before scene.undo/redo.
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});

test('L07 room water: undo right after a slider change takes back that change, and no late tray.water follows',async({request,playwright,browser})=>{
 await request.post('/__test/login',{data:{name:'therapist'}});
 const room=await(await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json() as {id:string};
 const {token}=await(await post(request,'/api/rooms/'+room.id+'/invites')).json() as {token:string};
 const client=await playwright.request.newContext({baseURL:origin});
 const redeemed=await(await post(client,'/api/invites/redeem',{token})).json() as {participantId:string};
 await post(request,'/api/rooms/'+room.id+'/admit',{participantId:redeemed.participantId});
 const cc=await browser.newContext({storageState:await client.storageState()});
 try{
  const wetWater=async()=>((await(await client.get('/api/rooms/'+room.id+'/snapshot')).json()).trays.find((t:any)=>t.id==='wet').waterLevel) as number;
  const c=await cc.newPage();
  const sent:string[]=[];
  c.on('websocket',ws=>ws.on('framesent',frame=>{try{const m=JSON.parse(String(frame.payload));if(m.type!=='presence.heartbeat')sent.push(m.type);}catch{/* not JSON */}}));
  await c.goto('/?room='+room.id);
  const water=c.getByRole('slider',{name:'濕沙盤水位'});
  const undo=c.getByRole('button',{name:'復原',exact:true}),redo=c.getByRole('button',{name:'重做',exact:true});
  await expect(water).toBeEnabled({timeout:15000});await expect(undo).toBeEnabled();

  // First gesture: 0.3, then a pause longer than the 1.5 s gesture window.
  await water.fill('0.3');await expect.poll(wetWater,{timeout:5000}).toBe(.3);await c.waitForTimeout(1800);
  // Second gesture, undo inside the 200 ms send delay.
  sent.length=0;
  await water.fill('0.6');await undo.click();
  await expect.poll(wetWater,{timeout:5000}).toBe(.3);
  await c.waitForTimeout(1000);
  expect(await wetWater()).toBe(.3);
  expect(sent.filter(t=>t==='tray.water'||t==='scene.undo')).toEqual(['tray.water','scene.undo']);
  await expect(water).toHaveValue('0.3');
  // Redo still holds the undone change (a late tray.water would have cleared it).
  await redo.click();
  await expect.poll(wetWater,{timeout:5000}).toBe(.6);await expect(water).toHaveValue('0.6');
  // A fresh slider change after undo is its own step: undo takes it back to 0.6, not further.
  await c.waitForTimeout(1800);
  await water.fill('0.9');await undo.click();
  await expect.poll(wetWater,{timeout:5000}).toBe(.6);
  await c.waitForTimeout(500);expect(await wetWater()).toBe(.6);
 }finally{await post(request,'/api/rooms/'+room.id+'/close').catch(()=>{});await cc.close();await client.dispose();}
});
