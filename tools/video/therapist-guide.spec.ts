import {test,expect,type APIRequestContext,type Locator,type Page} from '@playwright/test';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
// 治療師使用教學影片（2026-10-10 使用者指示）：只錄治療師這一席，案主在另一個不錄影的 context 由腳本操作。
// 全程虛構資料、本機 runtime（/__test/login），不碰 staging／production。每段停留時間取自旁白實際長度
// （tools/video/tts.py 產生 durations.json），並把每段開始秒數寫入 marks.json 讓 build-video.py 對齊音軌。
const origin='http://127.0.0.1:8788';
const out='working/video';
const steps=JSON.parse(readFileSync('tools/video/narration.json','utf8')) as {id:string;caption:string;say:string}[];
const durations=JSON.parse(readFileSync(out+'/tts/durations.json','utf8')) as Record<string,number>;
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});

const overlayCss=`#guide-caption{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:86%;padding:12px 22px;border-radius:12px;background:rgba(20,24,28,.86);color:#fff;font:600 24px/1.45 "Microsoft JhengHei","Noto Sans TC",sans-serif;text-align:center;z-index:2147483646;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,.35)}
#guide-card{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:linear-gradient(160deg,#f3ead8,#d9c7a3);color:#3b2f22;font-family:"Microsoft JhengHei","Noto Sans TC",sans-serif;z-index:2147483647;pointer-events:none;text-align:center}
#guide-card h1{font-size:54px;margin:0}#guide-card p{font-size:26px;margin:0;line-height:1.6}#guide-card ul{font-size:28px;line-height:1.9;text-align:left;margin:0}
.guide-ring{position:fixed;border:4px solid #ff8a00;border-radius:10px;box-shadow:0 0 0 6px rgba(255,138,0,.28);z-index:2147483645;pointer-events:none;transition:opacity .3s}`;

async function caption(page:Page,text:string|null){
 await page.evaluate(([css,text])=>{
  if(!document.getElementById('guide-style')){const s=document.createElement('style');s.id='guide-style';s.textContent=css;document.head.append(s);}
  document.getElementById('guide-caption')?.remove();
  if(text){const d=document.createElement('div');d.id='guide-caption';d.textContent=text;document.body.append(d);}
 },[overlayCss,text] as const);
}
async function card(page:Page,html:string|null){
 await page.evaluate(([css,html])=>{
  if(!document.getElementById('guide-style')){const s=document.createElement('style');s.id='guide-style';s.textContent=css;document.head.append(s);}
  document.getElementById('guide-card')?.remove();
  if(html){const d=document.createElement('div');d.id='guide-card';d.innerHTML=html;document.body.append(d);}
 },[overlayCss,html] as const);
}
// 點擊前先在目標外框畫橘色圈（影片看不到滑鼠），停一下再點。
async function ring(page:Page,target:Locator,holdMs=900){
 await target.scrollIntoViewIfNeeded();const box=await target.boundingBox();if(!box)return;
 await page.evaluate(b=>{const r=document.createElement('div');r.className='guide-ring';Object.assign(r.style,{left:b.x-6+'px',top:b.y-6+'px',width:b.width+12+'px',height:b.height+12+'px'});document.body.append(r);setTimeout(()=>{r.style.opacity='0';setTimeout(()=>r.remove(),400);},2200);},box);
 await page.waitForTimeout(holdMs);
}
const ringClick=async(page:Page,target:Locator)=>{await ring(page,target);await target.click();};

