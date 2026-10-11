import {afterEach,describe,expect,it,vi} from 'vitest';
import {oidc} from '../apps/worker/src/auth';
import type {Env} from '../apps/worker/src/env';

// 2026-09-28 staging regression (Claude Opus 5.5): the token exchange used fetch(..., {redirect:'error'}).
// Node accepts that mode, but the Cloudflare Workers runtime throws a TypeError for it, so every real
// OIDC callback on staging failed with INVALID_PAYLOAD. Unit tests stub fetch, so they never saw it.
// These cases pin the Workers-compatible mode and keep a redirecting token endpoint fail-closed.
function callbackEnv(created:unknown[]) {
 const sessions={
  consume:async()=>({nonce:'n',verifier:'v'}),
  createSession:async(identity:unknown)=>{created.push(identity);return {token:'t'.repeat(64)};},
  lookup:async()=>null,revoke:async()=>undefined,
 };
 return {
  DEPLOY_ENV:'staging',
  APP_ORIGIN:'https://sandtray.example',
  OIDC_ISSUER:'https://identity.example/',
  OIDC_CLIENT_ID:'sandtray-web',
  OIDC_CLIENT_SECRET:'test-only-not-a-real-secret',
  OIDC_AUTHORIZATION_URL:'https://identity.example/authorize',
  OIDC_TOKEN_URL:'https://identity.example/token',
  OIDC_JWKS_URL:'https://identity.example/jwks',
  DIRECTORY:{},
  AUTH_DO:{getByName:()=>sessions},
 } as unknown as Env;
}
const callback=()=>new Request('https://sandtray.example/auth/callback?state=s&code=c',{headers:{Cookie:'sandtray_login=b'}});

afterEach(()=>vi.unstubAllGlobals());

describe('OIDC token exchange on the Workers runtime',()=>{
 it('never asks fetch for redirect:"error", which Workers reject with a TypeError',async()=>{
  const seen:RequestInit[]=[];
  vi.stubGlobal('fetch',async(_url:unknown,init:RequestInit)=>{seen.push(init);return new Response('{}',{status:400});});
  await oidc(callback(),callbackEnv([]));
  expect(seen).toHaveLength(1);
  expect(seen[0].redirect).toBe('manual');
 });

 it('treats a redirecting token endpoint as a rejected login and creates no session',async()=>{
  const created:unknown[]=[];
  vi.stubGlobal('fetch',async()=>new Response(null,{status:302,headers:{Location:'https://elsewhere.example/'}}));
  const response=await oidc(callback(),callbackEnv(created));
  // oidc()'s generic rejection is 401 UNAUTHENTICATED; staging's INVALID_PAYLOAD came from the TypeError path.
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({code:'UNAUTHENTICATED'});
  expect(response.headers.get('Set-Cookie')??'').not.toContain('sandtray_session=');
  expect(created).toHaveLength(0);
 });
});
