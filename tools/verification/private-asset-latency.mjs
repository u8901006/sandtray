#!/usr/bin/env node
// T18-B / AC18-7 (local part): first-load cost of the private route vs the public static copy, same browser,
// same worker (tests/runtime entry on 8788 with the run's R2 seeded). Measures N distinct catalog models per
// path with a cold in-page cache (each URL fetched once, no-store on the private route), K rounds, reports
// per-path median wall time and bytes and the private/static ratio. Not a staging measurement: local workerd,
// local R2, loopback network. Usage: node tools/verification/private-asset-latency.mjs [--n 100] [--rounds 3]
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH??='0';
const root=fileURLToPath(new URL('../../',import.meta.url));
const args=process.argv.slice(2),value=(n,f)=>{const i=args.indexOf('--'+n);return i>=0?args[i+1]:f;};
const origin='http://127.0.0.1:8788',n=Number(value('n','100')),rounds=Number(value('rounds','3')),out=value('out',join(root,'working','t18b-latency.json'));
const imported=JSON.parse(readFileSync(join(root,'packages/asset-catalog/src/imported-v1.json'),'utf8'));
const post=(path,data,cookie)=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});
const login=await post('/__test/login',{name:'therapist'});const cookie=login.headers.get('set-cookie').split(';')[0];
const room=await (await post('/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'},cookie)).json();
const seed=await (await post('/__test/asset-store-all',{},cookie)).json();
const sample=[...imported].sort((a,b)=>a.id.localeCompare(b.id)).slice(0,n);
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext();await context.addCookies([{name:cookie.split('=')[0],value:cookie.split('=').slice(1).join('='),url:origin}]);
const page=await context.newPage();await page.goto(origin+'/api/health');
const results={at:new Date().toISOString(),origin,n:sample.length,rounds,seed,static:[],private:[]};
for(let round=0;round<rounds;round++){
 for(const kind of ['static','private']){
  const urls=sample.map(a=>kind==='static'?a.url+'?r='+round:`/api/assets/${a.id}/${a.version}/model.glb?roomId=${room.id}`);
  const r=await page.evaluate(async urls=>{
   const t0=performance.now();let bytes=0,failed=0;
   // Load the way the app does: all placed objects start fetching at once.
   await Promise.all(urls.map(async u=>{const res=await fetch(u,{cache:'no-store'});if(!res.ok){failed++;return;}const length=(await res.arrayBuffer()).byteLength;bytes+=length;}));
   return {ms:performance.now()-t0,bytes,failed};
  },urls);
  results[kind].push(r);
 }
}
await browser.close();
const median=xs=>{const s=[...xs].sort((a,b)=>a-b);return s[Math.floor(s.length/2)];};
const ms={static:median(results.static.map(r=>r.ms)),private:median(results.private.map(r=>r.ms))};
results.summary={medianMs:ms,ratio:ms.private/ms.static,degradationPct:(ms.private/ms.static-1)*100,bytesEqual:results.static.every((r,i)=>r.bytes===results.private[i].bytes),failed:{static:results.static.reduce((s,r)=>s+r.failed,0),private:results.private.reduce((s,r)=>s+r.failed,0)}};
mkdirSync(join(root,'working'),{recursive:true});writeFileSync(out,JSON.stringify(results,null,2)+'\n');
console.log(`AC18-7 local: n=${sample.length} rounds=${rounds} static median ${ms.static.toFixed(0)} ms, private median ${ms.private.toFixed(0)} ms, ratio ${results.summary.ratio.toFixed(3)} (${results.summary.degradationPct.toFixed(1)}%), bytesEqual=${results.summary.bytesEqual}, failed static/private=${results.summary.failed.static}/${results.summary.failed.private}`);
console.log('RESULT='+(results.summary.failed.private===0&&results.summary.bytesEqual&&results.summary.degradationPct<=20?'WITHIN_20PCT':'OVER_20PCT_OR_FAILED'));
