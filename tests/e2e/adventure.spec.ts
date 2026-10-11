import {test,expect} from '@playwright/test';
import {openCategory} from './shelf';
import rows from '../../packages/asset-catalog/src/adventure-v1.json' with {type:'json'};
// 2026-10-10 adventure-v1: every new category is reachable from its shelf group, and a figure, a building, a ruin and a weapon
// load, place and credit CC0. The screenshot shows the displaySize classes side by side (knight 1.6, castle 3.2, sword 1.0).
test('adventure-v1 categories are listed and one model from each kind loads with CC0 provenance',async({page},info)=>{
 await page.goto('/');
 for(const category of new Set(rows.map(r=>r.category))){await openCategory(page,category);await expect(page.getByRole('button',{name:category,exact:true})).toBeVisible();}
 const picks=['AV_ADV_Knight','AV_HEX_castle','AV_RUN_Statue_Fox','AV_WPN_sword'].map(id=>rows.find(r=>r.id===id)!);
 for(const [i,row] of picks.entries()){
  await openCategory(page,row.category);
  await page.getByLabel('搜尋物件').fill(row.name);
  await page.getByRole('button',{name:row.name+' 已匯入素材',exact:true}).click();
  await page.getByRole('button',{name:'放在中央',exact:true}).click();
  await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入');
  await expect(page.getByTestId('provenance')).toContainText('CC0');
  await expect(page.getByTestId('viewport')).toHaveAttribute('data-items',`${i+1}`);
 }
 await page.getByLabel('搜尋物件').fill('');
 await page.screenshot({path:info.outputPath('adventure-tray.png'),fullPage:true});
});
