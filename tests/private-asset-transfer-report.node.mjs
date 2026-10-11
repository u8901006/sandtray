import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeTransfer} from '../tools/verification/private-asset-transfer-report.mjs';

const row=(ms,extra={})=>({ms,bytes:1000,failed:0,verified:2,...extra});
const report=(a,b)=>({models:2,rounds:2,expectedBytes:1000,static:a,private:b});
test('uses the average middle pair for even rounds and reports transfer scope only',()=>{
 const r=summarizeTransfer(report([row(100),row(300)],[row(200),row(260)]));
 assert.equal(r.medianMs.static,200);assert.equal(r.medianMs.private,230);
 assert.equal(r.verdict,'TRANSFER_WITHIN_20PCT');assert.equal(r.sceneAcceptance,'NOT_MEASURED');
});
test('both paths failing with equal bytes must never pass',()=>{
 const r=summarizeTransfer(report([row(100),row(100)],[row(100),row(100,{bytes:0,failed:2,verified:0})]));
 assert.equal(r.verdict,'INVALID_SAMPLE');
 const bad=row(100,{bytes:0,failed:2,verified:0});
 assert.equal(summarizeTransfer(report([bad,bad],[bad,bad])).verdict,'INVALID_SAMPLE');
});
test('equal truncated payloads and unverified hashes must never pass',()=>{
 for(const fault of [{bytes:999},{verified:1}]){
  const bad=row(100,fault);
  assert.equal(summarizeTransfer(report([bad,bad],[bad,bad])).verdict,'INVALID_SAMPLE');
 }
});
test('incomplete, zero-time and non-finite samples are invalid',()=>{
 for(const rows of [[],[row(100)],[row(0),row(100)],[row(NaN),row(100)]])
  assert.equal(summarizeTransfer(report(rows,[row(100),row(100)])).verdict,'INVALID_SAMPLE');
});
test('the 20 percent boundary is inclusive; slower transfers remain over budget',()=>{
 assert.equal(summarizeTransfer(report([row(100),row(100)],[row(120),row(120)])).verdict,'TRANSFER_WITHIN_20PCT');
 assert.equal(summarizeTransfer(report([row(100),row(100)],[row(121),row(121)])).verdict,'TRANSFER_OVER_20PCT');
});
