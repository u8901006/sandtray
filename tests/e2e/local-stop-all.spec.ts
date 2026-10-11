import {test,expect} from '@playwright/test';
import {budget} from './budget';
const same=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
// C54 (G56): same stale-baseline family as imported.spec — judge stillness on two live screenshots two animation frames apart.
// G59 (C56): capture via page.screenshot({clip}) (no locator actionability wait — G59 diag caught a 55s "element to be stable"
// wedge while playing) and budget by frame-pair observations, not expect.poll seconds.
const stillPair=async(page:import('@playwright/test').Page,box:NonNullable<Awaited<ReturnType<import('@playwright/test').Locator['boundingBox']>>>)=>{const a=await page.screenshot({clip:box});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(null)))));return same(a,await page.screenshot({clip:box}));};
const waitStill=async(page:import('@playwright/test').Page,canvas:import('@playwright/test').Locator,pairs=8)=>{const box=await canvas.boundingBox();if(!box)throw new Error('canvas not visible');for(let i=1;i<=pairs;i++){if(await stillPair(page,box))return;}throw new Error(`canvas not still after ${pairs} frame-pair observations (each pair separated by two rendered frames)`);};
test('local stop all remains available with a static object selected and preserves the work',async({page})=>{
 test.setTimeout(budget(90000));await page.goto('/');
 await page.getByLabel('搜尋物件').fill('Casual_Female');
 for(let i=0;i<2;i++){
  await page.getByRole('button',{name:'Casual_Female 已匯入素材',exact:true}).click();
  await page.getByRole('button',{name:'放在中央'}).click();
  await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入');
  await page.getByLabel('左右位置').fill(String(-2+i*4));
  await page.getByLabel('角色動作',{exact:true}).selectOption({label:'Walk'});
  await page.getByRole('button',{name:'播放角色動作'}).click();
 }
 await page.getByLabel('搜尋物件').fill('圓石');
 await page.getByRole('button',{name:'● 圓石 練習物件'}).click();
 await page.getByRole('button',{name:'放在中央'}).click();
 await page.getByText('位置數值',{exact:true}).click();const position=await page.getByTestId('transform').textContent();
 await page.getByRole('button',{name:'停止所有動作',exact:true}).click({timeout:5000});
 await expect(page.getByRole('button',{name:'停止所有動作',exact:true})).toHaveCount(0);
 await expect(page.getByTestId('viewport')).toHaveAttribute('data-items','3');
 await expect(page.getByTestId('transform')).toHaveText(position!);
 const canvas=page.locator('canvas');await waitStill(page,canvas);
});
