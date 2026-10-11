import {test,expect,type APIRequestContext,type Locator,type Page} from '@playwright/test';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
// 案主使用教學影片（2026-10-10 使用者指示）：只錄案主這一席，治療師在另一個不錄影的 context 由腳本操作。
// 案主走 ?gate=1 入口（與部署主機相同的邀請畫面）。全程虛構資料、本機 runtime，不碰 staging／production。
// 每段停留時間取自旁白長度（python tools/video/tts.py client），開始秒數寫入 marks.json 供 build-video.py client 對齊。
const origin='http://127.0.0.1:8788';
const out='working/video-client';
const steps=JSON.parse(readFileSync('tools/video/client-narration.json','utf8')) as {id:string;caption:string;say:string}[];
const durations=JSON.parse(readFileSync(out+'/tts/durations.json','utf8')) as Record<string,number>;
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});

const overlayCss=`#guide-caption{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:86%;padding:12px 22px;border-radius:12px;background:rgba(20,24,28,.86);color:#fff;font:600 24px/1.45 "Microsoft JhengHei","Noto Sans TC",sans-serif;text-align:center;z-index:2147483646;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,.35)}
#guide-card{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:linear-gradient(160deg,#f3ead8,#d9c7a3);color:#3b2f22;font-family:"Microsoft JhengHei","Noto Sans TC",sans-serif;z-index:2147483647;pointer-events:none;text-align:center}
#guide-card h1{font-size:54px;margin:0}#guide-card p{font-size:26px;margin:0;line-height:1.6}#guide-card ul{font-size:28px;line-height:1.9;text-align:left;margin:0}
.guide-ring{position:fixed;border:4px solid #ff8a00;border-radius:10px;box-shadow:0 0 0 6px rgba(255,138,0,.28);z-index:2147483645;pointer-events:none;transition:opacity .3s}
.guide-dot{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,138,0,.85);box-shadow:0 0 0 6px rgba(255,138,0,.3);z-index:2147483645;pointer-events:none}`;

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
// 畫布上的拖曳／點擊：用跟著滑鼠移動的橘點標示位置（錄影沒有游標）。
async function dot(page:Page,x:number,y:number){await page.evaluate(([x,y])=>{let d=document.getElementById('guide-dot');if(!d){d=document.createElement('div');d.id='guide-dot';d.className='guide-dot';document.body.append(d);}d.style.left=x+'px';d.style.top=y+'px';},[x,y] as const);}
const undot=(page:Page)=>page.evaluate(()=>document.getElementById('guide-dot')?.remove());
async function drag(page:Page,from:[number,number],to:(i:number)=>[number,number],n=24){
 await dot(page,...from);await page.waitForTimeout(500);await page.mouse.move(...from);await page.mouse.down();
 for(let i=1;i<=n;i++){const p=to(i/n);await page.mouse.move(...p,{steps:2});await dot(page,...p);await page.waitForTimeout(40);}
 await page.mouse.up();await page.waitForTimeout(300);await undot(page);
}

