import {base64ToBytes,surfaceU8,type Heightmap,type BrushTool} from '../../../packages/sand-engine/src/core';
import {createTrayHeightmap,strokeTray,quantizeWater} from '../../../packages/sand-engine/src/tray';
import {CM_PER_UNIT,STANDARD_TRAY_CONFIG,trayConfigSchema,clampToTray,type TrayId,type TrayConfig} from '../../../packages/protocol/src/index';
export {CM_PER_UNIT};
// REQ-016 product slice (Claude Opus 5.5, 2026-09-30). The server is the authority: `confirmed` only ever changes by replaying
// tray.changed in trayRevision order (or by adopting a snapshot). `display` = confirmed + this tab's strokes that are not yet
// confirmed, so digging feels immediate; a rejected or lost stroke disappears on the next rebuild.
// A6: each tray has the shape and size chosen when the room was created; a snapshot with a different tray reconfigures the model.
export type Point=[number,number];
export interface TrayChanged {trayId:TrayId;trayRevision:number;operationId:string;stroke?:{tool:BrushTool;points:Point[]};waterLevel:number}
export interface SnapshotTray {id:string;shape?:string;sizeCm?:{w:number;h:number;depth:number};heightmap:{w:number;h:number;data:string};waterLevel:number;revision?:number}
/** Tray size in world units (7.2 cm per unit): the standard 72 x 57 x 7 cm tray is 10 x 7.92 x 0.97. */
export function traySize(config:TrayConfig){return {x:config.w/CM_PER_UNIT,z:config.h/CM_PER_UNIT,depth:config.depth/CM_PER_UNIT};}
/** Standard tray size (kept for callers that only know the default room). */
export const TRAY_SIZE=traySize(STANDARD_TRAY_CONFIG);
/** Sand above the original surface is drawn this many times taller than the heightmap's +3 cm, so a mound can grow into a small dune
 * (about 9 cm) without changing the u8 format that the server, sync and saves share (user decision 2026-10-05). Below the surface
 * (digging, water) the scale is unchanged. */
export const MOUND_DISPLAY_SCALE=3;
/** u8 0 = tray floor, 255 = original surface + 3 cm (shown as + 3 x MOUND_DISPLAY_SCALE cm); the untouched surface (u8 179 at 7 cm)
 * is exactly y 0, so an object placed on flat sand keeps y 0 as before trays existed. */
export function u8ToY(v:number,depthCm=7){const above=v-surfaceU8(depthCm);return (above>0?above*MOUND_DISPLAY_SCALE:above)/255*(depthCm+3)/CM_PER_UNIT;}
/** Width (cells, 0.5 cm each) and passes of the box blur that rounds the dunes. The brush clamps at u8 255, so a mound held in place
 * becomes a flat-topped mesa; drawn 3x taller its sides would be cliffs. Only the part above the original surface is blurred (over cells
 * inside the tray, so a dune neither spills over the rim nor sags at the wall); every cell then adds its own depth below the surface at
 * true scale. A drawn height is thus a fixed function of nearby cells: one stroke moves it smoothly (no 3 cm drop where a dug cell
 * crosses the surface), dug hollows keep their depth, and a cell dug a little next to a dune keeps part of the dune's rounded skirt.
 * The water reads these same drawn heights, so shore and depth agree with the sand (GPT-6.1 SOL reviews 2026-10-05). */
const DUNE_BLUR_RADIUS=2,DUNE_BLUR_PASSES=3;
function blurPass(src:Float32Array,dst:Float32Array,w:number,h:number,r:number,horizontal:boolean){
 const lines=horizontal?h:w,len=horizontal?w:h,step=horizontal?1:w,stride=horizontal?w:1;
 for(let line=0;line<lines;line++){const base=line*stride;let sum=0;
  for(let k=0;k<=Math.min(r,len-1);k++)sum+=src[base+k*step];
  for(let k=0;k<len;k++){dst[base+k*step]=sum;const add=k+r+1,drop=k-r;if(add<len)sum+=src[base+add*step];if(drop>=0)sum-=src[base+drop*step];}}
}
/** A cell dug to the floor is drawn this far below the blue floor, so the floor (not a thin sand skin) shows. */
export const SAND_SINK=.08;
/** A cell dug to u8 0 sinks below the floor in proportion as what is left of a dune's skirt on it falls under SAND_SINK (about 0.58
 * cm): equal widths keep the sink from amplifying small skirt changes into a jumping floor seam. */
const FLOOR_SKIRT=SAND_SINK;
/** The floor sink fades out over the last 12 u8 steps above the floor (about 0.5 cm of sand), so a thin film there already shows some
 * of the blue floor; one stroke (3 u8) then moves the visible floor seam by no more than a normal stroke does elsewhere. */
