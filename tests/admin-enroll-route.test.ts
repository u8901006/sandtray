import {describe,expect,it} from 'vitest';
import {oidc} from '../apps/worker/src/auth';
import {hashToken} from '../apps/worker/src/http';
import type {Env} from '../apps/worker/src/env';
// 2026-10-11 /auth/enroll：加入碼只檢查不消耗；不可用就導回 /?enroll=invalid，不送去 Google；
// 可用時只把雜湊存進登入嘗試，原始碼不出現在給 Google 的網址。callback 消耗與綁定由 runtime admin-enrollment.spec 驗。
function env(usable:boolean,fenced=false){
 const begun:unknown[]=[],queries:unknown[][]=[];
 const value={
  DEPLOY_ENV:'staging',APP_ORIGIN:'https://sandtray.example',OIDC_ISSUER:'https://accounts.google.com',OIDC_CLIENT_ID:'sandtray-web',OIDC_CLIENT_SECRET:'test-only',
  OIDC_AUTHORIZATION_URL:'https://accounts.google.com/o/oauth2/v2/auth',OIDC_TOKEN_URL:'https://oauth2.googleapis.com/token',OIDC_JWKS_URL:'https://www.googleapis.com/oauth2/v3/certs',
  DIRECTORY:{prepare:(sql:string)=>({bind:(...args:unknown[])=>({first:async()=>{queries.push([sql,...args]);return usable?{ok:1}:null;}})})},
  AUTH_DO:{getByName:()=>({begin:async(attempt:unknown)=>{begun.push(attempt);return 'state-1';},enrollmentFenced:async()=>fenced})},
 } as unknown as Env;
 return {value,begun,queries};
}
const code='a'.repeat(64);
describe('/auth/enroll',()=>{
 it('sends a usable code to Google with only its hash kept in the login attempt',async()=>{
  const e=env(true);const response=await oidc(new Request('https://sandtray.example/auth/enroll?code='+code),e.value);
  expect(response.status).toBe(302);
  const location=new URL(response.headers.get('Location')!);
  expect(location.origin+location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(location.href).not.toContain(code);
  expect(location.searchParams.get('prompt')).toBe('select_account');
  expect(e.begun).toEqual([expect.objectContaining({enrollHash:await hashToken(code)})]);
  expect(e.queries[0]).toEqual([expect.stringContaining('used_at IS NULL AND revoked_at IS NULL AND expires_at>?'),await hashToken(code),expect.any(Number)]);
 });
 it('redirects a dead code to /?enroll=invalid without starting a login',async()=>{
  const e=env(false);const response=await oidc(new Request('https://sandtray.example/auth/enroll?code='+code),e.value);
  expect(response.status).toBe(302);expect(response.headers.get('Location')).toBe('/?enroll=invalid');expect(e.begun).toEqual([]);
 });
 it('refuses a code fenced in AUTH_DO even when D1 (e.g. after a restore) says it is unused',async()=>{
  const e=env(true,true);const response=await oidc(new Request('https://sandtray.example/auth/enroll?code='+code),e.value);
  expect(response.headers.get('Location')).toBe('/?enroll=invalid');expect(e.begun).toEqual([]);
 });
 it('rejects malformed codes before touching the directory',async()=>{
  for(const bad of ['','short','A'.repeat(64),'a'.repeat(65),'g'.repeat(64)]){
   const e=env(true);const response=await oidc(new Request('https://sandtray.example/auth/enroll?code='+bad),e.value);
   expect(response.headers.get('Location')).toBe('/?enroll=invalid');expect(e.queries).toEqual([]);expect(e.begun).toEqual([]);
  }
 });
 it('plain /auth/login carries no enrollment',async()=>{
  const e=env(true);await oidc(new Request('https://sandtray.example/auth/login'),e.value);
  const response=await oidc(new Request('https://sandtray.example/auth/login'),e.value);
  expect(e.begun).toHaveLength(2);expect(e.begun[0]).not.toHaveProperty('enrollHash');expect(new URL(response.headers.get('Location')!).searchParams.get('prompt')).toBeNull();
 });
});
