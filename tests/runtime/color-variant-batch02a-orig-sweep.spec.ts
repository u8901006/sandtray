import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {expect,test,type Page} from '@playwright/test';
import {missingLocalAssetReason} from './local-asset-gate';

test.use({viewport:{width:1440,height:1000}});

const BAKED_T2=[0.806952,0.514918,0.323143,1];
const CASES=[
 {name:'Casual_Female',v1:'1a909850aee6c0ac',file:'IMP_ULTIMATE_Casual_Female-3d504438f6748b66.glb',sha256:'3d504438f6748b66fcb56a7ebdd75ea03173c12ee1588e7d6805e84d4c4393c7'},
 {name:'Casual2_Male',v1:'1c85762cbba47b8f',file:'IMP_ULTIMATE_Casual2_Male-f2a1084fa11ef010.glb',sha256:'f2a1084fa11ef010ce0ae89f8135d784442507ff800cb2d97e3c18d6d20582a8'},
 {name:'Casual2_Female',v1:'d95c07243223d4f7',file:'IMP_ULTIMATE_Casual2_Female-86c49db12805672b.glb',sha256:'86c49db12805672be10484b4c0cd060a16a7fe8b355accee7c416fbcafb1748c'},
 {name:'Suit_Male',v1:'4b3bbaddd3827dfe',file:'IMP_ULTIMATE_Suit_Male-40da393f68505fd3.glb',sha256:'40da393f68505fd3f56e78be36ebaa69354f28118f9f1bd7e954fd97d95025b7'},
 {name:'Suit_Female',v1:'99a13ffd39792239',file:'IMP_ULTIMATE_Suit_Female-d3e0ee28d2b42f84.glb',sha256:'d3e0ee28d2b42f846f3d82d5e4121fbf581c55aaa458d067ea26162418becbf8'},
 {name:'Worker_Male',v1:'6acc81d07a9aca9f',file:'IMP_ULTIMATE_Worker_Male-ab8d4e77e7878625.glb',sha256:'ab8d4e77e787862543812d9b8442f11e4c40d6fb2550884ebc5bd0ee5a17bd5f'},
 {name:'OldClassy_Male',v1:'da22b0aa834495b6',file:'IMP_ULTIMATE_OldClassy_Male-b62f2b4f81913b16.glb',sha256:'b62f2b4f81913b16945672ccc26299b17c9e5c889fe323f374995ea974b83780'},
 {name:'Doctor_Male_Young',v1:'0ca89474eeb41e6b',file:'IMP_ULTIMATE_Doctor_Male_Young-3c1ac924b709f67c.glb',sha256:'3c1ac924b709f67ccff25e6d334716824dde289d5117b4d841f86af4b13e762f'},
 {name:'Soldier_Male',v1:'67e36bad7a27a23e',file:'IMP_ULTIMATE_Soldier_Male-603b6868c160a610.glb',sha256:'603b6868c160a6106dfafd3b29866a1d202e876baa0ed49d7bd84cc9ed0ee221'},
];

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

for(const {name,v1,file,sha256} of CASES){
 test(`batch02a ${name} t2-baked Skin renders catalog orig as original black`,async({page})=>{
  test.setTimeout(120000);
  const batch02aPath=resolve(process.cwd(),'source/t14-batch02a/processed',file);
  const reason=missingLocalAssetReason(batch02aPath,'G06-B1 processed GLB '+file);
  if(reason){
   console.warn(reason);
   test.skip(true,reason);
  }
  const bytes=Buffer.from(await readFile(batch02aPath));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
  expect(bytes.toString('ascii',0,4)).toBe('glTF');
  const jsonLength=bytes.readUInt32LE(12),jsonType=bytes.readUInt32LE(16);
  expect(jsonType).toBe(0x4e4f534a);
  const document=JSON.parse(bytes.toString('utf8',20,20+jsonLength)) as {materials?:Array<{name?:string;pbrMetallicRoughness?:{baseColorFactor?:number[]}} >};
  const skin=document.materials?.find(material=>material.name==='Skin');
  expect(skin?.pbrMetallicRoughness?.baseColorFactor).toEqual(BAKED_T2);

  let served=0;
  await page.route(`**/imported-assets/v1/IMP_ULTIMATE_${name}-${v1}.glb`,async route=>{
   served++;
   await route.fulfill({status:200,contentType:'model/gltf-binary',body:bytes});
  });
  await page.goto('/');
  await page.getByLabel('搜尋物件').fill(name);
  await page.getByRole('button',{name:`${name} 已匯入素材`,exact:true}).click();
  await page.getByRole('button',{name:'放在中央'}).click();
  await expect(page.getByTestId('load-status')).toHaveText('3D 模型已載入',{timeout:45000});
  expect(served).toBeGreaterThan(0);
  // REQ-016 (2026-09-30): the default view frames two trays, so figures are smaller; focus the dry tray to keep the old on-screen scale.
  await page.getByRole('button',{name:'聚焦乾沙盤'}).click();

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
  console.log('[batch02a orig sweep]',JSON.stringify({name,served,stability,t2ToOrig,t6ToOrig}));
  expect(stability.count,'idle re-render must stay stable; keeps render noise from inflating the diff budget').toBeLessThan(50);
  expect(t2ToOrig.count,'Skin pixels differ after selecting orig from baked t2').toBeGreaterThan(200);
  expect(t2ToOrig.afterLuma,'orig must be darker than the baked t2 input').toBeLessThan(t2ToOrig.beforeLuma*0.35);
  expect(t6ToOrig.count,'Skin pixels differ after selecting orig from t6').toBeGreaterThan(200);
  expect(t6ToOrig.afterLuma,'orig must be substantially darker than t6; prevents t6-as-orig false pass').toBeLessThan(t6ToOrig.beforeLuma*0.7);
 });
}
