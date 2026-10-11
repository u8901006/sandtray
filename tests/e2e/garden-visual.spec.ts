import {test,expect,type Page,type Locator} from '@playwright/test';
import {budget} from './budget';
// 2026-10-10 garden-visual-v4: proposals 1-4 render without shader errors, the three tiers and the vegetation switch work,
// and the three guardrails hold: (1) the trays look identical with or without the added vegetation, (2) every tier and
// switch is reachable, (3) the garden is still (no wind animation) so the demand frameloop stops rendering.
const same=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const settle=(page:Page)=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(null))))));
// The box is re-read every round: the viewport now fills the column (2026-10-10, no heading row), so it can still be
// shrinking while the walking controls appear, and a stale clip would capture page content below the canvas.
async function still(page:Page,canvas:Locator){for(let i=0;i<10;i++){const box=(await canvas.boundingBox())!;const a=await page.screenshot({clip:box});await settle(page);const again=(await canvas.boundingBox())!;if(JSON.stringify(again)===JSON.stringify(box)&&same(a,await page.screenshot({clip:box})))return a;}throw new Error('canvas never became still');}
/** Share of clearly green pixels in the lower half of a canvas screenshot (decoded in the page). */
const greenShare=(page:Page,png:Uint8Array)=>page.evaluate<number,string>(async b64=>{const bitmap=await createImageBitmap(await (await fetch('data:image/png;base64,'+b64)).blob());const c=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=c.getContext('2d')!;ctx.drawImage(bitmap,0,0);const {data}=ctx.getImageData(0,Math.floor(bitmap.height/2),bitmap.width,Math.floor(bitmap.height/2));let green=0;for(let i=0;i<data.length;i+=4)if(data[i+1]>data[i]*1.05&&data[i+1]>data[i+2]*1.05)green++;return green/(data.length/4);},Buffer.from(png).toString('base64'));
test('garden tiers, vegetation switch and the sandtray-focus guardrail',async({page},info)=>{
 test.setTimeout(budget(180000));
 const shaderErrors:string[]=[];page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram|VALIDATE_STATUS|GL_INVALID/i.test(m.text()))shaderErrors.push(m.text());});page.on('pageerror',e=>shaderErrors.push(String(e)));
 await page.goto('/');await page.getByRole('button',{name:'走進自然庭園'}).click();
 const ready=()=>expect(page.getByTestId('garden-status')).toHaveText('庭園已準備好',{timeout:90000});await ready();
 await expect(page.getByLabel('庭園畫質').locator('option')).toHaveText(['流暢','細緻','電影（桌機）']);
 const vegetation=page.getByLabel('庭園草木');await expect(vegetation).toBeChecked();
 const canvas=page.locator('canvas');
 // Guardrail 1: the two tray surfaces (sandtray view) are pixel-identical with and without the added vegetation.
 await still(page,canvas);const box=(await canvas.boundingBox())!;
 const trays=[.32,.68].map(fx=>({x:box.x+box.width*fx-30,y:box.y+box.height*.53-20,width:60,height:40}));
 const withPlants=await Promise.all(trays.map(clip=>page.screenshot({clip})));
 await vegetation.uncheck();await still(page,canvas);
 const without=await Promise.all(trays.map(clip=>page.screenshot({clip})));
 trays.forEach((_,i)=>expect(same(withPlants[i],without[i]),'tray '+i+' changed when vegetation toggled').toBe(true));
 await vegetation.check();
 // Proposal 3: the meadow around the stone circle reads green (the old ground was uniformly sandy brown).
 await page.getByRole('button',{name:'前往靜心石庭',exact:true}).click();
 const meadow=await still(page,canvas);await page.screenshot({path:info.outputPath('circle-low.png')});
 expect(await greenShare(page,meadow)).toBeGreaterThan(.35);
 // Proposal 4 + vegetation switch: turning it off removes grass and planting from the walking view.
 await vegetation.uncheck();const bare=await still(page,canvas);expect(same(meadow,bare)).toBe(false);await vegetation.check();
 // Guardrail 2: the cinema tier loads (high-detail GLB, 4096 shadow map) and stays still (guardrail 3: nothing animates).
 await page.getByLabel('庭園畫質').selectOption('cinema');await ready();
 await page.getByRole('button',{name:'前往靜心石庭',exact:true}).click();await still(page,canvas);await page.screenshot({path:info.outputPath('circle-cinema.png')});
 await page.getByLabel('庭園光照').selectOption('evening');await still(page,canvas);
 await page.getByRole('button',{name:'回到沙盤'}).click();await page.getByRole('button',{name:'切回簡約沙盤'}).click();await expect(page.getByTestId('garden-status')).toHaveCount(0);
 expect(shaderErrors).toEqual([]);
});
test('the sky-lit environment is rebuilt after a WebGL context restore',async({page})=>{
 test.setTimeout(budget(120000));const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('/');await page.getByRole('button',{name:'走進自然庭園'}).click();await expect(page.getByTestId('garden-status')).toHaveText('庭園已準備好',{timeout:90000});
 await page.getByRole('button',{name:'前往靜心石庭',exact:true}).click();const canvas=page.locator('canvas');const before=await still(page,canvas);
 await page.evaluate(()=>{const gl=document.querySelector('canvas')!.getContext('webgl2')!;const ext=gl.getExtension('WEBGL_lose_context')!;(window as any).__restore=ext;ext.loseContext();});
 await expect(page.getByRole('alert').filter({hasText:'3D 顯示暫時中斷'})).toBeVisible();
 await page.evaluate(()=>(window as any).__restore.restoreContext());await expect(page.getByRole('alert').filter({hasText:'3D 顯示暫時中斷'})).toHaveCount(0,{timeout:15000});
 // Nudge one frame (restoring pauses exploring input, not the view), then compare: a lost PMREM would render the
 // garden without image-based light, visibly darker than before.
 await page.getByRole('button',{name:'前往靜心石庭',exact:true}).click();const after=await still(page,canvas);
 const mean=(png:Uint8Array)=>page.evaluate<number,string>(async b64=>{const bitmap=await createImageBitmap(await (await fetch('data:image/png;base64,'+b64)).blob());const c=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=c.getContext('2d')!;ctx.drawImage(bitmap,0,0);const {data}=ctx.getImageData(0,0,bitmap.width,bitmap.height);let sum=0;for(let i=0;i<data.length;i+=4)sum+=data[i]+data[i+1]+data[i+2];return sum/(data.length/4*3);},Buffer.from(png).toString('base64'));
 const [a,b]=[await mean(before),await mean(after)];expect(Math.abs(a-b)).toBeLessThan(4);expect(errors).toEqual([]);
});
// GPT-6 review F1 (2026-10-10 20:45): walking obstacles follow what is drawn. data-trees is the count of added trees
// that currently block walking (the walking rule itself is unit-tested in tests/garden-visual.test.ts).
test('added trees block walking only while drawn: switch off, failed load, switch back on',async({page})=>{
 test.setTimeout(budget(150000));
 // One tree model (CommonTree_3, 1 of the 26 planted trees) fails to load; the rest of the garden must still work.
 await page.route('**/imported-assets/megakits-v1/MK_SN_CommonTree_3-*.glb',route=>route.abort());
 await page.goto('/');await page.getByRole('button',{name:'走進自然庭園'}).click();
 const status=page.getByTestId('garden-status');await expect(status).toHaveText('庭園已準備好',{timeout:90000});
 await expect(status).toHaveAttribute('data-trees','25',{timeout:60000});
 const vegetation=page.getByLabel('庭園草木');
 await vegetation.uncheck();await expect(status).toHaveAttribute('data-trees','0');
 await vegetation.check();await expect(status).toHaveAttribute('data-trees','25',{timeout:60000});
 await page.unroute('**/imported-assets/megakits-v1/MK_SN_CommonTree_3-*.glb');
});
