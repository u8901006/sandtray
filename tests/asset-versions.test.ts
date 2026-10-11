import {it,expect} from 'vitest';
import * as catalog from '../packages/asset-catalog/src/index';
import previous from '../packages/asset-catalog/src/dev-puppet-v1.json';
it('retains old releases while the library selects the current release',()=>{
 for(const id of ['DEV_PUPPET']){// open-source edition: DEV_PUPPET v1/v2 is the two-version asset
  const old=previous.find(a=>a.id===id)!,next=catalog.assetById.get(id)!;
  expect(old.version).not.toBe(next.version);expect(catalog.validAssetVersion(id,old.version)).toBe(true);expect(catalog.validAssetVersion(id,next.version)).toBe(true);
  expect(catalog.resolveAsset(id,old.version)?.url).toBe(old.url);expect(catalog.resolveAsset(id,next.version)?.url).toBe(next.url);expect(catalog.assetById.get(id)?.version).toBe(next.version);
 }
 expect(new Set(catalog.devAssets.map(a=>a.id)).size).toBe(catalog.devAssets.length);expect(catalog.devAssets.filter(a=>a.sourcePack)).toHaveLength(999);// open-source edition: CC0 packs only
});
it('checks animation availability and duration against the pinned version',()=>{
 // T18-D removed the trex pair; G57's DEV_PUPPET restores a version-scoped clip pair (v1 lacks 原地行走).
 const walker=catalog.assetById.get('IMP_ULTIMATE_Casual_Female')!;const clip=walker.clips[0];
 expect(catalog.clipDuration(walker.id,clip.id,walker.version)).toBe(clip.durationMs);expect(catalog.clipDuration(walker.id,clip.id,'unknown')).toBeUndefined();
 const old=previous.find(a=>a.id==='DEV_PUPPET')!;expect(catalog.clipDuration(old.id,'clip-1',old.version)).toBeUndefined();
 expect(catalog.resolveAsset(old.id,'unknown')).toBeUndefined();expect(catalog.validAssetVersion(old.id,'unknown')).toBe(false);
 const puppetOld=catalog.resolveAsset('DEV_PUPPET','puppet-v1')!,puppetNew=catalog.assetById.get('DEV_PUPPET')!;
 expect(puppetOld.version).toBe('puppet-v1');expect(puppetNew.version).toBe('puppet-v2');
 expect(catalog.clipDuration('DEV_PUPPET','clip-0',puppetOld.version)).toBe(1000);expect(catalog.clipDuration('DEV_PUPPET','clip-1',puppetOld.version)).toBeUndefined();
 expect(catalog.clipDuration('DEV_PUPPET','clip-1',puppetNew.version)).toBe(800);expect(catalog.validAssetVersion('DEV_PUPPET',puppetOld.version)).toBe(true);
});
