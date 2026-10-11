import {test,expect} from '@playwright/test';
test('failed models retry independently without deleting or moving either object',async({page})=>{
 let fail=true;await page.route('**/dev-assets/rock.glb',route=>fail?route.fulfill({status:503,body:'temporarily unavailable'}):route.continue());await page.goto('/');
 for(let i=0;i<2;i++){await page.getByRole('button',{name:'● 圓石 練習物件'}).click();await page.getByRole('button',{name:'放在中央'}).click();await expect(page.getByTestId('load-status')).toContainText('載入失敗');}
 await page.getByRole('button',{name:'圓石 1',exact:true}).click();await page.getByLabel('左右位置').fill('1.2');await page.getByText('位置數值',{exact:true}).click();const before=await page.getByTestId('transform').textContent();fail=false;await page.getByRole('button',{name:'重新載入這件模型'}).click();await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入');await expect(page.getByTestId('transform')).toHaveText(before!);await expect(page.getByTestId('viewport')).toHaveAttribute('data-items','2');
 await page.getByRole('button',{name:'圓石 2',exact:true}).click();await expect(page.getByTestId('load-status')).toContainText('載入失敗');await page.getByRole('button',{name:'重新載入這件模型'}).click();await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入');await expect(page.getByTestId('viewport')).toHaveAttribute('data-items','2');
});
