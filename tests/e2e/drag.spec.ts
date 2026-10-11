import {test,expect} from '@playwright/test';
import {PerspectiveCamera,Vector3} from 'three';
import {TRAY_OFFSET_X,cameraPosition} from '../../apps/web/src/tray-layout';
// REQ-016 (2026-09-30): two trays side by side; the default camera and the dry tray centre moved (was camera 9,10,11 and object at x 0).
async function setup(page:any) {
 await page.goto('/');await page.getByRole('button',{name:'⌂ 小屋 練習物件'}).click();await page.getByRole('button',{name:'放在中央'}).click();
 await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入');
 await page.getByText('位置數值',{exact:true}).click();
 const box=await page.locator('canvas').boundingBox();
 const camera=new PerspectiveCamera(42,box.width/box.height,0.1,1000);camera.position.set(...cameraPosition('angle',box.width/box.height));camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const projected=new Vector3(TRAY_OFFSET_X.dry,0.85,0).project(camera);
 return {x:box.x+(projected.x+1)*box.width/2,y:box.y+(1-projected.y)*box.height/2};
}
test('direct pointer drag changes selected model position',async({page})=>{
 const point=await setup(page);
 await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+65,point.y+10,{steps:12});await page.mouse.up();
 const state=JSON.parse((await page.getByTestId('transform').textContent())!);
 expect(Math.abs(state.position[0])+Math.abs(state.position[2])).toBeGreaterThan(0.2);
 expect(state.scale).toBe(1);
});
test('second touch cancels object drag and pinch never scales the model',async({page,context})=>{
 const point=await setup(page);const original=await page.getByTestId('transform').textContent();
 const cdp=await context.newCDPSession(page);
 await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:point.x,y:point.y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:point.x+15,y:point.y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:point.x+15,y:point.y},{id:2,x:point.x-80,y:point.y+60}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:point.x+45,y:point.y},{id:2,x:point.x-110,y:point.y+60}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(page.getByTestId('transform')).toHaveText(original!);
});
test('dragging an object onto a dune lifts it onto the sand (GPT-6.1 SOL review 2026-10-05)',async({page})=>{
 test.setTimeout(150000);const point=await setup(page);
 // Build a wide dune to the right of the object, then drag the object onto it.
 await page.getByRole('button',{name:'堆沙'}).click();
 for(let pass=0;pass<3;pass++)for(const dy of [-15,10,35]){
  await page.mouse.move(point.x+75,point.y+dy);await page.mouse.down();
  for(let k=0;k<=12;k++){await page.mouse.move(point.x+75+k*6,point.y+dy+(k%2)*4);await page.waitForTimeout(16);}
  await page.mouse.up();
 }
 await page.getByRole('button',{name:'放置／檢視'}).click();
 await page.getByRole('button',{name:'小屋 1'}).click();
 await page.getByText('位置數值',{exact:true}).click();
 const before=JSON.parse((await page.getByTestId('transform').textContent())!);expect(before.position[1]).toBeCloseTo(0,3);
 await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+110,point.y+10,{steps:20});await page.mouse.up();
 const after=JSON.parse((await page.getByTestId('transform').textContent())!);
 expect(Math.abs(after.position[0]-before.position[0])).toBeGreaterThan(.2);
 expect(after.position[1]).toBeGreaterThan(.2);
});
