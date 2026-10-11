import {useEffect,useRef,useState} from 'react';
import {useThree} from '@react-three/fiber';
import {BufferGeometry,Color,Float32BufferAttribute,Group,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,Quaternion,Vector3,type Material} from 'three';
import {assetById} from '../../../packages/asset-catalog/src/index';
import {acquireAsset} from './asset-pool';
import {gardenPlanting,plantedTrunks,type GardenTier,type PlantKind,type PlantedTrunk} from './garden-layout';
import {patchGardenMaterial,type GardenFogUniforms,type GardenGroundUniforms} from './garden-shaders';
import type {GardenGround} from './garden-ground';
// 2026-10-10 garden-visual-v4 proposals 3 and 4. Static (no wind, guardrail 3): drawn only when the demand frameloop
// renders. Grass is real blade geometry in 20 m tiles so off-screen tiles are frustum-culled; planting uses the CC0
// Quaternius Stylized Nature models already in the catalog (megakits-v1, IMPORTED_UNREVIEWED), instanced per mesh.
export const GRASS_BUDGET:Record<GardenTier,{clumps:number;radius:number}>={low:{clumps:3000,radius:30},high:{clumps:8000,radius:44},cinema:{clumps:16000,radius:58}};
const TILE=20;
function rng(seed:number){let s=seed>>>0;return()=>{s=(s+0x6d2b79f5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
/** One clump = 9 tapered, slightly bent blades (5 triangles per side); normals point up so blades light like the ground. */
export function grassClumpGeometry(){
 const random=rng(7),position:number[]=[],color:number[]=[],normal:number[]=[],index:number[]=[];
 const base=[.045,.085,.018],tip=[.15,.22,.042];
 for(let b=0;b<9;b++){
  const a=random()*Math.PI*2,r=random()*.16,h=.2+random()*.18,w=.05+random()*.025,bend=(random()-.3)*.12,yaw=random()*Math.PI;
  const ox=Math.cos(a)*r,oz=Math.sin(a)*r,dx=Math.cos(yaw),dz=Math.sin(yaw),start=position.length/3;
  [[0,1],[.4,.78],[.75,.45],[1,0]].forEach(([t,k],row)=>{
   const y=t*h,lean=bend*t*t,cx=ox+Math.sin(yaw)*lean,cz=oz-Math.cos(yaw)*lean,half=w*k/2;
   const shade=base.map((v,i)=>v+(tip[i]-v)*t);
   if(row<3){position.push(cx-dx*half,y,cz-dz*half,cx+dx*half,y,cz+dz*half);color.push(...shade,...shade);normal.push(0,1,0,0,1,0);}
   else {position.push(cx,y,cz);color.push(...shade);normal.push(0,1,0);}
  });
  // Both windings, normals kept up: DoubleSide would flip the back face's normal downward and render it black.
  for(let row=0;row<2;row++){const i=start+row*2;index.push(i,i+1,i+3,i,i+3,i+2,i+3,i+1,i,i+2,i+3,i);}
  index.push(start+4,start+5,start+6,start+6,start+5,start+4);
 }
 const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(position,3));geometry.setAttribute('color',new Float32BufferAttribute(color,3));geometry.setAttribute('normal',new Float32BufferAttribute(normal,3));geometry.setIndex(index);geometry.computeBoundingSphere();return geometry;
}
type Built={group:Group;dispose():void};
function buildGrass(ground:GardenGround,tier:GardenTier,patch:{fog:GardenFogUniforms;ground:GardenGroundUniforms}):Built{
 const {clumps,radius}=GRASS_BUDGET[tier],random=rng(4242),tiles=new Map<string,Matrix4[]>(),colors=new Map<string,Color[]>();
 const m=new Matrix4(),q=new Quaternion(),s=new Vector3(),p=new Vector3(),axis=new Vector3(0,1,0);let placed=0;
 for(let attempt=0;attempt<clumps*8&&placed<clumps;attempt++){
  const a=random()*Math.PI*2,r=Math.sqrt(random())*radius,x=Math.cos(a)*r,z=Math.sin(a)*r,g=ground.grassAt(x,z);
  if(random()>=g)continue;
  q.setFromAxisAngle(axis,random()*Math.PI*2);const k=.7+random()*.6*g;s.set(k,k*(.8+random()*.5),k);p.set(x,ground.heightAt(x,z)-.02,z);m.compose(p,q,s);
  const key=Math.floor(x/TILE)+':'+Math.floor(z/TILE);if(!tiles.has(key)){tiles.set(key,[]);colors.set(key,[]);}
  tiles.get(key)!.push(m.clone());const dry=random()<.18?.35:0,v=.8+random()*.4;colors.get(key)!.push(new Color(v*(1+dry*.9),v*(1+dry*.35),v*(1-dry*.3)));placed++;
 }
 const geometry=grassClumpGeometry(),material=new MeshStandardMaterial({vertexColors:true,roughness:.92,metalness:0});material.name='Garden_Grass_Blades';
 patchGardenMaterial(material,{fog:patch.fog,ground:patch.ground,groundMode:'occlude'});
 const group=new Group();group.name='Garden_grass';const meshes:InstancedMesh[]=[];
 for(const [key,list] of tiles){const mesh=new InstancedMesh(geometry,material,list.length);list.forEach((matrix,i)=>{mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,colors.get(key)![i]);});mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.receiveShadow=true;mesh.name='Garden_grass_'+key;group.add(mesh);meshes.push(mesh);}
 group.userData.clumps=placed;
 return {group,dispose(){for(const mesh of meshes)mesh.dispose();geometry.dispose();material.dispose();}};
}
const SHADOW:Record<PlantKind,boolean>={tree:true,bush:true,ground:false,reed:false};
function buildPlants(ground:GardenGround,tier:GardenTier,roots:Map<string,Group>,patch:{fog:GardenFogUniforms;ground:GardenGroundUniforms}):Built{
 const group=new Group();group.name='Garden_planting';const owned:Material[]=[],meshes:InstancedMesh[]=[];
 const planting=gardenPlanting(tier),place=new Matrix4(),q=new Quaternion(),axis=new Vector3(0,1,0),s=new Vector3(),p=new Vector3(),local=new Matrix4(),inverse=new Matrix4();
 for(const kind of Object.keys(planting) as PlantKind[]){
  const byVariant=new Map<string,typeof planting[PlantKind]>();for(const item of planting[kind]){if(!byVariant.has(item.variant))byVariant.set(item.variant,[]);byVariant.get(item.variant)!.push(item);}
  for(const [variant,items] of byVariant){
   const root=roots.get(variant);if(!root)continue;root.updateWorldMatrix(true,true);inverse.copy(root.matrixWorld).invert();
   root.traverse(object=>{
    if(!(object instanceof Mesh))return;local.multiplyMatrices(inverse,object.matrixWorld);
    const materials=(Array.isArray(object.material)?object.material:[object.material]).map((source:Material)=>{const material=source.clone();patchGardenMaterial(material,{fog:patch.fog,ground:patch.ground,groundMode:'occlude'});owned.push(material);return material;});
    const mesh=new InstancedMesh(object.geometry,materials.length===1?materials[0]:materials,items.length);
    items.forEach((item,i)=>{q.setFromAxisAngle(axis,item.rotation);s.setScalar(item.scale);p.set(item.x,ground.heightAt(item.x,item.z),item.z);place.compose(p,q,s).multiply(local);mesh.setMatrixAt(i,place);});
    mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.castShadow=SHADOW[kind];mesh.receiveShadow=true;mesh.name=`Garden_${kind}_${variant}`;group.add(mesh);meshes.push(mesh);
   });
  }
 }
 return {group,dispose(){for(const mesh of meshes)mesh.dispose();for(const material of owned)material.dispose();}};
}
/** Variants used by any tier; loaded once through the shared asset pool and released on unmount. */
export function plantVariants(tier:GardenTier){const planting=gardenPlanting(tier);return [...new Set(Object.values(planting).flat().map(p=>p.variant))];}
/** onTrees reports the added trees that are drawn now (only loaded variants; [] on unmount) so walking matches the view. */
export function GardenVegetation({ground,tier,patch,onTrees}:{ground:GardenGround;tier:GardenTier;patch:{fog:GardenFogUniforms;ground:GardenGroundUniforms};onTrees:(trees:readonly PlantedTrunk[])=>void}){
 const {invalidate}=useThree();const [grass,setGrass]=useState<Group>(),[plants,setPlants]=useState<Group>();
 const reportTrees=useRef(onTrees);reportTrees.current=onTrees;
 useEffect(()=>{const built=buildGrass(ground,tier,patch);setGrass(built.group);invalidate();return()=>{setGrass(undefined);built.dispose();};},[ground,tier,patch]);
 useEffect(()=>{
  let active=true,built:Built|undefined;const handles=plantVariants(tier).flatMap(id=>{const url=assetById.get(id)?.url;return url?[{id,handle:acquireAsset(url)}]:[];});
  // A plant that fails to load is left out; the garden itself stays usable (no status change).
  void Promise.all(handles.map(({id,handle})=>handle.promise.then(root=>[id,root] as const,()=>undefined))).then(results=>{
   if(!active)return;const roots=new Map(results.filter((r):r is readonly [string,Group]=>!!r));built=buildPlants(ground,tier,roots,patch);setPlants(built.group);reportTrees.current(plantedTrunks().filter(t=>roots.has(t.variant)));invalidate();
  });
  return()=>{active=false;reportTrees.current([]);setPlants(undefined);built?.dispose();for(const {handle} of handles)handle.release();};
 },[ground,tier,patch]);
 return <>{grass&&<primitive object={grass} dispose={null}/>}{plants&&<primitive object={plants} dispose={null}/>}</>;
}
