import {test,expect} from '@playwright/test';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {budget} from './budget';
// 2026-10-10 T13 amendment (user decision): every catalog row with status 'ready' must load through the app's own
// GLTFLoader (apps/web/src/asset-pool.ts), with every texture slot holding a decoded image and finite, non-degenerate
// world bounds (the app recentres the pivot and scales to displaySize from these). The file-level gate is tests/ready-gate.test.ts.
const src=fileURLToPath(new URL('../../packages/asset-catalog/src/',import.meta.url));
const ready=readdirSync(src).filter(f=>f.endsWith('.json')).flatMap(f=>{const data=JSON.parse(readFileSync(join(src,f),'utf8'));return Array.isArray(data)?data:[];})
 .filter((row:{status?:string})=>row.status==='ready').map((row:{id:string;url:string})=>({id:row.id,url:row.url}));
test('every ready asset loads through the app GLTFLoader with all textures and sane bounds',async({page})=>{
 test.setTimeout(budget(300000));
 expect(ready.length).toBe(202);
 const errors:string[]=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('/');
 const results=await page.evaluate(async list=>{
  const {acquireAsset}=await import('/src/asset-pool.ts' as string);
  const out:{id:string;ok:boolean;textures:number;detail:string}[]=[];
  const one=async({id,url}:{id:string;url:string})=>{
   const handle=acquireAsset(url);
   try{
    const root=await handle.promise;root.updateWorldMatrix(true,true);
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let meshes=0,missing=0,textures=0;
    root.traverse((o:any)=>{
     if(!o.isMesh)return;meshes++;o.geometry.computeBoundingBox();const box=o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
     for(const k of ['x','y','z'] as const){const i='xyz'.indexOf(k);min[i]=Math.min(min[i],box.min[k]);max[i]=Math.max(max[i],box.max[k]);}
     for(const m of Array.isArray(o.material)?o.material:[o.material])for(const v of Object.values(m))if((v as any)?.isTexture){textures++;const img=(v as any).image;if(!img||!(img.width>0))missing++;}
    });
    const size=max.map((v,i)=>v-min[i]);
    const ok=meshes>0&&missing===0&&size.every(Number.isFinite)&&Math.max(...size)>1e-4;
    out.push({id,ok,textures,detail:`meshes=${meshes} textures=${textures} missing=${missing} size=${size.map(n=>n.toFixed(3)).join('x')}`});
   }catch(e){out.push({id,ok:false,textures:0,detail:String(e)});}
   finally{handle.release();}
  };
  for(let i=0;i<list.length;i+=6)await Promise.all(list.slice(i,i+6).map(one));
  return out;
 },ready);
 const failed=results.filter(r=>!r.ok);
 expect(failed,failed.map(f=>f.id+' '+f.detail).join('\n')).toEqual([]);
 expect(results.length).toBe(202);
 // Not vacuous: the KayKit / Quaternius colour atlases are real textures, so most assets carry at least one.
 expect(results.filter(r=>r.textures>0).length).toBeGreaterThan(150);
 expect(errors).toEqual([]);
});
