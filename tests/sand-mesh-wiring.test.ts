import {describe,it,expect} from 'vitest';
import {Mesh,MeshBasicMaterial,DoubleSide,Raycaster,Vector3,Triangle} from 'three';
import {createSand,updateSand,createWater,createShell,waterWall,trayOutline} from '../apps/web/src/sandtray-surface';
import {TrayModel,sandHeightsY,surfaceY,traySize,CM_PER_UNIT,u8ToY,sandVerticesXZ,sandIndex,insideBlueWall,insideBlueWallPolygon,BLUE_WALL_INSET,BLUE_LIP_Y,CIRCLE_SEGMENTS} from '../apps/web/src/tray-model';
import {strokeTray} from '../packages/sand-engine/src/tray';
import {surfaceU8} from '../packages/sand-engine/src/core';
import type {TrayConfig} from '../packages/protocol/src/index';
// GPT-6.1 SOL review of 5daa495 (Claude Opus 5.5, 2026-10-05): the dune tests never looked at the drawn sand mesh (flattening every
// vertex still passed), a cell dug next to a dune was lifted above the surface, the blur spilled outside round trays, and objects were
// seated on the nearest cell instead of the drawn triangles. These tests build the real mesh with createSand/updateSand.
const STD:TrayConfig={shape:'rect',w:72,h:57,depth:7};
function sculpted(config=STD){
 const model=new TrayModel('dry',config),hm=model.display;
 for(let n=0;n<200;n++)strokeTray(hm,'mound',[[72,57]]);
 for(let n=0;n<26;n++)strokeTray(hm,'dig',[[72,57]]);   // the review's case: dig into the top of a dune
 for(let n=0;n<90;n++)strokeTray(hm,'dig',[[30,30]]);   // a hole dug to the blue floor
 for(let n=0;n<40;n++)strokeTray(hm,'dig',[[100,40]]);  // a shallow hollow
 return model;
}
// The product's sand material is single-sided (FrontSide), so the tests raycast the same way (GPT-6.1 SOL fourth re-review).
function mesh(model:TrayModel){const geometry=createSand(model);updateSand(geometry,model,false);return new Mesh(geometry,new MeshBasicMaterial());}

