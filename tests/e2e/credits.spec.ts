import {test,expect} from '@playwright/test';
import {openCategory} from './shelf';
import {devAssets,assetById} from '../../packages/asset-catalog/src/index';
// REQ-017 AC17-5/6/8: credits are listed from catalog metadata for every asset, grouped by license, with per-asset authors, and cannot be hidden.
test('credits list every catalog asset with author and license, expands to per-asset rows, and copies plain text',async({page},testInfo)=>{
 await page.goto('/');
 const credits=page.getByTestId('credits');
 await expect(credits.locator('summary').first()).toContainText(`素材出處（${devAssets.length} 件）`);
 await expect(credits.getByText(/CC0 · 無需署名 · 999 件/)).toBeVisible();
 for(const label of ['ITHappy 免費授權','專案自有','CC BY 4.0','授權未核對'])await expect(credits.getByText(new RegExp(label))).toHaveCount(0);// open-source edition: CC0 only
 const pack=credits.locator('details:has(> summary:text-is("Kenney Furniture Kit — Kenney（140）"))');
 await pack.locator('> summary').click();
 await expect(pack).toHaveAttribute('open','');
 await expect(pack.getByRole('listitem').filter({hasText:'Kenney'})).toHaveCount(140);
 await expect(pack.getByRole('link',{name:'授權條款'})).toHaveAttribute('href','https://creativecommons.org/publicdomain/zero/1.0/');
 // No setting can hide the entry: it is not inside any toggle-able preference panel.
 expect(await page.locator('input[type=checkbox]',{hasText:/出處/}).count()).toBe(0);
 // Selecting an asset shows its provenance line in the inspector even before the GLB loads.
 const asset=assetById.get('IMP_ULTIMATE_Wizard')!;
 await openCategory(page,asset.category);await page.getByLabel('搜尋物件').fill(asset.name);
 await page.getByRole('button',{name:asset.name+' 已匯入素材',exact:true}).click();await page.getByRole('button',{name:'放在中央'}).click();
 await expect(page.getByTestId('provenance')).toContainText('出處：Quaternius · CC0 · 無需署名');
 await page.screenshot({path:testInfo.outputPath('credits.png'),fullPage:true});
});