const FLOOR_SINK_U8=12;
/** The blue inner wall stands this far inside the tray outline: exactly half a heightmap cell (0.25 cm), which is where a rectangular
 * tray's outermost sand vertices are, past the wood rim's bevel (0.03). On round and octagonal trays the sand mesh reaches the outline
 * behind the wall, and the water is clipped to the wall in its shader (user report and GPT-6.1 SOL reviews 2026-10-05). */
export const BLUE_WALL_INSET=.25/CM_PER_UNIT;
/** Segments of a round tray's outline (wood, blue wall, floor). */
export const CIRCLE_SEGMENTS=72;
/** Height of the thin blue ring that closes the gap between the blue wall and the rim (drawn by sandtray-surface). */
export const BLUE_LIP_Y=-.002;
/** World y of every sand-mesh vertex: the dunes (above the original surface, MOUND_DISPLAY_SCALE times taller) blurred over the cells
 * inside the tray plus each cell's own depth below the surface at true scale, a cell dug to u8 0 sunk SAND_SINK below the floor, cells outside the shape at the
 * original surface. The sand mesh draws exactly these heights; surfaceY and the water read them too. */
export function sandHeightsY(hm:Heightmap,out=new Float32Array(hm.data.length)){
 const s=surfaceU8(hm.depthCm),{w,h,data,mask}=hm,n=data.length,unit=(hm.depthCm+3)/255/CM_PER_UNIT,bottom=-hm.depthCm/CM_PER_UNIT-SAND_SINK;
 // Masked blur: blur value x mask and the mask itself, then divide, so cells outside the tray neither give nor take height.
 let v=new Float32Array(n),m=new Float32Array(n),tv=new Float32Array(n),tm=new Float32Array(n),flat=true;
 for(let k=0;k<n;k++)if(mask[k]){const d=data[k]-s;m[k]=1;if(d>0){v[k]=d*MOUND_DISPLAY_SCALE*unit;flat=false;}}
 if(!flat)for(let pass=0;pass<DUNE_BLUR_PASSES;pass++){
  blurPass(v,tv,w,h,DUNE_BLUR_RADIUS,true);blurPass(m,tm,w,h,DUNE_BLUR_RADIUS,true);blurPass(tv,v,w,h,DUNE_BLUR_RADIUS,false);blurPass(tm,m,w,h,DUNE_BLUR_RADIUS,false);
  for(let k=0;k<n;k++){v[k]=mask[k]&&m[k]>0?v[k]/m[k]:0;m[k]=mask[k];}
 }
 // A cell dug to u8 0 keeps any dune skirt it still has and sinks below the floor as the skirt fades, so the blue floor shows once it is
 // gone. The sink follows the skirt, not the height: rounding of the original surface leaves u8 0 a little above the floor on 5, 8, 9
 // and 10 cm trays (GPT-6.1 SOL fourth re-review); and it is proportional, not a switch, so a stroke nearby that nudges the skirt across
 // the threshold does not make the floor seam jump (fifth re-review). It also fades over the last FLOOR_SINK_U8 steps above the floor,
 // so a stroke that lifts a floor cell off u8 0 does not undo the whole sink at once (sixth re-review).
 for(let k=0;k<n;k++){const y=v[k]+Math.min(data[k]-s,0)*unit;out[k]=!mask[k]?0:data[k]<FLOOR_SINK_U8?y-SAND_SINK*Math.max(0,1-v[k]/FLOOR_SKIRT)*(1-data[k]/FLOOR_SINK_U8):y;}
 return out;
}
/** The water stops at the blue wall: true inside the wall's outline (the tray outline inset by BLUE_WALL_INSET; a round tray's wall is a
 * CIRCLE_SEGMENTS-gon, so its inscribed circle). The water shader applies the same test per fragment (sandtray-surface WATER_FRAGMENT). */
export function insideBlueWall(config:TrayConfig,x:number,z:number){
 const hx=config.w/CM_PER_UNIT/2-BLUE_WALL_INSET,hz=config.h/CM_PER_UNIT/2-BLUE_WALL_INSET;
 if(config.shape==='circle')return Math.hypot(x,z)<=(config.w/CM_PER_UNIT/2)*Math.cos(Math.PI/CIRCLE_SEGMENTS)-BLUE_WALL_INSET;
 if(config.shape==='octagon')return Math.max(Math.abs(x),Math.abs(z),(Math.abs(x)+Math.abs(z))/Math.SQRT2)<=hx;
 return Math.abs(x)<=hx&&Math.abs(z)<=hz;
}
/** The blue wall itself (and the blue ring behind it) as drawn: a round tray's wall is the CIRCLE_SEGMENTS-gon, not its inscribed
 * circle. Used to tell what an object stands on behind the wall; the water keeps the conservative insideBlueWall clip (GPT-6.1 SOL
 * eighth re-review: using the inscribed circle here lifted objects 7 cm onto a ring that is not there). */
