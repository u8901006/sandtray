import {expect,it,vi} from 'vitest';
import {serveStatic} from '../apps/worker/src/static-gate';
import {authenticate} from '../apps/worker/src/auth';
import type {Env} from '../apps/worker/src/env';
vi.mock('../apps/worker/src/auth',()=>({authenticate:vi.fn()}));
it('rejects a static model when its session is revoked while the asset lookup is in flight',async()=>{
 let active=true;
 vi.mocked(authenticate).mockImplementation(async()=>active?{hash:'h',session:{participantId:'p',clinicId:'c',role:'therapist',expiresAt:Date.now()+60000}}:null);
 const env={DEPLOY_ENV:'production',ASSETS:{fetch:vi.fn(async()=>{
  // The asset store resolves after a concurrent logout has revoked this session.
  active=false;
  return new Response('model-bytes',{headers:{'Content-Type':'model/gltf-binary'}});
 })}} as unknown as Env;
 const response=await serveStatic(new Request('https://review.test/imported-assets/a.glb'),env,'/imported-assets/a.glb');
 expect(response.status).toBe(401);
 expect(await response.text()).not.toContain('model-bytes');
});