import {describe,it,expect} from 'vitest';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {words} from '../apps/web/src/shared-room';
// Production two-person test 2026-10-04: the client status bar showed the raw code 「STALE_FENCE」. Every rejection code the Worker
// can send must have a readable sentence, so a new code fails here instead of leaking to a client or therapist.
const dir=join(__dirname,'../apps/worker/src');
const codes=new Set<string>();
for(const file of readdirSync(dir).filter(f=>f.endsWith('.ts')))for(const m of readFileSync(join(dir,file),'utf8').matchAll(/Rejected\('([A-Z_]+)'/g))codes.add(m[1]);
describe('rejection codes have readable text',()=>{
 it('finds the Worker codes (fixture sanity)',()=>{expect(codes.has('STALE_FENCE')).toBe(true);expect(codes.size).toBeGreaterThanOrEqual(10);});
 for(const code of [...codes,'SAVE_FAILED','UPGRADE_REQUIRED'])it(code,()=>{expect(words[code],code).toBeTruthy();expect(words[code]).not.toMatch(/[A-Z_]{4,}/);});
});