export function insideBlueWallPolygon(config:TrayConfig,x:number,z:number){
 if(config.shape!=='circle')return insideBlueWall(config,x,z);
 const step=Math.PI*2/CIRCLE_SEGMENTS,sector=Math.floor(Math.atan2(z,x)/step),normal=(sector+.5)*step;
 return x*Math.cos(normal)+z*Math.sin(normal)<=(config.w/CM_PER_UNIT/2-BLUE_WALL_INSET)*Math.cos(Math.PI/CIRCLE_SEGMENTS);
}
/** Tray-local world x/z -> integer cell, or undefined outside the sand (outside the grid or the shape mask). */
export function cellAt(hm:Heightmap,x:number,z:number):Point|undefined{
 const i=Math.floor((x/(hm.sizeCm.w/CM_PER_UNIT)+.5)*hm.w),j=Math.floor((z/(hm.sizeCm.h/CM_PER_UNIT)+.5)*hm.h);
 return i>=0&&j>=0&&i<hm.w&&j<hm.h&&hm.mask[j*hm.w+i]?[i,j]:undefined;
}
const configOf=(hm:Heightmap):TrayConfig=>({shape:hm.shape,w:hm.sizeCm.w,h:hm.sizeCm.h,depth:hm.depthCm});
/** Tray-local x/z of every sand-mesh vertex: cell centres, with cells outside a round or octagonal tray pulled onto its outline (behind
 * the blue wall) so the sand meets the wall without a stair-stepped edge. Only cells outside the shape move: clamping sand cells too
 * folded triangles over each other (GPT-6.1 SOL fourth re-review). The sand mesh, the water and
 * surfaceY all use these vertices and the same triangles. */
export function sandVerticesXZ(hm:Heightmap){
 const {w,h,mask}=hm,config=configOf(hm),sx=hm.sizeCm.w/CM_PER_UNIT,sz=hm.sizeCm.h/CM_PER_UNIT,out=new Float32Array(w*h*2);
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){const k=j*w+i;let x=((i+.5)/w-.5)*sx,z=((j+.5)/h-.5)*sz;if(!mask[k])[x,z]=clampToTray(config,x,z);out[k*2]=x;out[k*2+1]=z;}
 return out;
}
/** Mesh triangles of quad (i,j): a=(i,j) b=(i+1,j) c=(i,j+1) d=(i+1,j+1) as (a,c,b) and (b,c,d), kept only if a corner is sand and
 * the triangle still faces up after outline pulling. */
// A triangle whose outline-pulled corners fold it over (opposite winding) or flatten it is left out: on octagonal trays radial pulling
// near the corners folded some over their neighbours (GPT-6.1 SOL fourth re-review). The tests check that this leaves no gap inside the
// blue wall.
export function sandIndex(hm:Heightmap){
 const {w,h}=hm,xz=sandVerticesXZ(hm),index:number[]=[];
 for(let j=0;j<h-1;j++)for(let i=0;i<w-1;i++){const a=j*w+i;if(!quadHasSand(hm,a))continue;
  if(facesUp(xz,a,a+w,a+1))index.push(a,a+w,a+1);if(facesUp(xz,a+1,a+w,a+w+1))index.push(a+1,a+w,a+w+1);}
 return index;
}
const facesUp=(xz:Float32Array,a:number,b:number,c:number)=>(xz[b*2]-xz[a*2])*(xz[c*2+1]-xz[a*2+1])-(xz[c*2]-xz[a*2])*(xz[b*2+1]-xz[a*2+1])<-1e-12;
export function quadHasSand(hm:Heightmap,a:number){const {w,mask}=hm;return !!(mask[a]||mask[a+1]||mask[a+w]||mask[a+w+1]);}
// surfaceY runs on every drag move: reuse heights and vertices until the heightmap's bytes change.
const heightCache=new WeakMap<Heightmap,{data:Uint8Array;heights:Float32Array;xz:Float32Array}>();
function cached(hm:Heightmap){
 const hit=heightCache.get(hm);if(hit&&hit.data.length===hm.data.length&&hit.data.every((v,k)=>v===hm.data[k]))return hit;
 const next={data:hm.data.slice(),heights:sandHeightsY(hm),xz:hit&&hit.xz.length===hm.data.length*2?hit.xz:sandVerticesXZ(hm)};heightCache.set(hm,next);return next;
}
/** Visible height under a tray-local point: the sand mesh's own triangle under it (curved edges included), never below the blue floor
 * (where the mesh sinks under the floor the floor is what shows) and, behind the blue wall, never below the blue ring. Used to seat
 * placed and dragged objects. */
