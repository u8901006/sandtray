import {test,expect} from '@playwright/test';
// 2026-10-11 使用者指示「沙盤最大化」1–3：拿掉最下方「一方沙盤」那條；上方與兩側面板都收起時沙盤貼邊（無框、無圓角）；
// 高度用 dvh（桌面 Chromium 的 dvh 等於 vh，所以這裡驗「剛好填滿一屏、不必捲動」；iPad 網址列的差別要實機看）。
for(const size of [{width:1366,height:1024},{width:1280,height:720}])test(`with every panel folded the tray fills the screen edge to edge at ${size.width}x${size.height}`,async({page})=>{
 await page.setViewportSize(size);await page.goto('/');
 await expect(page.locator('footer')).toHaveCount(0);
 const viewport=page.getByTestId('viewport'),canvas=page.locator('.viewport canvas').first();
 await expect.poll(async()=>(await canvas.boundingBox())?.height??0).toBeGreaterThan(300);
 // 只收起一部分時沙盤仍有框（貼邊只在全部收起時）
 await page.getByRole('button',{name:'收起上方面板'}).click();
 await expect(viewport).toHaveCSS('border-top-width','1px');
 await page.getByRole('button',{name:'收起物件架'}).click();
 await page.getByRole('button',{name:'收起物件細節'}).click();
 await expect(viewport).toHaveCSS('border-top-width','0px');await expect(viewport).toHaveCSS('border-top-left-radius','0px');
 const library=(await page.locator('aside.library').boundingBox())!,inspector=(await page.locator('aside.inspector').boundingBox())!;
 await expect.poll(async()=>(await viewport.boundingBox())!.height).toBeCloseTo(size.height-104,0);
 const box=(await viewport.boundingBox())!;
 expect(Math.abs(box.x-(library.x+library.width))).toBeLessThanOrEqual(1);
 expect(Math.abs(inspector.x-(box.x+box.width))).toBeLessThanOrEqual(1);
 // 整頁剛好一屏：沙盤下方的提示列也在畫面內，不需要捲動
 expect(await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight)).toBeLessThanOrEqual(0);
 expect((await page.locator('.canvas-footer').boundingBox())!.y+(await page.locator('.canvas-footer').boundingBox())!.height).toBeLessThanOrEqual(size.height+0.5);
 // 3D 畫布跟著長到沙盤大小，中心點命中畫布
 await expect.poll(async()=>(await canvas.boundingBox())?.height??0).toBeGreaterThan(box.height-2);
 const c=(await canvas.boundingBox())!;
 expect(await canvas.evaluate((el,[x,y])=>document.elementFromPoint(x,y)===el,[c.x+c.width/2,c.y+c.height/2])).toBe(true);
 // 展開一側面板：恢復有框
 await page.getByRole('button',{name:'展開物件細節'}).click();
 await expect(viewport).toHaveCSS('border-top-width','1px');
});
