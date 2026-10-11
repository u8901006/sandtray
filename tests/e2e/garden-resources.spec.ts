import {test,expect} from '@playwright/test';
import {budget} from './budget';
import {writeFileSync} from 'node:fs';
test('garden GPU allocations return to a stable baseline across repeated visits',async({page},testInfo)=>{
 test.setTimeout(budget(180000));
 await page.addInitScript(()=>{
  const names=['Texture','Buffer','Framebuffer','Renderbuffer','Program'] as const;
  const live=Object.fromEntries(names.map(name=>[name,new Set<object>()]));
  (window as any).__gpuCounts=()=>Object.fromEntries(names.map(name=>[name,live[name].size]));
  const prototype=WebGL2RenderingContext.prototype as any;
  for(const name of names){const create=prototype['create'+name],remove=prototype['delete'+name];prototype['create'+name]=function(...args:any[]){const value=create.apply(this,args);if(value)live[name].add(value);return value;};prototype['delete'+name]=function(value:object){live[name].delete(value);return remove.call(this,value);};}
 });
 await page.goto('/');const samples:Record<string,number>[]=[];
 for(let cycle=0;cycle<3;cycle++){
  await page.getByRole('button',{name:'走進自然庭園'}).click();await expect(page.getByTestId('garden-status')).toHaveText('庭園已準備好',{timeout:60000});await page.getByLabel('庭園光照').selectOption('evening');await page.getByLabel('水面倒影').check();await page.getByRole('button',{name:'探索水岸'}).click();await page.screenshot({path:testInfo.outputPath(`garden-gpu-water-${cycle}.png`)});await page.getByRole('button',{name:'回到沙盤'}).click();await page.getByRole('button',{name:'切回簡約沙盤'}).click();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const counts=await page.evaluate(()=>(window as any).__gpuCounts());samples.push(counts);
  if(cycle>0)await expect.poll(()=>page.evaluate(()=>(window as any).__gpuCounts())).toEqual(samples[0]);
 }
 writeFileSync(testInfo.outputPath('garden-gpu-cycles.json'),JSON.stringify({environment:'Playwright Chromium SwiftShader; allocation counts, not real-device GPU memory',samples},null,2));
});
