import {useEffect,useMemo,useRef,useState} from 'react';
import {useThree,type ThreeEvent} from '@react-three/fiber';
import {ExtrudeGeometry,Shape,Path,ShapeGeometry,BufferGeometry,BufferAttribute,DoubleSide,Raycaster,Vector3,Vector2,Vector4,Color,DataTexture,RedFormat,UnsignedByteType,LinearFilter,ClampToEdgeWrapping,ShaderMaterial,type Mesh} from 'three';
import {createTrayTextures} from './tray-textures';
import {TrayModel,traySize,sandHeightsY,sandVerticesXZ,sandIndex,surfaceY,BLUE_WALL_INSET,BLUE_LIP_Y,CIRCLE_SEGMENTS,cellAt,type Point} from './tray-model';
import {surfaceU8,DEFAULT_RADIUS_CM} from '../../../packages/sand-engine/src/core';
import {clampToTray,CM_PER_UNIT,type TrayId,type TrayConfig} from '../../../packages/protocol/src/index';
// REQ-016 (Claude Opus 5.5, 2026-09-30): two trays, each with the shape and size chosen when the room was created (A6: rectangle,
// square, circle or regular octagon, 30-120 cm, 5-10 cm deep; default the international standard 72 x 57 x 7 cm). The inside of each
// tray is painted blue (REQ-016 §2.1, #1F5F8B); sand is a heightmap mesh, and a cell dug to the floor drops below the blue floor so
// the blue shows through. The wet tray has a water plane at waterLevel (0 = none, 1 = up to the original sand surface) with a light
// ripple shader: a slow ambient swell, rings where sand is dug or an object is set into the water, and a pale line where the water
// meets the sand. The shader is written for this project (REQ-016 §4 names cortiz2894/stylized-components as the reference look;
// no code was copied from it).
const RIM=0.25,WALL_TOP=0.08,BLUE='#1F5F8B',RIPPLES=8,RIM_BEVEL=.03;
/** The blue inner wall (BLUE_WALL_INSET inside the outline) stands in front of the wood walls' inner face (coplanar otherwise, so the
 * two z-fight into wood-and-blue stripes) and of the rim's bevel, which reaches RIM_BEVEL inwards and below the sand surface. Without
 * it a hollow dug against the wall shows a band of wood between the rim and the water instead of the blue inside (user report
 * 2026-10-05). */
