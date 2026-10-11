import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
it('T06: pilot briefs match the exact 10 catalog IDs without invented generation evidence',()=>{
 const catalog=JSON.parse(readFileSync('specs/002-assets-100/catalog.planned.json','utf8'));
 const pilot=catalog.filter((a:any)=>a.batch==='PILOT-10');
 const tracker=JSON.parse(readFileSync('specs/002-assets-100/pilot/tracker.json','utf8'));
 expect(tracker.map((a:any)=>a.assetId).sort()).toEqual(pilot.map((a:any)=>a.assetId).sort());
 for(const item of tracker){
  const content=readFileSync('specs/002-assets-100/pilot/'+item.briefPath,'utf8');
  const source=pilot.find((a:any)=>a.assetId===item.assetId);
  expect(content).toContain(source.nameZhTW);expect(content).toContain('animationClass: '+source.animationClass);
  expect(item.status).toBe('PLANNED');expect(item.canonicalImageHash).toBeNull();expect(item.glbSha256).toBeNull();expect(item.qaReport).toBeNull();
 }
});
