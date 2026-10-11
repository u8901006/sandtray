import {BoxGeometry,IcosahedronGeometry,ConeGeometry,BufferGeometry} from 'three';
import {mkdirSync,writeFileSync} from 'node:fs';
// Original volumetric DEV_ONLY fixtures. Never count as ST catalog assets.
function writeGlb(name:string,parts:{geometry:BufferGeometry;color:number[]}[]) {
 const buffers:Buffer[]=[];const views:any[]=[];const accessors:any[]=[];let offset=0;
 function attribute(array:Float32Array,min?:number[],max?:number[]) {
  const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength);const view=views.length;
  views.push({buffer:0,byteOffset:offset,byteLength:bytes.length,target:34962});buffers.push(bytes);offset+=bytes.length;
  accessors.push({bufferView:view,componentType:5126,count:array.length/3,type:'VEC3',...(min?{min,max}:{})});return accessors.length-1;
 }
 const meshes=parts.map((part,i)=>{
  const geometry=part.geometry.index?part.geometry.toNonIndexed():part.geometry;geometry.computeBoundingBox();
  const p=attribute(geometry.getAttribute('position').array as Float32Array,geometry.boundingBox!.min.toArray(),geometry.boundingBox!.max.toArray());
  const n=attribute(geometry.getAttribute('normal').array as Float32Array);
  return {primitives:[{attributes:{POSITION:p,NORMAL:n},material:i}]};
 });
 const doc={asset:{version:'2.0',generator:'sandtray DEV_ONLY'},scene:0,scenes:[{nodes:parts.map((_,i)=>i)}],nodes:parts.map((_,i)=>({mesh:i})),meshes,
 materials:parts.map(p=>({pbrMetallicRoughness:{baseColorFactor:[...p.color,1],metallicFactor:0,roughnessFactor:0.85}})),buffers:[{byteLength:offset}],bufferViews:views,accessors};
 const raw=Buffer.from(JSON.stringify(doc));const json=Buffer.alloc(Math.ceil(raw.length/4)*4,0x20);raw.copy(json);
 const binary=Buffer.concat(buffers);const output=Buffer.alloc(28+json.length+binary.length);
 output.writeUInt32LE(0x46546c67,0);output.writeUInt32LE(2,4);output.writeUInt32LE(output.length,8);
 output.writeUInt32LE(json.length,12);output.writeUInt32LE(0x4e4f534a,16);json.copy(output,20);
 output.writeUInt32LE(binary.length,20+json.length);output.writeUInt32LE(0x004e4942,24+json.length);binary.copy(output,28+json.length);
 writeFileSync('apps/web/public/dev-assets/'+name+'.glb',output);
}
mkdirSync('apps/web/public/dev-assets',{recursive:true});
writeGlb('rock',[{geometry:new IcosahedronGeometry(0.6,1).scale(1,0.7,0.85).translate(0,0.42,0),color:[0.38,0.48,0.43]}]);
writeGlb('house',[{geometry:new BoxGeometry(0.9,0.75,0.8).translate(0,0.375,0),color:[0.73,0.55,0.4]},{geometry:new ConeGeometry(0.8,0.5,4).rotateY(Math.PI/4).translate(0,1,0),color:[0.37,0.27,0.22]}]);
writeGlb('arch',[-0.5,0.5].map(x=>({geometry:new BoxGeometry(0.25,1,0.45).translate(x,0.5,0),color:[0.65,0.58,0.43]})).concat([{geometry:new BoxGeometry(1.25,0.25,0.45).translate(0,1.125,0),color:[0.65,0.58,0.43]}]));
// G57: two pinned DEV_PUPPET versions restore the version-scoped clip coverage the trex removal
// dropped — v1 plays only 待機, v2 adds 原地行走, so an old-version model sent clip-1 is the
// server-side INVALID_PAYLOAD negative. Rigid-node rotation channels; no skinning required.
function writePuppetGlb(file:string,animations:{name:string;keys:{t:number;angle:number}[]}[]){
 const buffers:Buffer[]=[];const views:any[]=[];const accessors:any[]=[];let offset=0;
 function pushView(array:Float32Array,type:'VEC3'|'VEC4'|'SCALAR',min?:number[],max?:number[],target?:number){
  const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength);const view=views.length;
  views.push({buffer:0,byteOffset:offset,byteLength:bytes.length,...(target?{target}:{})});buffers.push(bytes);offset+=bytes.length;
  const components=type==='VEC3'?3:type==='VEC4'?4:1;
  accessors.push({bufferView:view,componentType:5126,count:array.length/components,type,...(min&&max?{min,max}:{})});
  return accessors.length-1;
 }
 const materials=[{pbrMetallicRoughness:{baseColorFactor:[0.62,0.5,0.72,1],metallicFactor:0,roughnessFactor:0.85}},{pbrMetallicRoughness:{baseColorFactor:[0.86,0.62,0.45,1],metallicFactor:0,roughnessFactor:0.85}}];
 const meshes=[new BoxGeometry(0.5,0.62,0.35).translate(0,0.31,0),new BoxGeometry(0.14,0.55,0.14).translate(0,0.275,0)].map((geometry,i)=>{
  const nonIndexed=geometry.index?geometry.toNonIndexed():geometry;nonIndexed.computeBoundingBox();
  const p=pushView(nonIndexed.getAttribute('position').array as Float32Array,'VEC3',nonIndexed.boundingBox!.min.toArray(),nonIndexed.boundingBox!.max.toArray(),34962);
  const n=pushView(nonIndexed.getAttribute('normal').array as Float32Array,'VEC3',undefined,undefined,34962);
  return {primitives:[{attributes:{POSITION:p,NORMAL:n},material:i}]};
 });
 const animationDocs=animations.map(animation=>{
  const input=pushView(new Float32Array(animation.keys.map(k=>k.t)),'SCALAR',[animation.keys[0].t],[animation.keys[animation.keys.length-1].t]);
  const output=pushView(new Float32Array(animation.keys.flatMap(k=>[Math.sin(k.angle/2),0,0,Math.cos(k.angle/2)])),'VEC4');
  return {name:animation.name,samplers:[{input,output,interpolation:'LINEAR'}],channels:[{sampler:0,target:{node:1,path:'rotation'}}]};
 });
 const doc={asset:{version:'2.0',generator:'sandtray DEV_ONLY'},scene:0,scenes:[{nodes:[0]}],
  nodes:[{mesh:0,children:[1]},{mesh:1,translation:[0.1,0.62,0]}],meshes,materials,animations:animationDocs,
  buffers:[{byteLength:offset}],bufferViews:views,accessors};
 const raw=Buffer.from(JSON.stringify(doc));const json=Buffer.alloc(Math.ceil(raw.length/4)*4,0x20);raw.copy(json);
 const binary=Buffer.concat(buffers);const output=Buffer.alloc(28+json.length+binary.length);
 output.writeUInt32LE(0x46546c67,0);output.writeUInt32LE(2,4);output.writeUInt32LE(output.length,8);
 output.writeUInt32LE(json.length,12);output.writeUInt32LE(0x4e4f534a,16);json.copy(output,20);
 output.writeUInt32LE(binary.length,20+json.length);output.writeUInt32LE(0x004e4942,24+json.length);binary.copy(output,28+json.length);
 writeFileSync('apps/web/public/dev-assets/'+file,output);
}
const idleKeys=[{t:0,angle:0},{t:0.5,angle:0.12},{t:1,angle:0}];
const walkKeys=[{t:0,angle:-0.55},{t:0.2,angle:0},{t:0.4,angle:0.55},{t:0.6,angle:0},{t:0.8,angle:-0.55}];
writePuppetGlb('puppet-v1.glb',[{name:'待機',keys:idleKeys}]);
writePuppetGlb('puppet-v2.glb',[{name:'待機',keys:idleKeys},{name:'原地行走',keys:walkKeys}]);
console.log('Created 3 DEV_ONLY GLBs and DEV_PUPPET v1/v2. Released count remains 0.');
