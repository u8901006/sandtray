import {fileURLToPath} from 'node:url';
import {rmSync,readdirSync,statSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {traceProcess} from './trace-process.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const run=`runtime-${process.pid}-${Date.now()}`;
// G10（C13 根因處置）：wrangler dev 的 X_LOCAL_OBSERVABILITY 預設 true，miniflare 會把每筆請求
// trace 寫進持久化目錄 v3/observability 的 SQLite（60 分鐘耐久累積 1,288 MB）——屬 dev stack
// 觀測行為而非產品狀態，測試啟動一律關閉；手動 `npm run dev:worker` 不經過本檔，行為不變。
// 判別跑（run15）證實磁碟歸因：15 分鐘目錄 166→109 MB（observability 115→0），但 workerd RSS
// 成長率不變（~1.1 MB/s）——RSS 主因另有來源，非本檔處置範圍。
const {child,done}=traceProcess(process.execPath,[fileURLToPath(new URL('../../node_modules/wrangler/bin/wrangler.js',import.meta.url)),'dev','--config','tests/runtime/wrangler.jsonc','--ip','127.0.0.1','--port','8788','--persist-to',`.wrangler/${run}`],{cwd:root,directory:`${root}/working/runtime-diagnostics/${run}`,env:{...process.env,X_LOCAL_OBSERVABILITY:'false'}});
// open-items #8：歷史持久化目錄的清理策略屬 GPT-6（證據引用豁免由人決定），本檔不刪既有目錄，
// 只在啟動時產出孤兒報告（pid 已不存在的 runtime-* 目錄與大小）供決策。pid 可能被 OS 重用，
// 結果僅供參考；不做任何刪除。
const orphans=[];
try{
 for(const entry of readdirSync(join(root,'.wrangler'),{withFileTypes:true})){
  if(!entry.isDirectory()||!entry.name.startsWith('runtime-')||entry.name===run)continue;
  const pid=Number(entry.name.split('-')[1]);
  let alive=false;try{alive=pid>0&&process.kill(pid,0);}catch{/* EPERV=存在但無權（視為存活）；ESRCH=不存在 */}
  if(!alive){
   const size=(path)=>{let total=0;for(const e of readdirSync(path,{withFileTypes:true})){const p=join(path,e.name);total+=e.isDirectory()?size(p):statSync(p).size;}return total;};
   orphans.push({dir:entry.name,pid,sizeBytes:size(join(root,'.wrangler',entry.name))});
  }
 }
}catch{/* .wrangler 不存在等；不影響啟動 */}
if(orphans.length>0){try{writeFileSync(join(root,'working','runtime-diagnostics',run,'orphan-report.json'),JSON.stringify({at:new Date().toISOString(),count:orphans.length,totalBytes:orphans.reduce((s,o)=>s+o.sizeBytes,0),orphans},null,2)+'\n');}catch{/* 記錄失敗不影響啟動 */}}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
const result=await done;
// 僅清理自己本次的持久化目錄，且僅在本程序有機會執行清理時——Playwright webServer teardown 在
// Windows 以 taskkill 強殺程序樹，本檔收尾代碼不會執行（run15 實證），故自清只在手動啟動等
// 自然退出場景生效；signal 終止（正常 teardown）與 code 0 皆視為可清，非 signal 的非零退出
// （crash）保留現場供 open-items #1 崩潰取因。
if(result.code===0||result.signal){
 try{
  const dir=join(root,'.wrangler',run);
  if(existsSync(dir)){
   const size=path=>{let total=0;for(const e of readdirSync(path,{withFileTypes:true})){const p=join(path,e.name);total+=e.isDirectory()?size(p):statSync(p).size;}return total;};
   const bytes=size(dir);
   rmSync(dir,{recursive:true,force:true});
   writeFileSync(join(root,'working','runtime-diagnostics',run,'persist-cleanup.json'),JSON.stringify({run,deleted:dir,bytes,at:new Date().toISOString()})+'\n');
  }
 }catch{/* 清理或記錄失敗不影響結果；目錄名含 pid+時間戳，不影響後續 run */}
}
console.error('RUNTIME_PROCESS_RESULT',JSON.stringify(result));
process.exitCode=result.code;
