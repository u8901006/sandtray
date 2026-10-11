import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {
  buildPrivateAssetProbePath,
  formatProbeStart,
  inspectProbeHeaders,
  loadStagingProbeConfig,
  assertStagingHealth,
  installSessionCookieAfterStagingHealth,
} from '../tools/verification/staging-browser-probe';

const env={
  STAGING_PROBE_ORIGIN:'https://staging.sandtray.example',
  STAGING_PROBE_EXPECTED_HOST:'staging.sandtray.example',
  STAGING_PROBE_SESSION_COOKIE:`sandtray_session=${'a'.repeat(64)}`,
  STAGING_PROBE_ROOM_ID:'ROOM_SYNTHETIC_1',
  STAGING_PROBE_ASSET_ID:'USR_ANIMAL_panda',
  STAGING_PROBE_ASSET_VERSION:'user-42a950223f1c32aa',
};

function makeSyntheticGlb(options:{omitBinChunk?:boolean;bufferByteLength?:number;emptyBuffers?:boolean;omitBufferByteLength?:boolean;bufferUri?:string}={}){
  const length=2*1024*1024;
  const firstBuffer:Record<string,unknown>={};
  if(!options.omitBufferByteLength)firstBuffer.byteLength=4;
  if(options.bufferUri!==undefined)firstBuffer.uri=options.bufferUri;
  const buffers=options.emptyBuffers?[]:[firstBuffer];
  const document:{asset:{version:string};buffers:Array<Record<string,unknown>>}={asset:{version:'2.0'},buffers};
  let json=Buffer.alloc(0);
  let jsonChunkLength=0;
  let secondChunkLength=0;
  for(let attempt=0;attempt<4;attempt++){
    json=Buffer.from(JSON.stringify(document),'utf8');
    jsonChunkLength=Math.ceil(json.byteLength/4)*4;
    secondChunkLength=length-12-8-jsonChunkLength-8;
    if(document.buffers.length===0||options.omitBufferByteLength)break;
    const declaredByteLength=options.bufferByteLength??secondChunkLength;
    if(document.buffers[0].byteLength===declaredByteLength)break;
    document.buffers[0].byteLength=declaredByteLength;
  }
  const paddedJson=Buffer.alloc(jsonChunkLength,0x20);
  json.copy(paddedJson);
  const body=Buffer.alloc(length,0);
  body.write('glTF',0,'ascii');
  body.writeUInt32LE(2,4);
  body.writeUInt32LE(length,8);
  body.writeUInt32LE(jsonChunkLength,12);
  body.writeUInt32LE(0x4e4f534a,16);
  paddedJson.copy(body,20);
  const secondChunkHeader=20+jsonChunkLength;
  body.writeUInt32LE(secondChunkLength,secondChunkHeader);
  body.writeUInt32LE(options.omitBinChunk?0x12345678:0x004e4942,secondChunkHeader+4);
  return body;
}

describe('staging browser-path probe configuration',()=>{
  it('accepts only the operator-confirmed bare HTTPS staging origin and builds the private GLB path',()=>{
    const config=loadStagingProbeConfig(env);
    expect(config.origin).toBe('https://staging.sandtray.example');
    expect(buildPrivateAssetProbePath(config)).toBe('/api/assets/USR_ANIMAL_panda/user-42a950223f1c32aa/model.glb?roomId=ROOM_SYNTHETIC_1');
  });

  it('rejects a production or mistyped host before any session cookie can be installed',()=>{
    expect(()=>loadStagingProbeConfig({...env,STAGING_PROBE_ORIGIN:'https://sandtray.example'})).toThrow(/expected host/i);
    expect(()=>loadStagingProbeConfig({...env,STAGING_PROBE_EXPECTED_HOST:'sandtray.example'})).toThrow(/expected host/i);
    expect(()=>loadStagingProbeConfig({...env,STAGING_PROBE_ORIGIN:'https://sandtray.example',STAGING_PROBE_EXPECTED_HOST:'sandtray.example'})).toThrow(/staging\/test label/i);
  });

  it('rejects HTTP, URL credentials, and non-origin paths before starting Chromium',()=>{
    for(const origin of ['http://staging.sandtray.example','https://user:pass@staging.sandtray.example','https://staging.sandtray.example/path']){
      expect(()=>loadStagingProbeConfig({...env,STAGING_PROBE_ORIGIN:origin})).toThrow();
    }
  });

  it('rejects path-like room or asset identifiers instead of allowing route escape',()=>{
    for(const [key,value] of [
      ['STAGING_PROBE_ROOM_ID','../production'],
      ['STAGING_PROBE_ASSET_ID','folder/asset'],
      ['STAGING_PROBE_ASSET_VERSION','..'],
    ] as const){
      expect(()=>loadStagingProbeConfig({...env,[key]:value})).toThrow();
    }
  });

  it('rejects malformed or non-session cookies without echoing their value',()=>{
    for(const cookie of ['other=secret-value','sandtray_session=','sandtray_session=secret; Path=/','sandtray_session=secret\r\nX: y',`sandtray_session=${'A'.repeat(64)}`]){
      let error='';
      try{loadStagingProbeConfig({...env,STAGING_PROBE_SESSION_COOKIE:cookie});}catch(cause){error=String(cause);}
      expect(error).toMatch(/sandtray_session/i);
      expect(error).not.toContain('secret');
    }
  });

  it('never includes the session cookie in the probe start line',()=>{
    const safeSyntheticCookie=`sandtray_session=${'d'.repeat(64)}`;
    const config=loadStagingProbeConfig({...env,STAGING_PROBE_SESSION_COOKIE:safeSyntheticCookie});
    const line=formatProbeStart(config);
    expect(line).toContain('https://staging.sandtray.example');
    expect(line).not.toContain('d'.repeat(64));
    expect(line).not.toContain(config.sessionCookie);
  });
});

