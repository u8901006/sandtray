import {test,expect} from '@playwright/test';
import {budget} from './budget';
test('garden retries a failed download and exits safely while a replacement is pending',async({page})=>{
 test.setTimeout(budget(90000));let fail=true;await page.route('**/environments/garden-v3/garden-low.glb',async route=>{if(fail){fail=false;await route.fulfill({status:503,body:'unavailable'});}else await route.continue();});await page.goto('/');await page.getByRole('button',{name:'走進自然庭園'}).click();await expect(page.getByTestId('garden-status')).toContainText('載入失敗');await page.getByRole('button',{name:'重新載入庭園'}).click();await expect(page.getByTestId('garden-status')).toHaveText('庭園已準備好',{timeout:60000});
 let release!:()=>void,reached!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>reached=r);await page.route('**/environments/garden-v3/garden-high.glb',async route=>{reached();await gate;await route.fulfill({status:503,body:'cancelled'}).catch(()=>{});});await page.getByLabel('庭園畫質').selectOption('high');await ready;await page.getByRole('button',{name:'切回簡約沙盤'}).click();release();await expect(page.getByTestId('garden-status')).toHaveCount(0);await expect(page.getByRole('button',{name:'走進自然庭園'})).toBeVisible();
});
test('hidden-page interruption stops audio and movement without automatic resume',async({page})=>{
 test.setTimeout(budget(90000));await page.addInitScript(()=>{const Native=window.Audio;(window as any).__audio=[];window.Audio=function(src?:string){const a=new Native(src);(window as any).__audio.push(a);return a;} as any;});await page.goto('/');await page.getByRole('button',{name:'走進自然庭園'}).click();await expect(page.getByTestId('garden-status')).toHaveText('庭園已準備好',{timeout:60000});await page.getByRole('button',{name:'開啟環境音'}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__audio[0]?.paused)).toBe(false);await page.getByRole('button',{name:'漫步庭園',exact:true}).click();await page.keyboard.down('w');await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.getByRole('button',{name:'開啟環境音'})).toBeVisible();expect(await page.evaluate(()=>(window as any).__audio[0].paused)).toBe(true);const stopped=await page.getByTestId('explore-status').getAttribute('data-pose');await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await page.keyboard.up('w');await expect(page.getByTestId('explore-status')).toHaveAttribute('data-pose',stopped!);expect(await page.evaluate(()=>(window as any).__audio[0].paused)).toBe(true);
});
test('WebGL restoration retains the local work and clears the interrupted display message',async({page})=>{
 test.setTimeout(budget(90000));await page.goto('/');await page.getByRole('button',{name:'● 圓石 練習物件'}).click();await page.getByRole('button',{name:'放在中央'}).click();await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入');await page.getByText('位置數值',{exact:true}).click();const before=await page.getByTestId('transform').textContent();
 const available=await page.evaluate(()=>{const canvas=document.querySelector('canvas')!;const gl=canvas.getContext('webgl2')!;const extension=gl.getExtension('WEBGL_lose_context');(window as any).__restore=extension;extension?.loseContext();return !!extension;});expect(available).toBe(true);await expect(page.getByRole('alert').filter({hasText:'3D 顯示暫時中斷'})).toBeVisible();await page.evaluate(()=>(window as any).__restore.restoreContext());await expect(page.getByRole('alert').filter({hasText:'3D 顯示暫時中斷'})).toHaveCount(0,{timeout:15000});await expect(page.getByTestId('transform')).toHaveText(before!);await expect(page.getByTestId('viewport')).toHaveAttribute('data-items','1');
});
test('exploration leaves browser shortcuts alone and Escape returns to the sandtray',async({page})=>{
 test.setTimeout(budget(90000));await page.goto('/');await page.getByRole('button',{name:'走進自然庭園'}).click();await expect(page.getByTestId('garden-status')).toHaveText('庭園已準備好',{timeout:60000});await page.getByRole('button',{name:'漫步庭園',exact:true}).click();const pose=await page.getByTestId('explore-status').getAttribute('data-pose');await page.keyboard.down('Control');await page.keyboard.down('a');await page.evaluate(async()=>{for(let i=0;i<15;i++)await new Promise(requestAnimationFrame);});await page.keyboard.up('a');await page.keyboard.up('Control');await expect(page.getByTestId('explore-status')).toHaveAttribute('data-pose',pose!);await page.keyboard.press('Escape');await expect(page.getByTestId('explore-status')).toHaveCount(0);await expect(page.getByRole('button',{name:'重置視角'})).toBeVisible();
});

test('stalled garden download reaches a deadline and can be retried',async({page})=>{
 test.setTimeout(budget(120000));
 let release!:()=>void,reached!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve);
 const requested=new Promise<void>(resolve=>reached=resolve);
 await page.route('**/environments/garden-v3/garden-low.glb',async route=>{
  reached();await gate;await route.abort().catch(()=>{});
 });
 await page.goto('/');
 await page.clock.install();
 await page.getByRole('button',{name:'走進自然庭園'}).click();
 await requested;
 await page.clock.fastForward(45001);
 await expect(page.getByTestId('garden-status')).toContainText('載入失敗');
 release();
 await page.unroute('**/environments/garden-v3/garden-low.glb');
 await page.clock.resume();
 await page.getByRole('button',{name:'重新載入庭園'}).click();
 await expect(page.getByTestId('garden-status')).toHaveText('庭園已準備好',{timeout:60000});
});
