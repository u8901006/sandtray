import {test,expect} from '@playwright/test';
import {roomContext} from './open-panels';
import {assetById} from '../../packages/asset-catalog/src/index';
const origin='http://127.0.0.1:8788';
// T18-B (REQ-018 AC18-1/2/8 in the real UI): inside a room, hash-pinned catalog models are fetched through the
// session-and-room-authorized route, never from the public static copy; 401/403 show sign-in/session-over text.
// G61 (C57 DECISION): the "3D 模型已載入" waits below measure real network+parse+GPU work on multi-MB GLBs —
// a legitimate load can exceed the 5 s default under suite load — so they carry an explicit 45 s budget
// (same style as asset-versions.spec). Stillness checks stay frame-based; the mocked 401/403 texts render
// instantly and keep the default budget.
test('room mode loads catalog models through /api/assets and shows sign-in guidance on 401',async({request,playwright,browser},testInfo)=>{
 test.setTimeout(60000);await request.post('/__test/login',{data:{name:'therapist'}});const post=(path:string,data:unknown={})=>request.post(path,{data,headers:{Origin:origin}});
 const {id}=await(await post('/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();const {token}=await(await post(`/api/rooms/${id}/invites`)).json();const client=await playwright.request.newContext({baseURL:origin});
 const {participantId}=await(await client.post('/api/invites/redeem',{data:{token,nickname:'私有素材虛構案主',acceptedPolicyVersion:'dev-v1'},headers:{Origin:origin}})).json();await post(`/api/rooms/${id}/admit`,{participantId});
 const asset=assetById.get('IMP_ULTIMATE_Casual_Female')!,privatePath=`/api/assets/${asset.id}/${asset.version}/model.glb`;
 const tc=await roomContext(browser,{storageState:await request.storageState()}),cc=await roomContext(browser,{storageState:await client.storageState()});
 try{const t=await tc.newPage(),c=await cc.newPage();
  const glbRequests:{url:string;status:number}[]=[];
  for(const page of [t,c])page.on('response',response=>{if(/\.glb(\?|$)/.test(response.url()))glbRequests.push({url:response.url(),status:response.status()});});
  await t.goto('/?room='+id);await c.goto('/?room='+id);
  await c.getByLabel('搜尋物件').fill('Casual_Female');await c.getByRole('button',{name:'Casual_Female 已匯入素材',exact:true}).click();await c.getByRole('button',{name:'放在中央'}).click();
  await expect(c.getByTestId('load-status')).toHaveText('3D 模型已載入',{timeout:45000});await expect(t.getByTestId('viewport')).toHaveAttribute('data-items','1');await t.getByRole('button',{name:'Casual_Female 1',exact:true}).click();await expect(t.getByTestId('load-status')).toHaveText('3D 模型已載入',{timeout:45000});
  // Both seats fetched the private route with the room bound in the query; nothing touched the public copy.
  const privateHits=glbRequests.filter(r=>r.url.startsWith(origin+privatePath+'?roomId='+id));
  expect(privateHits.length).toBe(2);expect(privateHits.every(r=>r.status===200)).toBe(true);
  expect(glbRequests.filter(r=>r.url.includes('/imported-assets/'))).toEqual([]);
  // A practice (DEV_ONLY) model still comes from its static path: the worker refuses non-releasable ids.
  await c.getByRole('button',{name:'全部物件',exact:true}).click();await c.getByLabel('搜尋物件').fill('圓石');await c.getByRole('button',{name:'● 圓石 練習物件'}).click();await c.getByRole('button',{name:'放在中央'}).click();await expect(c.getByTestId('load-status')).toHaveText('3D 模型已載入',{timeout:45000});
  expect(glbRequests.some(r=>r.url.endsWith('/dev-assets/rock.glb')&&r.status===200)).toBe(true);
  // AC18-8: a 401 on the private route is shown as "sign in again" with a login link and no blind retry button.
  await t.close();// the therapist seat is single-page (409 on a second socket), so the 401/403 page replaces it
  const shadow=await tc.newPage();await shadow.route('**/api/assets/**',route=>route.fulfill({status:401,headers:{'Cache-Control':'private, no-store','Content-Type':'application/json'},body:JSON.stringify({code:'UNAUTHENTICATED'})}));
  await shadow.goto('/?room='+id);await shadow.getByRole('button',{name:'Casual_Female 1',exact:true}).click();
  await expect(shadow.getByTestId('load-status')).toHaveText('登入已失效，請重新登入後再載入模型');
  await expect(shadow.getByRole('link',{name:'重新登入'})).toHaveAttribute('href','/auth/login');await expect(shadow.getByRole('button',{name:'重新載入這件模型'})).toHaveCount(0);
  await shadow.screenshot({path:testInfo.outputPath('private-assets-401-ui.png'),fullPage:true});
  // A 403 (room closed / seat gone) reads as "session over", also without a retry button.
  await shadow.unroute('**/api/assets/**');await shadow.route('**/api/assets/**',route=>route.fulfill({status:403,headers:{'Cache-Control':'private, no-store','Content-Type':'application/json'},body:JSON.stringify({code:'PERMISSION_DENIED'})}));
  await shadow.reload();await shadow.getByRole('button',{name:'Casual_Female 1',exact:true}).click();
  await expect(shadow.getByTestId('load-status')).toHaveText('會談已結束或沒有這件素材的存取資格，作品仍保留');await expect(shadow.getByRole('button',{name:'重新載入這件模型'})).toHaveCount(0);
  // A real revocation: after the therapist closes the room, the same private URL is refused server-side.
  const closed=await post(`/api/rooms/${id}/close`);expect(closed.status()).toBe(200);
  expect((await request.get(privatePath+'?roomId='+id)).status()).toBe(403);
 }finally{await tc.close();await cc.close();await client.dispose();}
});
