import http from 'node:http';
import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
process.env.PLAYWRIGHT_BROWSERS_PATH??='0';
const {chromium}=await import('@playwright/test');
const root=fileURLToPath(new URL('../../',import.meta.url)),dir=path.join(root,'apps/web/public/imported-assets/v1');
const assets=JSON.parse(await readFile(path.join(root,'packages/asset-catalog/src/imported-v1.json'),'utf8'));
const html=`<html><style>body{background:#f5f2e9;font:14px sans-serif}#gallery{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}figure{margin:0;background:white;text-align:center;padding:8px}img{width:150px;height:150px;object-fit:contain}</style><script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script><h1>匯入素材 · 3D 實際渲染</h1><div id="gallery"></div></html>`;
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);return;}
 const base=url.pathname.startsWith('/three/')?path.join(root,'node_modules/three'):dir;
 const relative=url.pathname.startsWith('/three/')?url.pathname.slice(7):url.pathname.replace('/imported-assets/v1/','');const file=path.resolve(base,decodeURIComponent(relative));if(!file.startsWith(base+path.sep))throw Error('Outside root');
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'model/gltf-binary');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(8793,'127.0.0.1',resolve));
process.env.PLAYWRIGHT_BROWSERS_PATH??='0';const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1200,height:950}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.exposeFunction('savePreview',async(id,data)=>{if(!assets.some(a=>a.id===id))throw Error('Unknown');await writeFile(path.join(dir,id+'.png'),Buffer.from(data.split(',')[1],'base64'));});
try{await page.goto('http://127.0.0.1:8793');
 const results=await page.evaluate(async assets=>{
  const T=await import('three'),{GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js'),{clone}=await import('three/addons/utils/SkeletonUtils.js');
  const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(192,192);renderer.setPixelRatio(1);const camera=new T.PerspectiveCamera(40,1,0.01,100);camera.position.set(2.6,1.9,3);camera.lookAt(0,0.7,0);
  const scene=new T.Scene();scene.background=new T.Color('#ece9df');scene.add(new T.HemisphereLight(0xffffff,0x868176,2.5));const light=new T.DirectionalLight(0xffffff,2.5);light.position.set(3,6,4);scene.add(light);
  const loader=new GLTFLoader(),results=[];
  for(const asset of assets){
   const gltf=await loader.loadAsync(asset.url);const object=clone(gltf.scene);object.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(object),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());if(!Number.isFinite(size.length())||Math.min(...size.toArray())<0||size.length()<=0)throw Error(asset.id+' bounds');
   let meshes=0,skins=0,triangles=0;object.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}if(o.isSkinnedMesh){skins++;const original=gltf.scene.getObjectByName(o.name);if(original?.isSkinnedMesh&&original.skeleton.bones[0]===o.skeleton.bones[0])throw Error('Shared skeleton');}});if(!meshes||!triangles)throw Error('Empty model');
   const mixer=new T.AnimationMixer(object);let movingClips=0;
   for(const clip of gltf.animations){const action=mixer.clipAction(clip);action.play();mixer.setTime(0);object.updateMatrixWorld(true);const before=[];object.traverse(o=>before.push(...o.matrix.elements,...(o.morphTargetInfluences??[])));mixer.setTime(clip.duration*0.37);object.updateMatrixWorld(true);const after=[];object.traverse(o=>after.push(...o.matrix.elements,...(o.morphTargetInfluences??[])));if(before.some((v,i)=>Math.abs(v-after[i])>0.00001))movingClips++;mixer.stopAllAction();}
   if(gltf.animations.length!==asset.clips.length||skins!==asset.skins&&asset.skins>0&&skins===0)throw Error('Lost animation/skin');
   if(gltf.animations.length&&!movingClips)throw Error(asset.id+' has no observed motion');
   const idle=gltf.animations.find(c=>c.name.toLowerCase()==='idle');if(idle){mixer.clipAction(idle).play();mixer.setTime(0);}const wrapper=new T.Group();wrapper.add(object);wrapper.scale.setScalar(1.6/Math.max(...size.toArray()));object.position.sub(new T.Vector3(center.x,bounds.min.y,center.z));scene.add(wrapper);renderer.render(scene,camera);await window.savePreview(asset.id,renderer.domElement.toDataURL('image/png'));
   results.push({id:asset.id,meshes,skins,triangles,clips:gltf.animations.length,movingClips,size:size.toArray()});scene.remove(wrapper);mixer.stopAllAction();mixer.uncacheRoot(object);const disposed=new Set();object.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.dispose();if(o.isMesh){if(!disposed.has(o.geometry)){o.geometry.dispose();disposed.add(o.geometry);}for(const mat of Array.isArray(o.material)?o.material:[o.material]){for(const v of Object.values(mat))if(v?.isTexture&&!disposed.has(v)){v.dispose();disposed.add(v);}if(!disposed.has(mat)){mat.dispose();disposed.add(mat);}}}});
  }
  renderer.dispose();return results;
 },assets);
 const chosen=['IMP_ARENA_tree','IMP_ARENA_character-soldier','IMP_DUNGEON_chair','IMP_DUNGEON_character-orc','IMP_FURNITURE_bedDouble','IMP_FURNITURE_bear','IMP_FURNITURE_chair','IMP_MINI_character-female-a','IMP_MINI_character-male-a','IMP_ULTIMATE_Casual_Female','IMP_ULTIMATE_Cow','IMP_ULTIMATE_Doctor_Male_Young','IMP_ULTIMATE_Pug','IMP_ULTIMATE_Wizard','IMP_ULTIMATE_Elf','IMP_FURNITURE_bookcaseOpen','IMP_DUNGEON_chest','IMP_ARENA_trophy'];
 await page.evaluate(items=>{for(const a of items){const f=document.createElement('figure'),img=document.createElement('img'),c=document.createElement('figcaption');img.src=a.thumbnail;c.textContent=a.name;f.append(img,c);document.querySelector('#gallery').append(f);}},assets.filter(a=>chosen.includes(a.id)));
 await page.locator('#gallery img').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.decode())));
 const evidence=path.join(root,'docs/evidence/2026-09-10');await mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'imported-contact-sheet.png'),fullPage:true});
 await writeFile(path.join(evidence,'imported-models-v1.json'),JSON.stringify({models:results.length,animated:results.filter(r=>r.clips).length,errors,results},null,2));if(errors.length)throw Error(errors.join('\n'));console.log(JSON.stringify({models:results.length,animated:results.filter(r=>r.clips).length,observedMovingClips:results.reduce((n,r)=>n+r.movingClips,0),errors}));
}finally{await browser.close();server.close();}
