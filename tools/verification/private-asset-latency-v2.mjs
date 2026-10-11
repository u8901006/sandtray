#!/usr/bin/env node
// Run env-probe first. Requires the local runtime fixture on 8788; never connects to production.
// This is an HTTP transfer diagnostic, NOT AC18-7's rendered 100-instance scene acceptance.
// node tools/verification/private-asset-latency-v2.mjs --n 100 --rounds 3 --out working/t18e-transfer.json
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,relative,isAbsolute} from 'node:path';
import {summarizeTransfer} from './private-asset-transfer-report.mjs';
process.env.PLAYWRIGHT_BROWSERS_PATH??='0';
// C55: static `import {chromium}` is hoisted above the env assignment, so the bundled browser path was never applied
// (browserType.launch: Executable doesn't exist … ms-playwright/chromium_headless_shell). Import after setting it, as env-probe does.
const {chromium}=await import('@playwright/test');
const root=fileURLToPath(new URL('../../',import.meta.url)),origin='http://127.0.0.1:8788';
const args=process.argv.slice(2),options={n:'100',rounds:'3',out:'working/t18e-transfer.json'};
for(let i=0;i<args.length;i+=2){
 const key=args[i].slice(2);
 if(!args[i].startsWith('--')||!Object.hasOwn(options,key)||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Expected --n, --rounds or --out with a value');
 options[key]=args[i+1];
}
const n=Number(options.n),rounds=Number(options.rounds),out=resolve(root,options.out),rel=relative(root,out);
const imported=JSON.parse(readFileSync(resolve(root,'packages/asset-catalog/src/imported-v1.json'),'utf8'));
if(!Number.isInteger(n)||n<1||n>imported.length||!Number.isInteger(rounds)||rounds<1||rounds>5)throw new Error('n must select existing models; rounds must be 1..5');
if(isAbsolute(rel)||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../'))throw new Error('Output must stay inside this project');
const sample=[...imported].sort((a,b)=>a.id.localeCompare(b.id)).slice(0,n);
const post=async(path,data,cookie)=>{
 const r=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data),signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw new Error(`${path}: HTTP ${r.status}`);return r;
};
const login=await post('/__test/login',{name:'therapist'}),cookie=login.headers.get('set-cookie')?.split(';')[0];
if(!cookie)throw new Error('Test login returned no cookie');
const results={at:new Date().toISOString(),scope:'HTTP transfer only; no parse/clone/render/scene acceptance',origin,models:n,rounds,
 expectedBytes:sample.reduce((sum,a)=>sum+a.bytes,0),order:[],static:[],private:[]};
let browser,room,contextCookie;
try{
 room=await (await post('/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'},cookie)).json();
 if(typeof room.id!=='string')throw new Error('Test room returned no id');
 results.seed=await (await post('/__test/asset-store-all',{},cookie)).json();
 browser=await chromium.launch();
 const context=await browser.newContext();
 await context.addCookies([{name:cookie.split('=')[0],value:cookie.split('=').slice(1).join('='),url:origin}]);
 const page=await context.newPage();await page.goto(origin+'/api/health');
 for(let round=0;round<rounds;round++){
  // A fresh session each round avoids benchmarking the 600/session/min limiter instead of transfer.
  {
   if(contextCookie)await post('/auth/logout',{},contextCookie);
   const r=await post('/__test/login',{name:'therapist'});
   contextCookie=r.headers.get('set-cookie')?.split(';')[0];
   if(!contextCookie)throw new Error('Test login returned no cookie');
   await context.addCookies([{name:contextCookie.split('=')[0],value:contextCookie.split('=').slice(1).join('='),url:origin}]);
  }
  for(const kind of round%2?['private','static']:['static','private']){
   results.order.push({round,kind});
   const models=sample.map(a=>({url:kind==='static'?a.url:`/api/assets/${a.id}/${a.version}/model.glb?roomId=${room.id}`,bytes:a.bytes,sha256:a.sha256}));
   const transfer=await page.evaluate(async models=>{
    const started=performance.now();
    const payloads=await Promise.all(models.map(async model=>{
     try{
      const res=await fetch(model.url,{cache:'no-store',signal:AbortSignal.timeout(45000)});
      if(res.status!==200)return {ok:false};
      const body=await res.arrayBuffer();return {ok:body.byteLength===model.bytes,body};
     }catch{return {ok:false};}
    }));
    const ms=performance.now()-started; // Hash verification is outside the transfer timing.
    let bytes=0,failed=0,verified=0;
    for(let i=0;i<payloads.length;i++){
     const p=payloads[i];bytes+=p.body?.byteLength??0;
     if(!p.ok||!p.body){failed++;continue;}
     const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',p.body)),b=>b.toString(16).padStart(2,'0')).join('');
     if(hash!==models[i].sha256)failed++;else verified++;
    }
    return {ms,bytes,failed,verified};
   },models);
   results[kind].push(transfer);
  }
 }
 results.summary=summarizeTransfer(results);
 mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(results,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(results.summary));
 process.exitCode=results.summary.verdict==='TRANSFER_WITHIN_20PCT'?0:1;
}finally{
 await browser?.close().catch(e=>console.error('Browser cleanup failed:',e.message));
 if(room?.id)await post(`/api/rooms/${room.id}/close`,{},cookie).catch(e=>console.error('Fixture cleanup failed:',e.message));
 if(contextCookie)await post('/auth/logout',{},contextCookie).catch(e=>console.error('Fixture logout failed:',e.message));
 await post('/auth/logout',{},cookie).catch(e=>console.error('Owner logout failed:',e.message));
}
