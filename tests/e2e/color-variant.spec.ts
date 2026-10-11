import {test,expect} from '@playwright/test';
import {budget} from './budget';
test('approved character exposes all seven skin variants in the inspector',async({page})=>{
 test.setTimeout(budget(90000));
 await page.goto('/');
 await page.getByLabel('搜尋物件').fill('Casual_Male');
 await page.getByRole('button',{name:'Casual_Male 已匯入素材',exact:true}).click();
 await page.getByRole('button',{name:'放在中央'}).click();
 await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入',{timeout:45000});
 const select=page.getByLabel('膚色變體');
 await expect(select).toBeVisible();
 await expect(select.locator('option')).toHaveCount(7);
 await select.selectOption('t6');
 await expect(select).toHaveValue('t6');
});