export function surfaceY(hm:Heightmap,x:number,z:number){
 const {heights:y,xz}=cached(hm),{w,h}=hm,floor=-hm.depthCm/CM_PER_UNIT;
 // Behind the blue wall the sand runs on under the blue ring: what the viewer sees there is the ring, or sand standing above it
 // (GPT-6.1 SOL seventh re-review: a hollow dug against a round wall seated an object 7 cm under the ring).
 const behind=!insideBlueWallPolygon(configOf(hm),x,z),seen=(sand:number)=>behind?Math.max(sand,BLUE_LIP_Y):Math.max(sand,floor);
 const gx=(x/(hm.sizeCm.w/CM_PER_UNIT)+.5)*w-.5,gz=(z/(hm.sizeCm.h/CM_PER_UNIT)+.5)*h-.5;
 const tri=(p:number,q:number,r:number)=>{
  const [x1,z1,x2,z2,x3,z3]=[xz[p*2],xz[p*2+1],xz[q*2],xz[q*2+1],xz[r*2],xz[r*2+1]],det=(z2-z3)*(x1-x3)+(x3-x2)*(z1-z3);if(Math.abs(det)<1e-12)return undefined;
  const l1=((z2-z3)*(x-x3)+(x3-x2)*(z-z3))/det,l2=((z3-z1)*(x-x3)+(x1-x3)*(z-z3))/det,l3=1-l1-l2,e=-1e-9;
  return l1>=e&&l2>=e&&l3>=e?l1*y[p]+l2*y[q]+l3*y[r]:undefined;};
 // Pulled-in outline vertices move at most a cell or two, so the containing triangle is in a quad near the grid position.
 const ci=Math.floor(gx),cj=Math.floor(gz);
 for(let j=Math.max(0,cj-2);j<=Math.min(h-2,cj+2);j++)for(let i=Math.max(0,ci-2);i<=Math.min(w-2,ci+2);i++){
  const a=j*w+i;if(!quadHasSand(hm,a))continue;const found=(facesUp(xz,a,a+w,a+1)?tri(a,a+w,a+1):undefined)??(facesUp(xz,a+1,a+w,a+w+1)?tri(a+1,a+w,a+w+1):undefined);if(found!==undefined)return seen(found);
 }
 // Not on a drawn triangle. Dropping folded triangles at an octagonal tray's corners leaves slivers up to about 0.1 mm wide inside the
 // blue wall (GPT-6.1 SOL fifth re-review); there the object takes the height of the nearest sand point, so it neither floats nor sinks.
 let best=Infinity,near=0;
 const closest=(p:number,q:number,r:number)=>{const P=[p,q,r];
  for(let e=0;e<3;e++){const A=P[e],B=P[(e+1)%3],ax=xz[A*2],az=xz[A*2+1],dx=xz[B*2]-ax,dz=xz[B*2+1]-az,len=dx*dx+dz*dz;if(len<1e-18)continue;
   const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/len)),d=Math.hypot(x-ax-t*dx,z-az-t*dz);if(d<best){best=d;near=y[A]+(y[B]-y[A])*t;}}};
 for(let j=Math.max(0,cj-2);j<=Math.min(h-2,cj+2);j++)for(let i=Math.max(0,ci-2);i<=Math.min(w-2,ci+2);i++){
  const a=j*w+i;if(!quadHasSand(hm,a))continue;if(facesUp(xz,a,a+w,a+1))closest(a,a+w,a+1);if(facesUp(xz,a+1,a+w,a+w+1))closest(a+1,a+w,a+w+1);
 }
 if(best<=SLIVER&&!behind)return seen(near); // never behind the blue wall (sixth re-review)
 return behind?BLUE_LIP_Y:0; // no sand drawn here: behind the blue wall the blue ring, otherwise the original surface
}
/** Widest gap between drawn sand triangles that surfaceY still treats as sand (0.15 mm). */
const SLIVER=.015/CM_PER_UNIT;
const sameConfig=(a:TrayConfig,b:TrayConfig)=>a.shape===b.shape&&a.w===b.w&&a.h===b.h&&a.depth===b.depth;
export class TrayModel {
 config:TrayConfig;confirmed:Heightmap;display:Heightmap;revision=0;water=0;version=0;
 pending:{id:string;tool:BrushTool;points:Point[]}[]=[];
 private listeners=new Set<()=>void>();
 private rippleListeners=new Set<(x:number,z:number,strength:number)=>void>();
 constructor(readonly id:TrayId,config:TrayConfig=STANDARD_TRAY_CONFIG){this.config=config;this.confirmed=createTrayHeightmap(config);this.display=createTrayHeightmap(config);}
 subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 private changed(){this.version++;for(const listener of this.listeners)listener();}
 /** Water ripples (renderer only): tray-local x/z and a strength (sand stroke 0.6, an object set into the water 1). */
 onRipple(listener:(x:number,z:number,strength:number)=>void){this.rippleListeners.add(listener);return()=>{this.rippleListeners.delete(listener);};}
 ripple(x:number,z:number,strength=1){for(const listener of this.rippleListeners)listener(x,z,strength);}
 private rippleAt([i,j]:Point){const size=traySize(this.config);this.ripple(((i+.5)/this.confirmed.w-.5)*size.x,((j+.5)/this.confirmed.h-.5)*size.z,.6);}
 private rebuild(){this.display.data.set(this.confirmed.data);for(const p of this.pending)strokeTray(this.display,p.tool,p.points);this.changed();}
 /** Switch to another tray shape/size: fresh flat sand, no water, revision 0 (local practice set-up, or a snapshot of another room). */
 configure(config:TrayConfig){
  if(sameConfig(config,this.config))return false;
  this.config=config;this.confirmed=createTrayHeightmap(config);this.display=createTrayHeightmap(config);this.revision=0;this.water=0;this.pending=[];this.changed();return true;
 }
 /** Adopt a snapshot tray unless it is older than what this tab has already replayed. */
 adopt(tray:SnapshotTray){
  if(tray.shape&&tray.sizeCm){const parsed=trayConfigSchema.safeParse({shape:tray.shape,...tray.sizeCm});if(!parsed.success)throw new Error('TRAY_SHAPE_UNSUPPORTED');this.configure(parsed.data);}
  const revision=tray.revision??0;if(revision<this.revision)return;
  const data=base64ToBytes(tray.heightmap.data);if(tray.heightmap.w!==this.confirmed.w||tray.heightmap.h!==this.confirmed.h||data.length!==this.confirmed.data.length)throw new Error('TRAY_SHAPE_UNSUPPORTED');
  this.confirmed.data.set(data);this.revision=revision;this.water=tray.waterLevel;this.rebuild();
 }
 /** Returns false when the event is not the next revision: the caller must refetch the snapshot. */
 replay(event:TrayChanged){
  if(event.trayRevision<=this.revision)return true;if(event.trayRevision!==this.revision+1)return false;
  if(event.stroke){strokeTray(this.confirmed,event.stroke.tool,event.stroke.points);
   // Another tab's stroke ripples here too; this tab's own strokes already rippled when they were drawn.
   if(!this.pending.some(p=>p.id===event.operationId))this.rippleAt(event.stroke.points[event.stroke.points.length-1]);}
  this.water=event.waterLevel;this.revision=event.trayRevision;
  this.pending=this.pending.filter(p=>p.id!==event.operationId);this.rebuild();return true;
 }
 /** Optimistic local stroke; `id` is the operationId the stroke will be sent with. */
 stroke(id:string,tool:BrushTool,point:Point){
  let open=this.pending.at(-1);if(!open||open.id!==id){open={id,tool,points:[]};this.pending.push(open);}
  open.points.push(point);strokeTray(this.display,tool,[point]);this.rippleAt(point);this.changed();
 }
 drop(id:string){const before=this.pending.length;this.pending=this.pending.filter(p=>p.id!==id);if(this.pending.length!==before)this.rebuild();}
 /** Local-only mode (no room): strokes are final immediately. */
 applyLocal(tool:BrushTool,point:Point){strokeTray(this.confirmed,tool,[point]);strokeTray(this.display,tool,[point]);this.rippleAt(point);this.changed();}
 setLocalWater(level:number){this.water=quantizeWater(level);this.changed();}
 /** Local-only undo/redo: put back a saved heightmap and water level. */
 restoreLocal(data:Uint8Array,water:number){this.confirmed.data.set(data);this.water=water;this.rebuild();}
 /** Connection lost: unconfirmed strokes are either replayed by the receipt retry (and come back as tray.changed) or are gone. */
 clearPending(){if(this.pending.length){this.pending=[];this.rebuild();}}
}
