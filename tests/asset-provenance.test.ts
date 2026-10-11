import {it,expect} from 'vitest';
import {devAssets,resolveAsset,validAssetVersion,provenanceIssues,creditsText,ALLOWED_LICENSES,type CatalogAsset} from '../packages/asset-catalog/src/index';

// REQ-017 E1: every catalog entry ships with complete, allow-listed provenance.
it('every catalog asset has valid provenance (author, allow-listed license, attribution when required)',()=>{
  expect(devAssets.length).toBeGreaterThan(270);
  const bad=devAssets.filter(a=>provenanceIssues(a).length).map(a=>[a.id,provenanceIssues(a)]);
  expect(bad).toEqual([]);
  const released=devAssets.filter(a=>a.provenance.releasable);
  expect(released.length).toBe(999); // open-source edition: CC0 only — Kenney ×4 + Quaternius UACP (270) + Quaternius MegaKits (527) + adventure-v1 (98) + bits-v1 (104); DEV_ is never releasable
  // T18-C / REQ-018 option B: every releasable-but-restricted asset must be private-only (never a public static url).
  for(const a of released.filter(a=>!a.provenance.standaloneRedistributionAllowed))expect(a.url).toMatch(/^\/api\/assets\//);
  expect(released.filter(a=>a.provenance.license!=='CC0-1.0')).toEqual([]);
  for(const a of released){expect(a.provenance.licenseUrl).toMatch(/^https:\/\//);expect(a.provenance.sourceUrl).toMatch(/^https:\/\//);}
  expect(devAssets.filter(a=>a.provenance.license==='UNVERIFIED').map(a=>a.id)).toEqual([]);
});
// AC17-2 / AC17-4b / AC17-4: the check must actually fail when data goes wrong (mutation counter-tests).
it('rejects empty attribution on CC-BY, non-allow-listed licenses, and restricted assets on a public path',()=>{
  const base=devAssets.find(a=>a.id==='IMP_ARENA_banner')!;
  const mutate=(change:(a:CatalogAsset)=>void)=>{const a=structuredClone(base);change(a);return provenanceIssues(a);};
  expect(mutate(a=>{a.provenance.license='CC-BY-4.0';a.provenance.requiresAttribution=true;a.provenance.attributionText='';})).toContain('ATTRIBUTION_EMPTY');
  expect(mutate(a=>{(a.provenance as any).license='CC-BY-SA-4.0';})).toContain('LICENSE_NOT_ALLOWED');
  expect(mutate(a=>{(a.provenance as any).license='CC-BY-NC-4.0';})).toContain('LICENSE_NOT_ALLOWED');
  expect(mutate(a=>{a.provenance.license='QAL-1.0';a.provenance.standaloneRedistributionAllowed=false;})).toContain('RESTRICTED_ON_PUBLIC_PATH');
  expect(mutate(a=>{a.provenance.author='  ';})).toContain('AUTHOR_EMPTY');
  expect(mutate(a=>{delete (a as any).provenance;})).toEqual(['MISSING']);
  expect(ALLOWED_LICENSES).not.toContain('CC-BY-SA-4.0');
});
// E2: the server-side gate (validAssetVersion) shares the same check, so a provenance failure is not placeable.
it('validAssetVersion is false for an asset whose provenance fails',()=>{
  const asset=resolveAsset('IMP_ARENA_banner')!;
  expect(validAssetVersion(asset.id,asset.version)).toBe(true);
  const saved=asset.provenance;
  (asset as any).provenance={...saved,author:''};
  try{expect(validAssetVersion(asset.id,asset.version)).toBe(false);}finally{(asset as any).provenance=saved;}
  expect(validAssetVersion(asset.id,asset.version)).toBe(true);
});
it('creditsText lists every pack once with author, license and every object name',()=>{
  const picks=[resolveAsset('IMP_ARENA_banner')!,resolveAsset('IMP_FURNITURE_chair')!,resolveAsset('IMP_ULTIMATE_Wizard')!,resolveAsset('DEV_ROCK')!];
  const text=creditsText(picks);
  expect(text).toContain('Kenney');expect(text).toContain('Quaternius');expect(text).toContain('CC0');
  for(const p of picks)expect(text).toContain(p.name);
  expect(text.split('\n').filter(l=>l.includes('作者：')).length).toBe(4);
});
