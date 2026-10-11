import {Group,Mesh,MeshStandardMaterial,BufferAttribute,Vector3,type Material,type Texture,type BufferGeometry} from 'three';
import {patchGardenMaterial,type GardenFogUniforms,type GardenGroundUniforms} from './garden-shaders';
// 2026-09-30 user request: the pavilion's six cedar posts (x +/-7.5, z -5.8/0/5.8, y -0.4..4.2) pierced the two sandtrays, so they
// are removed. They are merged into the Weathered_Cedar mesh, so their triangles are dropped from the index. The shared asset-pool
// geometry is edited in place because every garden instance wants the same removal; the userData flag keeps it idempotent.
const POSTS=[-7.5,7.5].flatMap(x=>[-5.8,0,5.8].map(z=>[x,z] as const));
export function inPavilionPost(v:Vector3){return v.y>-.5&&v.y<4.3&&POSTS.some(([x,z])=>Math.abs(v.x-x)<.6&&Math.abs(v.z-z)<.6);}
function removePavilionPosts(mesh:Mesh){
 const geometry=mesh.geometry as BufferGeometry;if(geometry.userData.pavilionPostsRemoved)return;
 const position=geometry.getAttribute('position');if(!position)return;mesh.updateWorldMatrix(true,false);
 const world=(i:number)=>new Vector3().fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld);
 const index=geometry.getIndex(),count=index?index.count:position.count,kept:number[]=[];
 for(let t=0;t<count;t+=3){const ids=[0,1,2].map(k=>index?index.getX(t+k):t+k);if(!ids.every(i=>inPavilionPost(world(i))))kept.push(...ids);}
 if(kept.length!==count){geometry.setIndex(new BufferAttribute(position.count>65535?new Uint32Array(kept):new Uint16Array(kept),1));}
 geometry.userData.pavilionPostsRemoved=true;
}

/** Instance-owned materials; texture and geometry ownership stays with the asset pool. */
// 2026-10-10 garden-visual-v4: every owned material gets the garden atmosphere; the terrain additionally gets the baked
// grass / occlusion map, rocks and gravel only the occlusion. The deck and trays keep their look (guardrail 1).
const OCCLUDED=new Set(['Granite','Garden_Gravel']);
export function gardenSurfaces(source:Group,patch?:{fog:GardenFogUniforms;ground:GardenGroundUniforms}){
 const root=source.clone(true),owned=new Map<Material,Material>();let waterNormal:Texture|null=null;const waterMeshes:Mesh[]=[];
 root.traverse(object=>{
  if(!(object instanceof Mesh))return;
  const prepare=(original:Material)=>{
   if(owned.has(original))return owned.get(original)!;
   const material=original.clone();owned.set(original,material);
   if(material instanceof MeshStandardMaterial){
    if(material.name==='Pond_Water'){waterNormal=material.normalMap;material.color.set('#426f68');material.roughness=.12;material.metalness=.25;material.envMapIntensity=.75;material.normalScale.set(.18,.18);}
    if(material.name==='Oiled_Timber'){material.roughness=.57;material.normalScale.set(.25,.25);}
    if(material.name==='Weathered_Cedar')material.normalScale.set(.35,.35);
    if(material.name==='Glazed_Ceramic'){material.roughness=.19;material.envMapIntensity=.85;}
   }
   if(patch)patchGardenMaterial(material,material.name==='Forest_Floor'?{fog:patch.fog,ground:patch.ground,groundMode:'floor'}:OCCLUDED.has(material.name)?{fog:patch.fog,ground:patch.ground,groundMode:'occlude'}:{fog:patch.fog});
   return material;
  };
  object.material=Array.isArray(object.material)?object.material.map(prepare):prepare(object.material);
  if((Array.isArray(object.material)?object.material:[object.material]).some(m=>m.name==='Weathered_Cedar'))removePavilionPosts(object);
  // Without its posts the pavilion roof (beams, crossbeams, louvers) would float over the trays.
  if(/^Pavilion_/.test(object.name))object.visible=false;
  object.castShadow=true;object.receiveShadow=true;
  if((Array.isArray(object.material)?object.material:[object.material]).some(m=>m.name==='Pond_Water')){object.castShadow=false;waterMeshes.push(object);}
 });
 let released=false;
 return {root,waterNormal,setReflections(enabled:boolean){for(const mesh of waterMeshes)mesh.visible=!enabled;},setLanterns(lit:boolean){for(const material of owned.values())if(material instanceof MeshStandardMaterial&&material.name==='Warm_Lantern')material.emissiveIntensity=lit?2.4:0;},dispose(){if(released)return;released=true;for(const material of owned.values())material.dispose();}};
}