describe('staging browser-path response gates',()=>{
  const deployedCsp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'";

  it('accepts staging health only for HTTP 200 with mode exactly staging',()=>{
    expect(()=>assertStagingHealth(200,{status:'ok',mode:'staging'})).not.toThrow();
    for(const [status,body] of [[200,{mode:'production'}],[200,{mode:'LOCAL_PROTOTYPE'}],[503,{mode:'staging'}],[200,{}]] as const){
      expect(()=>assertStagingHealth(status,body)).toThrow(/mode=staging/i);
    }
  });

  it('allows the deployed app CSP baseline but rejects altered policy, Permissions-Policy, and AdGuard injection',()=>{
    expect(inspectProbeHeaders({'content-security-policy':deployedCsp},'document')).toEqual({ok:true,issues:[]});
    expect(inspectProbeHeaders({'Content-Security-Policy':`  ${deployedCsp.toUpperCase().replaceAll('; ', ';  ')}  `},'document').ok).toBe(true);
    expect(inspectProbeHeaders({'content-security-policy':`${deployedCsp}; script-src https://local.adguard.org`},'document').ok).toBe(false);
    expect(inspectProbeHeaders({'content-security-policy-report-only':deployedCsp},'document').ok).toBe(false);
    expect(inspectProbeHeaders({'permissions-policy':'join-ad-interest-group=()'},'document').ok).toBe(false);
    expect(inspectProbeHeaders({'x-adguard-filter':'1'},'document').ok).toBe(false);
  });

  it('rejects any CSP/Permissions-Policy on the health or binary asset response',()=>{
    expect(inspectProbeHeaders({},'health').ok).toBe(true);
    expect(inspectProbeHeaders({'content-security-policy':deployedCsp},'health').ok).toBe(false);
    expect(inspectProbeHeaders({'permissions-policy':'camera=()'},'asset').ok).toBe(false);
  });

  it('does not add a session cookie unless staging health passed first',async()=>{
    const addCookies=vi.fn(async(_cookies:unknown[])=>{});
    const config=loadStagingProbeConfig(env);
    await expect(installSessionCookieAfterStagingHealth({addCookies},config,503,{mode:'staging'})).rejects.toThrow();
    expect(addCookies).not.toHaveBeenCalled();
    await installSessionCookieAfterStagingHealth({addCookies},config,200,{mode:'staging'});
    expect(addCookies).toHaveBeenCalledTimes(1);
    expect(addCookies.mock.calls[0][0][0]).toMatchObject({name:'sandtray_session',value:'a'.repeat(64),url:config.origin,httpOnly:true,secure:true,sameSite:'Lax'});
  });
});

