import {describe,expect,it} from 'vitest';
import {decideEntry,gateEnforced,inviteFromHash,parseSession,roomSearch,sessionFailure,type SessionCheck} from '../apps/web/src/entry-decision';
// 2026-10-09 遊戲式登入入口：只有已登入治療師與受邀案主可以使用沙盤；判定失敗一律不放行。
const therapist:SessionCheck={kind:'ok',session:{role:'therapist',roomId:null}};
const client:SessionCheck={kind:'ok',session:{role:'client',roomId:'room-a'}};
const base={enforced:true,roomId:null,invite:null,search:''};
describe('entry gate',()=>{
 it('is enforced on every deployed host and only bypassed on local dev hosts without ?gate=1',()=>{
  for(const host of ['sandtray.example.org','sandtray-staging.workers.dev','localhost.evil.com','127.0.0.2'])expect(gateEnforced(host,'')).toBe(true);
  for(const host of ['localhost','127.0.0.1','[::1]','app.localhost'])expect(gateEnforced(host,'')).toBe(false);
  expect(gateEnforced('127.0.0.1','?gate=1')).toBe(true);
  expect(gateEnforced('127.0.0.1','?gate=0')).toBe(false);
  // 部署主機無法用參數關閉入口
  expect(gateEnforced('sandtray.example.org','?gate=0')).toBe(true);
 });
 it('shows the title screen, not the sandtray, to an anonymous visitor even with a room id',()=>{
  expect(decideEntry({...base,check:{kind:'none'}})).toEqual({view:'title'});
  expect(decideEntry({...base,roomId:'room-a',check:{kind:'none'}})).toEqual({view:'title'});
 });
 it('fails closed while checking and on non-401 errors',()=>{
  expect(decideEntry({...base,check:{kind:'checking'}})).toEqual({view:'loading'});
  expect(decideEntry({...base,check:{kind:'error'}})).toEqual({view:'error'});
  expect(sessionFailure(new Error('UNAUTHENTICATED'))).toEqual({kind:'none'});
  for(const cause of [new Error('SAVE_FAILED'),new TypeError('Failed to fetch'),new SyntaxError('Unexpected token'),'x'])expect(sessionFailure(cause)).toEqual({kind:'error'});
  for(const value of [null,{},{role:'admin'},{role:'Therapist'},'therapist'])expect(parseSession(value)).toEqual({kind:'error'});
 });
 it('lets a logged-in therapist in',()=>{
  expect(decideEntry({...base,check:therapist})).toEqual({view:'app'});
  expect(decideEntry({...base,roomId:'room-a',check:therapist})).toEqual({view:'app'});
  expect(parseSession({participantId:'p',role:'therapist'})).toEqual(therapist);
 });
 it('keeps an invited client inside their own room only',()=>{
  expect(decideEntry({...base,roomId:'room-a',check:client})).toEqual({view:'app'});
  expect(decideEntry({...base,check:client})).toEqual({view:'redirect',search:'?room=room-a'});
  expect(decideEntry({...base,roomId:'room-b',check:client})).toEqual({view:'redirect',search:'?room=room-a'});
  expect(decideEntry({...base,check:{kind:'ok',session:{role:'client',roomId:null}}})).toEqual({view:'title'});
 });
 it('routes an invite link to the invite card before any session check',()=>{
  expect(inviteFromHash('#invite=room.secret')).toBe('room.secret');
  expect(inviteFromHash('')).toBeNull();expect(inviteFromHash('#invite=')).toBeNull();expect(inviteFromHash('#other=1')).toBeNull();
  expect(decideEntry({...base,invite:'room.secret',check:{kind:'checking'}})).toEqual({view:'invite',token:'room.secret'});
 });
 it('changes nothing on an unenforced local host',()=>{
  expect(decideEntry({...base,enforced:false,check:{kind:'none'}})).toEqual({view:'app'});
 });
 it('keeps ?gate=1 when sending a client to their room',()=>{
  expect(roomSearch('room-a','?gate=1')).toBe('?room=room-a&gate=1');
  expect(roomSearch('room-a','?gate=0')).toBe('?room=room-a');
 });
});
