import {test,expect} from '@playwright/test';
const workerOrigin='http://127.0.0.1:'+(process.env.E2E_WORKER_PORT??'8787');
test('Worker runtime serves assets, health and denies business routes while failing login closed without OIDC',async({request})=>{
 const health=await request.get(workerOrigin+'/api/health');
 expect(health.status()).toBe(200);const healthBody=await health.json();expect(healthBody.sharedEditing).toBe(true);expect(healthBody.mode).toBe('LOCAL_PROTOTYPE');// V8-L03-1: only env.staging/env.production set DEPLOY_ENV
 for(const route of ['/api/rooms/guessed/snapshot','/api/rooms/guessed/socket','/api/scenes/guessed/exports','/api/assets']){
  const response=await request.get(workerOrigin+route);
  expect(response.status()).toBe(401);expect(response.headers()['cache-control']).toBe('no-store');
  expect(Object.keys(await response.json()).sort()).toEqual(['code','requestId']);
 }
 const login=await request.get(workerOrigin+'/auth/login');
 expect(login.status()).toBe(503);expect(login.headers()['cache-control']).toBe('no-store');
 const loginBody=await login.json();expect(loginBody.code).toBe('SERVICE_MISCONFIGURED');
 expect(Object.keys(loginBody).sort()).toEqual(['code','requestId']);
 const index=await request.get(workerOrigin+'/');
 expect(index.status()).toBe(200);expect(index.headers()['referrer-policy']).toBe('no-referrer');expect(await index.text()).toContain('一方沙盤');
});
