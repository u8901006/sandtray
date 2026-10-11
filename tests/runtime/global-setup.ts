import type {FullConfig} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {pinnedModels} from '../../packages/asset-catalog/src/index';
// T18-B: room-mode UI now loads hash-pinned models through /api/assets/…; the run's local R2 starts empty,
// so seed it once from the built public copies before any spec runs (private-assets.spec re-seeds its own fixture).
export default async function globalSetup(_config:FullConfig){
 const response=await fetch('http://127.0.0.1:8788/__test/asset-store-all',{method:'POST'});
 if(!response.ok)throw new Error('asset-store-all seed failed: '+response.status);
 const result=await response.json() as {stored:number;skipped:number};
 // T18-C: private-only models have no public copy in dist; upload them from the repo's private-assets/ directory.
 let uploaded=0;
 for(const model of pinnedModels){
  if(!model.privateSource)continue;
  const put=await fetch('http://127.0.0.1:8788/__test/asset-put',{method:'POST',headers:{'x-asset-id':model.id,'x-asset-version':model.version},body:readFileSync(model.privateSource)});
  if(!put.ok)throw new Error(`asset-put ${model.id}@${model.version} failed: ${put.status}`);uploaded++;
 }
 console.log(`[global-setup] private asset seed stored=${result.stored} skipped=${result.skipped} privateUploaded=${uploaded}`);
}
