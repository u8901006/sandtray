import {test,expect} from '@playwright/test';
import {openCategory} from './shelf';
import rows from '../../packages/asset-catalog/src/bits-v1.json' with {type:'json'};
// 2026-10-10 bits-v1: every new category is reachable from its shelf group, and one piece per pack loads, places and credits CC0
// (Holiday included: its licence comes from the itch.io page snapshot). The screenshot shows the pieces side by side.
test('bits-v1 categories are listed and one model from each pack loads with CC0 provenance',async({page},info)=>{
 await page.goto('/');
 for(const category of new Set(rows.map(r=>r.category))){await openCategory(page,category);await expect(page.getByRole('button',{name:category,exact:true})).toBeVisible();}
 const picks:[string,number][]=[['KB_CTY_building_H',-3.4],['KB_SPC_basemodule_dome',-1],['KB_CTY_car_police',0.8],['KB_RST_burger',1.8],['KB_BRD_meeple_red',2.6],['KB_HOL_snowman_B',3.6]];
 for(const [i,[id,x]] of picks.entries()){
  const row=rows.find(r=>r.id===id)!;
  await openCategory(page,row.category);
  await page.getByLabel('搜尋物件').fill(row.name);
  await page.getByRole('button',{name:row.name+' 已匯入素材',exact:true}).click();
  await page.getByRole('button',{name:'放在中央',exact:true}).click();
  await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入');
  await expect(page.getByTestId('provenance')).toContainText('CC0');
  await expect(page.getByTestId('viewport')).toHaveAttribute('data-items',`${i+1}`);
  const field=page.getByLabel('左右位置',{exact:true});
  if(!(await field.isVisible()))await page.getByText('位置數值').click();
  await field.fill(String(x));await field.press('Enter');await expect(field).toHaveValue(String(x));
 }
 await page.getByLabel('搜尋物件').fill('');
 await page.getByRole('button',{name:'斜視',exact:true}).click();
 await page.waitForTimeout(800);
 await page.locator('canvas').first().screenshot({path:info.outputPath('bits-tray.png')});
});
