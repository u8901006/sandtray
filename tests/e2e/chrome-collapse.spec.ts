import {test,expect} from '@playwright/test';
// 2026-10-10 使用者指示：頁首、會談工具、庭園設定與標題可往上收起，畫面盡量只剩沙盤。
for(const size of [{width:1600,height:900},{width:1280,height:720}])test(`collapsing the top panels enlarges the tray at ${size.width}x${size.height}`,async({page})=>{
 await page.setViewportSize(size);await page.goto('/');
 const viewport=page.getByTestId('viewport');const canvas=page.locator('.viewport canvas').first();
 await expect.poll(async()=>(await canvas.boundingBox())?.height??0).toBeGreaterThan(300);
 const before=(await viewport.boundingBox())!;
 await page.getByRole('button',{name:'收起上方面板'}).click();
 await expect(page.locator('header')).toBeHidden();
 await expect(page.getByRole('region',{name:'雙人會談'})).toBeHidden();
 await expect(page.getByRole('button',{name:'走進自然庭園'})).toBeHidden();
 // 2026-10-10: the heading row above the trays is gone in both states (user request), not just hidden here.
 await expect(page.locator('.canvas-heading')).toHaveCount(0);
 await expect(page.getByTestId('chrome-bar')).toBeVisible();
 await expect.poll(async()=>(await viewport.boundingBox())?.height??0).toBeGreaterThan(before.height+150);
 const after=(await viewport.boundingBox())!;
 expect(after.y).toBeLessThan(80);expect(after.y+after.height).toBeLessThanOrEqual(size.height);
 // 畫布跟著變大（R3F 重新量測），中心仍命中畫布本身。
 await expect.poll(async()=>(await canvas.boundingBox())?.height??0).toBeGreaterThan(before.height+150);
 const box=(await canvas.boundingBox())!;
 expect(await canvas.evaluate((el,[x,y])=>document.elementFromPoint(x,y)===el,[box.x+box.width/2,box.y+box.height/2])).toBe(true);
 // 這台裝置記住收起狀態；重新整理後仍收起，再按一次可展開。
 await page.reload();
 await expect(page.locator('header')).toBeHidden();
 await page.getByRole('button',{name:'展開上方面板'}).click();
 await expect(page.locator('header')).toBeVisible();
 await expect(page.getByRole('button',{name:'走進自然庭園'})).toBeVisible();
 await expect(page.getByTestId('chrome-bar')).toHaveCount(0);
});