test('therapist guide video',async({request,playwright,browser})=>{
 test.setTimeout(10*60000);
 mkdirSync(out,{recursive:true});
 await expect(await request.post('/__test/login',{data:{name:'therapist'}})).toBeOK();
 const tc=await browser.newContext({storageState:await request.storageState(),viewport:{width:1280,height:720},recordVideo:{dir:out+'/raw',size:{width:1280,height:720}}});
 const cc=await browser.newContext({viewport:{width:1280,height:720}});
 const t=await tc.newPage(),c=await cc.newPage();
 const t0=Date.now();const marks:{id:string;at:number}[]=[];
 t.on('dialog',d=>void d.accept());c.on('dialog',d=>void d.accept());
 const log:string[]=[];for(const [seat,page] of [['T',t],['C',c]] as const){page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')log.push(seat+' console '+m.text());});page.on('response',r=>{if(r.url().includes('.glb')||r.status()>=400)log.push(seat+' '+r.status()+' '+new URL(r.url()).pathname);});}
 let roomId:string|undefined;
 const step=async(id:string,body:()=>Promise<void>=async()=>{})=>{
  const s=steps.find(x=>x.id===id)!;const start=Date.now();marks.push({id,at:(start-t0)/1000});
  if(id!=='intro'&&id!=='outro')await caption(t,s.caption);
  await body();
  const rest=start+(durations[id]??5)*1000+700-Date.now();if(rest>0)await t.waitForTimeout(rest);
 };
 try{
  await t.goto('/');await expect(t.getByRole('button',{name:'建立虛構資料會談'})).toBeEnabled();
  await step('intro',async()=>{await card(t,'<h1>線上沙盤 · 治療師操作教學</h1><p>建立會談 → 邀請案主 → 一起完成沙盤 → 匯出與結束</p><p style="font-size:20px;opacity:.75">示範畫面全程使用虛構資料</p>');});
  await card(t,null);
  await step('home',async()=>{await ring(t,t.getByTestId('invite-hint'),1500);await ringClick(t,t.getByRole('button',{name:'建立虛構資料會談'}));await expect(t).toHaveURL(/\?room=/);roomId=new URL(t.url()).searchParams.get('room')!;});
  let invitation='';
  await step('invite',async()=>{await ringClick(t,t.getByRole('button',{name:'產生邀請連結'}));const field=t.getByLabel('邀請連結');await expect(field).not.toHaveValue('');invitation=await field.inputValue();await ring(t,field,1500);});
  await step('waiting',async()=>{
   await c.goto(invitation);await c.getByRole('checkbox',{name:/我知道指定治療師看得到作品/}).check();await c.getByRole('button',{name:'進入等候室'}).click();await expect(c).toHaveURL(/\?room=/);
   const admit=t.getByRole('button',{name:'確認等候者入房'});await expect(admit).toBeVisible({timeout:20000});await t.waitForTimeout(1200);await ringClick(t,admit);
   await expect(c.getByRole('button',{name:'離開會談'})).toBeVisible({timeout:20000});
  });
  // 案主擺物件：優先用已匯入的真實模型（熊貓），本機沒有私有素材時退回練習物件。
  let objectName='小屋';
  await step('client-places',async()=>{
   await c.getByLabel('搜尋物件').fill('熊貓');const panda=c.getByRole('button',{name:'熊貓 已匯入素材',exact:true});
   if(await panda.count()){objectName='熊貓';await panda.click();}else{await c.getByLabel('搜尋物件').fill('小屋');await c.getByRole('button',{name:'⌂ 小屋 練習物件'}).click();}
   await c.getByRole('button',{name:'放在中央'}).click();await expect(c.getByTestId('load-status')).toHaveText('3D 模型已載入',{timeout:45000});
   await expect(t.getByText('1 件物件',{exact:true})).toBeVisible({timeout:20000});
  });
  await step('client-sand',async()=>{
   await c.getByRole('button',{name:'聚焦濕沙盤'}).click();await c.getByRole('button',{name:'挖沙'}).click();
   const box=(await c.locator('.viewport canvas').first().boundingBox())!;const x=box.x+box.width/2-120,y=box.y+box.height/2+30;
   await c.mouse.move(x,y);await c.mouse.down();for(let i=0;i<24;i++){await c.mouse.move(x+i*10,y+Math.sin(i/3)*20,{steps:2});await c.waitForTimeout(25);}await c.mouse.up();
   await c.getByRole('slider',{name:'濕沙盤水位'}).fill('0.6');
   await ringClick(t,t.getByRole('button',{name:'聚焦濕沙盤'}));
  });
  await step('request',async()=>{
   await ringClick(t,t.getByRole('toolbar',{name:'視角'}).getByRole('button',{name:'斜視'}));await t.waitForTimeout(800);
   await ringClick(t,t.getByRole('button',{name:objectName+' 1',exact:true}));
   await ringClick(t,t.getByRole('button',{name:'請求操作選中物件'}));
   await c.waitForTimeout(2500);await c.getByRole('button',{name:'同意上述動作'}).click();
  });
  await step('granted',async()=>{
   const right=t.getByRole('button',{name:'向右轉 45 度'});await expect(right).toBeEnabled({timeout:15000});
   const info=await(await request.get(`/api/rooms/${roomId}/info`)).json();log.push('grants after consent '+JSON.stringify(info.grants)+' now='+Date.now());
   await ring(t,right);await right.click({timeout:10000});await t.waitForTimeout(800);
   const bigger=t.getByRole('button',{name:'放大物件'});await ring(t,bigger);await bigger.click({timeout:10000});await t.waitForTimeout(800);await bigger.click({timeout:10000}).catch(e=>log.push('second bigger '+String(e).slice(0,200)));
  });
  await step('views',async()=>{const bar=t.getByRole('toolbar',{name:'視角'});await ring(t,bar,1500);for(const name of ['俯視','盤邊視角','聚焦乾沙盤','斜視']){await ringClick(t,bar.getByRole('button',{name}));await t.waitForTimeout(1300);}});
  await step('collapse',async()=>{await ringClick(t,t.getByRole('button',{name:'收起上方面板 ▴'}));await t.waitForTimeout(4500);await ringClick(t,t.getByRole('button',{name:'展開上方面板 ▾'}));});
  await step('export',async()=>{
   await c.getByRole('button',{name:'允許治療師匯出 PNG',exact:true}).click();
   await expect.poll(async()=>(await(await request.get(`/api/rooms/${roomId}/info`)).json()).exportConsent?.formats??[],{timeout:15000}).toContain('png');
   const exportButton=t.getByRole('button',{name:'匯出 PNG',exact:true});await expect(exportButton).toBeEnabled({timeout:20000});
   const download=t.waitForEvent('download',{timeout:20000});await ringClick(t,exportButton);await (await download).saveAs(out+'/sandtray-demo.png');
  });
  await step('revoke',async()=>{await c.getByRole('button',{name:'收回全部操作'}).click();await expect(t.getByRole('button',{name:'向右轉 45 度'})).toBeDisabled({timeout:15000}).catch(()=>{});});
  await step('end',async()=>{await t.waitForTimeout(1500);await ringClick(t,t.getByRole('button',{name:'結束會談並刪除作品'}));await t.waitForURL(u=>!u.search.includes('room='),{timeout:20000});roomId=undefined;await expect(t.getByRole('button',{name:'建立虛構資料會談'})).toBeEnabled({timeout:20000});await caption(t,'會談已結束，作品已從伺服器刪除；回到首頁');});
  await step('outro',async()=>{await card(t,'<h1>重點回顧</h1><ul><li>一次會談一條邀請連結，案主同意後才進等候室</li><li>沙盤由案主主導；治療師動物件要先取得同意</li><li>案主隨時可收回操作權</li><li>要留存就在結束前匯出 PNG（需案主同意）</li></ul>');});
 }finally{
  writeFileSync(out+'/page-log.txt',log.join('\n')+'\n');
  writeFileSync(out+'/marks.json',JSON.stringify({marks,total:(Date.now()-t0)/1000},null,1)+'\n');
  if(roomId)await post(request,`/api/rooms/${roomId}/close`).catch(()=>{});
  const video=t.video();await tc.close();await cc.close();
  if(video)writeFileSync(out+'/video-path.txt',await video.path());
 }
});
