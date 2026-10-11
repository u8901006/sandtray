import {describe,it,expect} from 'vitest';
import {Mesh,MeshBasicMaterial,DoubleSide,Raycaster,Vector3,type BufferGeometry} from 'three';
import {createShell,createWater,trayOutline,BLUE_WALL_INSET} from '../apps/web/src/sandtray-surface';
import {traySize,TrayModel,insideBlueWall} from '../apps/web/src/tray-model';
import {STANDARD_TRAY_CONFIG,type TrayConfig} from '../packages/protocol/src/index';
// User report 2026-10-05 (Claude Opus 5.5): a hollow dug against the wet tray's wall showed a band of wood (striped with blue) between
// the rim and the water. The blue inner wall must stand in front of every wood surface below the original sand surface: the walls'
// inner face used to be coplanar with it (z-fighting) and the rim's bevel reached inwards past it down to about -0.11.
const trays:TrayConfig[]=[STANDARD_TRAY_CONFIG,{shape:'square',w:60,h:60,depth:7},{shape:'circle',w:80,h:80,depth:10},{shape:'octagon',w:45,h:45,depth:5}];
const MARGIN=.002;
function vertices(geometry:BufferGeometry){const p=geometry.getAttribute('position'),out:[number,number,number][]=[];for(let k=0;k<p.count;k++)out.push([p.getX(k),p.getY(k),p.getZ(k)]);return out;}
function inside(poly:[number,number][],x:number,z:number){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,zi]=poly[i],[xj,zj]=poly[j];if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)c=!c;}return c;}
function distance(poly:[number,number][],x:number,z:number){let best=Infinity;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [ax,az]=poly[j],[bx,bz]=poly[i],dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)));best=Math.min(best,Math.hypot(x-ax-t*dx,z-az-t*dz));}return best;}

describe('dug edge shows the blue inside, not the wood shell',()=>{
 for(const config of trays)it(`${config.shape} ${config.w}x${config.h}x${config.depth}: no wood below the sand surface in front of or on the blue wall`,()=>{
  const shell=createShell(config),depth=traySize(config).depth;
  try{
   const blue=vertices(shell.strip),wall=blue.filter(([,y])=>Math.abs(y+depth)<1e-6).map(([x,,z]):[number,number]=>[x,z]);
   // The blue wall still runs from the tray floor up to the original sand surface, all the way round.
   expect(Math.min(...blue.map(v=>v[1]))).toBeCloseTo(-depth,6);expect(Math.max(...blue.map(v=>v[1]))).toBeCloseTo(0,6);
   expect(wall.length).toBe(blue.length/2);
   const offending:string[]=[];
   for(const [name,geometry] of [['rim',shell.rim],['walls',shell.walls]] as const)
    for(const [x,y,z] of vertices(geometry))
     if(y<-1e-6&&y>-depth&&(inside(wall,x,z)||distance(wall,x,z)<MARGIN))offending.push(`${name} (${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)})`);
   expect(offending.slice(0,5)).toEqual([]);
  }finally{shell.dispose();}
 });
 it('the blue wall stands exactly on the outermost sand vertices of a rectangular tray (half a cell), past the rim bevel',()=>{
  expect(BLUE_WALL_INSET).toBeGreaterThan(.03);
  expect(BLUE_WALL_INSET).toBeCloseTo(.25/7.2,9);
 });
});

// GPT-6.1 SOL review (2026-10-05): checking vertices alone passed with the blue wall's triangles removed, and looking straight down into
// the 0.36 mm gap between the blue wall and the rim bevel showed the water. These rays hit the real geometry.
const solid=(geometry:BufferGeometry,name:string)=>{const m=new Mesh(geometry,new MeshBasicMaterial({side:DoubleSide}));m.name=name;m.updateMatrixWorld();return m;};
describe('looking at a dug edge: the blue inside is what the eye meets',()=>{
 for(const config of trays)it(`${config.shape} ${config.w}x${config.h}x${config.depth}`,()=>{
  const shell=createShell(config),depth=traySize(config).depth,water=createWater(new TrayModel('wet',config));
  try{
   const wood=[solid(shell.rim,'rim'),solid(shell.walls,'walls')],blue=[solid(shell.strip,'strip'),solid(shell.lip,'lip'),solid(shell.floor,'floor')];
   const pool=solid(water.geometry,'water');pool.position.y=0;pool.updateMatrixWorld();
   // Water fragments outside the blue wall are discarded by its shader: skip those hits, as the GPU does.
   const scene=[...wood,...blue,pool],first=(origin:Vector3,dir:Vector3)=>new Raycaster(origin,dir.normalize()).intersectObjects(scene,false).find(h=>h.object.name!=='water'||insideBlueWall(config,h.point.x,h.point.z))?.object.name;
   const outline=trayOutline(config),n=outline.length;let side=0,top=0;
   for(let k=0;k<n;k++)for(const t of [.25,.5,.75]){
    const [ax,az]=outline[k],[bx,bz]=outline[(k+1)%n],x=ax+(bx-ax)*t,z=az+(bz-az)*t;
    // From inside the tray towards this point of the wall, at several depths below the surface: the blue wall comes first.
    for(const y of [-.05,-depth/2,-depth+.05]){expect(first(new Vector3(0,y,0),new Vector3(x,0,z))).toBe('strip');side++;}
    // Straight down into the gap between the blue wall and the rim bevel: the blue lip, never the water or the wood.
    // Step 0.0325 straight in from the wall (edge normal, pointing to the centre): between the rim bevel (0.03) and the blue wall (0.035).
    let nx=-(bz-az),nz=bx-ax;const nl=Math.hypot(nx,nz);nx/=nl;nz/=nl;if(nx*x+nz*z>0){nx=-nx;nz=-nz;}
    expect(first(new Vector3(x+nx*.0325,1,z+nz*.0325),new Vector3(0,-1,0))).toBe('lip');top++;
   }
   expect(side).toBeGreaterThan(20);expect(top).toBeGreaterThan(10);
   // The water plane really covers the tray: straight down anywhere inside the blue wall meets the water first.
   for(const [fx,fz] of [[0,0],[.3,.2],[-.35,-.25],[.4,-.1],[-.1,.4]]){const [ox,oz]=[fx*traySize(config).x,fz*traySize(config).z];expect(first(new Vector3(ox,1,oz),new Vector3(0,-1,0))).toBe('water');}
   // What survives the water's clip lies inside the blue wall polygon.
   const wall=trayOutline(config,-BLUE_WALL_INSET),p=water.geometry.getAttribute('position');
   for(let k=0;k<p.count;k++)if(insideBlueWall(config,p.getX(k),p.getZ(k)))expect(inside(wall,p.getX(k),p.getZ(k))||distance(wall,p.getX(k),p.getZ(k))<1e-6).toBe(true);
  }finally{shell.dispose();water.dispose();}
 },30000);
});
