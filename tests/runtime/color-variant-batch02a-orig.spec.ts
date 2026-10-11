import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {expect,test,type Page} from '@playwright/test';
import {missingLocalAssetReason} from './local-asset-gate';

test.use({viewport:{width:1440,height:1000}});

const batch02aPath=resolve(process.cwd(),'source/t14-batch02a/processed/IMP_ULTIMATE_Casual_Male-6abf565509e534c1.glb');
const expectedSha256='6abf565509e534c1f15843a1cdaa1f4cf1ab6a40b7452fb39247738a6e9447e9';
const importedV1Url='**/imported-assets/v1/IMP_ULTIMATE_Casual_Male-34b06e07f9ec3f26.glb';

type PixelShot={data:number[];width:number;height:number};
async function shot(page:Page):Promise<PixelShot>{
 const canvas=page.locator('canvas').first(),box=await canvas.boundingBox();
 if(!box)throw Error('canvas not visible');
 const buffer=await page.screenshot({clip:box});
 return page.evaluate<PixelShot,string>(async base64=>{
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
  const image=new Image();image.src=url;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const context=canvas.getContext('2d')!;context.drawImage(image,0,0);
  const rgba=context.getImageData(0,0,canvas.width,canvas.height);
  URL.revokeObjectURL(url);
  return {data:Array.from(rgba.data),width:rgba.width,height:rgba.height};
 },Buffer.from(buffer).toString('base64'));
}
function changedPixelLuma(before:PixelShot,after:PixelShot){
 let count=0,beforeSum=0,afterSum=0;
 for(let i=0;i<before.data.length;i+=4){
  const delta=Math.abs(before.data[i]-after.data[i])+Math.abs(before.data[i+1]-after.data[i+1])+Math.abs(before.data[i+2]-after.data[i+2]);
  if(delta<=24)continue;
  count++;
  beforeSum+=0.2126*before.data[i]+0.7152*before.data[i+1]+0.0722*before.data[i+2];
  afterSum+=0.2126*after.data[i]+0.7152*after.data[i+1]+0.0722*after.data[i+2];
 }
 return {count,beforeLuma:count?beforeSum/count:0,afterLuma:count?afterSum/count:0};
}

test('batch02a t2-baked Skin renders catalog orig as original black',async({page})=>{
 test.setTimeout(120000);
 const reason=missingLocalAssetReason(batch02aPath,'G06-B1 processed GLB');
 if(reason){
  console.warn(reason);
  test.skip(true,reason);
 }
 const bytes=Buffer.from(await readFile(batch02aPath));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(expectedSha256);
 expect(bytes.toString('ascii',0,4)).toBe('glTF');
 const jsonLength=bytes.readUInt32LE(12),jsonType=bytes.readUInt32LE(16);
 expect(jsonType).toBe(0x4e4f534a);
 const document=JSON.parse(bytes.toString('utf8',20,20+jsonLength)) as {materials?:Array<{name?:string;pbrMetallicRoughness?:{baseColorFactor?:number[]}} >};
 const skin=document.materials?.find(material=>material.name==='Skin');
 expect(skin?.pbrMetallicRoughness?.baseColorFactor).toEqual([0.806952,0.514918,0.323143,1]);

 let served=0;
 await page.route(importedV1Url,async route=>{
  served++;
  await route.fulfill({status:200,contentType:'model/gltf-binary',body:bytes});
 });
 await page.goto('/');
 await page.getByLabel('搜尋物件').fill('Casual_Male');
 await page.getByRole('button',{name:'Casual_Male 已匯入素材',exact:true}).click();
 await page.getByRole('button',{name:'放在中央'}).click();
 await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入',{timeout:45000});
 expect(served).toBeGreaterThan(0);

 const select=page.getByLabel('膚色變體');
 await expect(select).toHaveValue('t2');
 const t2=await shot(page);
 await page.waitForTimeout(800);
 const t2Again=await shot(page);
 await select.selectOption('t6');
 await page.waitForTimeout(1500);
 const t6=await shot(page);
 await select.selectOption('orig');
 await page.waitForTimeout(1500);
 const orig=await shot(page);
 const stability=changedPixelLuma(t2,t2Again);
 const t2ToOrig=changedPixelLuma(t2Again,orig),t6ToOrig=changedPixelLuma(t6,orig);
 console.log('[batch02a orig render]',JSON.stringify({sha256:expectedSha256,served,stability,t2ToOrig,t6ToOrig}));
 expect(stability.count,'idle re-render must stay stable; keeps render noise from inflating the diff budget').toBeLessThan(50);
 expect(t2ToOrig.count,'Skin pixels differ after selecting orig from baked t2').toBeGreaterThan(200);
 expect(t2ToOrig.afterLuma,'orig must be darker than the baked t2 input').toBeLessThan(t2ToOrig.beforeLuma*0.35);
 expect(t6ToOrig.count,'Skin pixels differ after selecting orig from t6').toBeGreaterThan(200);
 expect(t6ToOrig.afterLuma,'orig must be substantially darker than t6; prevents t6-as-orig false pass').toBeLessThan(t6ToOrig.beforeLuma*0.7);
});