describe('sand mesh draws the dune heights',()=>{
 it('every vertex is at sandHeightsY (u8 0 sunk below the floor), and the dune really stands up',()=>{
  const model=sculpted(),hm=model.display,heights=sandHeightsY(hm),pos=mesh(model).geometry.getAttribute('position'),floor=-traySize(STD).depth;
  for(let k=0;k<hm.data.length;k++){expect(pos.getY(k)).toBeCloseTo(heights[k],5);if(hm.data[k]===0&&hm.mask[k])expect(pos.getY(k)).toBeLessThan(floor-.05);}
  let top=0;for(let k=0;k<pos.count;k++)top=Math.max(top,pos.getY(k));
  expect(top*CM_PER_UNIT).toBeGreaterThan(2);
 });
 it('the largest trays (120 cm, 240 x 240 cells) build their sand and water meshes',()=>{
  // Round 4 regression: index.push(...sandIndex(hm)) spread 343k arguments and threw RangeError on a 120 x 120 tray.
  for(const shape of ['rect','circle'] as const){const model=new TrayModel('wet',{shape,w:120,h:120,depth:10});
   const sand=mesh(model),water=createWater(model);try{expect(sand.geometry.getIndex()!.count).toBeGreaterThan(250000);expect(water.geometry.getIndex()!.count).toBe(sand.geometry.getIndex()!.count);}finally{water.dispose();}}
 });
 for(const size of [30,45,80,120])it(`${size} cm round and octagonal trays: no folded or overlapping sand triangles, and sand covers everything inside the blue wall`,()=>{
  for(const shape of ['circle','octagon','rect'] as const){
   const model=new TrayModel('dry',{shape,w:size,h:size,depth:7}),hm=model.display,xz=sandVerticesXZ(hm),index=sandIndex(hm);let flipped=0,up=0;
   for(let t=0;t<index.length;t+=3){const [a,b,c]=[index[t],index[t+1],index[t+2]];
    const area=(xz[b*2]-xz[a*2])*(xz[c*2+1]-xz[a*2+1])-(xz[c*2]-xz[a*2])*(xz[b*2+1]-xz[a*2+1]);if(area<-1e-12)up++;else if(area>1e-12)flipped++;}
   // Every triangle winds the same way (the mesh's up-facing winding); degenerate slivers on the outline are allowed.
   expect(flipped,`${shape} ${size}`).toBe(0);expect(up).toBeGreaterThan(index.length/3*.9);
   // Straight down just inside the blue wall all round: exactly one sand triangle (single-sided, as in the product).
   const sand=mesh(model),r=traySize(model.config).x/2;let checked=0;
   for(let k=0;k<720;k++){const ang=k/720*Math.PI*2,dir=[Math.cos(ang),Math.sin(ang)];
    let lo=0,hi=r;for(let it=0;it<40;it++){const mid=(lo+hi)/2;if(insideBlueWall(model.config,dir[0]*mid,dir[1]*mid))lo=mid;else hi=mid;}
    const [x,z]=[dir[0]*(lo-.0005),dir[1]*(lo-.0005)],hits=new Raycaster(new Vector3(x,5,z),new Vector3(0,-1,0)).intersectObject(sand);
    expect(hits.length,`${shape} ${size} at ${x.toFixed(4)},${z.toFixed(4)}`).toBe(1);expect(Math.abs(surfaceY(hm,x,z)-hits[0].point.y)).toBeLessThan(1e-4);checked++;}
   expect(checked).toBe(720);
  }
 },60000);
 it('fifth re-review corner gap: on a 60 cm octagon covered in dunes an object at the corner sliver sits on the nearest sand, not at 0',()=>{
  const model=new TrayModel('dry',{shape:'octagon',w:60,h:60,depth:7}),all:[number,number][]=[];
  for(let i=0;i<120;i+=2)for(let j=0;j<120;j+=2)all.push([i,j]);for(let n=0;n<120;n++)strokeTray(model.display,'mound',all);
  const [x,z]=[4.131422509,1.711291235];expect(insideBlueWall(model.config,x,z)).toBe(true);
  const sand=mesh(model),hits=new Raycaster(new Vector3(x,5,z),new Vector3(0,-1,0)).intersectObject(sand);
  const y=surfaceY(model.display,x,z);expect(y*CM_PER_UNIT).toBeGreaterThan(1);
  if(hits.length)expect(Math.abs(y-hits[0].point.y)).toBeLessThan(1e-4);
  else{const near=Array.from({length:16},(_,k)=>[x+Math.cos(k*Math.PI/8)*.001,z+Math.sin(k*Math.PI/8)*.001]).map(([px,pz])=>new Raycaster(new Vector3(px,5,pz),new Vector3(0,-1,0)).intersectObject(sand)[0]).filter(Boolean);
   // The ring lies on a dune's slope, so its points differ among themselves; the seat must match the closest of them.
   expect(near.length).toBeGreaterThan(0);expect(Math.min(...near.map(h=>Math.abs(y-h!.point.y)))*CM_PER_UNIT).toBeLessThan(.05);}
 });
 it('every octagon size (30-120 cm): gaps between sand triangles inside the blue wall at the corners are under 0.1 mm',()=>{
  let worst=0,samples=0,gaps=0;
  for(let size=30;size<=120;size++){
   const config={shape:'octagon' as const,w:size,h:size,depth:7},hm=new TrayModel('dry',config).display,xz=sandVerticesXZ(hm),index=sandIndex(hm);
   const apothem=size/CM_PER_UNIT/2-BLUE_WALL_INSET,R=apothem/Math.cos(Math.PI/8),corners=Array.from({length:8},(_,k)=>{const t=Math.PI/8+k*Math.PI/4;return [Math.cos(t)*R,Math.sin(t)*R];});
   const tris:number[][]=[];for(let t=0;t<index.length;t+=3){const [a,b,c]=[index[t],index[t+1],index[t+2]];const cx=Math.abs((xz[a*2]+xz[b*2]+xz[c*2])/3),cz=Math.abs((xz[a*2+1]+xz[b*2+1]+xz[c*2+1])/3);if(Math.max(cx,cz,(cx+cz)/Math.SQRT2)>apothem-.25)tris.push([a,b,c]);}
   const cover=(x:number,z:number)=>{let best=Infinity;for(const [a,b,c] of tris){const P=[a,b,c];let inside=true;
     for(let e=0;e<3;e++){const A=P[e],B=P[(e+1)%3],ex=xz[B*2]-xz[A*2],ez=xz[B*2+1]-xz[A*2+1];if(ex*(z-xz[A*2+1])-ez*(x-xz[A*2])>1e-12)inside=false;
      const len=ex*ex+ez*ez;if(len<1e-18)continue;const u=Math.max(0,Math.min(1,((x-xz[A*2])*ex+(z-xz[A*2+1])*ez)/len));best=Math.min(best,Math.hypot(x-xz[A*2]-u*ex,z-xz[A*2+1]-u*ez));}
     if(inside)return 0;}return best;};
   for(let k=0;k<8;k++){const [ax,az]=corners[k],[bx,bz]=corners[(k+1)%8];
    for(const t of [0,.002,.005,.01,.02,.05,.1,.2,.3,.5,.7,.8,.9,.95,.98,.99,.995,.998]){const scale=1-.0005/apothem,x=(ax+(bx-ax)*t)*scale,z=(az+(bz-az)*t)*scale;
     if(!insideBlueWall(config,x,z))continue;samples++;const d=cover(x,z);if(d>0)gaps++;worst=Math.max(worst,d);}}
  }
  expect(samples).toBeGreaterThan(91*8*15);
  expect(worst*CM_PER_UNIT*10).toBeLessThan(.1); // mm
 },120000);
 it('fifth re-review floor seam: mounding next to a hole dug to the floor never makes the visible surface jump',()=>{
  const model=new TrayModel('dry',{shape:'rect',w:30,h:30,depth:10}),hm=model.display,shell=createShell(model.config);
  try{
   const floor=new Mesh(shell.floor,new MeshBasicMaterial({side:DoubleSide}));floor.updateMatrixWorld();
   const visible=()=>{const sand=mesh(model);return new Raycaster(new Vector3(.455125592,5,.034722224),new Vector3(0,-1,0)).intersectObjects([sand,floor],false)[0].point.y*CM_PER_UNIT;};
   for(let n=0;n<200;n++)strokeTray(hm,'dig',[[30,30]]);
   let last=visible(),worst=0;
   for(const [tool,times] of [['mound',3],['dig',1],['mound',2],['dig',2]] as const)for(let n=0;n<times;n++){strokeTray(hm,tool,[[44,30]]);const now=visible();worst=Math.max(worst,Math.abs(now-last));last=now;}
   expect(worst).toBeLessThan(.15);
  }finally{shell.dispose();}
 });
 for(const [cell,depth] of [[[38,30],10],[[44,30],10],[[36,30],7],[[40,30],5]] as const)it(`sixth re-review floor seam: mounding and digging at [${cell}] beside a hole dug to the floor (${depth} cm) moves the visible surface less than a stroke (0.6 cm)`,()=>{
  const model=new TrayModel('dry',{shape:'rect',w:30,h:30,depth}),hm=model.display,shell=createShell(model.config);
  try{
   const floor=new Mesh(shell.floor,new MeshBasicMaterial({side:DoubleSide}));floor.updateMatrixWorld();
   const pts:[number,number][]=[];for(let i=0;i<40;i++)pts.push([(i/40-.5)*30/7.2*.9,.034722224]);
   const visible=()=>{const sand=mesh(model);return pts.map(([x,z])=>new Raycaster(new Vector3(x,5,z),new Vector3(0,-1,0)).intersectObjects([sand,floor],false)[0].point.y*CM_PER_UNIT);};
   for(let n=0;n<200;n++)strokeTray(hm,'dig',[[30,30]]);
   let last=visible(),worst=0;
   for(const [tool,times] of [['mound',1],['dig',1],['mound',3],['dig',3],['mound',2],['dig',2]] as const)for(let n=0;n<times;n++){strokeTray(hm,tool,[cell as unknown as [number,number]]);const now=visible();for(let i=0;i<pts.length;i++)worst=Math.max(worst,Math.abs(now[i]-last[i]));last=now;}
   expect(worst).toBeLessThan(.6);
  }finally{shell.dispose();}
 },30000);
 it('sixth re-review: behind the blue wall the seat is the blue ring, never the bottom of a hole dug against the wall',()=>{
  const model=new TrayModel('dry',{shape:'rect',w:30,h:30,depth:7});for(let n=0;n<90;n++)strokeTray(model.display,'dig',[[59,30]]);
  const [x,z]=[2.049611111,.034722222];expect(insideBlueWall(model.config,x,z)).toBe(false);
  expect(new Raycaster(new Vector3(x,5,z),new Vector3(0,-1,0)).intersectObject(mesh(model)).length).toBe(0);
  expect(surfaceY(model.display,x,z)).toBe(BLUE_LIP_Y);
 });
 // Seventh re-review: behind the blue wall of round and octagonal trays the sand mesh runs on under the blue ring; the seat must be what
 // the viewer sees (sand + ring + floor, first hit from above), not the hidden sand.
 for(const [shape,size,cells] of [['circle',30,[[59,30]]],['octagon',30,[[59,42]]],['circle',80,[[159,80],[80,0],[2,80]]],['octagon',45,[[89,45],[45,0],[80,80]]]] as const)
  it(`seventh re-review: ${shape} ${size} cm, holes dug against the wall: seat behind the blue wall = visible surface`,()=>{
   const model=new TrayModel('dry',{shape,w:size,h:size,depth:7}),hm=model.display;for(const c of cells)for(let n=0;n<90;n++)strokeTray(hm,'dig',[c as unknown as [number,number]]);
   const shell=createShell(model.config);
   try{
    const lip=new Mesh(shell.lip,new MeshBasicMaterial({side:DoubleSide})),floor=new Mesh(shell.floor,new MeshBasicMaterial({side:DoubleSide}));lip.updateMatrixWorld();floor.updateMatrixWorld();
    const scene=[mesh(model),lip,floor],first=(x:number,z:number)=>new Raycaster(new Vector3(x,5,z),new Vector3(0,-1,0)).intersectObjects(scene,false)[0];
    if(size===30){const [x,z]=shape==='circle'?[2.047276706,.037940709]:[2.047707812,.85077295];expect(insideBlueWall(model.config,x,z)).toBe(false);
     expect(Math.abs(surfaceY(hm,x,z)-first(x,z).point.y)).toBeLessThan(1e-4);}
    const r=size/CM_PER_UNIT/2;let seed=9,checked=0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(let n=0;n<3000&&checked<400;n++){
     // Between the rim's bevel (0.03 in) and the blue wall: the band seen from above behind the wall.
     const ang=random()*Math.PI*2,inset=.0305+random()*(BLUE_WALL_INSET-.031),dir=[Math.cos(ang),Math.sin(ang)];
     const outlineR=shape==='circle'?r:r/Math.max(Math.abs(dir[0]),Math.abs(dir[1]),(Math.abs(dir[0])+Math.abs(dir[1]))/Math.SQRT2);
     const [x,z]=[dir[0]*(outlineR-inset*(outlineR/r)),dir[1]*(outlineR-inset*(outlineR/r))];
     if(insideBlueWall(model.config,x,z))continue;const hit=first(x,z);if(!hit)continue;
     expect(Math.abs(surfaceY(hm,x,z)-hit.point.y),`${shape} at ${x.toFixed(5)},${z.toFixed(5)}`).toBeLessThan(1e-4);checked++;
    }
    expect(checked).toBeGreaterThan(200);
   }finally{shell.dispose();}
  },60000);
 it('the seating wall test matches the drawn blue wall polygon (a round tray’s 72-gon, not the water’s inscribed circle)',()=>{
  const inPoly=(poly:[number,number][],x:number,z:number)=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,zi]=poly[i],[xj,zj]=poly[j];if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)c=!c;}return c;};
  let seed=21,diff=0,between=0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(const [shape,w] of [['circle',30],['circle',120],['octagon',45],['rect',72]] as const){const config={shape,w,h:shape==='rect'?57:w,depth:7},poly=trayOutline(config,-BLUE_WALL_INSET),r=w/CM_PER_UNIT/2;
   for(let n=0;n<20000;n++){const a=random()*Math.PI*2,d=r-.08+random()*.08,x=Math.cos(a)*d,z=Math.sin(a)*d*(shape==='rect'?57/72:1);
    if(insideBlueWallPolygon(config,x,z)!==inPoly(poly,x,z))diff++;if(insideBlueWallPolygon(config,x,z)&&!insideBlueWall(config,x,z))between++;}}
  expect(diff).toBe(0);expect(between).toBeGreaterThan(50); // the band where the water is clipped but the floor of the tray still shows
 });
 for(const size of [30,60,80,120])it(`eighth re-review: ${size} cm round tray, hole dug against the wall: inside the 72-gon but outside the water's circle the seat is the floor`,()=>{
  const model=new TrayModel('dry',{shape:'circle',w:size,h:size,depth:7}),hm=model.display,g=size*2;
  for(const c of [[g-1,size],[size,0],[0,size],[size,g-1]])for(let n=0;n<90;n++)strokeTray(hm,'dig',[c as [number,number]]);
  const shell=createShell(model.config);
  try{
   const lip=new Mesh(shell.lip,new MeshBasicMaterial({side:DoubleSide})),floor=new Mesh(shell.floor,new MeshBasicMaterial({side:DoubleSide}));lip.updateMatrixWorld();floor.updateMatrixWorld();
   const scene=[mesh(model),lip,floor],first=(x:number,z:number)=>new Raycaster(new Vector3(x,5,z),new Vector3(0,-1,0)).intersectObjects(scene,false)[0];
   if(size===30){const [x,z]=[2.046637216,.002046638];expect(insideBlueWall(model.config,x,z)).toBe(false);expect(insideBlueWallPolygon(model.config,x,z)).toBe(true);
    expect(surfaceY(hm,x,z)*CM_PER_UNIT).toBeCloseTo(-7,2);expect(Math.abs(surfaceY(hm,x,z)-first(x,z).point.y)).toBeLessThan(1e-4);}
   const r=size/CM_PER_UNIT/2,apo=(r-BLUE_WALL_INSET)*Math.cos(Math.PI/CIRCLE_SEGMENTS),R=r-BLUE_WALL_INSET;let checked=0;
   // Sample the band between the inscribed circle and the 72-gon around the four holes (angles 0, 90, 180, 270 degrees).
   for(const base of [0,Math.PI/2,Math.PI,Math.PI*1.5])for(let k=-20;k<=20;k++){const a=base+k*.002;
    for(const t of [.1,.3,.5,.7,.9]){const step=Math.PI*2/CIRCLE_SEGMENTS,local=((a%step)+step)%step-step/2,edge=apo/Math.cos(local),d=apo+(Math.min(edge,R)-apo)*t,[x,z]=[Math.cos(a)*d,Math.sin(a)*d];
     if(insideBlueWall(model.config,x,z)||!insideBlueWallPolygon(model.config,x,z))continue;const hit=first(x,z);if(!hit)continue;
     expect(Math.abs(surfaceY(hm,x,z)-hit.point.y),`at ${x.toFixed(6)},${z.toFixed(6)}`).toBeLessThan(1e-4);checked++;}}
   expect(checked).toBeGreaterThan(100);
  }finally{shell.dispose();}
 },60000);
 for(const depth of [5,6,7,8,9,10])it(`${depth} cm tray: a hole dug to u8 0 shows the blue floor`,()=>{
  const model=new TrayModel('dry',{shape:'rect',w:72,h:57,depth});for(let n=0;n<90;n++)strokeTray(model.display,'dig',[[72,57]]);
  expect(model.display.data[57*144+72]).toBe(0);
  const shell=createShell(model.config);try{
   const floor=new Mesh(shell.floor,new MeshBasicMaterial({side:DoubleSide}));floor.name='floor';floor.updateMatrixWorld();const sand=mesh(model);sand.name='sand';
   const first=new Raycaster(new Vector3(((72.5)/144-.5)*10,5,((57.5)/114-.5)*57/7.2),new Vector3(0,-1,0)).intersectObjects([sand,floor],false)[0];
   expect(first.object.name).toBe('floor');expect(first.point.y).toBeCloseTo(-depth/CM_PER_UNIT,6);
  }finally{shell.dispose();}
 });
 it('the water clip uniforms reproduce insideBlueWall (the shader test mirrored in JS)',()=>{
  const clip=(shape:number,wall:{x:number;y:number},x:number,z:number)=>{const ax=Math.abs(x),az=Math.abs(z);
   return !(shape===1?Math.hypot(x,z)>wall.x:shape===2?Math.max(ax,az,(ax+az)*0.70710678)>wall.x:(ax>wall.x||az>wall.y));};
  for(const config of [{shape:'rect',w:72,h:57,depth:7},{shape:'circle',w:80,h:80,depth:10},{shape:'octagon',w:45,h:45,depth:5}] as const){
   const water=createWater(new TrayModel('wet',config as any)),u=water.material.uniforms;
   try{expect(water.material.fragmentShader).toContain('if(uShape==1?length(vPos)>uWall.x:uShape==2?max(max(a.x,a.y),(a.x+a.y)*0.70710678)>uWall.x:(a.x>uWall.x||a.y>uWall.y))discard;');
    expect(u.uWall.value.x).toBeCloseTo(waterWall(config as any).x,9);
    const size=traySize(config as any);let seed=3,diff=0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(let n=0;n<4000;n++){const x=(random()-.5)*size.x*1.02,z=(random()-.5)*size.z*1.02;if(clip(u.uShape.value,u.uWall.value,x,z)!==insideBlueWall(config as any,x,z))diff++;}
    expect(diff).toBeLessThanOrEqual(2); // float rounding on the boundary only
   }finally{water.dispose();}
  }
  expect(BLUE_WALL_INSET).toBeGreaterThan(0);expect(CIRCLE_SEGMENTS).toBe(72);
 });
 it('a wide dug area away from dunes and walls is drawn within 0.15 cm of its true depth (the blur averages about 1.5 cm)',()=>{
  const model=new TrayModel('dry',STD),hm=model.display,pts:[number,number][]=[];
  for(let i=40;i<=100;i+=2)for(let j=30;j<=80;j+=2)pts.push([i,j]);
  for(let n=0;n<3;n++)strokeTray(hm,'dig',pts);
  const y=sandHeightsY(hm);let checked=0;
  for(let j=50;j<=60;j++)for(let i=60;i<=80;i++){const k=j*144+i;expect(hm.data[k]).toBeLessThan(surfaceU8(7));expect(hm.data[k]).toBeGreaterThan(0);expect(Math.abs(y[k]-u8ToY(hm.data[k],7))).toBeLessThan(.15/CM_PER_UNIT);checked++;}
  expect(checked).toBeGreaterThan(100);
 });
 // Review counter-examples: a single-point dune, the wide dune fixture, and saturated 5 / 10 cm trays, each dug at the centre.
 for(const [name,depth,points] of [['single-point dune',7,[[72,57]]],['wide dune',7,null],['saturated 5 cm',5,'all'],['saturated 10 cm',10,'all']] as const)
  it(`digging into a dune lowers it gradually down to the floor (${name}): no visible cell moves more than 0.6 cm in one stroke`,()=>{
   const hm=new TrayModel('dry',{shape:'rect',w:72,h:57,depth}).display,pts:[number,number][]=[];
   if(points==='all'){for(let i=0;i<144;i+=2)for(let j=0;j<114;j+=2)pts.push([i,j]);}else if(points===null){for(let i=40;i<=100;i+=2)for(let j=40;j<=74;j+=2)pts.push([i,j]);}else pts.push(...(points as unknown as [number,number][]));
   for(let n=0;n<(points===null||points==='all'?120:200);n++)strokeTray(hm,'mound',pts);
   const floor=-depth/CM_PER_UNIT,visible=()=>sandHeightsY(hm).map(y=>Math.max(y,floor));
   let last=visible(),worst=0,reachedFloor=false;
   for(let n=0;n<90;n++){strokeTray(hm,'dig',[[72,57]]);const next=visible();for(let k=0;k<next.length;k++)if(hm.mask[k])worst=Math.max(worst,Math.abs(last[k]-next[k])*CM_PER_UNIT);last=next;}
   reachedFloor=hm.data.some((v,k)=>v===0&&hm.mask[k]===1);expect(reachedFloor).toBe(true);
   expect(worst).toBeGreaterThan(.1);expect(worst).toBeLessThan(.6);
  },30000);
 it('a hollow dug against the wall keeps its depth at the wall (the blur does not pull it up to the surface)',()=>{
  const hm=new TrayModel('dry',STD).display;for(let n=0;n<40;n++)strokeTray(hm,'dig',[[0,57]]);
  const y=sandHeightsY(hm);for(const k of [57*144,57*144+1,56*144,58*144])expect(Math.abs(y[k]-u8ToY(hm.data[k],7))*CM_PER_UNIT).toBeLessThan(.3);
 });
 it('a dune piled against the wall keeps its height at the wall (no sag towards the rim)',()=>{
  const hm=new TrayModel('dry',STD).display,pts:[number,number][]=[];for(let i=0;i<=30;i+=2)for(let j=40;j<=74;j+=2)pts.push([i,j]);
  for(let n=0;n<120;n++)strokeTray(hm,'mound',pts);
  const y=sandHeightsY(hm);expect(hm.data[57*144]).toBe(255);expect(Math.abs(y[57*144]-y[57*144+8])*CM_PER_UNIT).toBeLessThan(.5);
 });
 it('a deep pit dug into the middle of a wide dune is drawn well below the original surface',()=>{
  const hm=new TrayModel('dry',STD).display,pts:[number,number][]=[];for(let i=40;i<=100;i+=2)for(let j=40;j<=74;j+=2)pts.push([i,j]);
  for(let n=0;n<120;n++)strokeTray(hm,'mound',pts);for(let n=0;n<84;n++)strokeTray(hm,'dig',[[72,57]]);
  const y=sandHeightsY(hm);expect(hm.data[57*144+72]).toBeLessThan(40);expect(y[57*144+72]*CM_PER_UNIT).toBeLessThan(-4);
 });
 it('the water is a flat copy of the sand mesh carrying the drawn heights, so shore and depth match the visible sand anywhere',()=>{
  for(const model of [sculpted(),(()=>{const m=new TrayModel('wet',{shape:'circle',w:30,h:30,depth:10}),all:[number,number][]=[];for(let i=0;i<60;i+=2)for(let j=0;j<60;j+=2)all.push([i,j]);for(let n=0;n<120;n++)strokeTray(m.display,'mound',all);for(let n=0;n<90;n++)strokeTray(m.display,'dig',[[30,30]]);return m;})()]){
   const sand=mesh(model),water=createWater(model);
   try{
    water.sync(updateSand(sand.geometry,model,true));
    const sp=sand.geometry.getAttribute('position'),wp=water.geometry.getAttribute('position'),wy=water.geometry.getAttribute('sandY');
    expect(Array.from(water.geometry.getIndex()!.array)).toEqual(Array.from(sand.geometry.getIndex()!.array));
    for(let k=0;k<sp.count;k++){expect(wp.getX(k)).toBe(sp.getX(k));expect(wp.getZ(k)).toBe(sp.getZ(k));expect(wy.getX(k)).toBeCloseTo(sp.getY(k),6);}
    // The fragment's sand height = interpolated vertex sandY, floored at the blue floor: equal to the visible sand at random points.
    for(const line of ['float sandY=max(vSandY,uFloor);float depth=uWaterY-sandY;','if(depth<=0.0)discard;','float deep=clamp(depth/0.45,0.0,1.0);float foam=1.0-smoothstep(0.0,0.035,depth+h0*0.6);'])expect(water.material.fragmentShader).toContain(line);expect(water.material.uniforms.uFloor.value).toBe(-traySize(model.config).depth);
    const pool=new Mesh(water.geometry,new MeshBasicMaterial({side:DoubleSide})),size=traySize(model.config),floor=-size.depth;let seed=5,checked=0;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(let n=0;n<800;n++){
     const x=(random()-.5)*size.x,z=(random()-.5)*size.z,down=new Vector3(0,-1,0);
     const s=new Raycaster(new Vector3(x,5,z),down).intersectObject(sand)[0],w=new Raycaster(new Vector3(x,5,z),down).intersectObject(pool)[0];
     if(!insideBlueWall(model.config,x,z))continue; // the fragment is discarded there (blue-wall clip)
     if(!s||!w){expect(!s&&!w).toBe(true);continue;}
     const f=w.face!,bc=new Triangle(new Vector3(wp.getX(f.a),0,wp.getZ(f.a)),new Vector3(wp.getX(f.b),0,wp.getZ(f.b)),new Vector3(wp.getX(f.c),0,wp.getZ(f.c))).getBarycoord(new Vector3(x,0,z),new Vector3());
     const fragment=Math.max(bc!.x*wy.getX(f.a)+bc!.y*wy.getX(f.b)+bc!.z*wy.getX(f.c),floor);
     expect(Math.abs(fragment-Math.max(s.point.y,floor))).toBeLessThan(1e-4);checked++;
    }
    expect(checked).toBeGreaterThan(300);
   }finally{water.dispose();}
  }
 },60000);
 it('untouched sand is exactly at the surface, so full water (level at the surface) has zero depth there for every depth',()=>{
  for(const depth of [5,7,10]){const model=new TrayModel('wet',{shape:'rect',w:72,h:57,depth});strokeTray(model.display,'dig',[[20,20]]);
   const y=sandHeightsY(model.display);expect(y[100*144+120]).toBe(0);expect(y[57*144+72]).toBe(0);}
 });
 it('a dune never lifts cells outside a round or octagonal tray',()=>{
  for(const shape of ['circle','octagon'] as const){
   const model=new TrayModel('dry',{shape,w:30,h:30,depth:7}),hm=model.display,all:[number,number][]=[];
   for(let i=0;i<60;i+=2)for(let j=0;j<60;j+=2)all.push([i,j]);
   for(let n=0;n<120;n++)strokeTray(hm,'mound',all);
   const heights=sandHeightsY(hm);let outside=0;for(let k=0;k<heights.length;k++)if(!hm.mask[k]){outside++;expect(heights[k]).toBe(0);}
   expect(outside).toBeGreaterThan(100);
  }
 });
 it('object seating matches the drawn triangles anywhere in the tray: dunes, the floor seam, round and octagonal edges',()=>{
  const fixtures:[string,TrayModel][]=[['dug rect',sculpted()]];
  for(const shape of ['circle','octagon'] as const){
   const model=new TrayModel('dry',{shape,w:30,h:30,depth:7}),all:[number,number][]=[];
   for(let i=0;i<60;i+=2)for(let j=0;j<60;j+=2)all.push([i,j]);
   for(let n=0;n<120;n++)strokeTray(model.display,'mound',all);for(let n=0;n<90;n++)strokeTray(model.display,'dig',[[30,30]]);
   fixtures.push([shape,model]);
  }
  let seam=0;
  for(const [name,model] of fixtures){
   const hm=model.display,sand=mesh(model),size=traySize(model.config),floor=-size.depth;let seed=11,checked=0;
   const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
   for(let n=0;n<1500;n++){
    const x=(random()-.5)*size.x,z=(random()-.5)*size.z;
    const hit=new Raycaster(new Vector3(x,5,z),new Vector3(0,-1,0)).intersectObject(sand)[0];if(!hit)continue;
    if(hit.point.y<floor)seam++;
    const drawn=Math.max(hit.point.y,floor); // where the mesh sinks below the floor, the blue floor is the visible surface
    expect(Math.abs(surfaceY(hm,x,z)-drawn),`${name} at ${x.toFixed(4)},${z.toFixed(4)}`).toBeLessThan(1e-4);checked++;
   }
   expect(checked).toBeGreaterThan(700);
  }
  expect(seam).toBeGreaterThanOrEqual(3); // rays that met the sand sunk under the floor (the dug rectangle's hole)
 },60000);
 it('review counter-examples: floor seam and a saturated round tray edge',()=>{
  const model=sculpted(),floorSeam=surfaceY(model.display,-3.048611,-1.6875);
  const hit=new Raycaster(new Vector3(-3.048611,5,-1.6875),new Vector3(0,-1,0)).intersectObject(mesh(model))[0]!;
  expect(Math.abs(floorSeam-Math.max(hit.point.y,-traySize(STD).depth))).toBeLessThan(1e-4);
  const round=new TrayModel('dry',{shape:'circle',w:30,h:30,depth:7}),all:[number,number][]=[];
  for(let i=0;i<60;i+=2)for(let j=0;j<60;j+=2)all.push([i,j]);for(let n=0;n<120;n++)strokeTray(round.display,'mound',all);
  const edge=new Raycaster(new Vector3(-1.673611,5,-1.1875),new Vector3(0,-1,0)).intersectObject(mesh(round))[0]!;
  expect(edge.point.y).toBeGreaterThan(.3);expect(Math.abs(surfaceY(round.display,-1.673611,-1.1875)-edge.point.y)).toBeLessThan(1e-4);
  // Fourth re-review: folded triangles buried an object 8.94 cm at this point of a saturated 30 cm round tray.
  const fold=new Raycaster(new Vector3(-1.341901143,5,-1.544827143),new Vector3(0,-1,0)).intersectObject(mesh(round));
  expect(fold.length).toBe(1);expect(Math.abs(surfaceY(round.display,-1.341901143,-1.544827143)-fold[0].point.y)).toBeLessThan(1e-4);
 });
});
