import {test,expect} from '@playwright/test';
// 2026-09-28 staging regression (Claude Opus 5.5, user report "有些物件沒有正確顯示顏色"): GLTFLoader decodes a GLB's
// embedded textures by fetch()ing blob: URLs. The deployed CSP had connect-src 'self', so every textured imported
// model (e.g. Kenney character-soldier) rendered untextured white while the load status still said loaded.
// The runtime Worker sets the same CSP header as staging (run_worker_first), so this reproduces it locally.
test('textured imported models load their embedded textures under the deployed CSP',async({page})=>{
 test.setTimeout(60000);
 const problems:string[]=[];
 page.on('console',message=>{const text=message.text();if(/Content Security Policy|Couldn't load texture/.test(text))problems.push(text.slice(0,160));});
 page.on('pageerror',error=>{if(/Content Security Policy|Couldn't load texture/.test(error.message))problems.push(error.message.slice(0,160));});
 const response=await page.goto('/');
 expect(response?.headers()['content-security-policy']).toContain("connect-src 'self' blob:");
 await page.getByLabel('搜尋物件').fill('character-soldier');
 await page.locator('.asset-card',{hasText:'character-soldier'}).first().click();
 await page.getByRole('button',{name:'放在中央'}).click();
 await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入',{timeout:30000});
 await page.waitForTimeout(1500);
 expect(problems).toEqual([]);
});
