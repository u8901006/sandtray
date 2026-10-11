import {test,expect} from '@playwright/test';
import {budget} from './budget';
for(const width of [1280,390])test(`garden focus preserves work and restores editing at ${width}px`,async({page},testInfo)=>{
 test.setTimeout(budget(90000));await page.goto('/');
 await page.getByRole('button',{name:'● 圓石 練習物件'}).click();await page.getByRole('button',{name:'放在中央'}).click();await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入');
 const transform=await page.getByTestId('transform').textContent();await page.setViewportSize({width,height:900});
 await page.getByRole('button',{name:'走進自然庭園'}).click();await expect(page.getByTestId('garden-status')).toHaveText('庭園已準備好',{timeout:60000});await page.getByRole('button',{name:'探索木屋'}).click();
 const canvas=page.locator('canvas');const before=(await canvas.boundingBox())!.width;
 await expect(page.getByRole('button',{name:'放大探索畫面'})).toBeVisible();await page.getByRole('button',{name:'放大探索畫面'}).click();await expect(page.locator('.workspace')).toHaveClass(/garden-focused/);
 await expect(page.getByLabel('庭園光照')).toBeHidden();await page.getByRole('button',{name:'顯示庭園設定'}).click();await expect(page.getByLabel('庭園光照')).toBeVisible();await page.getByLabel('庭園光照').selectOption('sunset');await page.getByRole('button',{name:'收起庭園設定'}).click();await expect(page.getByLabel('庭園光照')).toBeHidden();
 await expect(page.locator('.library')).toBeHidden();await expect(page.locator('.inspector')).toBeHidden();await expect(page.getByLabel('自然庭園設定')).toBeVisible();
 if(width>760)await expect.poll(async()=>(await canvas.boundingBox())!.width).toBeGreaterThan(before+200);
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath(`garden-focused-${width}.png`),fullPage:true});
 await page.getByRole('button',{name:'還原探索畫面'}).click();await expect(page.locator('.workspace')).not.toHaveClass(/garden-focused/);
 await page.getByRole('button',{name:'放大探索畫面'}).click();await page.keyboard.press('Escape');await expect(page.getByTestId('explore-status')).toHaveCount(0);await expect(page.locator('.workspace')).not.toHaveClass(/garden-focused/);
 await expect(page.getByTestId('transform')).toHaveText(transform!);await expect(page.getByTestId('viewport')).toHaveAttribute('data-items','1');
 await page.getByRole('button',{name:'探索木屋'}).click();await expect(page.getByRole('button',{name:'放大探索畫面'})).toBeVisible();
});
