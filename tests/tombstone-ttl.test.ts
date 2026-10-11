import {describe,it,expect,vi} from 'vitest';
import type {Env} from '../apps/worker/src/env';
import {tombstoneTtlMs,DEFAULT_TOMBSTONE_TTL_MS} from '../apps/worker/src/policy';
import {purgeExpiredTombstones} from '../apps/worker/src/tombstones';
// C09-F3（Claude Opus 5.5, 2026-09-26）：staging／production 不設 RETENTION_POLICY（L01-4）。tombstone 清除不得因此失效，
// 否則每個結束的會談都在 D1 永久留下 clinic／scene id 與刪除時間。
const bindings={DIRECTORY:{},PRIVATE_SCENES:{}};
const env=(extra:Record<string,unknown>={})=>({...bindings,...extra}) as unknown as Env;
describe('tombstone ttl without a retention policy',()=>{
 it('defaults to 8 h when neither TOMBSTONE_TTL_MS nor RETENTION_POLICY is set',()=>{
  expect(tombstoneTtlMs(env())).toBe(DEFAULT_TOMBSTONE_TTL_MS);
  expect(DEFAULT_TOMBSTONE_TTL_MS).toBe(28800000);
 });
 it('fixes staging and production at 8 h and rejects every environment override',()=>{
  for(const DEPLOY_ENV of ['staging','production'] as const){
   expect(tombstoneTtlMs(env({DEPLOY_ENV}))).toBe(28800000);
   expect(()=>tombstoneTtlMs(env({DEPLOY_ENV,TOMBSTONE_TTL_MS:'86400000'}))).toThrow('PERMISSION_DENIED');
   expect(()=>tombstoneTtlMs(env({DEPLOY_ENV,RETENTION_POLICY:JSON.stringify({version:'dev-v1',ttlMs:86400000,purpose:'synthetic-testing'})}))).toThrow('PERMISSION_DENIED');
  }
 });
 it('uses an explicit TOMBSTONE_TTL_MS before the retention policy',()=>{
  const policy=JSON.stringify({version:'dev-v1',ttlMs:86400000,purpose:'synthetic-testing'});
  expect(tombstoneTtlMs(env({TOMBSTONE_TTL_MS:'3600000',RETENTION_POLICY:policy}))).toBe(3600000);
  expect(tombstoneTtlMs(env({RETENTION_POLICY:JSON.stringify({version:'dev-v1',ttlMs:5000,purpose:'synthetic-testing'})}))).toBe(5000);
 });
 it('fails loudly on an invalid value instead of silently falling back',()=>{
  for(const bad of ['0','999','86400001','1.5','abc',''])expect(()=>tombstoneTtlMs(env({TOMBSTONE_TTL_MS:bad}))).toThrow('PERMISSION_DENIED');
  expect(()=>tombstoneTtlMs(env({RETENTION_POLICY:'{broken'}))).toThrow('PERMISSION_DENIED');
  expect(()=>tombstoneTtlMs({} as Env)).toThrow('PERMISSION_DENIED');
 });
 it('the scheduled purge runs and asks the coordinator to purge an expired tombstone with no RETENTION_POLICY set',async()=>{
  const purgeTombstone=vi.fn().mockResolvedValue({purged:true});
  const pages=[[{clinic_id:'clinic-a',scene_id:'scene-1'}],[]];const binds:unknown[][]=[];
  const DIRECTORY={prepare:()=>({bind:(...args:unknown[])=>{binds.push(args);return {all:async()=>({success:true,results:pages.shift()??[]})};}})};
  const SCENE_COORDINATOR_DO={getByName:vi.fn(()=>({purgeTombstone}))};
  const result=await purgeExpiredTombstones({DIRECTORY,PRIVATE_SCENES:{},SCENE_COORDINATOR_DO} as unknown as Env);
  expect(result).toEqual({purged:1,skipped:0});
  expect(purgeTombstone).toHaveBeenCalledWith('clinic-a','scene-1');
  expect(binds[0][0]).toBe(DEFAULT_TOMBSTONE_TTL_MS);
 });
});
