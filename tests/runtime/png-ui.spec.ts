import {test,expect} from '@playwright/test';
import {roomContext} from './open-panels';
import {readFile} from 'node:fs/promises';
const origin='http://127.0.0.1:8788';
test('A14 PNG is a rendered image and export is refused without the client PNG consent',async({request,playwright,browser})=>{
 test.setTimeout(60000);
 const post=(api:typeof request,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
 await request.post('/__test/login',{data:{name:'therapist'}});
 const {id}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();
 const {token}=await (await post(request,`/api/rooms/${id}/invites`)).json();
 const clientApi=await playwright.request.newContext({baseURL:origin});
 const {participantId}=await (await post(clientApi,'/api/invites/redeem',{token,nickname:'PNG虛構'})).json();
 await post(request,`/api/rooms/${id}/admit`,{participantId});
 const tc=await roomContext(browser,{storageState:await request.storageState()}),cc=await roomContext(browser,{storageState:await clientApi.storageState()});
 try{
  const t=await tc.newPage(),c=await cc.newPage();await t.goto(`/?room=${id}`);await c.goto(`/?room=${id}`);
  await c.getByRole('button',{name:'● 圓石 練習物件'}).click();await c.getByRole('button',{name:'放在中央'}).click();
  await expect(c.getByTestId('load-status')).toHaveText('3D 模型已載入');await expect(t.getByTestId('viewport')).toHaveAttribute('data-items','1');
  const downloads:string[]=[];t.on('download',d=>downloads.push(d.suggestedFilename()));
  // V8-L12-8：JSON 同意已隨 JSON 匯出移除（使用者裁定 L01-9）；改驗「案主尚未同意任何匯出」時 PNG 被拒
  await expect(c.getByRole('button',{name:/JSON/})).toHaveCount(0);
  await t.getByRole('button',{name:'匯出 PNG',exact:true}).click();await expect(t.getByRole('alert')).toContainText('PERMISSION_DENIED');expect(downloads).toEqual([]);
  // A reload starts a new session epoch and intentionally invalidates export consent.
  // Wait for the connected therapist's regular refresh to observe this consent instead.
  const consentRefresh=t.waitForResponse(async response=>response.url().endsWith('/api/rooms/'+id+'/info')&&response.ok()&&(await response.json()).exportConsent?.formats.includes('png'),{timeout:15000});
  await c.getByRole('button',{name:'允許治療師匯出 PNG',exact:true}).click();
  await expect.poll(async()=>{const info=await(await request.get(`/api/rooms/${id}/info`)).json();return info.exportConsent?.formats;}).toContain('png');
  await consentRefresh;await expect(t.getByRole('button',{name:'匯出 PNG',exact:true})).toBeEnabled();
  await t.getByRole('button',{name:'圓石 1',exact:true}).click();await expect(t.getByTestId('load-status')).toHaveText('3D 模型已載入');
  // REQ-017 AC17-7: the PNG is accompanied by sandtray-credits.txt naming every placed asset's author and license.
  const downloadPromise=t.waitForEvent('download',{timeout:15000});const creditsPromise=t.waitForEvent('download',{predicate:d=>d.suggestedFilename()==='sandtray-credits.txt',timeout:15000});
  await t.getByRole('button',{name:'匯出 PNG',exact:true}).click();const download=await downloadPromise;const creditsDownload=await creditsPromise;
  const bytes=await readFile((await download.path())!);expect([...bytes.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
  const creditsBody=await readFile((await creditsDownload.path())!,'utf8');expect(creditsBody).toContain('圓石');expect(creditsBody).toContain('作者：');
  const decoded=await t.evaluate(async(base64)=>{
   const data=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const bitmap=await createImageBitmap(new Blob([data],{type:'image/png'}));
   const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);
   const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let varied=false;for(let i=4;i<pixels.length;i+=4){if(pixels[i]!==pixels[0]||pixels[i+1]!==pixels[1]||pixels[i+2]!==pixels[2]){varied=true;break;}}
   bitmap.close();return {width:canvas.width,height:canvas.height,varied};
  },btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')));
  expect(decoded.width).toBeGreaterThan(100);expect(decoded.height).toBeGreaterThan(100);expect(decoded.varied).toBe(true);
  await c.getByRole('button',{name:'收回匯出同意',exact:true}).click();
  await expect.poll(async()=>{const info=await(await request.get(`/api/rooms/${id}/info`)).json();return info.exportConsent?.formats??[];}).toEqual([]);
  await t.getByRole('button',{name:'匯出 PNG',exact:true}).click();await expect(t.getByRole('alert')).toContainText('PERMISSION_DENIED');expect(downloads).toEqual(['sandtray.png','sandtray-credits.txt']);
 }finally{await tc.close();await cc.close();await clientApi.dispose();}
});

