/** Run one diagnostic child, preserve its output and exit status; never auto-restart. */
import {spawn} from 'node:child_process';
import {finished} from 'node:stream/promises';
import {mkdirSync,appendFileSync,createWriteStream} from 'node:fs';
import {resolve} from 'node:path';
export function traceProcess(command,args,{directory,cwd=process.cwd(),env=process.env,forward=true}={}){
 const folder=resolve(directory);mkdirSync(folder,{recursive:true});
 const record=(event,details={})=>appendFileSync(resolve(folder,'events.jsonl'),JSON.stringify({time:new Date().toISOString(),event,...details})+'\n');
 record('start',{command,args,cwd,node:process.version,platform:process.platform,parentPid:process.pid});
 const child=spawn(command,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 record('spawn',{pid:child.pid??null});
 const stdout=createWriteStream(resolve(folder,'stdout.log')),stderr=createWriteStream(resolve(folder,'stderr.log'));
 child.stdout.pipe(stdout);child.stderr.pipe(stderr);
 if(forward){child.stdout.pipe(process.stdout,{end:false});child.stderr.pipe(process.stderr,{end:false});}
 return {child,done:new Promise((resolveDone,rejectDone)=>{
  child.on('error',error=>record('error',{message:error.message,code:error.code??null}));
  child.on('exit',(code,signal)=>record('exit',{code,signal}));
  child.on('close',(code,signal)=>{record('close',{code,signal});void Promise.all([finished(stdout),finished(stderr)]).then(()=>resolveDone({code:code??1,signal,directory:folder}),rejectDone);});
 })};
}
