import {CircleGeometry,Color,Matrix4,ShaderMaterial,type Texture} from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';

/** Static planar reflection: no automatic wave animation; all render targets are owned here. */
export function createGardenReflection(normalMap:Texture|null,resolution:256|512){
 const geometry=new CircleGeometry(1,96);
 const reflector=new Reflector(geometry,{textureWidth:resolution,textureHeight:resolution,multisample:0,clipBias:.003,color:'#45675c',shader:{
  name:'GardenWaterReflection',
  uniforms:{color:{value:new Color()},tDiffuse:{value:null},textureMatrix:{value:new Matrix4()},normalMap:{value:normalMap},hasNormal:{value:normalMap?1:0}},
  vertexShader:`uniform mat4 textureMatrix;varying vec4 reflectionUv;varying vec2 surfaceUv;varying vec3 eyeDirection;
   void main(){surfaceUv=uv;reflectionUv=textureMatrix*vec4(position,1.0);eyeDirection=cameraPosition-(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`uniform vec3 color;uniform sampler2D tDiffuse;uniform sampler2D normalMap;uniform float hasNormal;varying vec4 reflectionUv;varying vec2 surfaceUv;varying vec3 eyeDirection;
   void main(){vec2 ripple=hasNormal*(texture2D(normalMap,surfaceUv*vec2(8.0,6.0)).xy*2.0-1.0);vec4 projected=reflectionUv;projected.xy+=ripple*.005*projected.w;vec3 reflection=texture2DProj(tDiffuse,projected).rgb;float fresnel=pow(1.0-clamp(abs(normalize(eyeDirection).y),0.0,1.0),3.0);gl_FragColor=vec4(mix(color,reflection,.32+.53*fresnel),1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`
 }});
 // Reflector clones shader uniforms. Restore the borrowed map so it is never duplicated or disposed here.
 (reflector.material as ShaderMaterial).uniforms.normalMap.value=normalMap;
 reflector.position.set(-23,-.697,10);reflector.rotation.x=-Math.PI/2;reflector.scale.set(11.5,8.5,1);reflector.name='Garden_water_reflection';
 let disposed=false;return {object:reflector,dispose(){if(disposed)return;disposed=true;reflector.dispose();geometry.dispose();}};
}
