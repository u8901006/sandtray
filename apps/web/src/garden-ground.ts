import {DataTexture,LinearFilter,LinearMipmapLinearFilter,Mesh,RGBAFormat,UnsignedByteType,Vector3,type Object3D} from 'three';
import {gardenFloor} from './garden-navigation';
import {gardenPlanting,grassDensity,wornPath} from './garden-layout';
// 2026-10-10 garden-visual-v4: one-off CPU bake of the garden ground, from the loaded GLB itself so the shading and
// the grass placement follow the real terrain. Channels documented in garden-shaders.ts. ~0.1 s on a laptop.
export const GROUND_EXTENT=110,GROUND_CELLS=440;
const CELL=2*GROUND_EXTENT/GROUND_CELLS;
type Grid=Float32Array;
const index=(i:number,j:number)=>j*GROUND_CELLS+i;
const toCell=(v:number)=>(v+GROUND_EXTENT)/CELL-.5;

function meshesOf(root:Object3D,names:string[]){const out:Mesh[]=[];root.updateWorldMatrix(true,true);root.traverse(o=>{if(o instanceof Mesh&&(Array.isArray(o.material)?o.material:[o.material]).some(m=>names.includes(m.name)))out.push(o);});return out;}
function eachTriangle(mesh:Mesh,visit:(a:Vector3,b:Vector3,c:Vector3)=>void){
 const position=mesh.geometry.getAttribute('position'),idx=mesh.geometry.getIndex(),count=idx?idx.count:position.count;
 const v=[new Vector3(),new Vector3(),new Vector3()];
 for(let t=0;t<count;t+=3){for(let k=0;k<3;k++)v[k].fromBufferAttribute(position,idx?idx.getX(t+k):t+k).applyMatrix4(mesh.matrixWorld);visit(v[0],v[1],v[2]);}
}
/** Writes value (or the interpolated height) into every cell whose centre lies inside the triangle's XZ footprint. */
function rasterize(grid:Grid,a:Vector3,b:Vector3,c:Vector3,mode:'height'|'mark'){
 const ax=toCell(a.x),az=toCell(a.z),bx=toCell(b.x),bz=toCell(b.z),cx=toCell(c.x),cz=toCell(c.z);
 const area=(bx-ax)*(cz-az)-(cx-ax)*(bz-az);if(Math.abs(area)<1e-9)return;
 const i0=Math.max(0,Math.ceil(Math.min(ax,bx,cx))),i1=Math.min(GROUND_CELLS-1,Math.floor(Math.max(ax,bx,cx)));
 const j0=Math.max(0,Math.ceil(Math.min(az,bz,cz))),j1=Math.min(GROUND_CELLS-1,Math.floor(Math.max(az,bz,cz)));
 for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
  const w0=((bx-i)*(cz-j)-(cx-i)*(bz-j))/area,w1=((cx-i)*(az-j)-(ax-i)*(cz-j))/area,w2=1-w0-w1;
  if(w0<-1e-6||w1<-1e-6||w2<-1e-6)continue;
  grid[index(i,j)]=mode==='height'?w0*a.y+w1*b.y+w2*c.y:1;
 }
}
function splat(grid:Grid,x:number,z:number,radius:number,amount:number){
 const ci=toCell(x),cj=toCell(z),r=radius/CELL;
 for(let j=Math.max(0,Math.floor(cj-r));j<=Math.min(GROUND_CELLS-1,Math.ceil(cj+r));j++)for(let i=Math.max(0,Math.floor(ci-r));i<=Math.min(GROUND_CELLS-1,Math.ceil(ci+r));i++){const d=Math.hypot(i-ci,j-cj)/r;if(d<1)grid[index(i,j)]+=amount*(1-d*d);}
}
/** Three separable box passes approximate a Gaussian of the given radius (cells). */
function blur(grid:Grid,radius:number){
 const tmp=new Float32Array(grid.length);
 for(let pass=0;pass<3;pass++)for(const horizontal of [true,false]){
  const src=horizontal?grid:tmp,dst=horizontal?tmp:grid;
  for(let line=0;line<GROUND_CELLS;line++){let sum=0;const at=(k:number)=>horizontal?index(Math.min(GROUND_CELLS-1,Math.max(0,k)),line):index(line,Math.min(GROUND_CELLS-1,Math.max(0,k)));
   for(let k=-radius;k<=radius;k++)sum+=src[at(k)];
   for(let k=0;k<GROUND_CELLS;k++){dst[horizontal?index(k,line):index(line,k)]=sum/(2*radius+1);sum+=src[at(k+radius+1)]-src[at(k-radius)];}}
 }
}
export type GardenGround={texture:DataTexture;heightAt(x:number,z:number):number;grassAt(x:number,z:number):number;occlusionAt(x:number,z:number):number;dispose():void};
export function bakeGardenGround(root:Object3D):GardenGround{
 const size=GROUND_CELLS*GROUND_CELLS,height=new Float32Array(size).fill(NaN),built=new Float32Array(size),canopy=new Float32Array(size),contact=new Float32Array(size);
 for(const mesh of meshesOf(root,['Forest_Floor']))eachTriangle(mesh,(a,b,c)=>rasterize(height,a,b,c,'height'));
 for(const mesh of meshesOf(root,['Garden_Gravel','Oiled_Timber','Lime_Plaster','Granite','Pond_Water']))eachTriangle(mesh,(a,b,c)=>rasterize(built,a,b,c,'mark'));
 for(const mesh of meshesOf(root,['Granite','Weathered_Cedar','Lime_Plaster']))eachTriangle(mesh,(a,b,c)=>rasterize(contact,a,b,c,'mark'));
 const point=new Vector3();
 for(const mesh of meshesOf(root,['Foliage_0','Foliage_1','Foliage_2','Foliage_3'])){const p=mesh.geometry.getAttribute('position');for(let k=0;k<p.count;k+=2){point.fromBufferAttribute(p,k).applyMatrix4(mesh.matrixWorld);const i=Math.round(toCell(point.x)),j=Math.round(toCell(point.z));if(i>=0&&j>=0&&i<GROUND_CELLS&&j<GROUND_CELLS)canopy[index(i,j)]+=1;}}
 for(const tree of gardenPlanting('cinema').tree)splat(canopy,tree.x,tree.z,2.6*tree.scale,6);
 blur(canopy,4);blur(contact,2);
 const builtSoft=Float32Array.from(built);blur(builtSoft,2);
 const data=new Uint8Array(size*4),grass=new Float32Array(size),occlusion=new Float32Array(size);
 for(let j=0;j<GROUND_CELLS;j++)for(let i=0;i<GROUND_CELLS;i++){
  const k=index(i,j),x=(i+.5)*CELL-GROUND_EXTENT,z=(j+.5)*CELL-GROUND_EXTENT;
  const shade=1-Math.exp(-canopy[k]*.9),ao=(1-.5*shade)*(1-.55*Math.min(1,contact[k]*1.6)*(1-built[k]*.6));
  const g=built[k]>0?0:grassDensity(x,z)*(1-.45*shade)*(1-Math.min(1,builtSoft[k]*1.4));
  const worn=Math.max(wornPath(x,z),Math.min(1,builtSoft[k]*1.2)*(1-built[k]));
  occlusion[k]=ao;grass[k]=g;
  data[k*4]=Math.round(ao*255);data[k*4+1]=Math.round(g*255);data[k*4+2]=Math.round(worn*255);data[k*4+3]=255;
 }
 const texture=new DataTexture(data,GROUND_CELLS,GROUND_CELLS,RGBAFormat,UnsignedByteType);
 texture.magFilter=LinearFilter;texture.minFilter=LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.flipY=false;texture.needsUpdate=true;
 const sample=(grid:Grid,x:number,z:number)=>{const i=Math.round(toCell(x)),j=Math.round(toCell(z));return i<0||j<0||i>=GROUND_CELLS||j>=GROUND_CELLS?NaN:grid[index(i,j)];};
 let disposed=false;
 return {texture,
  heightAt(x,z){const ci=toCell(x),cj=toCell(z),i=Math.floor(ci),j=Math.floor(cj),fx=ci-i,fz=cj-j;const h=(a:number,b:number)=>a<0||b<0||a>=GROUND_CELLS||b>=GROUND_CELLS?NaN:height[index(a,b)];
   const v=[h(i,j),h(i+1,j),h(i,j+1),h(i+1,j+1)];if(v.some(Number.isNaN))return Number.isNaN(v[0])?gardenFloor(x,z):v[0];return (v[0]*(1-fx)+v[1]*fx)*(1-fz)+(v[2]*(1-fx)+v[3]*fx)*fz;},
  grassAt:(x,z)=>sample(grass,x,z)||0,occlusionAt:(x,z)=>{const v=sample(occlusion,x,z);return Number.isNaN(v)?1:v;},
  dispose(){if(disposed)return;disposed=true;texture.dispose();}};
}
