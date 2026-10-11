import {describe,it,expect,vi} from 'vitest';
import {assertStagingHealthMode,assertStagingSessionCookie,normalizeStagingOrigin} from '../tools/verification/endurance-target';

describe('external endurance target safety',()=>{
  it('requires a bare HTTPS origin and canonicalizes its trailing slash',()=>{
    expect(normalizeStagingOrigin('https://sandtray-staging.example.test/')).toBe('https://sandtray-staging.example.test');
    for(const target of ['http://sandtray-staging.example.test','https://user:pass@sandtray-staging.example.test','https://sandtray-staging.example.test/path','https://sandtray-staging.example.test/?token=x','not a url']) {
      expect(()=>normalizeStagingOrigin(target)).toThrow(/HTTPS origin/);
    }
  });

  it('requires the named session cookie without logging or accepting attributes',()=>{
    expect(()=>assertStagingSessionCookie('sandtray_session='+'a1'.repeat(32))).not.toThrow();
    for(const cookie of [undefined,'','opaque-token','sandtray_session=opaque-token','sandtray_session=3cd67cb1-374e-4475-9992-7ced219ff98a','sandtray_session='+'A1'.repeat(32),'sandtray_session='+'a'.repeat(63),'other=value','sandtray_session=','sandtray_session=value; Path=/','sandtray_session=foo bar','sandtray_session=value\r\n']) {
      expect(()=>assertStagingSessionCookie(cookie)).toThrow(/ENDURANCE_SESSION_COOKIE/);
    }
  });

  it('accepts only a staging deployment health marker',()=>{
    expect(()=>assertStagingHealthMode({status:'ok',mode:'staging'})).not.toThrow();
    for(const body of [{mode:'production'},{mode:'LOCAL_PROTOTYPE'},{status:'ok'},null,'staging']) {
      expect(()=>assertStagingHealthMode(body)).toThrow(/mode must be staging/);
    }
  });

  it('keeps external mode away from local setup and local-only load specs',async()=>{
    try{
      vi.stubEnv('ENDURANCE_ORIGIN','https://sandtray-staging.example.test/');
      vi.stubEnv('ENDURANCE_SESSION_COOKIE','sandtray_session='+'0'.repeat(64));
      vi.resetModules();
      const {default: config}=await import('../playwright.endurance.config');
      expect(config.webServer).toBeUndefined();
      expect(config.globalSetup).toBeUndefined();
      expect(config.testMatch).toBe('**/endurance-protocol.spec.ts');
    }finally{
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
