// Private T14 verification server exposes only this manifest's models and Three.js modules.
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
process.env.PLAYWRIGHT_BROWSERS_PATH??='0';
const {chromium}=await import('@playwright/test');
const root=fileURLToPath(new URL('../../',import.meta.url));
const batchDir=process.argv[2]??'t14-batch01';
const base=path.join(root,'source',batchDir);
const sha=b=>createHash('sha256').update(b).digest('hex');
const metadataBytes=await readFile(path.join(base,'metadata.json'));
const manifest=JSON.parse(metadataBytes);
const v1raw=JSON.parse(await readFile(path.join(root,'packages/asset-catalog/src/imported-v1.json'),'utf8'));
const v1by={};for(const v of (Array.isArray(v1raw)?v1raw:v1raw.assets))v1by[v.id]=v;
const assets=manifest.assets;const route=new Map();
for(const a of assets){
 const file=await realpath(path.resolve(root,a.file));
 if(!file.startsWith(base+path.sep))throw Error('Candidate outside private batch');
 const bytes=await readFile(file);if(sha(bytes)!==a.sha256||bytes.length!==a.bytes)throw Error('Model hash/size mismatch');
 // Verify GLB has no external dependencies before running the loader.
 const doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8'));
 if([...doc.buffers??[],...doc.images??[]].some(v=>v.uri))throw Error('External model dependency');
 route.set('/candidate/'+a.id+'.glb',bytes);
 const policies=Array.isArray(a.materialPolicy)?a.materialPolicy:(a.materialPolicy?[a.materialPolicy]:[]);
 if(policies.includes('skin-tone-override')){
  const v1=v1by[a.id];if(!v1)throw Error('No imported-v1 baseline for '+a.id);
  const v1bytes=await readFile(path.resolve(root,'apps/web/public',v1.url.replace(/^\//,'')));
  if(sha(v1bytes)!==v1.sha256)throw Error('imported-v1 baseline drift for '+a.id);
  route.set('/before/'+a.id+'.glb',v1bytes);
 }
}
const html=`<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script><style>body{background:#eeeae1;font:16px sans-serif}main{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}img{width:210px}figure{margin:0;background:white;padding:8px}figcaption{font-size:14px}</style><h1>${manifest.batch} · 待獨立美術驗收</h1><main></main>`;
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');let bytes,type;
  if(url.pathname==='/'){bytes=Buffer.from(html);type='text/html;charset=utf-8';}
  else if(route.has(url.pathname)){bytes=route.get(url.pathname);type='model/gltf-binary';}
  else if(url.pathname.startsWith('/three/')){
   const lib=await realpath(path.join(root,'node_modules/three'));
   const file=await realpath(path.resolve(lib,decodeURIComponent(url.pathname.slice(7))));
   if(!file.startsWith(lib+path.sep)||!file.endsWith('.js'))throw Error('Outside module allowlist');
   bytes=await readFile(file);type='text/javascript';
  }else{res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes);
 }catch{res.writeHead(404);res.end();}
});
let browser;const errors=[];const results=[];const phantomAborted=[];const started=Date.now();
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1200,height:720}});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('requestfailed',r=>{const failure=r.failure()?.errorText;const url=r.url();
  // Chromium's network service can abort-and-retry a GET on a reused loopback socket; the retry is
  // invisible to CDP (REQ+FAIL, no FIN, no second REQ) while the load itself succeeds. Treat an
  // ERR_ABORTED model URL as fatal only when its asset did not complete validation.
  if(failure==='net::ERR_ABORTED'&&(url.includes('/candidate/')||url.includes('/before/')))phantomAborted.push(url);
  else errors.push(url+': '+failure);});
 const origin='http://127.0.0.1:'+server.address().port;
 // Leak guard: only explicit candidate routes and Three.js modules are reachable.
 const denial=await page.request.get(origin+'/assets_seed.yaml');if(denial.status()!==404)throw Error('Private server path guard');
 await page.goto(origin);
 for(const asset of assets){
  const outcome=await page.evaluate(async a=>{
   const T=await import('three');const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
   const gltf=await Promise.race([new GLTFLoader().loadAsync('/candidate/'+a.id+'.glb'),new Promise((_,reject)=>setTimeout(()=>reject(Error('Load timeout')),15000))]);
   if(gltf.animations.length!==a.clips)throw Error('Clip count changed');
   const obj=gltf.scene;obj.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(obj);
   const size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());
   if(![...size.toArray(),...center.toArray()].every(Number.isFinite)||size.length()<=0)throw Error('Invalid bounds');
   const geometries=new Set(),materials=new Set(),textures=new Set();let meshes=0,triangles=0,missingTextures=0;
   obj.traverse(o=>{if(!o.isMesh)return;meshes++;geometries.add(o.geometry);triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;
    for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const t of Object.values(m))if(t?.isTexture)textures.add(t);}
   });
   const policies=Array.isArray(a.materialPolicy)?a.materialPolicy:(a.materialPolicy?[a.materialPolicy]:[]);
   if(policies.includes('double-sided-thin-surfaces')&&[...materials].some(m=>m.side!==T.DoubleSide))throw Error('Thin material policy not loaded');
   if(policies.includes('non-metallic-flat-color')&&[...materials].some(m=>(m.metalness??1)!==0))throw Error('Non-metallic policy not loaded');
   const skinPolicy=policies.includes('skin-tone-override');
   if(skinPolicy){
    const skin=[...materials].find(m=>m.name==='Skin');if(!skin)throw Error('Skin material missing');
    const c=skin.color;
    if(Math.abs(c.r-0.806952)>0.0001||Math.abs(c.g-0.514918)>0.0001||Math.abs(c.b-0.323143)>0.0001)throw Error('Skin tone override not loaded: '+[c.r,c.g,c.b]);
   }
   const textureInfo=[...textures].map(t=>{const image=t.image;const width=image?.width??0,height=image?.height??0;if(!width||!height)missingTextures++;return {width,height};});
   if(!meshes||!triangles||missingTextures)throw Error('Empty geometry or missing texture');
   const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(512,512);renderer.setPixelRatio(1);
   const scene=new T.Scene();scene.background=new T.Color('#ece9df');scene.add(new T.HemisphereLight(0xffffff,0x868176,2.5));
   const light=new T.DirectionalLight(0xffffff,2.5);light.position.set(3,6,4);scene.add(light);
   const scale=1.6/Math.max(...size.toArray());const wrapper=new T.Group();wrapper.scale.setScalar(scale);wrapper.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale);wrapper.add(obj);scene.add(wrapper);
   const camera=new T.PerspectiveCamera(40,1,0.01,100);camera.position.set(2.6,1.9,3);camera.lookAt(0,0.7,0);
   const blank=new Uint8Array(512*512*4),pixels=new Uint8Array(blank.length);const gl=renderer.getContext();
   wrapper.visible=false;renderer.render(scene,camera);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,blank);
   wrapper.visible=true;renderer.render(scene,camera);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   let changedPixels=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]!==blank[i]||pixels[i+1]!==blank[i+1]||pixels[i+2]!==blank[i+2])changedPixels++;
   const thumbnail=renderer.domElement.toDataURL('image/webp',0.9);if(!thumbnail.startsWith('data:image/webp;'))throw Error('WebP unavailable');
   const transformed=new T.Box3().setFromObject(wrapper);if(Math.abs(transformed.min.y)>0.00001)throw Error('Ground placement drift');
   const placedCenter=transformed.getCenter(new T.Vector3());
   const placedSize=transformed.getSize(new T.Vector3());
   if(Math.abs(placedCenter.x)>1e-5||Math.abs(placedCenter.z)>1e-5||Math.abs(Math.max(...placedSize.toArray())-1.6)>1e-5)throw Error('Normalization drift');
   // Render every quadrant, including a lower view of explicitly thin leaves.
   const views=[];
   for(const position of [[2.6,1.9,3],[-2.6,1.9,-3],[2.6,0.15,-3],[-2.6,0.15,3]]){
    camera.position.fromArray(position);camera.lookAt(0,0.7,0);
    wrapper.visible=false;renderer.render(scene,camera);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,blank);
    wrapper.visible=true;renderer.render(scene,camera);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let count=0,dark=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]!==blank[i]||pixels[i+1]!==blank[i+1]||pixels[i+2]!==blank[i+2]){
     count++;if(0.2126*pixels[i]+0.7152*pixels[i+1]+0.0722*pixels[i+2]<50)dark++;
    }
    if(count<100)throw Error('Empty quadrant render');
    const darkRatio=dark/count;
    // G54 dark-pixel guard: blanket near-black cap for non-skin assets. Skin-tone assets carry
    // faithful dark content (hair/clothes), so they are guarded by the paired v1 baseline below.
    if(darkRatio>0.3&&!skinPolicy)throw Error('Dark render: '+Math.round(darkRatio*1000)/10+'% of model pixels are near-black');
    if(skinPolicy&&darkRatio>0.9)throw Error('Near-total dark render: '+Math.round(darkRatio*1000)/10+'% of model pixels are near-black');
    views.push({position,changedPixels:count,darkRatio:Math.round(darkRatio*10000)/10000});
   }
   let skinTone;
   if(a.beforeUrl){
    const gltf2=await new GLTFLoader().loadAsync(a.beforeUrl);
    const obj2=gltf2.scene;obj2.updateMatrixWorld(true);
    const bGeo=new Set(),bMat=new Set(),bTex=new Set();obj2.traverse(o=>{if(!o.isMesh)return;bGeo.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){bMat.add(m);for(const t of Object.values(m))if(t?.isTexture)bTex.add(t);}});
    const b2=new T.Box3().setFromObject(obj2);const s2=b2.getSize(new T.Vector3()),c2=b2.getCenter(new T.Vector3());
    const sc2=1.6/Math.max(...s2.toArray());const w2=new T.Group();w2.scale.setScalar(sc2);w2.position.set(-c2.x*sc2,-b2.min.y*sc2,-c2.z*sc2);w2.add(obj2);scene.add(w2);
    let beforeTotal=0,afterTotal=0;
    for(const position of [[2.6,1.9,3],[-2.6,1.9,-3],[2.6,0.15,-3],[-2.6,0.15,3]]){
     camera.position.fromArray(position);camera.lookAt(0,0.7,0);
     w2.visible=false;wrapper.visible=false;renderer.render(scene,camera);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,blank);
     w2.visible=true;renderer.render(scene,camera);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
     for(let i=0;i<pixels.length;i+=4)if((pixels[i]!==blank[i]||pixels[i+1]!==blank[i+1]||pixels[i+2]!==blank[i+2])&&0.2126*pixels[i]+0.7152*pixels[i+1]+0.0722*pixels[i+2]<50)beforeTotal++;
     w2.visible=false;wrapper.visible=true;renderer.render(scene,camera);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
     for(let i=0;i<pixels.length;i+=4)if((pixels[i]!==blank[i]||pixels[i+1]!==blank[i+1]||pixels[i+2]!==blank[i+2])&&0.2126*pixels[i]+0.7152*pixels[i+1]+0.0722*pixels[i+2]<50)afterTotal++;
    }
    scene.remove(w2);
    for(const g of bGeo)g.dispose();for(const m of bMat)m.dispose();for(const t of bTex)t.dispose();
    if(afterTotal>=beforeTotal)throw Error('Skin tone override did not reduce dark pixels: '+afterTotal+' >= '+beforeTotal);
    skinTone={baselineBeforeDarkTotal:beforeTotal,afterDarkTotal:afterTotal};
   }
   for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();
   renderer.dispose();renderer.forceContextLoss();
   if(changedPixels<100)throw Error('Model did not render');
   const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');img.src=thumbnail;caption.textContent=a.seedId+' '+a.name;figure.append(img,caption);document.querySelector('main').append(figure);await img.decode();
   return {id:a.id,seedId:a.seedId,meshes,triangles,textures:textures.size,textureInfo,missingTextures,views,doubleSidedMaterials:[...materials].filter(m=>m.side===T.DoubleSide).length,clips:gltf.animations.length,size:size.toArray(),rendered:true,changedPixels,placement:{scale,groundOffset:-bounds.min.y*scale,centerOffset:{x:-center.x*scale,z:-center.z*scale}},skinTone,thumbnail};
  },{...asset,beforeUrl:(Array.isArray(asset.materialPolicy)?asset.materialPolicy:[asset.materialPolicy]).includes('skin-tone-override')?'/before/'+asset.id+'.glb':null});
  const thumbnailBytes=Buffer.from(outcome.thumbnail.split(',')[1],'base64');delete outcome.thumbnail;
  const target=path.resolve(root,asset.thumbnail);if(!target.startsWith(base+path.sep))throw Error('Thumbnail path');
  await mkdir(path.dirname(target),{recursive:true});await writeFile(target,thumbnailBytes);
  results.push({...outcome,sha256:asset.sha256,thumbnailSha256:sha(thumbnailBytes),thumbnailBytes:thumbnailBytes.length,withinBudget:asset.bytes<manifest.budget.maxBytes&&outcome.triangles<=manifest.budget.maxTriangles});
 }
 await page.screenshot({path:path.join(base,'contact-sheet.png'),fullPage:true});
}catch(e){errors.push(e.stack??String(e));}
finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
const validated=new Set(results.map(r=>r.id));
 const unresolved=phantomAborted.filter(u=>{const id=decodeURIComponent(u.split('/').pop().replace(/.glb$/,''));return !validated.has(id);});
 errors.push(...unresolved.map(u=>u+': net::ERR_ABORTED (asset did not complete validation)'));
 const report={metadataSha256:sha(metadataBytes),validatorSha256:sha(await readFile(fileURLToPath(import.meta.url))),errors,phantomAbortedModelRequests:phantomAborted.filter(u=>!unresolved.includes(u)),results,elapsedMs:Date.now()-started};
await writeFile(path.join(base,'validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({loaded:results.length,total:assets.length,withinBudget:results.filter(r=>r.withinBudget).length,errors,elapsedMs:report.elapsedMs}));
if(errors.length||results.length!==assets.length)process.exitCode=1;