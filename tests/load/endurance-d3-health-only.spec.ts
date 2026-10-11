import {test} from '@playwright/test';
import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// G18（v4 計畫，可選；C15 §1 的 D3）：health-only 15 分鐘對照——零房間操作下 workerd RSS 是否成長。
// 目的：排除 user workerd 層的 DO 貢獻（R1／C15 保留項）。判讀（報告，非斷言）：
// user 層 health-only 成長 ≈0 → DO＋WS 路徑即 G11/G12 所見每請求堆積的來源；≈0.4 MB/s → DO 排除。
// 量測型 spec：不判任何記憶體門檻（acceptance 補充：記憶體於 staging 判定）；webServer 由耐久 runner
// 啟動（X_LOCAL_OBSERVABILITY 已關，G10），sampler 樹根＝runner（C6-F2），cmd 欄辨識 proxy/user（G11-D1）。
const DURATION_MS=Number(process.env.D3_DURATION_MS??900000);
const HEALTH_INTERVAL_MS=Number(process.env.D3_HEALTH_INTERVAL_MS??1000);
const HEALTH_TIMEOUT_MS=Number(process.env.D3_HEALTH_TIMEOUT_MS??10000);
// G21 (v5, C23-F2): D3 answered its question (G18/C23); it is opt-in so `test:endurance` does not
// silently grow by 15 minutes. Set D3_ENABLED=1 (with optional D3_* env) to run the measurement.
test.skip(process.env.D3_ENABLED!=='1','D3 is opt-in (C23-F2/G21): set D3_ENABLED=1 to run the 15-minute health-only measurement');
test('D3: health-only control — workerd RSS growth with zero room operations (measurement only)',async({request},testInfo)=>{
 test.setTimeout(0);
 const samplerPath=fileURLToPath(new URL('../../tools/verification/memory-sampler.mjs',import.meta.url));
 const memoryPath=testInfo.outputPath('memory.jsonl'),healthPath=testInfo.outputPath('health-log.jsonl'),summaryPath=testInfo.outputPath('d3-summary.json');
 const began=Date.now(),deadline=began+DURATION_MS;
 const sampler=spawn(process.execPath,[samplerPath,'--out',memoryPath,'--interval-ms','30000','--duration-ms',String(DURATION_MS+30000),'--root-pid',String(process.ppid)],{stdio:'ignore'});
 let probes=0,success=0,failures=0;
 const statuses:Record<string,number>={};
 try{
  while(Date.now()<deadline){
   const t0=Date.now();
   await request.get('/api/health',{timeout:HEALTH_TIMEOUT_MS}).then(r=>{const s=String(r.status());statuses[s]=(statuses[s]??0)+1;if(r.status()===200)success++;else failures++;},()=>{failures++;});
   probes++;
   appendFileSync(healthPath,JSON.stringify({elapsedMs:Date.now()-began,probes,success,failures,statuses:{...statuses}})+'\n');
   const wait=HEALTH_INTERVAL_MS-(Date.now()-t0);
   if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
  }
 }finally{
  sampler.kill();
  let memoryLines:any[]=[];
  try{memoryLines=readFileSync(memoryPath,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch{/* sampler 尚未落地任何樣本 */}
  const workerdFirst=memoryLines[0]?.processes?.filter((p:any)=>p.name==='workerd')??[];
  const workerdLast=memoryLines[memoryLines.length-1]?.processes?.filter((p:any)=>p.name==='workerd')??[];
  const total=(list:any[])=>list.reduce((sum:number,p:any)=>sum+(p.ws??0),0);
  writeFileSync(summaryPath,JSON.stringify({
   scope:'G18/D3 measurement-only control (C15 §1): health-only traffic, zero room operations. No memory threshold asserted locally (judged on staging per acceptance 2026-09-17 addendum). Proxy/user split via memory.jsonl cmd field (G11-D1 method), analyzed in the evidence report.',
   envMs:{duration:DURATION_MS,healthInterval:HEALTH_INTERVAL_MS,healthTimeout:HEALTH_TIMEOUT_MS},
   health:{probes,success,failures,statuses},
   workerd:{firstCount:workerdFirst.length,lastCount:workerdLast.length,firstTotalWs:total(workerdFirst),lastTotalWs:total(workerdLast),durationMs:memoryLines.length>1?memoryLines[memoryLines.length-1].elapsedMs-memoryLines[0].elapsedMs:0},
   samples:{memory:memoryLines.length},
   localReportOnly:['workerdGrowth']
  },null,2)+'\n');
 }
});
