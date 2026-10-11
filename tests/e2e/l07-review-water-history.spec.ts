import {test,expect} from '@playwright/test';
// Non-author regression: undo must finalize the pending local water gesture before moving history.
test('L07 review: immediate undo targets the latest water gesture',async({page})=>{
 await page.goto('/');
 const water=page.getByRole('slider',{name:'濕沙盤水位'});
 await water.fill('0.3');await page.waitForTimeout(1800);
 const undo=page.getByRole('button',{name:'復原沙盤',exact:true});
 await expect(undo).toBeEnabled();
 await water.fill('0.6');await undo.click();
 // Correct undo of the second gesture should restore 0.3; the pending timer must not insert a later history step.
 await expect(water).toHaveValue('0.3');
 await page.waitForTimeout(1800);
 await page.getByRole('button',{name:'重做沙盤',exact:true}).click();
 await expect(water).toHaveValue('0.6');
});