describe('staging browser-path orchestration',()=>{
  const fixtureCsp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'";
  const fixtureEnv={...env,STAGING_PROBE_ORIGIN:'https://staging.invalid',STAGING_PROBE_EXPECTED_HOST:'staging.invalid'};
  const fixtureConfig=loadStagingProbeConfig(fixtureEnv);
  let runSession:unknown;
  let chromiumBrowser:{newContext(options:{javaScriptEnabled:boolean}):Promise<unknown>;close():Promise<void>}|undefined;

  beforeAll(async()=>{
    const probe=await import('../tools/verification/staging-browser-probe') as unknown as Record<string,unknown>;
    runSession=probe.runStagingProbeSession;
    if(typeof runSession==='function'){
      process.env.PLAYWRIGHT_BROWSERS_PATH??='0';
      const {chromium}=await import('@playwright/test');
      chromiumBrowser=await chromium.launch({headless:true});
    }
  });

  afterAll(async()=>{await chromiumBrowser?.close();});

  async function runFixture(options:{healthMode?:string;injectConsole?:boolean;injectConsoleAfterMs?:number;injectConsoleDuringClose?:boolean;injectHealthPolicy?:boolean;corruptAssetAttempt?:number;corruptGlbHeader?:boolean;omitBinChunk?:boolean;bufferByteLength?:number;emptyBuffers?:boolean;omitBufferByteLength?:boolean;bufferUri?:string;delayAssetResponseMs?:number;redirectAssetAttempt?:number}={}){
    const events:string[]=[];
    const healthCookies:Array<string|null>=[];
    const assetRequests:Array<{path:string;cookie:string|null}>=[];
    const externalRequests:Array<{hasRoomId:boolean;cookie:string|null}>=[];
    const crossOriginRequestEvents:Array<{hasRoomId:boolean;cookie:string|null}>=[];
    const logLines:string[]=[];
    let sessionCookieInstallCount=0;
    let assetAttempt=0;
    let failure:unknown;
    const token='a'.repeat(64);
    const body=makeSyntheticGlb({omitBinChunk:options.omitBinChunk,bufferByteLength:options.bufferByteLength,emptyBuffers:options.emptyBuffers,omitBufferByteLength:options.omitBufferByteLength,bufferUri:options.bufferUri});
    const routedBrowser={
      newContext:async (contextOptions:{javaScriptEnabled:boolean})=>{
        const context=await chromiumBrowser!.newContext(contextOptions) as {
          route(pattern:string,handler:(route:unknown)=>Promise<void>):Promise<void>;
          addCookies(cookies:unknown[]):Promise<void>;
          newPage():Promise<{evaluate(pageFunction:()=>void):Promise<unknown>}>;
          close():Promise<void>;
          on(event:'request',listener:(request:{url():string;headers():Record<string,string>})=>void):void;
        };
        let pageForClose:{evaluate(pageFunction:()=>void):Promise<unknown>}|undefined;
        const newPage=context.newPage.bind(context);
        context.newPage=async()=>{
          const page=await newPage();
          if(contextOptions.javaScriptEnabled)pageForClose=page;
          return page;
        };
        const close=context.close.bind(context);
        context.close=async()=>{
          if(options.injectConsoleDuringClose&&contextOptions.javaScriptEnabled&&pageForClose){
            await pageForClose.evaluate(()=>console.log('local.adguard.org'));
          }
          await close();
        };
        context.on('request',request=>{
          const requestUrl=new URL(request.url());
          if(requestUrl.origin!=='https://staging.invalid'){
            crossOriginRequestEvents.push({hasRoomId:requestUrl.searchParams.has('roomId'),cookie:request.headers().cookie??null});
          }
        });
        const addCookies=context.addCookies.bind(context);
        await addCookies([{name:'preflight_sentinel',value:'must-not-leak-to-health',url:'https://staging.invalid',httpOnly:true,secure:true,sameSite:'Lax'}]);
        context.addCookies=async cookies=>{
          if(cookies.some(cookie=>(cookie as {name?:string}).name==='sandtray_session'))sessionCookieInstallCount+=1;
          await addCookies(cookies);
        };
        await context.route('https://staging.invalid/**',async(rawRoute:unknown)=>{
          const route=rawRoute as {request():{url():string;method():string;headers():Record<string,string>};fulfill(options:{status:number;headers?:Record<string,string>;body?:string|Buffer}):Promise<void>};
          const request=route.request();
          const url=new URL(request.url());
          const cookie=request.headers().cookie??null;
          if(url.pathname==='/'){
            events.push(`document:${contextOptions.javaScriptEnabled?'js':'no-js'}`);
            const injectConsole=Boolean(options.injectConsole||options.injectConsoleAfterMs);
            const html=injectConsole&&contextOptions.javaScriptEnabled?'<script src="/probe.js"></script>':'<!doctype html><html><body>synthetic probe</body></html>';
            await route.fulfill({status:200,headers:{'content-type':'text/html; charset=utf-8','content-security-policy':fixtureCsp},body:html});
          }else if(url.pathname==='/probe.js'){
            events.push('console-script');
            const script=options.injectConsoleAfterMs
              ? `setTimeout(()=>console.log('local.adguard.org'),${options.injectConsoleAfterMs});`
              : "console.log('local.adguard.org');";
            await route.fulfill({status:200,headers:{'content-type':'text/javascript'},body:script});
          }else if(url.pathname==='/api/health'){
            events.push('health');
            healthCookies.push(cookie);
            const headers:Record<string,string>={'content-type':'application/json'};
            if(options.injectHealthPolicy)headers['permissions-policy']='camera=()';
            await route.fulfill({status:200,headers,body:JSON.stringify({status:'ok',mode:options.healthMode??'staging'})});
          }else if(url.pathname.startsWith('/api/assets/')){
            events.push('asset');
            assetAttempt+=1;
            assetRequests.push({path:url.pathname+url.search,cookie});
            if(options.redirectAssetAttempt===assetAttempt){
              const returnPath=buildPrivateAssetProbePath(fixtureConfig);
              await route.fulfill({status:302,headers:{location:`https://collector.invalid/return?roomId=${encodeURIComponent(fixtureConfig.roomId)}&returnPath=${encodeURIComponent(returnPath)}`}});
              return;
            }
            if(options.delayAssetResponseMs)await new Promise(resolve=>setTimeout(resolve,options.delayAssetResponseMs));
            const contentType=options.corruptAssetAttempt===assetAttempt?'application/octet-stream':'model/gltf-binary';
            const responseBody=options.corruptGlbHeader?Buffer.from(body):body;
            if(options.corruptGlbHeader)responseBody.write('nope',0,'ascii');
            await route.fulfill({status:200,headers:{'content-type':contentType,'content-length':String(responseBody.byteLength)},body:responseBody});
          }else{
            await route.fulfill({status:404,body:'not found'});
          }
        });
        await context.route('https://collector.invalid/**',async(rawRoute:unknown)=>{
          const route=rawRoute as {request():{url():string;headers():Record<string,string>};fulfill(options:{status:number;headers?:Record<string,string>}):Promise<void>};
          const request=route.request();
          const url=new URL(request.url());
          externalRequests.push({hasRoomId:url.searchParams.has('roomId'),cookie:request.headers().cookie??null});
          events.push('external-route-hit');
          const returnPath=url.searchParams.get('returnPath')??buildPrivateAssetProbePath(fixtureConfig);
          await route.fulfill({status:302,headers:{location:`https://staging.invalid${returnPath}`}});
        });
        return context;
      },
    };
    if(typeof runSession!=='function'){
      expect(typeof runSession).toBe('function');
      return {events,healthCookies,assetRequests,externalRequests,crossOriginRequestEvents,logLines,token,sessionCookieInstallCount,failure};
    }
    try{
      await (runSession as (...args:unknown[])=>Promise<void>)(fixtureConfig,routedBrowser,(line:unknown)=>logLines.push(String(line)));
    }catch(error){failure=error;}
    return {events,healthCookies,assetRequests,externalRequests,crossOriginRequestEvents,logLines,token,sessionCookieInstallCount,failure};
  }

  it('keeps health cookie-free and only fetches the same private GLB three times after staging health',async()=>{
    expect(typeof runSession).toBe('function');
    if(typeof runSession!=='function')return;
    const result=await runFixture();
    expect(result.healthCookies).toEqual([null]);
    expect(result.sessionCookieInstallCount).toBe(1);
    expect(result.failure).toBeUndefined();
    expect(result.events.filter(event=>event==='asset')).toHaveLength(3);
    expect(result.assetRequests).toHaveLength(3);
    expect(result.assetRequests.map(request=>request.path)).toEqual(Array.from({length:3},()=>'/api/assets/USR_ANIMAL_panda/user-42a950223f1c32aa/model.glb?roomId=ROOM_SYNTHETIC_1'));
    expect(result.assetRequests.every(request=>request.cookie?.includes(`sandtray_session=${result.token}`))).toBe(true);
    expect(result.events.indexOf('health')).toBeLessThan(result.events.indexOf('asset'));
    expect(result.logLines.filter(line=>line.startsWith('GLB attempt'))).toHaveLength(3);
    expect(result.logLines.join('\n')).not.toContain(result.token);
  });

  it('does not install a cookie or fetch assets when browser console reports an AdGuard signal',async()=>{
    expect(typeof runSession).toBe('function');
    if(typeof runSession!=='function')return;
    const result=await runFixture({injectConsole:true});
    expect(String(result.failure)).toMatch(/console reported an AdGuard/i);
    expect(result.healthCookies).toEqual([]);
    expect(result.assetRequests).toHaveLength(0);
    expect(result.sessionCookieInstallCount).toBe(0);
    expect(result.events).toContain('console-script');
  });

  it('does not install a cookie or fetch assets when health is not staging',async()=>{
    expect(typeof runSession).toBe('function');
    if(typeof runSession!=='function')return;
    const result=await runFixture({healthMode:'production'});
    expect(String(result.failure)).toMatch(/mode=staging/i);
    expect(result.healthCookies).toEqual([null]);
    expect(result.sessionCookieInstallCount).toBe(0);
    expect(result.assetRequests).toHaveLength(0);
  });

  it('does not install a cookie or fetch assets when health headers are injected',async()=>{
    expect(typeof runSession).toBe('function');
    if(typeof runSession!=='function')return;
    const result=await runFixture({injectHealthPolicy:true});
    expect(String(result.failure)).toMatch(/Permissions-Policy/i);
    expect(result.healthCookies).toEqual([null]);
    expect(result.sessionCookieInstallCount).toBe(0);
    expect(result.assetRequests).toHaveLength(0);
  });

  it('stops before a third GLB request when an attempt fails its content-type integrity check',async()=>{
    const result=await runFixture({corruptAssetAttempt:2});
    expect(String(result.failure)).toMatch(/failed status\/type\/length integrity checks/i);
    expect(result.sessionCookieInstallCount).toBe(1);
    expect(result.assetRequests).toHaveLength(2);
  });

  it('blocks a cross-origin asset redirect before it can leak roomId, even if it would redirect back',async()=>{
    const result=await runFixture({redirectAssetAttempt:1});
    expect(result.failure).toBeTruthy();
    expect(result.assetRequests).toHaveLength(1);
    expect(result.externalRequests).toHaveLength(0);
    expect(result.crossOriginRequestEvents,JSON.stringify({failure:String(result.failure),events:result.events,external:result.externalRequests,requests:result.crossOriginRequestEvents})).toEqual([]);
  });

  it('stops later cookie-bearing GLB fetches when a delayed console signal arrives during attempt one',async()=>{
    const result=await runFixture({injectConsoleAfterMs:100,delayAssetResponseMs:300});
    expect(String(result.failure)).toMatch(/console reported an AdGuard/i);
    expect(result.sessionCookieInstallCount).toBe(1);
    expect(result.assetRequests).toHaveLength(1);
  });

  it('rejects a console signal emitted while closing after all three GLB checks',async()=>{
    const result=await runFixture({injectConsoleDuringClose:true});
    expect(String(result.failure)).toMatch(/console reported an AdGuard/i);
    expect(result.sessionCookieInstallCount).toBe(1);
    expect(result.assetRequests).toHaveLength(3);
    expect(result.logLines.filter(line=>line.startsWith('GLB attempt'))).toHaveLength(3);
  });

  it('rejects a same-length MIME-correct payload without a valid GLB v2 header and JSON chunk',async()=>{
    const result=await runFixture({corruptGlbHeader:true});
    expect(String(result.failure)).toMatch(/GLB v2/i);
    expect(result.assetRequests).toHaveLength(1);
  });

  it('rejects JSON that declares a GLB-stored buffer without the required BIN chunk',async()=>{
    const result=await runFixture({omitBinChunk:true});
    expect(String(result.failure)).toMatch(/GLB v2/i);
    expect(result.assetRequests).toHaveLength(1);
  });

  it('rejects a BIN chunk shorter than its JSON-declared embedded buffer',async()=>{
    const result=await runFixture({bufferByteLength:2*1024*1024});
    expect(String(result.failure)).toMatch(/GLB v2/i);
    expect(result.assetRequests).toHaveLength(1);
  });

  it('rejects an empty buffers array',async()=>{
    const result=await runFixture({emptyBuffers:true});
    expect(String(result.failure)).toMatch(/GLB v2/i);
    expect(result.assetRequests).toHaveLength(1);
  });

  it('rejects a buffer with uri but no required byteLength',async()=>{
    const result=await runFixture({omitBufferByteLength:true,bufferUri:'external.bin'});
    expect(String(result.failure)).toMatch(/GLB v2/i);
    expect(result.assetRequests).toHaveLength(1);
  });

  it('rejects buffer byteLength values that are zero or fractional',async()=>{
    for(const bufferByteLength of [0,1.5]){
      const result=await runFixture({bufferByteLength});
      expect(String(result.failure)).toMatch(/GLB v2/i);
      expect(result.assetRequests).toHaveLength(1);
    }
  });
});
