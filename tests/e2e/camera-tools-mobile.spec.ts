import {test,expect} from '@playwright/test';
// 2026-10-10 使用者指示：手機寬度下視角按鈕列（6 顆）右側被沙盤邊緣裁切。每顆按鈕都要完整落在沙盤內、可點到，標籤不溢出。
for(const size of [{width:320,height:640},{width:375,height:812},{width:414,height:896},{width:760,height:900}])test(`all view buttons fit inside the tray at ${size.width}x${size.height}`,async({page})=>{
 await page.setViewportSize(size);await page.goto('/');
 const viewport=(await page.getByTestId('viewport').boundingBox())!;
 const buttons=page.getByRole('toolbar',{name:'視角'}).getByRole('button');
 await expect(buttons).toHaveCount(6);
 for(let i=0;i<6;i++){
  const button=buttons.nth(i);await button.scrollIntoViewIfNeeded();
  const box=(await button.boundingBox())!;const name=await button.textContent();const vp=(await page.getByTestId('viewport').boundingBox())!;
  expect(box.x,`${name} left`).toBeGreaterThanOrEqual(vp.x);expect(box.x+box.width,`${name} right`).toBeLessThanOrEqual(vp.x+viewport.width);
  expect(box.height,`${name} touch height`).toBeGreaterThanOrEqual(44);
  expect(await button.evaluate(el=>el.scrollWidth<=el.clientWidth),`${name} label overflow`).toBe(true);
  expect(await button.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}),`${name} hit`).toBe(true);
 }
 await buttons.filter({hasText:'重置視角'}).click(); // 最右一顆實際點得到
});
