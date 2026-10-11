import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
// L12-3 B 段 / V8-C-L12-3 F4: npm run contracts only compares OpenAPI to its generator,
// so this checks implemented Worker operations against OpenAPI at both path and method level.
const source=readFileSync(new URL('../apps/worker/src/index.ts',import.meta.url),'utf8');
const assetSource=readFileSync(new URL('../apps/worker/src/asset-delivery.ts',import.meta.url),'utf8');
const openapi=JSON.parse(readFileSync(new URL('../specs/001-sandtray/contracts/openapi.json',import.meta.url),'utf8')) as {paths:Record<string,unknown>};
const HTTP_METHODS=['get','head','post','put','patch','delete'] as const;
type Operation=string;
const normalize=(path:string)=>path.replace(/\{[^}]+\}/g,'*');
const operation=(method:string,path:string):Operation=>`${method.toLowerCase()} ${normalize(path)}`;
const routeFromRegex=(pattern:string)=>pattern.replaceAll('\\/','/').replaceAll('\\.','.').replace(/\(\?:[^)]*\)/g,'*').replace(/\([^)]*\)/g,'*');

function workerOperations(){
 const operations=new Set<Operation>();
 const add=(method:string,path:string)=>operations.add(operation(method,path));
 // Literal-path handlers with an explicit method guard.
 for(const m of source.matchAll(/path===['"](\/api\/[^'"]+|\/auth\/[^'"]+)['"]\s*&&\s*request\.method===['"](GET|HEAD|POST|PUT|PATCH|DELETE)['"]/g))add(m[2],m[1]);
 if(/path===['"]\/auth\/login['"]\s*\|\|\s*path===['"]\/auth\/callback['"]/.test(source)&&/\)\s*&&\s*request\.method===['"]GET['"]/.test(source)){
  add('GET','/auth/login');add('GET','/auth/callback');
 }
 // Regex-path handlers with a direct method guard.
 const patterns=new Map<string,string>();
 for(const m of source.matchAll(/const\s+(\w+)=path\.match\(\/\^([^\r\n]+?)\$\/\);/g))patterns.set(m[1],m[2]);
 for(const [name,pattern] of patterns){
  const actionGroup=pattern.match(/^(.*)\/\(([^()]*(?:\|[^()]*)+)\)$/);
  if(actionGroup){
   const prefix=routeFromRegex(actionGroup[1]);
   const allowed=new Set(actionGroup[2].split('|'));
   for(const m of source.matchAll(/action===['"]([^'"]+)['"]\s*&&\s*request\.method===['"](GET|HEAD|POST|PUT|PATCH|DELETE)['"]/g))if(allowed.has(m[1]))add(m[2],routeFromRegex(`${prefix}/${m[1]}`));
   continue;
  }
  const condition=new RegExp(`if\\s*\\(\\s*${name}\\s*&&\\s*request\\.method\\s*===\\s*['"](GET|HEAD|POST|PUT|PATCH|DELETE)['"]\\s*\\)`,'g');
  for(const m of source.matchAll(condition))add(m[1],routeFromRegex(pattern));
 }
 // The top-level path prefix delegates to the private model handler, which owns GET/HEAD validation.
 if(source.includes("path.startsWith('/api/assets/')")&&/!\[['"]GET['"],\s*['"]HEAD['"]\]\.includes\(request\.method\)/.test(assetSource)){
  add('GET','/api/assets/{assetId}/{assetVersion}/model.glb');
  add('HEAD','/api/assets/{assetId}/{assetVersion}/model.glb');
 }
 return operations;
}
function documentedOperations(paths:Record<string,unknown>){
 const operations=new Set<Operation>();
 for(const [path,raw] of Object.entries(paths))for(const method of HTTP_METHODS)if(Object.hasOwn(raw??{},method))operations.add(operation(method,path));
 return operations;
}
function operationDiff(worker:Set<Operation>,documented:Set<Operation>){
 const stale=[...documented].filter(op=>!worker.has(op)&&!KNOWN_TARGET_ONLY.has(op)).sort();
 const undocumented=[...worker].filter(op=>!documented.has(op)&&!KNOWN_UNDOCUMENTED.has(op)).sort();
 return {stale,undocumented};
}
// The T00 OpenAPI is explicitly a target contract, not an implementation claim. Historical REQ-018 evidence
// also says its root catalog operation was retained; REQ-018 adds private per-model GET/HEAD delivery.
const KNOWN_TARGET_ONLY=new Set<Operation>(['get /api/assets']);
// Existing implemented endpoints not yet documented; adding one here requires a scope decision/evidence.
const KNOWN_UNDOCUMENTED=new Set<Operation>(['get /api/health','get /api/session','get /api/rooms/*/info','post /api/rooms/*/export-consent']);
const worker=workerOperations();
const documented=documentedOperations(openapi.paths);
describe('OpenAPI and implemented Worker operations must not drift apart',()=>{
 it('documents every implemented business operation and retains no removed implementation route',()=>{
  expect(operationDiff(worker,documented)).toEqual({stale:[],undocumented:[]});
 });
 it('keeps the root asset catalog explicitly target-only, distinct from REQ-018 model delivery',()=>{
  expect(documented).toContain('get /api/assets');
  expect(worker).not.toContain('get /api/assets');
  expect(documented).toContain('get /api/assets/*/*/model.glb');
  expect(documented).toContain('head /api/assets/*/*/model.glb');
 });
 it('detects method drift in either direction',()=>{
  const mutated=new Set(documented);mutated.delete('post /api/rooms/*/close');mutated.add('get /api/rooms/*/close');
  const diff=operationDiff(worker,mutated);
  expect(diff.stale).toContain('get /api/rooms/*/close');
  expect(diff.undocumented).toContain('post /api/rooms/*/close');
 });
 it('keeps the removed cloud and JSON-export surfaces out of both sides (L12-3 / L12-8)',()=>{
  const workerPaths=new Set([...worker].map(op=>op.slice(op.indexOf(' ')+1)));
  const documentedPaths=new Set([...documented].map(op=>op.slice(op.indexOf(' ')+1)));
  for(const route of ['/api/scenes','/api/retention-policy','/api/data-management','/api/scenes/*/management','/api/scenes/*/backups','/api/scenes/*/deletion','/api/rooms/*/versions']){
   expect(documentedPaths).not.toContain(route);
   expect(workerPaths).not.toContain(route);
  }
  expect(source).not.toContain("'/api/scenes'");
  expect(source).toContain("z.literal('png')");
 });
});
