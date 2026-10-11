import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {devAssets,assetById} from '../../packages/asset-catalog/src/index';
const same=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const distinct=devAssets.filter(a=>a.sourcePack&&!a.clips.length&&devAssets.filter(b=>b.name===a.name&&b.category===a.category).length===1).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,100);
for(const kind of ['repeated','distinct','animated'] as const)test(`100 ${kind} imported instances remain operable in the garden`,async({page,browser},testInfo)=>{
 const assets=kind==='animated'?Array.from({length:100},(_,i)=>assetById.get(i<5?'IMP_ULTIMATE_Casual_Female':'IMP_ARENA_tree')!):kind==='repeated'?Array.from({length:100},()=>assetById.get('IMP_ARENA_tree')!):distinct;expect(assets).toHaveLength(100);if(kind==='distinct')expect(new Set(assets.map(a=>a.id)).size).toBe(100);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&/shader|WebGLProgram|VALIDATE_STATUS/i.test(message.text()))errors.push(message.text());});
 await page.goto('/');const samples:number[]=[];const began=performance.now();
 for(const [index,asset] of assets.entries()){
  const start=performance.now();await page.getByRole('button',{name:asset.category,exact:true}).click();await page.getByLabel('搜尋物件').fill(asset.name);
  const item=page.getByRole('button',{name:asset.name+' 已匯入素材',exact:true});await expect(item).toHaveCount(1);await item.click();await page.getByRole('button',{name:'放在中央'}).click();await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入',{timeout:30000});
  await page.getByLabel('左右位置').fill(String((index%10-4.5)*.85));await page.getByLabel('前後位置').fill(String((Math.floor(index/10)-4.5)*.6));await page.getByLabel('物件大小').press('Home');await page.getByLabel('物件大小').press('ArrowRight');samples.push(performance.now()-start);
  if((index+1)%25===0){await expect(page.getByTestId('viewport')).toHaveAttribute('data-items',`${index+1}`);console.log('capacity-progress',kind,index+1);}
 }
 await expect(page.getByTestId('viewport')).toHaveAttribute('data-items','100');await expect.poll(async()=>(await page.locator('.scene-list').boundingBox())!.height).toBeLessThanOrEqual(320);await page.locator('.scene-list').getByRole('button',{name:assets[0].name+' 1',exact:true}).click();await page.locator('.scene-list').getByRole('button',{name:assets[99].name+' 100',exact:true}).click();await page.getByLabel('左右位置').fill('4.1');await expect(page.getByLabel('左右位置')).toHaveValue('4.1');
 const gardenStart=performance.now();await page.getByRole('button',{name:'走進自然庭園'}).click();await expect(page.getByTestId('garden-status')).toHaveText('庭園已準備好',{timeout:60000});const gardenLoadMs=performance.now()-gardenStart;
 await page.getByRole('button',{name:'斜視',exact:true}).click();
 if(kind==='animated'){
  const canvas=page.locator('canvas');
  for(let i=0;i<5;i++){
   await page.locator('.scene-list').getByRole('button',{name:assets[i].name+' '+(i+1),exact:true}).click();
   await page.getByLabel('左右位置').fill(String(-3.4+i*1.7));
   await page.getByLabel('前後位置').fill('2.7');
   await page.getByLabel('物件大小').press('Home');
   for(let step=0;step<7;step++)await page.getByLabel('物件大小').press('ArrowRight');
   await page.getByLabel('角色動作',{exact:true}).selectOption({label:'Walk'});
   await page.getByRole('button',{name:'播放角色動作'}).click();
  }
  const moving=await canvas.screenshot();
  expect(same(moving,await canvas.screenshot({timeout:30000}))).toBe(false);
  for(let i=0;i<5;i++){
   await page.locator('.scene-list').getByRole('button',{name:assets[i].name+' '+(i+1),exact:true}).click();
   await page.getByRole('button',{name:'停止角色動作'}).click();
  }
  const stopped=await canvas.screenshot();
  expect(same(stopped,await canvas.screenshot({timeout:30000}))).toBe(true);
 }
 await page.screenshot({path:testInfo.outputPath('capacity.png'),fullPage:true});expect(errors).toEqual([]);
 const sorted=[...samples].sort((a,b)=>a-b);const report={fixture:kind,instances:100,playbackCommands:kind==='animated'?5:0,uniqueAssets:new Set(assets.map(a=>a.id)).size,browser:browser.version(),renderer:'Chromium SwiftShader; not real-device GPU performance',elapsedAutomationMs:performance.now()-began,placementAndLayoutMedianMs:sorted[50],placementAndLayoutP95Ms:sorted[94],gardenLoadMs,viewport:await page.locator('.viewport').boundingBox(),pageHeight:await page.evaluate(()=>document.documentElement.scrollHeight),errors,assetIds:assets.map(a=>a.id),scope:'Short local capacity fixture only. No 60-minute, 10-room, real-device or formal art acceptance. Animated fixture checks five playback commands, changing rendered pixels and stable pixels after stopping all five; it does not measure FPS.'};
 writeFileSync(testInfo.outputPath('capacity.json'),JSON.stringify(report,null,2)+'\n');
});
