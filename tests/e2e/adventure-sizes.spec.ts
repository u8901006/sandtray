import {test,expect} from '@playwright/test';
import {openCategory} from './shelf';
import rows from '../../packages/asset-catalog/src/adventure-v1.json' with {type:'json'};
// 2026-10-10 adventure-v1 displaySize: a knight (1.6), castle (3.2), sword (1.0) and gold nuggets (0.6) placed side by side at
// scale 1.0. Asserts each places and loads at its own x; the screenshot (adventure-sizes.png) is visual evidence, not a pixel assertion.
test('displaySize classes render at different sizes side by side',async({page},info)=>{
 await page.goto('/');
 const picks:[string,number][]=[['AV_HEX_castle',-3],['AV_ADV_Knight',-0.5],['AV_WPN_sword',1.5],['AV_RES_gold_nuggets',3]];
 for(const [i,[id,x]] of picks.entries()){
  const row=rows.find(r=>r.id===id)!;
  await openCategory(page,row.category);
  await page.getByLabel('搜尋物件').fill(row.name);
  await page.getByRole('button',{name:row.name+' 已匯入素材',exact:true}).click();
  await page.getByRole('button',{name:'放在中央',exact:true}).click();
  await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入');
  await expect(page.getByTestId('viewport')).toHaveAttribute('data-items',`${i+1}`);
  const field=page.getByLabel('左右位置',{exact:true});
  if(!(await field.isVisible()))await page.getByText('位置數值').click();
  await field.fill(String(x));await field.press('Enter');await expect(field).toHaveValue(String(x));
 }
 await page.getByLabel('搜尋物件').fill('');
 await page.getByRole('button',{name:'斜視',exact:true}).click();
 await page.waitForTimeout(800);
 await page.locator('canvas').first().screenshot({path:info.outputPath('adventure-sizes.png')});
});