export {BLUE_WALL_INSET};
// BLUE_LIP_Y (tray-model): a thin blue ring just under the original surface closes the gap between the blue wall and the rim's bevel
// (about 0.4 mm); seen from above, a hollow dug against the wall otherwise showed the water through it (GPT-6.1 SOL review 2026-10-05).
export type SandTool='dig'|'mound'|'smooth';
export interface SculptHandlers {tool:SandTool|null;start:(trayId:TrayId,point:Point)=>void;move:(point:Point)=>void;end:()=>void}
/** Inner outline of a tray (tray-local x/z, counter-clockwise), grown by `grow` units. The regular octagon has flat sides facing the axes. */
export function trayOutline(config:TrayConfig,grow=0):[number,number][]{
 const size=traySize(config),hx=size.x/2+grow,hz=size.z/2+grow;
 if(config.shape==='circle')return Array.from({length:CIRCLE_SEGMENTS},(_,k)=>{const a=k/CIRCLE_SEGMENTS*Math.PI*2;return [Math.cos(a)*hx,Math.sin(a)*hx];});
 if(config.shape==='octagon'){const r=hx/Math.cos(Math.PI/8);return Array.from({length:8},(_,k)=>{const a=Math.PI/8+k*Math.PI/4;return [Math.cos(a)*r,Math.sin(a)*r];});}
 return [[-hx,-hz],[hx,-hz],[hx,hz],[-hx,hz]];
}
/** A three.js Shape in the XY plane whose y is the tray-local z (geometry is then rotated so y maps to world z). */
function shapeOf(points:[number,number][],hole?:[number,number][]){
 const shape=new Shape();points.forEach(([x,z],k)=>k?shape.lineTo(x,z):shape.moveTo(x,z));shape.closePath();
 if(hole){const path=new Path();[...hole].reverse().forEach(([x,z],k)=>k?path.lineTo(x,z):path.moveTo(x,z));path.closePath();shape.holes.push(path);}
 return shape;
}
/** Lay an XY-plane geometry flat so shape y becomes world +z (rotateX(+90deg) maps y to z). */
function flat<T extends BufferGeometry>(geometry:T){geometry.rotateX(Math.PI/2);return geometry;}
export function createShell(config:TrayConfig){
 const depth=traySize(config).depth,bottom=-depth-.08,inner=trayOutline(config),outer=trayOutline(config,RIM),blue=trayOutline(config,-BLUE_WALL_INSET);
 const rim=flat(new ExtrudeGeometry(shapeOf(outer,inner),{depth:.16,steps:1,bevelEnabled:true,bevelSegments:3,bevelSize:RIM_BEVEL,bevelThickness:.03,curveSegments:1}));
 // rotateX(+90deg) sends the extrusion (+z) downwards, so each piece is lifted to its top edge.
 rim.translate(0,.08,0);
 const walls=flat(new ExtrudeGeometry(shapeOf(outer,inner),{depth:WALL_TOP-bottom,bevelEnabled:false,curveSegments:1}));walls.translate(0,WALL_TOP-.08,0);
 const floor=flat(new ShapeGeometry(shapeOf(inner)));floor.translate(0,-depth,0);
 // Blue inner wall: a vertical strip just inside the outline from the floor up to the original sand surface (the rim covers the rest).
 const strip=new BufferGeometry(),n=blue.length,pos=new Float32Array(n*2*3),index:number[]=[];
 blue.forEach(([x,z],k)=>{pos.set([x,-depth,z,x,0,z],k*6);const a=k*2,b=((k+1)%n)*2;index.push(a,b,a+1,b,b+1,a+1);});
 strip.setAttribute('position',new BufferAttribute(pos,3));strip.setIndex(index);strip.computeVertexNormals();
 const lip=flat(new ShapeGeometry(shapeOf(inner,blue)));lip.translate(0,BLUE_LIP_Y,0);
 return {rim,walls,floor,strip,lip,dispose(){rim.dispose();walls.dispose();floor.dispose();strip.dispose();lip.dispose();}};
}
export function createSand(model:TrayModel){
 const hm=model.display,{w,h}=hm,geometry=new BufferGeometry(),positions=new Float32Array(w*h*3),uvs=new Float32Array(w*h*2),colors=new Float32Array(w*h*3),xz=sandVerticesXZ(hm);
 for(let j=0;j<h;j++)for(let i=0;i<w;i++){
  const k=j*w+i;positions[k*3]=xz[k*2];positions[k*3+2]=xz[k*2+1];uvs[k*2]=i/(w-1);uvs[k*2+1]=1-j/(h-1);
 }
 geometry.setAttribute('position',new BufferAttribute(positions,3));geometry.setAttribute('uv',new BufferAttribute(uvs,2));geometry.setAttribute('color',new BufferAttribute(colors,3));geometry.setIndex(sandIndex(hm));
 return geometry;
}
export function updateSand(geometry:BufferGeometry,model:TrayModel,wet:boolean){
 const hm=model.display,data=hm.data,surface=surfaceU8(hm.depthCm),positions=geometry.getAttribute('position') as BufferAttribute,colors=geometry.getAttribute('color') as BufferAttribute,tint=wet?.86:1,heights=sandHeightsY(hm);
 for(let k=0;k<data.length;k++){
  const v=data[k];
  // sandHeightsY already sinks a cell dug to the floor below the blue floor, so the floor, not a thin sand skin, is what shows.
  positions.array[k*3+1]=heights[k];
  // Deeper sand reads darker (shadowed, damp); mounded sand a little lighter.
  const shade=tint*(v<surface?.5+.5*v/surface:1+.08*(v-surface)/(255-surface));colors.array[k*3]=shade;colors.array[k*3+1]=shade;colors.array[k*3+2]=shade;
 }
 positions.needsUpdate=true;colors.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.computeBoundingBox();
 return heights;
}
// The water is a flat copy of the sand mesh (same vertices and triangles), each vertex carrying the drawn sand height, so the depth and
// shore a fragment sees are exactly the sand drawn beneath it (GPT-6.1 SOL review 2026-10-05: a height texture sampled bilinearly
// disagreed with the triangulated sand by up to 1 cm at steep hollows and the floor seam).
const WATER_VERTEX=`attribute float sandY;varying vec2 vPos;varying vec3 vWorld;varying float vSandY;
void main(){vPos=position.xz;vSandY=sandY;vec4 world=modelMatrix*vec4(position,1.0);vWorld=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`;
const WATER_FRAGMENT=`uniform float uTime;uniform float uAmbient;uniform vec4 uRipples[${RIPPLES}];
uniform float uWaterY;uniform float uFloor;uniform int uShape;uniform vec2 uWall;uniform vec3 uShallow;uniform vec3 uDeep;
varying vec2 vPos;varying vec3 vWorld;varying float vSandY;
float waveHeight(vec2 p){
 float h=uAmbient*(0.5*sin(p.x*2.7+uTime*1.1)+0.4*sin(p.y*3.3-uTime*0.9)+0.25*sin((p.x-p.y)*5.1+uTime*1.7));
 for(int k=0;k<${RIPPLES};k++){
  vec4 r=uRipples[k];float age=uTime-r.z;
  if(r.w>0.0&&age>0.0&&age<2.6){float d=distance(p,r.xy)-age*0.85;h+=r.w*sin(d*26.0)*exp(-d*d*18.0)*(1.0-age/2.6);}
 }
 return h*0.012;
}
void main(){
 float e=0.02;float h0=waveHeight(vPos);
 vec3 n=normalize(vec3(-(waveHeight(vPos+vec2(e,0.0))-h0)/e,1.0,-(waveHeight(vPos+vec2(0.0,e))-h0)/e));
 vec3 v=normalize(cameraPosition-vWorld);vec3 l=normalize(vec3(0.35,1.0,0.45));
 float spec=pow(max(dot(reflect(-l,n),v),0.0),70.0);float fresnel=pow(1.0-max(dot(n,v),0.0),3.0);
 // Water depth over the sand drawn beneath (where the sand sinks under the floor, the floor): pale foam at the shore, deeper blue in hollows.
 // The water stops at the blue wall (same test as insideBlueWall in tray-model): the mesh itself reaches the outline behind it.
 vec2 a=abs(vPos);
 if(uShape==1?length(vPos)>uWall.x:uShape==2?max(max(a.x,a.y),(a.x+a.y)*0.70710678)>uWall.x:(a.x>uWall.x||a.y>uWall.y))discard;
 float sandY=max(vSandY,uFloor);float depth=uWaterY-sandY;
 if(depth<=0.0)discard;
 float deep=clamp(depth/0.45,0.0,1.0);float foam=1.0-smoothstep(0.0,0.035,depth+h0*0.6);
 vec3 color=mix(uShallow,uDeep,deep)+spec*0.9+fresnel*0.12+foam*0.55;
 gl_FragColor=vec4(color,clamp(0.32+0.4*deep+spec+foam*0.5+fresnel*0.2,0.0,0.95));
 #include <colorspace_fragment>
}`;
/** Water for one tray: shaped plane + ripple shader + heightmap texture for the shoreline. Owned by the caller; call dispose(). */
/** Uniform for the water's blue-wall clip: half-extents of the wall (rect), or the inscribed radius / apothem (circle / octagon). */
export function waterWall(config:TrayConfig){const size=traySize(config);
 return config.shape==='circle'?new Vector2(size.x/2*Math.cos(Math.PI/CIRCLE_SEGMENTS)-BLUE_WALL_INSET,0):new Vector2(size.x/2-BLUE_WALL_INSET,size.z/2-BLUE_WALL_INSET);}
