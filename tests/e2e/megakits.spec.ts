import {test,expect} from '@playwright/test';
import {openCategory} from './shelf';
import rows from '../../packages/asset-catalog/src/megakits-v1.json' with {type:'json'};
// 2026-10-06 megakits-v1: every new category is reachable from the library, and one model per pack loads, places and shows its CC0 credit.
test('MegaKit categories are listed and one model from each pack loads with CC0 provenance',async({page},info)=>{
 await page.goto('/');
 for(const category of new Set(rows.map(r=>r.category))){await openCategory(page,category);await expect(page.getByRole('button',{name:category,exact:true})).toBeVisible();}
 const picks=['MK_FP_Anvil','MK_SN_Pine_1','MK_SF_Prop_Barrel_Large','MK_MV_Door_1_Round'].map(id=>rows.find(r=>r.id===id)!);
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
 await page.screenshot({path:info.outputPath('megakits-tray.png'),fullPage:true});
});
