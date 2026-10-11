import {test,expect} from '@playwright/test';
import {assetById} from '../../packages/asset-catalog/src/index';
// 2026-10-03 上線整合：staging／production 的物件庫只列 releasable 素材（隱藏 DEV_ 練習模型與 UNVERIFIED）。
const released=assetById.get('IMP_ULTIMATE_Wizard')!;
for(const mode of ['production','staging'] as const)test(`${mode} library hides non-releasable assets and keeps releasable ones`,async({page})=>{
 await page.route('**/api/health',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,mode})}));
 await page.goto('/');
 const search=page.getByLabel('搜尋物件');
 await search.fill(released.name);await expect(page.getByRole('button',{name:released.name+' 已匯入素材',exact:true})).toBeVisible();
 await search.fill('圓石');await expect(page.getByRole('button',{name:'● 圓石 練習物件'})).toHaveCount(0);// exact name: the old /^圓石/ never matched the '● ' glyph prefix
});
test('local mode still lists the DEV practice models',async({page})=>{
 await page.goto('/');
 await page.getByLabel('搜尋物件').fill('圓石');
 await expect(page.getByRole('button',{name:'● 圓石 練習物件'})).toHaveCount(1);
});
