import assert from 'node:assert/strict';
process.env.PLAYWRIGHT_BROWSERS_PATH??='0';
const {chromium}=await import('@playwright/test');
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const base='http://127.0.0.1:8790';
try{
  await page.goto(base);
  await page.locator('.card').nth(9).waitFor();
  assert.equal(await page.locator('.card').count(),10);
  for(let n=0;n<10;n++){
    await page.locator('.card button').nth(n).click();
    await page.locator('#message').filter({hasText:'已載入'}).waitFor();
    assert.equal(await page.locator('#stage canvas').count(),1);
    assert.equal(await page.locator('#animation').inputValue(),'');
    const title=await page.locator('#title').textContent();
    const clips=await page.locator('#animation option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean));
    if(/ST-007|ST-020/.test(title))assert.deepEqual([...clips].sort(),['idle','walk','wave']);
    if(/ST-036/.test(title))assert.deepEqual(clips,['flap']);
    if(clips.length){await page.locator('#animation').selectOption(clips[0]);await page.waitForTimeout(100);await page.locator('#reset').click();assert.equal(await page.locator('#animation').inputValue(),'')}
    const beforeColor=await page.locator('#stage').screenshot();
    await page.locator('#color').evaluate(el=>{el.value='#ff3333';el.dispatchEvent(new Event('input',{bubbles:true}))});
    await page.waitForTimeout(100);
    const afterColor=await page.locator('#stage').screenshot();
    assert.notDeepEqual(afterColor,beforeColor,'editable material should visibly change');
    await page.locator('#reset').click();
    await page.waitForTimeout(100);
    assert.deepEqual(await page.locator('#stage').screenshot(),beforeColor,'reset should restore material appearance');
    await page.locator('#lod').selectOption('lod');
    await page.locator('#message').filter({hasText:'已載入'}).waitFor();
    assert.match(await page.locator('#download').getAttribute('href'),/lod.glb$/);
    await page.locator('#close').click();
    await page.locator('#stage canvas').waitFor({state:'detached'});
    assert.equal(await page.locator('#stage canvas').count(),0);
  }
  // A stale successful request must not recreate a canvas after closing.
  await page.route('**/ST-007/model.glb',async route=>{await new Promise(r=>setTimeout(r,350));await route.continue()});
  await page.locator('.card button').first().click();
  await page.locator('#close').click();
  await page.waitForTimeout(700);
  assert.equal(await page.locator('#stage canvas').count(),0);
  await page.unroute('**/ST-007/model.glb');
  await page.locator('.card button').first().click();
  await page.locator('#message').filter({hasText:'已載入'}).waitFor();
  await page.screenshot({path:'working/pilot-v1/review.png'});
  await page.locator('#close').click();
  for(const route of ['/assets/%2e%2e%5c%2e%2e%5cpackage.json','/three/%2e%2e%5cpackage.json','/references/ST-007/../../package.json']){
    assert.equal((await page.request.get(base+route)).status(),404);
  }
  assert.equal((await page.request.post(base+'/')).status(),405);
  assert.deepEqual(errors,[]);
  console.log('PASS: 10 cards/GLBs, default stop, required clips, LOD, color/reset, cleanup, delayed close/reopen, traversal and method rejection. Desktop Chromium SwiftShader only; no real-device certification.');
}finally{await browser.close()}
