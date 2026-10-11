import {test,expect} from '@playwright/test';
// 2026-10-10 使用者指示：拿掉沙盤上方「我的小小世界／你的沙盤世界／N 件物件」，沙盤放大；「放置／檢視」工具框可收起，少擋沙盤。
test('no heading above the trays, and the sand-tool box folds to one button that keeps the current tool',async({page})=>{
 await page.goto('/');
 const viewport=page.getByTestId('viewport'),tools=page.getByRole('toolbar',{name:'沙盤工具'});
 await expect(page.getByText('我的小小世界')).toHaveCount(0);await expect(page.getByText('你的沙盤世界')).toHaveCount(0);await expect(page.getByText(/^\d+ 件物件$/)).toHaveCount(0);
 await expect(viewport).toHaveAttribute('data-items','0');
 // The viewport starts right under the garden button now (the heading row used to sit in between).
 const garden=(await page.getByRole('button',{name:'走進自然庭園'}).boundingBox())!,box=(await viewport.boundingBox())!;
 expect(box.y-(garden.y+garden.height)).toBeLessThan(30);
 const open=(await tools.boundingBox())!;
 await page.getByRole('button',{name:'挖沙'}).click();
 await page.getByRole('button',{name:'收起沙盤工具'}).click();
 await expect(page.getByRole('button',{name:'挖沙'})).toHaveCount(0);await expect(page.getByRole('slider',{name:'濕沙盤水位'})).toHaveCount(0);await expect(page.getByTestId('water-hint')).toHaveCount(0);
 const toggle=page.getByRole('button',{name:'展開沙盤工具'});await expect(toggle).toHaveText(/挖沙/);await expect(toggle).toHaveAttribute('aria-expanded','false');
 const folded=(await tools.boundingBox())!;expect(folded.width*folded.height).toBeLessThan(open.width*open.height/4);
 // The folded state is remembered on this device; expanding brings every control and hint back.
 await page.reload();await expect(page.getByRole('button',{name:'展開沙盤工具'})).toBeVisible();
 await page.getByRole('button',{name:'展開沙盤工具'}).click();
 await expect(page.getByRole('button',{name:'放置／檢視'})).toBeVisible();await expect(page.getByRole('slider',{name:'濕沙盤水位'})).toBeVisible();await expect(page.getByTestId('water-hint')).toBeVisible();
 await expect(page.getByRole('button',{name:'收起沙盤工具'})).toHaveAttribute('aria-expanded','true');
});
