import {describe,expect,it,vi,beforeEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {serveStatic,staticLoginRequired} from '../apps/worker/src/static-gate';
import {authenticate} from '../apps/worker/src/auth';
import type {Env} from '../apps/worker/src/env';
vi.mock('../apps/worker/src/auth',()=>({authenticate:vi.fn()}));
// 2026-10-09 使用者裁定：部署環境的素材登入才能下載。
const gated=['/imported-assets/animals-v1/USR_ANIMAL_panda.glb','/imported-assets/megakits-v1/thumbs/a.png','/dev-assets/rock.glb','/environments/garden-v3/garden-ambience.wav','/room','/favicon.ico','/_headers',
 '/assets/..%2Fimported-assets%2Fx.glb','/assets/%2e%2e/x','/assets/.hidden','/assets/a/b.js','/assets/','/Index.html','/index.html/x','//imported-assets/x.glb'];
const shell=['/','/index.html','/assets/index-Bq-mHQGH.js','/assets/index-D4x_9a.css'];
function env(mode:'staging'|'production'|undefined){
 const fetch=vi.fn(async(request:Request)=>new Response('body',{headers:{'Content-Type':new URL(request.url).pathname.endsWith('/')?'text/html':'model/gltf-binary','Cache-Control':'public, max-age=31536000'}}));
 return {env:{DEPLOY_ENV:mode,ASSETS:{fetch}} as unknown as Env,fetch};
}
beforeEach(()=>vi.mocked(authenticate).mockReset());
describe('static asset login gate',()=>{
 it('allows only the entry shell anonymously on deployed environments',()=>{
  for(const mode of ['staging','production'] as const){
   for(const path of gated)expect(staticLoginRequired({DEPLOY_ENV:mode},path),path).toBe(true);
   for(const path of shell)expect(staticLoginRequired({DEPLOY_ENV:mode},path),path).toBe(false);
  }
  // 未知的 DEPLOY_ENV 值也強制（fail-closed）
  expect(staticLoginRequired({DEPLOY_ENV:'prod' as 'production'},'/imported-assets/x.glb')).toBe(true);
 });
 it('keeps the local prototype public',()=>{for(const path of gated)expect(staticLoginRequired({DEPLOY_ENV:undefined},path)).toBe(false);});
 it('returns 401 without touching the asset store when an anonymous visitor asks for a model',async()=>{
  vi.mocked(authenticate).mockResolvedValue(null);const {env:e,fetch}=env('production');
  const response=await serveStatic(new Request('https://x.test/imported-assets/a.glb'),e,'/imported-assets/a.glb');
  expect(response.status).toBe(401);expect((await response.json() as {code:string}).code).toBe('UNAUTHENTICATED');expect(fetch).not.toHaveBeenCalled();
 });
 it('serves a model to a logged-in user, privately cached',async()=>{
  vi.mocked(authenticate).mockResolvedValue({hash:'h',session:{participantId:'p',clinicId:'c',role:'client',expiresAt:Date.now()+1000}});const {env:e,fetch}=env('staging');
  const response=await serveStatic(new Request('https://x.test/imported-assets/a.glb'),e,'/imported-assets/a.glb');
  expect(response.status).toBe(200);expect(fetch).toHaveBeenCalledOnce();
  expect(response.headers.get('Cache-Control')).toBe('private, no-cache');expect(response.headers.get('Vary')).toContain('Cookie');
  expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
 });
 it('rechecks the session after the asset lookup: valid twice → served; expired in between → 401 and the body is cancelled',async()=>{
  const live={hash:'h',session:{participantId:'p',clinicId:'c',role:'therapist' as const,expiresAt:Date.now()+1000}};
  vi.mocked(authenticate).mockResolvedValue(live);const ok=env('production');
  expect((await serveStatic(new Request('https://x.test/imported-assets/a.glb'),ok.env,'/imported-assets/a.glb')).status).toBe(200);
  expect(authenticate).toHaveBeenCalledTimes(2);
  vi.mocked(authenticate).mockReset();vi.mocked(authenticate).mockResolvedValueOnce(live).mockResolvedValueOnce(null);
  const cancel=vi.fn();const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('model-bytes'));},cancel});
  const e={DEPLOY_ENV:'staging',ASSETS:{fetch:vi.fn(async()=>new Response(body,{headers:{'Content-Type':'model/gltf-binary'}}))}} as unknown as Env;
  const response=await serveStatic(new Request('https://x.test/environments/garden-v3/a.wav'),e,'/environments/garden-v3/a.wav');
  expect(response.status).toBe(401);expect(await response.text()).not.toContain('model-bytes');expect(cancel).toHaveBeenCalledOnce();
 });
 it('serves the entry shell without a session check',async()=>{
  const {env:e}=env('production');
  const response=await serveStatic(new Request('https://x.test/'),e,'/');
  expect(response.status).toBe(200);expect(authenticate).not.toHaveBeenCalled();expect(response.headers.get('Cache-Control')).toBe('no-cache');
 });
 it('routes every request through the Worker in the deployed config',()=>{
  const config=readFileSync('apps/worker/wrangler.jsonc','utf8');
  expect(config).toMatch(/"run_worker_first":\s*true/);expect(config).not.toMatch(/"run_worker_first":\s*\[/);
 });
});
