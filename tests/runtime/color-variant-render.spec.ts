import {test,expect,type Page} from '@playwright/test';
// V7-G02 (GLM-5.3-flash) per V7-C02 #5: promoted from working/opus-v7c/i02-render.spec.ts (Claude Opus 5.5,
// 2026-09-23). REQ-019 matrix item 4 — the variant must actually change pixels, and changing one clone must not
// change another instance of the same asset (material isolation). Local (non-room) mode, same renderer.
// G59 lesson: locator.screenshot() carries an actionability wait that can hang under load, so the canvas is
// captured via a clip screenshot; the PNG is decoded in-page (img.decode) to avoid adding a dependency.
// V7-C03 A/B (Claude Opus 5.5, 2026-09-24): the runtime default 1280×720 viewport leaves the selected clone
// outside the visible clip, so the diff reads 0 px — an artifact, not a renderer freeze. 1440×1000 keeps both
// clones in frame (t2→t6 right 1,518 px / left 0).
test.use({viewport:{width:1440,height:1000}});
async function shot(page:Page){
 const canvas=page.locator('canvas').first();const box=await canvas.boundingBox();if(!box)throw Error('canvas not visible');
 const buffer=await page.screenshot({clip:box});
 return page.evaluate<{data:number[];w:number;h:number},string>(async base64=>{
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
  const image=new Image();image.src=url;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const context=canvas.getContext('2d')!;context.drawImage(image,0,0);
  const pixels=context.getImageData(0,0,canvas.width,canvas.height);
  URL.revokeObjectURL(url);
  return {data:Array.from(pixels.data),w:pixels.width,h:pixels.height};
 },Buffer.from(buffer).toString('base64'));
}
function diff(a:any,b:any,x0:number,x1:number){let n=0;for(let y=0;y<a.h;y++)for(let x=Math.floor(a.w*x0);x<Math.floor(a.w*x1);x++){const i=(y*a.w+x)*4;if(Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2])>24)n++;}return n;}
async function placeAt(page:Page,x:number){
 await page.getByLabel('搜尋物件').fill('Casual_Male');
 await page.getByRole('button',{name:'Casual_Male 已匯入素材',exact:true}).click();
 await page.getByRole('button',{name:'放在中央'}).click();
 await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入',{timeout:45000});
 await page.getByLabel('左右位置').fill(String(x));await page.getByLabel('左右位置').press('Tab');
}
test('Skin variant changes pixels on the selected clone only',async({page})=>{
 test.setTimeout(120000);
 await page.goto('/');
 await placeAt(page,-2.5);await placeAt(page,2.5);
 // REQ-016 (2026-09-30): both clones stand in the dry tray; focusing it puts them left/right of the canvas centre again.
 await page.getByRole('button',{name:'聚焦乾沙盤'}).click();
 const select=page.getByLabel('膚色變體');await expect(select).toHaveValue('t2');
 await page.screenshot({path:'working/v7g02-render-state.png'});
 await page.mouse.move(5,5);await page.waitForTimeout(1500);const t2=await shot(page);
 await page.waitForTimeout(800);const t2b=await shot(page);
 await select.selectOption('t6');await page.waitForTimeout(1500);const t6=await shot(page);

 await select.selectOption('orig');await page.waitForTimeout(1500);const orig=await shot(page);
 await select.selectOption('t2');await page.waitForTimeout(1500);const back=await shot(page);
 const r={noise:{left:diff(t2,t2b,0,0.5),right:diff(t2,t2b,0.5,1)},t2_t6:{left:diff(t2,t6,0,0.5),right:diff(t2,t6,0.5,1)},t6_orig:{left:diff(t6,orig,0,0.5),right:diff(t6,orig,0.5,1)},t2_back:{left:diff(t2,back,0,0.5),right:diff(t2,back,0.5,1)},size:[t2.w,t2.h]};
 console.log('[render diff px]',JSON.stringify(r));
 expect(r.t2_t6.right,'selected (right) clone changes').toBeGreaterThan(200);
 expect(r.t2_t6.left,'other (left) clone unchanged').toBeLessThanOrEqual(r.noise.left+20);
 expect(r.t6_orig.right).toBeGreaterThan(200);
 expect(r.t2_back.right,'returning to t2 restores pixels').toBeLessThanOrEqual(r.noise.right+20);
});
