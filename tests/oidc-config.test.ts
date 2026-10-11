import {describe,expect,it} from 'vitest';
import {oidc} from '../apps/worker/src/auth';
import type {Env} from '../apps/worker/src/env';

const requiredSettings = [
 'APP_ORIGIN',
 'OIDC_ISSUER',
 'OIDC_CLIENT_ID',
 'OIDC_CLIENT_SECRET',
 'OIDC_AUTHORIZATION_URL',
 'OIDC_TOKEN_URL',
 'OIDC_JWKS_URL',
 'DIRECTORY',
] as const;

function configuredEnv(overrides:Record<string,unknown> = {}) {
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
  ...overrides,
 } as unknown as Env;
}

async function expectMisconfigured(env:Env,path='/auth/login') {
 const response=await oidc(new Request(`https://sandtray.example${path}`),env);
 expect(response.status).toBe(503);
 const body=await response.json() as Record<string,unknown>;
 expect(body).toMatchObject({code:'SERVICE_MISCONFIGURED'});
 expect(Object.keys(body).sort()).toEqual(['code','requestId']);
 expect(JSON.stringify(body)).not.toContain('test-only-not-a-real-secret');
}

describe('OIDC deployment configuration',()=>{
 it.each(requiredSettings)('fails clearly when %s is missing in a deployed environment',async key=>{
  await expectMisconfigured(configuredEnv({[key]:undefined}));
 });

 it('uses the same explicit configuration failure on callback',async()=>{
  await expectMisconfigured(configuredEnv({OIDC_CLIENT_SECRET:undefined}),'/auth/callback?code=x&state=y');
 });

 it('requires the client secret in production as well as staging',async()=>{
  await expectMisconfigured(configuredEnv({DEPLOY_ENV:'production',OIDC_CLIENT_SECRET:undefined}));
 });

 it('fails clearly for malformed or non-HTTPS deployment endpoints',async()=>{
  await expectMisconfigured(configuredEnv({OIDC_TOKEN_URL:'not-a-url'}));
  await expectMisconfigured(configuredEnv({OIDC_JWKS_URL:'http://identity.example/jwks'}));
 });

 it('keeps the local PKCE-only prototype compatible',async()=>{
  const env=configuredEnv({DEPLOY_ENV:undefined,OIDC_CLIENT_SECRET:undefined,AUTH_DO:{
   getByName:()=>({begin:async()=> 'test-state'}),
  }});
  const response=await oidc(new Request('https://sandtray.example/auth/login'),env);
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toContain('client_id=sandtray-web');
 });
});
