// 週期取樣「測試自身程序樹」內的 node/workerd 工作集，附加為 JSONL；供耐久測試（AC13 記憶體趨勢）與診斷使用。
// C6-F2：以本程序的父程序為樹根，僅記錄樹內（後代）名稱為 node/workerd 的程序——排除同一機器上
// 無關的 node/workerd（其他工作階段、外部服務）。每列：{at,elapsedMs,rootPid,processes:[{name,pid,ws,cmd?}],totalWs}
// 用法：node tools/verification/memory-sampler.mjs --out <path> [--interval-ms 30000] [--duration-ms 0]
// duration-ms=0 表示取樣直到外部終止。
// G11-D1：每個程序加記 Win32_Process 的 CommandLine（截 300 字元）——workerd 可由 config 路徑／參數
// 辨別是 ProxyWorker 的 Miniflare 還是 user worker 的 Miniflare；僅列於首見該 pid 時輸出，控制檔案大小。
import {appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const argv=process.argv.slice(2);
const flag=name=>{const index=argv.indexOf('--'+name);return index>=0?argv[index+1]:undefined;};
const out=flag('out')??'memory.jsonl';
const intervalMs=Number(flag('interval-ms')??30000);
const durationMs=Number(flag('duration-ms')??0);
const started=Date.now();
const listScript='Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,CommandLine | ConvertTo-Json -Compress';
const seenCmd=new Set();
function sampleTree(rootPid){
 const raw=execFileSync('powershell.exe',['-NoProfile','-Command',listScript],{encoding:'utf8',timeout:20000}).trim();
 if(!raw)return[];
 const all=raw.startsWith('[')?JSON.parse(raw):[JSON.parse(raw)];
 const byPid=new Map(all.map(p=>[Number(p.ProcessId),p]));
 const children=new Map();
 for(const p of all){const parent=Number(p.ParentProcessId);if(!children.has(parent))children.set(parent,[]);children.get(parent).push(Number(p.ProcessId));}
 const included=[];
 const walk=start=>{const queue=[start];const seen=new Set();while(queue.length){const pid=queue.shift();if(seen.has(pid))continue;seen.add(pid);const p=byPid.get(pid);if(p&&(p.Name==='node.exe'||p.Name==='workerd.exe')){const pid=Number(p.ProcessId);const entry={name:p.Name.replace('.exe',''),pid,ws:Number(p.WorkingSetSize??0)};if(!seenCmd.has(pid)){seenCmd.add(pid);const cmd=String(p.CommandLine??'');if(cmd)entry.cmd=cmd.slice(0,300);}included.push(entry);}for(const child of children.get(pid)??[])queue.push(child);}};
 walk(rootPid);
 return included;
}
const rootPid=Number(flag('root-pid')??process.ppid);
while(durationMs===0||Date.now()-started<durationMs){
 const at=new Date().toISOString();
 let processes=[],error;
 try{processes=sampleTree(rootPid);}catch(cause){error=String(cause).slice(0,200);}
 appendFileSync(out,JSON.stringify({at,elapsedMs:Date.now()-started,rootPid,...(error?{error}:{processes,totalWs:processes.reduce((sum,p)=>sum+p.ws,0)})})+'\n');
 const wait=intervalMs-((Date.now()-started)%intervalMs);
 await new Promise(resolve=>setTimeout(resolve,Math.max(200,wait)));
}
