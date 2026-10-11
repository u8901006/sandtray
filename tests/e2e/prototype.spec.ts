import {test,expect} from '@playwright/test';
test('T01 GLB load, selection, translation, rotation, uniform scale and camera isolation',async({page,context},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByRole('heading',{name:'一方沙盤'})).toBeVisible();
 await page.getByRole('button',{name:'● 圓石 練習物件'}).click();
 await page.getByRole('button',{name:'放在中央'}).click();
 await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入');
 await page.getByLabel('左右位置').fill('2');
 await page.getByLabel('物件方向').fill('45');
 await page.getByLabel('物件大小').fill('1.5');
 await page.getByText('位置數值',{exact:true}).click();
 const value=JSON.parse((await page.getByTestId('transform').textContent())!);
 expect(value.position).toEqual([2,0,0]);expect(value.scale).toBe(1.5);expect(value.rotation[1]).toBeCloseTo(Math.sin(Math.PI/8));
 const before=await page.getByTestId('transform').textContent();
 await page.getByRole('button',{name:'俯視',exact:true}).click();
 await page.mouse.move(650,500);await page.mouse.wheel(0,100);
 await expect(page.getByTestId('transform')).toHaveText(before!);
 const other=await context.newPage();await other.goto('/');await expect(other.getByTestId('viewport')).toHaveAttribute('data-items','0');await other.close();
 await page.screenshot({path:testInfo.outputPath('prototype-desktop.png'),fullPage:true});
 await page.reload();await expect(page.getByTestId('viewport')).toHaveAttribute('data-items','0');
 expect(errors).toEqual([]);
});
test('all 3 volumetric GLBs load; removal and re-add release/reacquire resources',async({page},testInfo)=>{
 await page.goto('/');
 for(const name of ['● 圓石 練習物件','⌂ 小屋 練習物件','∩ 拱門 練習物件']){
  await page.getByRole('button',{name}).click();await page.getByRole('button',{name:'放在中央'}).click();await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入');
 }
 await expect(page.getByTestId('viewport')).toHaveAttribute('data-items','3');
 await page.getByRole('button',{name:'移除這件物件'}).click();
 await page.getByRole('button',{name:'∩ 拱門 練習物件'}).click();await page.getByRole('button',{name:'放在中央'}).click();await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入');
 await page.getByLabel('搜尋物件').fill('小屋');await expect(page.locator('.asset-card')).toHaveCount(1);
});
test('tablet viewport: controls remain available; not a real iPad acceptance',async({page},testInfo)=>{
 await page.setViewportSize({width:1024,height:768});await page.goto('/');
 await page.getByRole('button',{name:'⌂ 小屋 練習物件'}).click();await page.getByRole('button',{name:'放在中央'}).click();
 await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入');
 await expect(page.getByLabel('物件大小')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('prototype-tablet.png'),fullPage:true});
});
