import {test,expect} from '@playwright/test';
import {openCategory} from './shelf';
import {budget} from './budget';
import rows from '../../packages/asset-catalog/src/adventure-v1.json' with {type:'json'};
const same=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
// GPT-6 review 2026-10-10 (NEEDS_EVIDENCE): the 行走 / 倒下 clips merged from Rig_Medium actually play on a placed adventure-v1
// figure and stop again. Stillness uses the imported.spec frame-pair method (two live captures two rendered frames apart).
const stillPair=async(page:import('@playwright/test').Page,box:NonNullable<Awaited<ReturnType<import('@playwright/test').Locator['boundingBox']>>>)=>{const a=await page.screenshot({clip:box});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(null)))));return same(a,await page.screenshot({clip:box}));};
const waitStill=async(page:import('@playwright/test').Page,canvas:import('@playwright/test').Locator,pairs=8)=>{const box=await canvas.boundingBox();if(!box)throw new Error('canvas not visible');for(let i=1;i<=pairs;i++){if(await stillPair(page,box))return;}throw new Error(`canvas not still after ${pairs} frame-pair observations`);};
test('an adventure-v1 figure plays 行走 and 倒下 and stops',async({page},info)=>{
 test.setTimeout(budget(60000));await page.goto('/');
 const knight=rows.find(r=>r.id==='AV_ADV_Knight')!;
 expect(knight.clips.map(c=>c.name)).toEqual(['待機','行走','倒下']);
 await openCategory(page,knight.category);await page.getByLabel('搜尋物件').fill(knight.name);
 await page.getByRole('button',{name:knight.name+' 已匯入素材',exact:true}).click();await page.getByRole('button',{name:'放在中央',exact:true}).click();
 await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入');
 const canvas=page.locator('canvas');await waitStill(page,canvas);const box=(await canvas.boundingBox())!;
 for(const clip of ['行走','倒下']){
  const before=await page.screenshot({clip:box});
  await page.getByLabel('角色動作',{exact:true}).selectOption({label:clip});await page.getByRole('button',{name:'播放角色動作'}).click();
  for(let i=1;i<=8;i++){if(!same(before,await page.screenshot({clip:box})))break;if(i===8)throw new Error(clip+': no rendered frame differed from the pre-play baseline after 8 captures');}
  await page.screenshot({path:info.outputPath(`knight-${clip==='行走'?'walk':'fall'}.png`),fullPage:true});
  await page.getByRole('button',{name:'停止角色動作'}).click();await waitStill(page,canvas);
 }
});
