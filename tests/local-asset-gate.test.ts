import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe,expect,it} from 'vitest';
import {missingLocalAssetReason,parseRequireLocalAssetsMode} from './runtime/local-asset-gate';

const missingPath=resolve(tmpdir(),'sandtray-v8-l02-1-'+randomUUID()+'.glb');
const existingPath=fileURLToPath(import.meta.url);

describe('local runtime asset requirement flag',()=>{
 it.each([
  {value:'1',expected:true},
  {value:'true',expected:true},
  {value:'on',expected:true},
  {value:' TRUE ',expected:true},
  {value:undefined,expected:false},
  {value:'',expected:false},
  {value:'   ',expected:false},
  {value:'0',expected:false},
  {value:'false',expected:false},
  {value:'off',expected:false},
  {value:' OFF ',expected:false},
 ])('parses $value as required=$expected',({value,expected})=>{
  expect(parseRequireLocalAssetsMode(value)).toBe(expected);
 });

 it('rejects an unrecognized non-empty value instead of silently disabling the gate',()=>{
  expect(()=>parseRequireLocalAssetsMode('treu')).toThrow(/INVALID_REQUIRE_LOCAL_ASSETS/);
 });

 it('fails closed when true is used and a required fixture is absent',()=>{
  expect(()=>missingLocalAssetReason(missingPath,'G06-B1 test fixture','true')).toThrow(/ENV_MISSING_ASSET.*REQUIRE_LOCAL_ASSETS/);
  expect(()=>missingLocalAssetReason(missingPath,'G06-B1 test fixture','true')).not.toThrow(/SKIPPED/);
 });

 it('preserves an explicit, non-pass skip reason when the gate is disabled',()=>{
  const reason=missingLocalAssetReason(missingPath,'G06-B1 test fixture','false');
  expect(reason).toContain('ENV_MISSING_ASSET');
  expect(reason).toContain('SKIPPED/NOT_RUN, not PASS');
 });

 it('accepts a present fixture in required mode',()=>{
  expect(missingLocalAssetReason(existingPath,'existing test module','on')).toBeUndefined();
 });

 it('rejects malformed configuration even when a fixture exists',()=>{
  expect(()=>missingLocalAssetReason(existingPath,'existing test module','unexpected')).toThrow(/INVALID_REQUIRE_LOCAL_ASSETS/);
 });
});