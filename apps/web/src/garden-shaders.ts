import {Vector4,type Material,type Texture,type WebGLProgramParametersWithUniforms} from 'three';
// 2026-10-10 garden-visual-v4. Shader patches applied only to garden-owned materials (cloned per garden instance in
// garden-surfaces.ts, or created in garden-vegetation.tsx); catalog models and the sandtray keep three's stock shaders.
//  - atmosphere (proposal 2): exponential distance haze plus a low ground haze, mixed toward scene.fog's colour, so far
//    hills fade and turn bluish while the trays a few metres away stay clear. Off when the fog toggle removes scene.fog.
//  - ground (proposals 1 and 3): one RGBA map over the garden: R = canopy / contact occlusion (scales only indirect
//    light, which is what ambient occlusion means), G = grass cover, B = trodden earth. Built in garden-ground.ts.
export type GardenFogUniforms={gardenFogDensity:{value:number};gardenGroundFog:{value:number};gardenFogFalloff:{value:number}};
export type GardenGroundUniforms={gardenGroundMap:{value:Texture|null};gardenGroundBounds:{value:Vector4}};
export function createFogUniforms():GardenFogUniforms{return {gardenFogDensity:{value:.0105},gardenGroundFog:{value:.35},gardenFogFalloff:{value:.22}};}
export function createGroundUniforms():GardenGroundUniforms{return {gardenGroundMap:{value:null},gardenGroundBounds:{value:new Vector4(-110,-110,220,220)}};}

const NOISE=`float gardenHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float gardenNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(gardenHash(i),gardenHash(i+vec2(1,0)),f.x),mix(gardenHash(i+vec2(0,1)),gardenHash(i+vec2(1,1)),f.x),f.y);}`;

export type GardenPatch={fog:GardenFogUniforms;ground?:GardenGroundUniforms;
 /** 'floor' tints the terrain by the grass map; 'occlude' only applies the occlusion (grass, plants, gravel). */
 groundMode?:'floor'|'occlude'};
export function patchGardenMaterial(material:Material,patch:GardenPatch){
 const mode=patch.ground?patch.groundMode??'occlude':'none';
 material.customProgramCacheKey=()=>'garden-v4-'+mode;
 material.onBeforeCompile=(shader:WebGLProgramParametersWithUniforms)=>{
  Object.assign(shader.uniforms,patch.fog,patch.ground??{});
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vGardenWorld;').replace('#include <project_vertex>',`#include <project_vertex>
 { vec4 gardenWorld=vec4(transformed,1.0);
 #ifdef USE_INSTANCING
  gardenWorld=instanceMatrix*gardenWorld;
 #endif
  vGardenWorld=(modelMatrix*gardenWorld).xyz; }`);
  let fragment=shader.fragmentShader.replace('#include <common>',`#include <common>
varying vec3 vGardenWorld;uniform float gardenFogDensity;uniform float gardenGroundFog;uniform float gardenFogFalloff;
${patch.ground?'uniform sampler2D gardenGroundMap;uniform vec4 gardenGroundBounds;':''}
${NOISE}`);
  if(patch.ground){
   fragment=fragment.replace('#include <map_fragment>',`#include <map_fragment>
 vec2 gardenUv=(vGardenWorld.xz-gardenGroundBounds.xy)/gardenGroundBounds.zw;
 vec4 gardenGround=(gardenUv.x<0.0||gardenUv.y<0.0||gardenUv.x>1.0||gardenUv.y>1.0)?vec4(1.0,0.0,0.0,0.0):texture2D(gardenGroundMap,gardenUv);`+(mode==='floor'?`
 { float lum=dot(diffuseColor.rgb,vec3(.299,.587,.114));
   float n=gardenNoise(vGardenWorld.xz*.31)*.6+gardenNoise(vGardenWorld.xz*1.9)*.4;
   vec3 grass=mix(vec3(.045,.10,.018),vec3(.15,.25,.04),n)*(.75+lum*2.0);
   vec3 moss=vec3(.05,.075,.03)*(.8+lum*2.0);
   diffuseColor.rgb=mix(diffuseColor.rgb,mix(grass,moss,clamp(1.0-gardenGround.r,0.0,1.0)*1.6),gardenGround.g*.92);
   diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.08,1.02,.92),gardenGround.b); }`:''));
   fragment=fragment.replace('#include <aomap_fragment>',`#include <aomap_fragment>
 reflectedLight.indirectDiffuse*=gardenGround.r;
 #if defined( USE_ENVMAP ) && defined( STANDARD )
  reflectedLight.indirectSpecular*=gardenGround.r;
 #endif`);
  }
  shader.fragmentShader=fragment.replace('#include <fog_fragment>',`#ifdef USE_FOG
 { float gardenDistance=length(vGardenWorld-cameraPosition);
   float haze=1.0-exp(-gardenFogDensity*gardenFogDensity*gardenDistance*gardenDistance);
   float low=(1.0-exp(-gardenDistance*.02))*exp(-max(vGardenWorld.y+.5,0.0)*gardenFogFalloff)*gardenGroundFog;
   gl_FragColor.rgb=mix(gl_FragColor.rgb,fogColor,clamp(max(haze,low),0.0,1.0)); }
#endif`);
 };
 material.needsUpdate=true;
}