export function createWater(model:TrayModel){
 const hm=model.display,xz=sandVerticesXZ(hm),positions=new Float32Array(hm.w*hm.h*3),geometry=new BufferGeometry();
 for(let k=0;k<hm.w*hm.h;k++){positions[k*3]=xz[k*2];positions[k*3+2]=xz[k*2+1];}
 const sandY=new BufferAttribute(new Float32Array(hm.w*hm.h),1);
 geometry.setAttribute('position',new BufferAttribute(positions,3));geometry.setAttribute('sandY',sandY);geometry.setIndex(sandIndex(hm));geometry.computeBoundingSphere();
 const material=new ShaderMaterial({vertexShader:WATER_VERTEX,fragmentShader:WATER_FRAGMENT,transparent:true,depthWrite:false,side:DoubleSide,uniforms:{
  uTime:{value:0},uAmbient:{value:1},uRipples:{value:Array.from({length:RIPPLES},()=>new Vector4())},
  uWaterY:{value:0},uFloor:{value:-traySize(model.config).depth},uShape:{value:model.config.shape==='circle'?1:model.config.shape==='octagon'?2:0},uWall:{value:waterWall(model.config)},uShallow:{value:new Color('#7cc3e0')},uDeep:{value:new Color('#2f7fb4')}}});
 // One clock per water surface: uTime and every ripple's start time are seconds since this water was created.
 let next=0;const t0=performance.now();
 return {geometry,material,
  now(){return (performance.now()-t0)/1000;},
  sync(heights:Float32Array){(sandY.array as Float32Array).set(heights);sandY.needsUpdate=true;},
  ripple(x:number,z:number,strength:number){material.uniforms.uRipples.value[next].set(x,z,this.now(),strength);next=(next+1)%RIPPLES;},
  busy(time:number){return (material.uniforms.uRipples.value as Vector4[]).some(r=>r.w>0&&time-r.z<2.6);},
  dispose(){geometry.dispose();material.dispose();}};
}
// 2026-10-09 UX 建議 3、5（Claude Opus 5.5）：游標下的提示圈。放置中是物件的落點影子；拿著沙子工具時是一次筆刷的實際範圍
// （sand-engine 的 DEFAULT_RADIUS_CM，與 server 同一個值）。只畫在本機畫面，不送任何訊息。
export const BRUSH_RADIUS_UNITS=DEFAULT_RADIUS_CM/CM_PER_UNIT;
export type HoverHandler=(hover:{trayId:TrayId;x:number;z:number}|null)=>void;
function SandTray({id,x,model,textures,placing,sculpt,onPlace,onHover}:{id:TrayId;x:number;model:TrayModel;textures:ReturnType<typeof createTrayTextures>;placing:boolean;sculpt:SculptHandlers;onPlace:(trayId:TrayId,x:number,z:number,event:ThreeEvent<MouseEvent>)=>void;onHover?:HoverHandler}){
 const {invalidate,controls,gl}=useThree();const [config,setConfig]=useState(model.config);
 const sand=useMemo(()=>createSand(model),[model,config]);const shell=useMemo(()=>createShell(config),[config]);const water=useMemo(()=>id==='wet'?createWater(model):null,[model,config,id]);
 const mesh=useRef<Mesh>(null);const [level,setLevel]=useState(model.water);
 const active=useRef(false);const orbit=controls as unknown as {enabled:boolean}|null;
 const marker=useRef<Mesh>(null);const showMarker=placing||!!sculpt.tool;
 function hover(e:ThreeEvent<PointerEvent>|null){const ring=marker.current;
  if(!e){if(ring?.visible){ring.visible=false;invalidate();}onHover?.(null);return;}
  const local=toLocal(e.point);const [cx,cz]=clampToTray(model.config,local.x,local.z);onHover?.({trayId:id,x:cx,z:cz});
  if(ring&&(showMarker||ring.visible)){ring.visible=showMarker;ring.position.set(cx,surfaceY(model.display,cx,cz)+.015,cz);invalidate();}}
 useEffect(()=>{if(!showMarker&&marker.current?.visible){marker.current.visible=false;invalidate();}},[showMarker,invalidate]);
 useEffect(()=>{let frameId=0;const apply=()=>{frameId=0;if(model.config!==config){setConfig(model.config);return;}const heights=updateSand(sand,model,id==='wet');water?.sync(heights);setLevel(model.water);invalidate();};apply();
  const unsubscribe=model.subscribe(()=>{if(!frameId)frameId=requestAnimationFrame(apply);});
  return()=>{unsubscribe();if(frameId)cancelAnimationFrame(frameId);};},[sand,water,model,config,id,invalidate]);
 useEffect(()=>()=>sand.dispose(),[sand]);useEffect(()=>()=>shell.dispose(),[shell]);useEffect(()=>()=>water?.dispose(),[water]);
 // Ripples: rings wherever the sand changes under water (either participant) or an object is set into the water.
 useEffect(()=>{if(!water)return;let last=-1e9;
  return model.onRipple((cx,cz,strength)=>{const now=water.now();if(strength<1&&now-last<.12)return;last=now;water.ripple(cx,cz,strength);water.material.uniforms.uTime.value=now;invalidate();});},[model,water,invalidate]);
 // The water moves only while it is visible: a slow swell (none when the viewer asks for reduced motion) and any live ripples.
 useEffect(()=>{if(!water||level<=0)return;
  const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;water.material.uniforms.uAmbient.value=reduced?0:1;
  const timer=setInterval(()=>{if(document.hidden)return;const time=water.now();if(reduced&&!water.busy(time))return;water.material.uniforms.uTime.value=time;invalidate();},33);
  return()=>clearInterval(timer);},[water,level,invalidate]);
 const toLocal=(point:Vector3)=>mesh.current?mesh.current.worldToLocal(point.clone()):point;
 function stop(){if(!active.current)return;active.current=false;if(orbit)orbit.enabled=true;sculpt.end();}
 useEffect(()=>{
  // A second finger means the user is changing the view: end the stroke (same rule as object drag).
  const secondary=(e:PointerEvent)=>{if(e.pointerType==='touch'&&!e.isPrimary)stop();};
  gl.domElement.addEventListener('pointerdown',secondary,true);gl.domElement.addEventListener('pointercancel',stop);
  return()=>{gl.domElement.removeEventListener('pointerdown',secondary,true);gl.domElement.removeEventListener('pointercancel',stop);stop();};
 },[gl,sculpt.tool]);
 function hit(e:ThreeEvent<PointerEvent>){if(!mesh.current)return;const found=new Raycaster(e.ray.origin,e.ray.direction).intersectObject(mesh.current)[0];if(!found)return;const local=toLocal(found.point);return cellAt(model.display,local.x,local.z);}
 const depth=traySize(config).depth;
 useEffect(()=>{if(water){water.material.uniforms.uWaterY.value=-depth+level*depth;invalidate();}},[water,level,depth,invalidate]);
 return <group position={[x,0,0]} userData={{sandtrayTrayId:id}}>
  {/* wood shell: outer walls (no lid, so the blue inside stays visible) and the rim, following the tray outline */}
  <mesh geometry={shell.walls} receiveShadow><meshStandardMaterial map={textures.wood} color="#e5d8c4" roughness={.75}/></mesh>
  <mesh geometry={shell.rim} castShadow receiveShadow><meshStandardMaterial map={textures.wood} color="#eddfcb" roughness={.65}/></mesh>
  {/* blue inside: floor and inner wall */}
  <mesh geometry={shell.floor}><meshStandardMaterial color={BLUE} side={DoubleSide} roughness={.55}/></mesh>
  <mesh geometry={shell.strip}><meshStandardMaterial color={BLUE} side={DoubleSide} roughness={.55}/></mesh>
  <mesh geometry={shell.lip}><meshStandardMaterial color={BLUE} side={DoubleSide} roughness={.55}/></mesh>
  <mesh ref={mesh} geometry={sand} receiveShadow castShadow={false}
   onClick={e=>{if(sculpt.tool&&!placing)return;e.stopPropagation();const local=toLocal(e.point);onPlace(id,local.x,local.z,e);}}
   onPointerDown={e=>{
    if(!sculpt.tool||placing||e.button!==0||(e.pointerType==='touch'&&!e.isPrimary))return;const cell=hit(e);if(!cell)return;
    e.stopPropagation();active.current=true;if(orbit)orbit.enabled=false;(e.target as Element).setPointerCapture?.(e.pointerId);sculpt.start(id,cell);
   }}
   onPointerMove={e=>{hover(e);if(!active.current)return;e.stopPropagation();const cell=hit(e);if(cell)sculpt.move(cell);}}
   onPointerLeave={()=>hover(null)}
   onPointerUp={e=>{if(!active.current)return;e.stopPropagation();(e.target as Element).releasePointerCapture?.(e.pointerId);stop();}}>
   <meshStandardMaterial map={textures.sand} normalMap={textures.normal} normalScale={[.32,.32]} vertexColors roughness={.98} envMapIntensity={.25}/>
  </mesh>
  <mesh ref={marker} visible={false} rotation={[-Math.PI/2,0,0]} renderOrder={3} raycast={()=>null}>
   {placing?<circleGeometry args={[.55,40]}/>:<ringGeometry args={[BRUSH_RADIUS_UNITS*.92,BRUSH_RADIUS_UNITS,48]}/>}
   <meshBasicMaterial color={placing?'#2b2a24':'#c9773b'} transparent opacity={placing?.22:.85} depthTest={false} depthWrite={false}/>
  </mesh>
  {water&&level>0&&<mesh geometry={water.geometry} material={water.material} position={[0,-depth+level*depth,0]} renderOrder={1} raycast={()=>null}/>}
 </group>;
}
export function SandtraySurface({models,offsets,placing,sculpt,onPlace,onHover}:{models:Record<TrayId,TrayModel>;offsets:Record<TrayId,number>;placing:boolean;sculpt:SculptHandlers;onPlace:(trayId:TrayId,x:number,z:number,event:ThreeEvent<MouseEvent>)=>void;onHover?:HoverHandler}){
 const [textures]=useState(createTrayTextures);const {gl}=useThree();
 useEffect(()=>{for(const map of [textures.sand,textures.normal,textures.wood])map.anisotropy=Math.min(8,gl.capabilities.getMaxAnisotropy());return()=>{textures.dispose();};},[textures,gl]);
 return <group>{(['dry','wet'] as const).map(id=><SandTray key={id} id={id} x={offsets[id]} model={models[id]} textures={textures} placing={placing} sculpt={sculpt} onPlace={onPlace} onHover={onHover}/>)}</group>;
}
