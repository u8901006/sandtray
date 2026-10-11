import {describe,it,expect} from 'vitest';
import {devAssets,provenanceFor,type CatalogAsset} from '../packages/asset-catalog/src/index';
import {isLocalHost,listableAsset} from '../apps/web/src/asset-listing';
// GPT-6 static review 2026-10-04 A2-F1: deployed hosts must hide non-releasable assets without waiting for /api/health.
// Open-source edition ships no UNVERIFIED pack; a synthetic one (unknown sourcePack → UNVERIFIED) stands in.
const base=devAssets.find(a=>a.id==='IMP_ARENA_banner')!;
const unverified:CatalogAsset[]=['X_UNVERIFIED_1','X_UNVERIFIED_2'].map(id=>({...base,id,sourcePack:'Unknown pack',provenance:provenanceFor({id,sourcePack:'Unknown pack'})}));
const hidden=[...devAssets.filter(a=>a.id.startsWith('DEV_')||!a.provenance.releasable),...unverified];
const zeus=base;
describe('asset listing (deployed vs local)',()=>{
 it('fixture sanity: the synthetic UNVERIFIED assets and the DEV models are non-releasable',()=>{for(const a of unverified)expect(a.provenance.license).toBe('UNVERIFIED');expect(hidden.length).toBeGreaterThanOrEqual(6);/* 4 DEV models + 2 synthetic UNVERIFIED */expect(zeus.provenance.releasable).toBe(true);});
 for(const hostname of ['sandtray.example.org','sandtray-staging.example.workers.dev'])for(const roomId of [null,'room-1'])
  it(`${hostname} ${roomId?'room':'explore'}: hidden before health answers (healthDeployed=false)`,()=>{
   for(const asset of hidden)expect(listableAsset(asset,{roomId,hostname,healthDeployed:false}),asset.id).toBe(false);
   expect(listableAsset(zeus,{roomId,hostname,healthDeployed:false})).toBe(true);
  });
 it('local host lists candidates unless health reports a deployed mode',()=>{
  for(const asset of unverified)expect(listableAsset(asset,{roomId:null,hostname:'127.0.0.1',healthDeployed:false})).toBe(true);
  for(const asset of unverified)expect(listableAsset(asset,{roomId:null,hostname:'127.0.0.1',healthDeployed:true})).toBe(false);
 });
 it('local hosts',()=>{for(const h of ['localhost','127.0.0.1','[::1]','app.localhost'])expect(isLocalHost(h)).toBe(true);for(const h of ['sandtray.example.org','127.0.0.1.nip.io','localhost.example.com'])expect(isLocalHost(h)).toBe(false);});
});
