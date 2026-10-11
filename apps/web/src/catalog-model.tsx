import {useEffect,useRef,useState} from 'react';
import {useFrame,useThree} from '@react-three/fiber';
import {AnimationMixer,Box3,Group,Vector3,LoopOnce,LoopRepeat,type AnimationAction,SkinnedMesh,Mesh,type Material} from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {resolveAsset,modelUrlFor,COLOR_VARIANT_OPTIONS,type LinearRgba} from '../../../packages/asset-catalog/src/index';
import {colorVariantHex,type ColorVariant} from '../../../packages/protocol/src/index';
import {acquireAsset,AssetLoadError,type AssetLoadFailure} from './asset-pool';
import {pathPosition} from '../../../packages/room-core/src/animation';
import {normalizedScale} from './model-size';
type Animation=Parameters<typeof pathPosition>[0];
const OWNED_MATERIAL='__sandtrayOwnedMaterial';
function materialsOf(node:Mesh):Material[]{const value=node.material;return Array.isArray(value)?value:[value];}
function cloneMaterials(root:Group){root.traverse(node=>{if(!(node instanceof Mesh))return;const materials=materialsOf(node).map(material=>{const copy=material.clone();copy.userData[OWNED_MATERIAL]=true;return copy;});node.material=Array.isArray(node.material)?materials:materials[0];});}
function disposeMaterials(root:Group){root.traverse(node=>{if(node instanceof SkinnedMesh)node.skeleton.dispose();if(!(node instanceof Mesh))return;for(const material of materialsOf(node))if(material.userData[OWNED_MATERIAL])material.dispose();});}
function applyColorVariant(root:Group,variant:ColorVariant|undefined,original:LinearRgba|undefined){if(!variant)return;root.traverse(node=>{if(!(node instanceof Mesh))return;for(const material of materialsOf(node)){if(material.name!=='Skin'||!('color' in material))continue;const color=(material as Material & {color?:{set:(value:string)=>void;setRGB:(r:number,g:number,b:number)=>void;needsUpdate:boolean}}).color;if(!color)continue;if(variant==='orig'){if(!original)continue;color.setRGB(original[0],original[1],original[2]);}else color.set(colorVariantHex[variant]);material.needsUpdate=true;}});}
export function Model({assetId,assetVersion,roomId=null,onLoad,animation,clockOffset=0,retryToken=0,colorVariant}:{assetId:string;assetVersion?:string;roomId?:string|null;onLoad:(ok:boolean|undefined,reason?:AssetLoadFailure)=>void;retryToken?:number;animation?:Animation;clockOffset?:number;colorVariant?:ColorVariant}){
 const asset=resolveAsset(assetId,assetVersion),[model,setModel]=useState<Group>();const {invalidate}=useThree();
 const url=asset?modelUrlFor(asset,roomId):undefined;
 const mixer=useRef<AnimationMixer|null>(null),action=useRef<AnimationAction|null>(null);
 useEffect(()=>{setModel(undefined);if(!asset||!url){onLoad(false,'NOT_FOUND');return;}let active=true;let instance:Group|undefined;const handle=acquireAsset(url);setModel(undefined);onLoad(undefined);
  void handle.promise.then(root=>{if(!active)return;instance=clone(root) as Group;cloneMaterials(instance);const wrapper=new Group();wrapper.add(instance);
   if(asset.sourcePack){const bounds=new Box3().setFromObject(instance);const size=bounds.getSize(new Vector3()),center=bounds.getCenter(new Vector3());const scale=normalizedScale(size,asset.displaySize);if(!Number.isFinite(scale))throw new Error('Invalid model bounds');wrapper.scale.setScalar(scale);instance.position.sub(new Vector3(center.x,bounds.min.y,center.z));}
   wrapper.animations=root.animations;setModel(wrapper);onLoad(true);invalidate();
  }).catch((error:unknown)=>{if(active)onLoad(false,error instanceof AssetLoadError?error.reason:'ERROR');});
  return()=>{active=false;if(instance)disposeMaterials(instance);handle.release();};
 },[url,assetVersion,retryToken]);
 useEffect(()=>{if(model)applyColorVariant(model,colorVariant,asset?.colorVariantOriginal);invalidate();},[model,colorVariant,asset,invalidate]);
 useEffect(()=>{if(!model)return;const index=asset?.clips.findIndex(c=>c.id===animation?.clipId)??-1;const clip=index>=0?model.animations[index]:model.animations.find(c=>c.name.toLowerCase()==='idle');
  const m=new AnimationMixer(model);mixer.current=m;if(clip){const a=m.clipAction(clip);a.setLoop(animation?.loop?LoopRepeat:LoopOnce,animation?.loop?Infinity:1);a.clampWhenFinished=true;a.play();action.current=a;m.setTime(0);}else action.current=null;invalidate();
  return()=>{m.stopAllAction();m.uncacheRoot(model);mixer.current=null;action.current=null;};
 },[model,animation?.clipId,animation?.loop]);
 useFrame(()=>{const m=mixer.current,a=action.current;if(!m||!a)return;const matched=asset?.clips.some(c=>c.id===animation?.clipId);const elapsed=matched&&animation?(animation.offsetMs+(animation.state==='playing'?Math.max(0,Date.now()+clockOffset-animation.serverStartedAt)*animation.speed:0))/1000:0;const duration=a.getClip().duration;a.paused=false;a.enabled=true;m.setTime(animation?.loop&&duration?elapsed%duration:Math.min(elapsed,duration));if(matched&&animation?.state==='playing')invalidate();});
 return model?<primitive object={model} dispose={null}/>:null;
}
export {COLOR_VARIANT_OPTIONS,applyColorVariant};
