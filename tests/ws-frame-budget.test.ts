import {describe,expect,it,vi} from 'vitest';
import {parseInbound} from '../packages/protocol/src/index';
import {Rejected} from '../packages/room-core/src/index';
import {parseInboundFrame,recoverRejectedOperationId,type FrameBudget} from '../apps/worker/src/ws-frame-budget';

const budget=():FrameBudget=>({window:1000,normal:0,priority:0,commits:0,previews:0,invalidFrames:0});

describe('WebSocket malformed-frame budget',()=>{
 it('does not invoke the parser after ten invalid frames until the next one-second window',()=>{
  const state=budget();const parser=vi.fn((_raw:string)=>{throw new Error('INVALID_PAYLOAD');});
  for(let i=0;i<10;i++)expect(()=>parseInboundFrame('bad',state,1000,parser)).toThrow('INVALID_PAYLOAD');
  expect(parser).toHaveBeenCalledTimes(10);expect(state.invalidFrames).toBe(10);

  let caught:unknown;try{parseInboundFrame('must-not-parse',state,1500,parser);}catch(error){caught=error;}
  expect(caught).toBeInstanceOf(Rejected);expect((caught as Rejected).code).toBe('RATE_LIMITED');
  expect((caught as Rejected).retryAfterMs).toBe(500);expect(parser).toHaveBeenCalledTimes(10);
  expect(()=>parseInboundFrame('still-blocked',state,1999,parser)).toThrow(Rejected);
  expect(parser).toHaveBeenCalledTimes(10);

  expect(()=>parseInboundFrame('new-window',state,2000,parser)).toThrow('INVALID_PAYLOAD');
  expect(parser).toHaveBeenCalledTimes(11);expect(state.window).toBe(2000);expect(state.invalidFrames).toBe(1);
 });

 it('counts binary, oversized and invalid-JSON frames without bypassing the parser budget',()=>{
  const state=budget();const malformed:Array<string|ArrayBuffer>=[new ArrayBuffer(0),'x'.repeat(16385),'not-json'];
  for(const [index,raw] of malformed.entries()){
   expect(()=>parseInboundFrame(raw,state,1000,parseInbound)).toThrow();
   expect(state.invalidFrames).toBe(index+1);
  }
 });

 it('does not parse raw JSON to recover attribution after a pre-parse rate-limit rejection',()=>{
  const raw=JSON.stringify({operationId:'gated-frame-11'});const parse=vi.fn((text:string)=>JSON.parse(text));
  expect(recoverRejectedOperationId(raw,true,parse)).toBeUndefined();expect(parse).not.toHaveBeenCalled();
  expect(recoverRejectedOperationId(raw,false,parse)).toBe('gated-frame-11');expect(parse).toHaveBeenCalledTimes(1);

  const multibyteOversize=JSON.stringify({operationId:'oversize-frame',padding:'漢'.repeat(5500)});const utf8Parse=vi.fn((text:string)=>JSON.parse(text));
  expect(multibyteOversize.length).toBeLessThan(16384);expect(new TextEncoder().encode(multibyteOversize).length).toBeGreaterThan(16384);
  expect(recoverRejectedOperationId(multibyteOversize,false,utf8Parse)).toBeUndefined();expect(utf8Parse).not.toHaveBeenCalled();
 });
});
