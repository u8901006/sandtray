import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {type Group,Mesh,Texture,LoadingManager} from 'three';
type Entry={refs:number;promise:Promise<Group>};
const entries=new Map<string,Entry>();
function dispose(root:Group) {
 const disposed=new Set<object>();
 root.traverse(object=>{if(!(object instanceof Mesh))return;
  if(!disposed.has(object.geometry)){object.geometry.dispose();disposed.add(object.geometry);}
  for(const material of Array.isArray(object.material)?object.material:[object.material]){
   for(const value of Object.values(material))if(value instanceof Texture&&!disposed.has(value)){value.dispose();disposed.add(value);}
   if(!disposed.has(material)){material.dispose();disposed.add(material);}
  }
 });
}
const ASSET_LOAD_TIMEOUT_MS=45000;
export type AssetLoadFailure='UNAUTHENTICATED'|'PERMISSION_DENIED'|'NOT_FOUND'|'TIMEOUT'|'ERROR';
export class AssetLoadError extends Error{constructor(public readonly reason:AssetLoadFailure,message:string){super(message);}}
// REQ-018 AC18-8: a 401/403 from the private route is a session/room problem, not a broken model —
// the UI must say "sign in again" / "session ended" instead of retrying blindly.
function classify(error:unknown):AssetLoadError{
 const status=(error as {response?:{status?:number}})?.response?.status;
 if(status===401)return new AssetLoadError('UNAUTHENTICATED','登入已失效，請重新登入。');
 if(status===403)return new AssetLoadError('PERMISSION_DENIED','會談已結束或沒有這件素材的存取資格。');
 if(status===404)return new AssetLoadError('NOT_FOUND','找不到這件模型。');
 return new AssetLoadError('ERROR',error instanceof Error?error.message:'模型載入失敗。');
}
function loadAsset(url:string):Promise<Group>{
 const manager=new LoadingManager();
 return new Promise((resolve,reject)=>{
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;manager.abort();reject(new AssetLoadError('TIMEOUT','模型下載或處理逾時，請重新載入。'));},ASSET_LOAD_TIMEOUT_MS);
  void new GLTFLoader(manager).loadAsync(url).then(gltf=>{
   clearTimeout(timer);
   if(timedOut){dispose(gltf.scene);return;}
   gltf.scene.animations=gltf.animations??[];resolve(gltf.scene);
  },error=>{clearTimeout(timer);if(!timedOut)reject(classify(error));});
 });
}
export function acquireAsset(url:string) {
 let entry=entries.get(url);
 if(!entry){
  const created:Entry={refs:0,promise:loadAsset(url)};
  created.promise=created.promise.catch(error=>{if(entries.get(url)===created)entries.delete(url);throw error;});
  entries.set(url,created);entry=created;
 }
 entry.refs++;const current=entry;let released=false;
 return {promise:current.promise,release:()=>{
  if(released)return;released=true;
  if(--current.refs===0){if(entries.get(url)===current)entries.delete(url);void current.promise.then(dispose,()=>{});}
 }};
}
