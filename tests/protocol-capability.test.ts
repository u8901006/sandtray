import {describe,expect,it} from 'vitest';
import {hasV2Capability,offersWsSubprotocol} from '../packages/protocol/src/index';
// L07-2B C4 (2026-09-30): only an exact header value or an exact offered subprotocol counts as the two-tray capability.
describe('L07-2B C4 capability negotiation',()=>{
 const h=(init:Record<string,string>)=>new Headers(init);
 it('accepts the header or the subprotocol',()=>{
  expect(hasV2Capability(h({'X-Sandtray-Protocol':'2'}))).toBe(true);
  expect(hasV2Capability(h({'Sec-WebSocket-Protocol':'sandtray.v2'}))).toBe(true);
  expect(hasV2Capability(h({'Sec-WebSocket-Protocol':'other, sandtray.v2'}))).toBe(true);
  expect(offersWsSubprotocol(h({'Sec-WebSocket-Protocol':' sandtray.v2 ,x'}))).toBe(true);
 });
 it('refuses missing, old or look-alike values',()=>{
  for(const init of [{},{'X-Sandtray-Protocol':'1'},{'X-Sandtray-Protocol':''},{'X-Sandtray-Protocol':'20'},{'Sec-WebSocket-Protocol':'sandtray.v1'},{'Sec-WebSocket-Protocol':'sandtray.v2x'},{'Sec-WebSocket-Protocol':'SANDTRAY.V2'}])
   expect(hasV2Capability(h(init as Record<string,string>)),JSON.stringify(init)).toBe(false);
 });
});