test('client guide video',async({request,browser})=>{
 test.setTimeout(10*60000);
 mkdirSync(out,{recursive:true});
 await expect(await request.post('/__test/login',{data:{name:'therapist'}})).toBeOK();
 const tc=await browser.newContext({storageState:await request.storageState(),viewport:{width:1280,height:720}});
 const cc=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:out+'/raw',size:{width:1280,height:720}}});
 const t=await tc.newPage(),c=await cc.newPage();
 const t0=Date.now();const marks:{id:string;at:number}[]=[];
 t.on('dialog',d=>void d.accept());c.on('dialog',d=>void d.accept());
 const log:string[]=[];for(const [seat,page] of [['T',t],['C',c]] as const){page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')log.push(seat+' console '+m.text());});page.on('response',r=>{if(r.url().includes('.glb')||r.status()>=400)log.push(seat+' '+r.status()+' '+new URL(r.url()).pathname);});}
 let roomId:string|undefined;
 const step=async(id:string,body:()=>Promise<void>=async()=>{})=>{
  const s=steps.find(x=>x.id===id)!;const start=Date.now();marks.push({id,at:(start-t0)/1000});
  if(id!=='intro'&&id!=='outro')await caption(c,s.caption);
  await body();
  const rest=start+(durations[id]??5)*1000+700-Date.now();if(rest>0)await c.waitForTimeout(rest);else log.push(`step ${id} overran by ${-rest} ms`);
 };
 const transform=async()=>c.getByTestId('transform').textContent();
 const canvasBox=async()=>(await c.locator('.viewport canvas').first().boundingBox())!;
 try{
  // 治療師（不錄影）先建好會談與邀請連結。
  await t.goto('/');await t.getByRole('button',{name:'建立虛構資料會談'}).click();await expect(t).toHaveURL(/\?room=/);roomId=new URL(t.url()).searchParams.get('room')!;
  await t.getByRole('button',{name:'產生邀請連結'}).click();const invitation=new URL(await t.getByLabel('邀請連結').inputValue());
  await c.goto('/?gate=1'+invitation.hash);await expect(c.getByRole('button',{name:'進入等候室'})).toBeVisible({timeout:20000});
  await step('intro',async()=>{await card(c,'<h1>線上沙盤 · 案主使用說明</h1><p>打開邀請連結 → 等候入房 → 擺放沙盤 → 離開會談</p><p style="font-size:20px;opacity:.75">不需要帳號 · 示範畫面全程使用虛構資料</p>');});
  await card(c,null);
  await step('invite',async()=>{
   await c.waitForTimeout(2500);const box=c.getByRole('checkbox',{name:/我知道指定治療師看得到作品/});await ring(c,box,1500);await box.check();
   await c.waitForTimeout(1500);await ringClick(c,c.getByRole('button',{name:'進入等候室'}));await expect(c).toHaveURL(/\?room=/,{timeout:20000});
  });
  await step('waiting',async()=>{
   await expect(c.getByText('等候治療師確認入房').first()).toBeVisible({timeout:20000});await c.waitForTimeout(3500);
   const admit=t.getByRole('button',{name:'確認等候者入房'});await expect(admit).toBeVisible({timeout:20000});await admit.click();
   await expect(c.getByRole('button',{name:'離開會談'})).toBeVisible({timeout:20000});
  });
  await step('tour',async()=>{
   await ring(c,c.locator('aside.library'),2500);const box=await canvasBox();
   for(const [x,label] of [[0.3,'乾沙盤'],[0.72,'濕沙盤']] as const){await c.evaluate(([x,y,label])=>{const d=document.createElement('div');d.className='guide-ring';d.textContent=label;Object.assign(d.style,{left:x-70+'px',top:y-26+'px',width:'140px',height:'52px',font:'700 22px/52px "Microsoft JhengHei",sans-serif',textAlign:'center',color:'#fff',background:'rgba(255,138,0,.85)'});document.body.append(d);setTimeout(()=>d.remove(),5200);},[box.x+box.width*x,box.y+box.height*0.25,label] as const);await c.waitForTimeout(2500);}
  });
  // 擺物件：優先用已匯入的真實模型（熊貓），本機沒有私有素材時退回練習物件。
  let objectName='小屋';let placedAt:[number,number]=[0,0];
  await step('pick',async()=>{
   const search=c.getByLabel('搜尋物件');await ring(c,search,700);await search.fill('熊貓');await c.waitForTimeout(800);
   let item=c.getByRole('button',{name:'熊貓 已匯入素材',exact:true});
   if(await item.count())objectName='熊貓';else{await search.fill('小屋');item=c.getByRole('button',{name:'⌂ 小屋 練習物件'});}
   await ringClick(c,item);await c.waitForTimeout(1200);
   const box=await canvasBox();placedAt=[box.x+box.width*0.32,box.y+box.height*0.58];
   await dot(c,...placedAt);await c.waitForTimeout(900);await c.mouse.click(...placedAt);await undot(c);
   await expect(c.getByText('1 件物件',{exact:true})).toBeVisible({timeout:10000}).catch(async()=>{log.push('canvas click placement failed; used 放在中央');await c.getByRole('button',{name:'放在中央'}).click();});
   await expect(c.getByTestId('load-status')).toHaveText('3D 模型已載入',{timeout:45000});
  });
  await step('adjust',async()=>{
   const before=await transform();
   await drag(c,[placedAt[0],placedAt[1]-12],i=>[placedAt[0]+i*90,placedAt[1]-12+i*30],12);
   let after=await transform();if(before===after){log.push('drag move retry from base point');await drag(c,placedAt,i=>[placedAt[0]+i*90,placedAt[1]+i*30],10);after=await transform();}
   log.push('drag move changed transform: '+(before!==after)+' '+after);
   const right=c.getByRole('button',{name:'向右轉 45 度'});await ringClick(c,right);await c.waitForTimeout(600);await right.click();await c.waitForTimeout(600);
   const bigger=c.getByRole('button',{name:'放大物件'});await ringClick(c,bigger);await c.waitForTimeout(600);
   await ring(c,c.getByRole('button',{name:'拿走這件物件'}),1200);
  });
  await step('sand',async()=>{
   await ringClick(c,c.getByRole('button',{name:'聚焦濕沙盤'}));await c.waitForTimeout(1500);
   await ringClick(c,c.getByRole('button',{name:'挖沙'}));
   const box=await canvasBox();const x=box.x+box.width/2-140,y=box.y+box.height/2+20;
   // 按住約一秒才挖得到盤底，水才看得見：每點停 1.2 秒。
   await dot(c,x,y);await c.waitForTimeout(400);await c.mouse.move(x,y);await c.mouse.down();
   for(let i=0;i<=5;i++){const p:[number,number]=[x+i*40,y+(i%2)*12];await c.mouse.move(...p,{steps:3});await dot(c,...p);await c.waitForTimeout(1200);}
   await c.mouse.up();await undot(c);
   await ringClick(c,c.getByRole('button',{name:'堆沙'}));
   await drag(c,[x+20,y-90],i=>[x+20+i*160,y-90],6);
  });
  await step('water',async()=>{
   const slider=c.getByRole('slider',{name:'濕沙盤水位'});
   // 2026-10-10 第二次錄製：挖沙後案主席曾斷線（slider disabled，fill 卡到逾時）。記錄狀態並重新連線，不靜默略過。
   if(!await slider.isEnabled()){log.push('water slider disabled; status='+await c.getByRole('status').first().textContent());const again=c.getByRole('button',{name:'重新連線'});if(await again.count())await again.click();await expect(slider).toBeEnabled({timeout:20000});}
   await ring(c,slider,1000);
   for(const v of ['0.2','0.4','0.6']){await slider.fill(v,{timeout:15000});await c.waitForTimeout(700);}
   await c.waitForTimeout(1500);await ringClick(c,c.getByRole('button',{name:'放置／檢視'}));
  });
  await step('undo',async()=>{
   const undo=c.getByRole('button',{name:'復原',exact:true});await ringClick(c,undo);await c.waitForTimeout(1500);
   await ringClick(c,c.getByRole('button',{name:'重做',exact:true}));
  });
  await step('views',async()=>{
   const bar=c.getByRole('toolbar',{name:'視角'});await ring(c,bar,1200);
   for(const name of ['俯視','盤邊視角']){await ringClick(c,bar.getByRole('button',{name}));await c.waitForTimeout(1100);}
   const box=await canvasBox();const x=box.x+box.width*0.5,y=box.y+box.height*0.15;
   await drag(c,[x,y],i=>[x-i*160,y],8);await c.waitForTimeout(800);
   await ringClick(c,bar.getByRole('button',{name:'斜視'}));
  });
  await step('collapse',async()=>{
   await ringClick(c,c.getByRole('button',{name:'收起上方面板 ▴'}));await c.waitForTimeout(3000);
   await t.getByRole('button',{name:objectName+' 1',exact:true}).click();await t.getByRole('button',{name:'請求操作選中物件'}).click();
   const alert=c.getByRole('button',{name:'治療師請求操作物件'});await expect(alert).toBeVisible({timeout:15000});await c.waitForTimeout(1000);await ringClick(c,alert);
  });
  await step('request',async()=>{
   const agree=c.getByRole('button',{name:'同意上述動作'});await expect(agree).toBeVisible({timeout:10000});
   await ring(c,c.locator('.permission-request'),1800);await ring(c,c.getByRole('button',{name:'拒絕'}),1200);await ringClick(c,agree);
   await expect(t.getByRole('button',{name:'向右轉 45 度'})).toBeEnabled({timeout:15000});
   await t.waitForTimeout(800);await t.getByRole('button',{name:'向右轉 45 度'}).click();
  });
  await step('revoke',async()=>{
   await ringClick(c,c.getByRole('button',{name:'收回全部操作'}));
   await expect(t.getByRole('button',{name:'向右轉 45 度'})).toBeDisabled({timeout:15000}).catch(e=>log.push('revoke check '+String(e).slice(0,200)));
  });
  await step('export',async()=>{
   await ringClick(c,c.getByRole('button',{name:'允許治療師匯出 PNG',exact:true}));
   await expect.poll(async()=>(await(await request.get(`/api/rooms/${roomId}/info`)).json()).exportConsent?.formats??[],{timeout:15000}).toContain('png');
   await c.waitForTimeout(1500);await ring(c,c.getByRole('button',{name:'收回匯出同意'}),1500);
  });
  await step('leave',async()=>{
   await ringClick(c,c.getByRole('button',{name:'離開會談'}));await c.waitForURL(u=>!u.search.includes('room='),{timeout:20000});
   // 本機主機的首頁是練習沙盤；部署主機一律顯示入口畫面，所以改開 ?gate=1 呈現案主實際會看到的畫面。
   await c.goto('/?gate=1');await expect(c.getByTestId('entry-gate')).toBeVisible({timeout:20000});
   await caption(c,'已離開會談；要再進來，請向治療師索取新的邀請連結');
  });
  await step('outro',async()=>{await card(c,'<h1>重點回顧</h1><ul><li>打開邀請連結，同意後進等候室</li><li>沙盤由你決定怎麼擺，沒有標準答案</li><li>治療師要動物件會先問你，你隨時可以收回</li><li>作品在會談結束後從伺服器刪除</li></ul>');});
 }finally{
  writeFileSync(out+'/page-log.txt',log.join('\n')+'\n');
  writeFileSync(out+'/marks.json',JSON.stringify({marks,total:(Date.now()-t0)/1000},null,1)+'\n');
  if(roomId)await post(request,`/api/rooms/${roomId}/close`).catch(()=>{});
  const video=c.video();await cc.close();await tc.close();
  if(video)writeFileSync(out+'/video-path.txt',await video.path());
 }
});
