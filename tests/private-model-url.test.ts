import {it,expect,vi,beforeEach} from 'vitest';
const {load}=vi.hoisted(()=>({load:vi.fn()}));
vi.mock('three/addons/loaders/GLTFLoader.js',()=>({GLTFLoader:class {constructor(_m:any){}loadAsync=load}}));
import {acquireAsset,AssetLoadError} from '../apps/web/src/asset-pool';
import {modelUrlFor,privateModelUrl,resolveAsset,devAssets,pinnedModels} from '../packages/asset-catalog/src/index';
import {resolvePrivateModel} from '../apps/worker/src/asset-delivery';
beforeEach(()=>load.mockReset());
// T18-B: the web app's choice of URL must agree exactly with what the worker will serve.
it('room mode routes every hash-pinned releasable model through the private API and nothing else',()=>{
 let routed=0;
 for(const asset of devAssets){
  const url=modelUrlFor(asset,'room-1'),served=resolvePrivateModel(asset.id,asset.version)!==undefined;
  expect(url.startsWith('/api/assets/')).toBe(served);if(served)routed++;
  if(served)expect(url).toBe(`/api/assets/${asset.id}/${asset.version}/model.glb?roomId=room-1`);else expect(url).toBe(asset.url);
 }
 expect(routed).toBe(999);// open-source edition: every CC0 model (270 + 527 + 98 + 104) is hash-pinned
 expect(modelUrlFor(resolveAsset('DEV_ROCK')!,'room-1')).toBe('/dev-assets/rock.glb');
 expect(pinnedModels.filter(m=>m.privateSource).length).toBe(0);// no private-only models ship in the open-source catalog
});
it('local exploration (no room) keeps the static catalog url and the room id is URL-encoded',()=>{
 const asset=resolveAsset('IMP_ARENA_banner')!;
 expect(modelUrlFor(asset,null)).toBe(asset.url);expect(modelUrlFor(asset,undefined)).toBe(asset.url);expect(modelUrlFor(asset,'')).toBe(asset.url);
 expect(modelUrlFor(asset,'a b&c')).toContain('?roomId=a%20b%26c');
 // A previous version that is not in imported-v1 is not pinned: no private route is invented for it.
 expect(privateModelUrl({...asset,version:'import-unknown'},'room-1')).toBeUndefined();
});
it('classifies 401/403/404 loader failures so the UI can tell sign-in from a broken model',async()=>{
 const reasons:string[]=[];
 for(const [i,status] of [401,403,404,500].entries()){
  load.mockRejectedValueOnce(Object.assign(new Error('fetch responded with '+status),{response:{status}}));
  const handle=acquireAsset('classify-'+i);const error=await handle.promise.catch(e=>e);
  expect(error).toBeInstanceOf(AssetLoadError);reasons.push((error as AssetLoadError).reason);handle.release();
 }
 expect(reasons).toEqual(['UNAUTHENTICATED','PERMISSION_DENIED','NOT_FOUND','ERROR']);
 load.mockRejectedValueOnce(new Error('network'));
 const plain=await acquireAsset('classify-plain').promise.catch(e=>e);expect((plain as AssetLoadError).reason).toBe('ERROR');expect((plain as Error).message).toBe('network');
});
