import {test,expect,type Page} from '@playwright/test';
// GPT-6 review F2 follow-up (Claude Opus 5.5, 2026-09-30): the pending local water gesture is settled before every history move and
// dropped on a practice-tray reset, so its timer never inserts a late step or clears the redo branch.
const controls=(page:Page)=>({water:page.getByRole('slider',{name:'濕沙盤水位'}),undo:page.getByRole('button',{name:'復原沙盤',exact:true}),redo:page.getByRole('button',{name:'重做沙盤',exact:true})});

test('L07 F2: undo with no new gesture keeps the redo branch after the idle timer',async({page})=>{
 await page.goto('/');const {water,undo,redo}=controls(page);
 await water.fill('0.3');await page.waitForTimeout(1800);
 await undo.click();await expect(water).toHaveValue('0');
 await page.waitForTimeout(1800);
 await expect(redo).toBeEnabled();await redo.click();await expect(water).toHaveValue('0.3');
});

test('L07 F2: resetting the practice trays drops a pending water gesture (no late history step)',async({page})=>{
 await page.goto('/');const {water,undo}=controls(page);
 await water.fill('0.4');
 await page.getByText('練習用沙盤形狀與尺寸').click();await page.getByRole('button',{name:'套用（清空練習沙面）'}).click();
 await expect(water).toHaveValue('0');
 await page.waitForTimeout(1800);
 await expect(undo).toBeDisabled();await expect(water).toHaveValue('0');
});

test('L07 F2: a sand drag right after a water change is undone first, then the water',async({page})=>{
 await page.goto('/');const {water,undo}=controls(page);
 await page.getByRole('button',{name:'聚焦濕沙盤'}).click();
 await water.fill('0.5');
 await page.getByRole('button',{name:'挖沙'}).click();
 const box=(await page.locator('canvas').first().boundingBox())!;
 const x=box.x+box.width/2,y=box.y+box.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.waitForTimeout(250);await page.mouse.move(x+20,y+10);await page.waitForTimeout(250);await page.mouse.up();
 await undo.click();
 // The drag is the newest step: undoing it must leave the water change in place, and the water step must already be in history
 // (not added later by the idle timer, which would also wipe the redo branch). Short timeout: click() would otherwise wait for it.
 await expect(water).toHaveValue('0.5');
 await expect(undo).toBeEnabled({timeout:300});
 await undo.click();await expect(water).toHaveValue('0');
 await expect(undo).toBeDisabled();
 await page.waitForTimeout(1800);
 const {redo}=controls(page);
 await redo.click();await expect(water).toHaveValue('0.5');
 await expect(redo).toBeEnabled({timeout:300});await redo.click();await expect(water).toHaveValue('0.5');
 await expect(redo).toBeDisabled();
});
