import {describe,it,expect} from 'vitest';
import {devAssets} from '../packages/asset-catalog/src/index';
import {SHELF_GROUPS,OTHER_GROUP,categoryGroup,shelfGroups} from '../apps/web/src/shelf-groups';
import {therapistHolds,dropOffset,DROP_MS,DROP_HEIGHT,isSoftwareRenderer} from '../apps/web/src/presence';
import {cameraView} from '../apps/web/src/tray-layout';
// 2026-10-09 UX 建議 2、6、7、9（Claude Opus 5.5）。
describe('shelf groups (UX 2)',()=>{
 const categories=[...new Set(devAssets.map(a=>a.category))];
 it('every catalogue category is reachable from exactly one shelf group',()=>{
  const rows=shelfGroups(categories),listed=rows.flatMap(r=>r.categories);
  expect(listed.sort()).toEqual([...categories].sort());
  expect(new Set(listed).size).toBe(listed.length);
 });
 it('the current catalogue needs no "其他" group, and an unknown category falls into it instead of disappearing',()=>{
  expect(categories.filter(c=>categoryGroup(c)===OTHER_GROUP)).toEqual([]);
  const rows=shelfGroups([...categories,'未分類測試']);
  expect(rows.at(-1)).toEqual({group:OTHER_GROUP,categories:['未分類測試']});
 });
 it('no category is listed under two groups, and empty groups are hidden',()=>{
  const all=SHELF_GROUPS.flatMap(g=>g.categories);expect(new Set(all).size).toBe(all.length);
  expect(shelfGroups(['動物']).map(r=>r.group.id)).toEqual(['animals']);
 });
});
describe('therapist holds (UX 7, display only)',()=>{
 const now=1_000_000;
 it('needs an active, unexpired grant for that object',()=>{
  expect(therapistHolds({g:{objectId:'a',active:true,expiresAt:now+1}},'a',now)).toBe(true);
  expect(therapistHolds({g:{objectId:'a',active:true,expiresAt:now}},'a',now)).toBe(false);
  expect(therapistHolds({g:{objectId:'a',active:false,expiresAt:now+1}},'a',now)).toBe(false);
  expect(therapistHolds({g:{objectId:'b',active:true,expiresAt:now+1}},'a',now)).toBe(false);
  expect(therapistHolds(undefined,'a',now)).toBe(false);
 });
});
describe('drop-in offset (UX 9)',()=>{
 it('starts at the drop height, falls monotonically and ends exactly at rest',()=>{
  expect(dropOffset(0)).toBe(DROP_HEIGHT);expect(dropOffset(DROP_MS)).toBe(0);expect(dropOffset(DROP_MS*5)).toBe(0);
  let last=Infinity;for(let t=0;t<=DROP_MS;t+=8){const y=dropOffset(t);expect(y).toBeLessThanOrEqual(last);expect(y).toBeGreaterThanOrEqual(0);last=y;}
  expect(dropOffset(Number.NaN)).toBe(DROP_HEIGHT);
 });
});
describe('seated camera view (UX 6)',()=>{
 it('looks across both trays from lower than the oblique view, at the same target',()=>{
  const low=cameraView('low',1.6),angle=cameraView('angle',1.6);
  expect(low.target).toEqual(angle.target);
  const elevation=(p:number[])=>Math.atan2(p[1],Math.hypot(p[0],p[2]));
  expect(elevation(low.position)).toBeLessThan(elevation(angle.position));
  expect(elevation(low.position)).toBeGreaterThan(0.2); // stays above OrbitControls' floor (maxPolarAngle π/2-0.04)
 });
});
describe('software renderer detection (UX 9: no decorative drop without a GPU)',()=>{
 it('matches software GL renderers and nothing else',()=>{
  for(const name of ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)','llvmpipe (LLVM 15.0.7, 256 bits)','ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)'])expect(isSoftwareRenderer(name)).toBe(true);
  for(const name of ['Apple GPU','ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)','Adreno (TM) 740','',undefined,null])expect(isSoftwareRenderer(name as string)).toBe(false);
 });
});
