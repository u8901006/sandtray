import {describe,expect,it,vi} from 'vitest';
import {serveStatic} from '../apps/worker/src/static-gate';
import {hashToken} from '../apps/worker/src/http';
import type {Env,Session} from '../apps/worker/src/env';

// Non-author F1 recheck: real authenticate/cookie/hash; only AUTH_DO storage is stubbed.
// Expiry below models lookup's contract, not a runtime test of the Durable Object itself.
for(const mode of ['staging','production'] as const){
 for(const role of ['client','therapist'] as const){
  describe(`${mode} ${role} F1 delayed delivery`,()=>{
   for(const change of ['revoked','expired','unchanged'] as const){
    it(`${change} session during pending ASSETS.fetch`,async()=>{
     const token='a'.repeat(64),hash=await hashToken(token);
     const session:Session={participantId:'review-p',clinicId:'review-c',role,expiresAt:Date.now()+60000};
     let active=true,started!:()=>void,release!:()=>void,settled=false;
     const entered=new Promise<void>(resolve=>{started=resolve;});
     const pending=new Promise<void>(resolve=>{release=resolve;});
     const lookup=vi.fn(async(key:string)=>key===hash&&active&&session.expiresAt>Date.now()?session:null);
     const cancel=vi.fn();
     const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('private-review-bytes'));if(change==='unchanged')controller.close();},cancel});
     const fetch=vi.fn(async()=>{started();await pending;return new Response(stream,{headers:{'Content-Type':'model/gltf-binary','Cache-Control':'public'}});});
     const env={DEPLOY_ENV:mode,AUTH_DO:{getByName:vi.fn(()=>({lookup}))},ASSETS:{fetch}} as unknown as Env;
     const path='/imported-assets/review.glb';
     const responsePromise=serveStatic(new Request('https://review.test'+path,{headers:{Cookie:`sandtray_session=${token}`}}),env,path).then(response=>{settled=true;return response;});
     await entered;expect(lookup).toHaveBeenCalledTimes(1);expect(settled).toBe(false);
     if(change==='revoked')active=false;
     if(change==='expired')session.expiresAt=Date.now()-1;
     release();const response=await responsePromise;
     expect(fetch).toHaveBeenCalledOnce();expect(lookup).toHaveBeenCalledTimes(2);
     expect(lookup.mock.calls.every(([key])=>key===hash)).toBe(true);
     if(change==='unchanged'){
      expect(response.status).toBe(200);expect(await response.text()).toBe('private-review-bytes');
      expect(cancel).not.toHaveBeenCalled();expect(response.headers.get('Cache-Control')).toBe('private, no-cache');expect(response.headers.get('Vary')).toContain('Cookie');
     }else{
      expect(response.status).toBe(401);expect(await response.text()).not.toContain('private-review-bytes');expect(cancel).toHaveBeenCalledOnce();
      expect(stream.locked).toBe(false);expect((await stream.getReader().read()).done).toBe(true);
     }
    });
   }
  });
 }
}