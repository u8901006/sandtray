import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {traceProcess} from '../tools/verification/trace-process.mjs';
test('diagnostic runner preserves output and a failed child exit without restarting',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'sandtray-trace-'));
 const {done}=traceProcess(process.execPath,['-e','console.log("ready");console.error("synthetic failure");process.exitCode=7'],{directory,forward:false});
 const result=await done;assert.equal(result.code,7);
 const events=(await readFile(join(directory,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(events.filter(e=>e.event==='spawn').length,1);assert.equal(events.find(e=>e.event==='exit').code,7);
 assert.match(await readFile(join(directory,'stdout.log'),'utf8'),/ready/);
 assert.match(await readFile(join(directory,'stderr.log'),'utf8'),/synthetic failure/);
});
