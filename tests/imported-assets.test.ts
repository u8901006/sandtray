import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import manifest from '../packages/asset-catalog/src/imported-v1.json';
import {describe,it,expect} from 'vitest';
import {missingLocalAssetsReason} from './runtime/local-asset-gate';
import {devAssets,validAssetVersion,clipDuration} from '../packages/asset-catalog/src/index';
describe('user supplied assets',()=>{
 it('registers all 270 source models with distinct IDs',()=>{const imported=devAssets.filter(a=>a.id.startsWith('IMP_'));expect(imported).toHaveLength(270);expect(new Set(imported.map(a=>a.id)).size).toBe(270);});
 it('pins imported content, keeps dependencies embedded and rejects mismatched versions',ctx=>{
  const reason=missingLocalAssetsReason(manifest.flatMap(asset=>['apps/web/public'+asset.url,asset.source]),'imported-v1 GLB and source bytes');
  if(reason){console.warn(reason);ctx.skip(reason);}
  for(const asset of manifest){const bytes=readFileSync('apps/web/public'+asset.url);expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);expect(createHash('sha256').update(readFileSync(asset.source)).digest('hex')).toBe(asset.sourceSha256);expect(new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(8,true)).toBe(bytes.length);const data=JSON.parse(bytes.subarray(20,20+new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(12,true)).toString());expect(data.buffers.every((b:any)=>!b.uri)).toBe(true);expect((data.images??[]).every((image:any)=>image.bufferView!==undefined&&!image.uri)).toBe(true);expect(validAssetVersion(asset.id,asset.version)).toBe(true);expect(validAssetVersion(asset.id,'dev-v1')).toBe(false);for(const clip of asset.clips)expect(clipDuration(asset.id,clip.id)).toBeGreaterThan(0);}
  expect(validAssetVersion('missing','dev-v1')).toBe(false);expect(clipDuration('IMP_ULTIMATE_Casual_Female','injected')).toBeUndefined();
 // V8-L02-10 (2026-09-26): explicit budget for real work (C57 DECISION) -- SHA-256 over 540 files / ~180 MB. Isolated 356-384 ms,
 // but 7,005 ms inside the parallel `npm run check` (2 of 3 runs hit the 5 s default). Assertions are unchanged.
 },30000);
});
