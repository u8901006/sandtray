import navigation from './garden-colliders-v2.json';
export const gardenStops={entry:{position:[3,1.4,8],yaw:0},water:{position:[-10,1.4,10],yaw:Math.PI/2},cabin:{position:[21,1.4,-9],yaw:0},circle:{position:[9,1.4,-13],yaw:Math.atan2(1,5)}} as const;
export function gardenFloor(x:number,z:number){const y=-z,r=Math.hypot(x,y);let h=-.48+Math.max(0,r-24)*.019+Math.max(0,r-43)**1.25*.065*(1+.35*Math.sin(x*.13)*Math.cos(y*.11));h+=Math.min(1,Math.max(0,r-13)/16)*(.35*Math.sin(x*.17)*Math.cos(y*.14));const d=((x+23)/12)**2+((y+10)/9)**2;if(d<1.2)h-=1.6*Math.max(0,1-d/1.2);if(Math.abs(x)<7.9&&Math.abs(y)<6.4)h=Math.max(h,-.35);if(Math.abs(x-21)<5.1&&Math.abs(y-16)<4.1)h=Math.max(h,-.21);if(x>=-35&&x<=-10.8&&Math.abs(y+10)<1.3)h=Math.max(h,-.265+1.1*Math.sin(Math.min(1,(x+35)/24.12)*Math.PI));return h;}
type Collider={kind:'box';name:string;x:number;z:number;halfX:number;halfZ:number}|{kind:'ellipse';name:string;x:number;z:number;radiusX:number;radiusZ:number};
// 2026-09-30: the six pavilion posts were removed (garden-surfaces.ts), so their colliders go too.
const colliders=(navigation.colliders as Collider[]).filter(c=>c.name!=='Pavilion_column');
/** An added tree (garden-visual-v4, garden-layout.ts). The caller passes only trees that are drawn right now:
 * with 草叢與花木 off, or a model that failed to load, the tree must not leave an invisible obstacle (GPT-6 review F1). */
export type GardenTree={x:number;z:number;radius:number};
const insideTree=(x:number,z:number,t:GardenTree)=>Math.hypot(x-t.x,z-t.z)<t.radius+navigation.bodyRadius;
export function canWalkGarden(x:number,z:number,trees:readonly GardenTree[]=[]){
 return canWalkBase(x,z)&&!trees.some(t=>insideTree(x,z,t));
}
function canWalkBase(x:number,z:number){
 const radius=navigation.bodyRadius,y=-z;
 if(!Number.isFinite(x)||!Number.isFinite(z)||Math.abs(x)>navigation.bounds-radius||Math.abs(z)>navigation.bounds-radius)return false;
 const bridge=Math.abs(y+10)<1.3-radius&&x>-35-radius&&x<-10.8+radius;
 if(((x+23)/(11.7+radius))**2+((y+10)/(8.7+radius))**2<1&&!bridge)return false;
 // REQ-016: two 72 x 57 cm trays side by side (x -10.85..10.85, z -4.21..4.21).
 if(Math.abs(x)<10.85+radius&&Math.abs(z)<4.21+radius)return false;
 for(const c of colliders){
  if(bridge&&c.name==='Boulder')continue;
  if(c.kind==='box'&&Math.abs(x-c.x)<c.halfX+radius&&Math.abs(z-c.z)<c.halfZ+radius)return false;
  if(c.kind==='ellipse'&&((x-c.x)/(c.radiusX+radius))**2+((z-c.z)/(c.radiusZ+radius))**2<1)return false;
 }
 return true;
}
/** A step is allowed onto walkable ground, or, when standing inside a tree that appeared under the walker (plants
 * finished loading or 草叢與花木 was switched on), any step that does not go deeper into that tree. */
function canStep(fromX:number,fromZ:number,toX:number,toZ:number,trees:readonly GardenTree[]){
 return canWalkBase(toX,toZ)&&trees.every(t=>!insideTree(toX,toZ,t)||insideTree(fromX,fromZ,t)&&Math.hypot(toX-t.x,toZ-t.z)>=Math.hypot(fromX-t.x,fromZ-t.z));
}
/** Bounded substeps prevent crossing a thin wall on a slow frame; blocked diagonals slide. */
export function moveInGarden(x:number,z:number,dx:number,dz:number,trees:readonly GardenTree[]=[]){
 if(![x,z,dx,dz].every(Number.isFinite)||!canWalkBase(x,z))return {x,z};
 const distance=Math.hypot(dx,dz);if(!distance)return {x,z};
 const ratio=Math.min(1,4/distance),steps=Math.ceil(Math.min(distance,4)/.08),sx=dx*ratio/steps,sz=dz*ratio/steps;
 for(let i=0;i<steps;i++){
  if(canStep(x,z,x+sx,z+sz,trees)){x+=sx;z+=sz;}
  else {if(canStep(x,z,x+sx,z,trees))x+=sx;if(canStep(x,z,x,z+sz,trees))z+=sz;}
 }
 return {x,z};
}
