import {test,expect} from '@playwright/test';
// 2026-10-03 上線整合：素材分類增加後物件庫變高，桌面版沙盤欄被撐長、雙沙盤落到首屏之外（drag／挖沙 E2E 因此點到視窗外）。
// GPT-6 static review 2026-10-04 A1：補常見筆電尺寸與 761／1100 breakpoint 兩側，並確認畫布中心未被其他元素遮住、寬度在視窗內。
// 本測試覆蓋到桌面高度 720（.viewport min-height 410 加上方標題區約 308 px）；更矮的視窗需捲動。此為測試範圍說明，非產品 AC，最低支援尺寸待使用者裁定。
const sizes=[{width:1440,height:1000},{width:1280,height:800},{width:1366,height:768},{width:1280,height:720},{width:1100,height:800},{width:1101,height:800},{width:761,height:900}];
for(const size of sizes)test(`canvas stays inside the first screen at ${size.width}x${size.height}`,async({page})=>{
 await page.setViewportSize(size);await page.goto('/');
 await expect(page.getByRole('button',{name:'奇幻神話類',exact:true})).toBeVisible(); // 2026-10-09 UX 2：細分類收在大類底下
 const canvas=page.locator('.viewport canvas').first();
 await expect.poll(async()=>(await canvas.boundingBox())?.height??0).toBeGreaterThan(300); // R3F 尚未量測前是預設 150px
 const box=(await canvas.boundingBox())!;
 expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(size.height);
 expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(size.width);
 // 中心與兩個沙盤所在的左右兩側（雙沙盤畫在同一個畫布內）都必須命中這個畫布本身，而不是任何覆蓋元素。
 for(const [fx,fy] of [[0.5,0.5],[0.3,0.6],[0.7,0.6]])expect(await canvas.evaluate((el,[x,y])=>document.elementFromPoint(x,y)===el,[box.x+box.width*fx,box.y+box.height*fy]),`${fx},${fy}`).toBe(true);
});
