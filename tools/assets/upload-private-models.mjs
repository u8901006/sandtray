#!/usr/bin/env node
// T18-B (REQ-018): immutable private-model upload.
//
// For every hash-pinned catalog model (packages/asset-catalog/src/imported-v1.json) this tool
//   1. reads the built public copy (apps/web/public<url>), recomputes sha256 and REFUSES any file whose
//      digest or size differs from the catalog pin (the worker will 503 on a mismatch anyway);
//   2. stores it at models/<sha256>.glb with the sha256 checksum attached so R2 records it
//      (apps/worker/src/asset-delivery.ts compares object.checksums.sha256 before streaming);
//   3. never overwrites: an existing object with the same key and checksum is skipped, an existing object
//      with a different checksum aborts the run (content-addressed keys must be immutable).
//
// Modes:
//   --dry-run             verify only, print the manifest (default when no target is given)
//   --local [--persist P] write into wrangler dev local R2 via wrangler getPlatformProxy (default P=apps/worker/.wrangler/state/v3)
//   --local --config C    same, but read bindings from wrangler config C; a PRIVATE_ASSETS binding with "remote": true
//                         writes to that real bucket through wrangler's own login (staging upload, 2026-09-27)
//   --remote              upload through the R2 S3 API with x-amz-checksum-sha256; needs
//                         R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (never printed, never written)
//   --bucket NAME         default sandtray-private-assets (production wrangler.jsonc binding)
//   --only ID[,ID]        restrict to catalog ids
//   --manifest FILE       write the verified manifest JSON (id, version, key, sha256, bytes, result)
import {createHash,createHmac} from 'node:crypto';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../../',import.meta.url));
const args=process.argv.slice(2);
const flag=name=>args.includes('--'+name);
const value=(name,fallback)=>{const i=args.indexOf('--'+name);return i>=0&&args[i+1]!==undefined?args[i+1]:fallback;};
const mode=flag('remote')?'remote':flag('local')?'local':'dry-run';
const bucketName=value('bucket','sandtray-private-assets');
const only=value('only','')?new Set(value('only','').split(',')):null;
const manifestPath=value('manifest','');

// T18-C: imported-v1 plus the private-only animals (animals-v1/v2 entries with privateSource); DEV/UNVERIFIED entries are not pinned.
const catalogs=['imported-v1.json','animals-v2.json','animals-v1.json','blendercity-v1.json','sunmoonlake-v1.json','twscenic-v1.json','olympians-v1.json','megakits-v1.json','adventure-v1.json','bits-v1.json'].map(f=>JSON.parse(readFileSync(join(root,'packages/asset-catalog/src',f),'utf8')));
const seen=new Set();const imported=catalogs.flat().filter(a=>{const k=a.id+'\0'+a.version;if(seen.has(k)||!a.sha256)return false;seen.add(k);return a.sourcePack!=='使用者動物素材';});
const sourcePath=asset=>asset.privateSource?join(root,asset.privateSource):join(root,'apps/web/public',asset.url);
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');

// Step 1: verify every candidate against the catalog pin before touching any storage.
const manifest=[];let bad=0;
for(const asset of imported){
 if(only&&!only.has(asset.id))continue;
 const entry={id:asset.id,version:asset.version,key:'models/'+asset.sha256+'.glb',sha256:asset.sha256,bytes:asset.bytes,source:asset.privateSource??asset.url,result:'pending'};
 try{
  const path=sourcePath(asset);
  const size=statSync(path).size;
  if(size!==asset.bytes){entry.result='SIZE_MISMATCH';entry.detail=`disk ${size} != catalog ${asset.bytes}`;bad++;}
  else{const digest=sha256(readFileSync(path));if(digest!==asset.sha256){entry.result='SHA_MISMATCH';entry.detail=`disk ${digest}`;bad++;}else entry.result='verified';}
 }catch(error){entry.result='MISSING';entry.detail=error.message;bad++;}
 manifest.push(entry);
}
const verified=manifest.filter(e=>e.result==='verified');
console.log(`verify: ${verified.length} verified, ${bad} rejected, of ${manifest.length} candidates (${(verified.reduce((s,e)=>s+e.bytes,0)/1e6).toFixed(1)} MB)`);
if(bad){for(const e of manifest.filter(e=>e.result!=='verified'))console.error(`  ${e.result} ${e.id} ${e.detail}`);}

// Step 2: store (never overwrite a different object under the same key).
async function storeAll(head,put){
 let stored=0,skipped=0;
 for(const entry of verified){
  const existing=await head(entry.key);
  if(existing){
   if(existing.sha256===entry.sha256&&existing.size===entry.bytes){entry.result='exists';skipped++;continue;}
   entry.result='CONFLICT';entry.detail=`existing sha256=${existing.sha256??'none'} size=${existing.size}`;
   throw new Error(`immutable key conflict at ${entry.key}: ${entry.detail}`);
  }
  const body=readFileSync(entry.source.startsWith('/')?join(root,'apps/web/public',entry.source):join(root,entry.source));
  await put(entry.key,body,entry.sha256);
  const check=await head(entry.key);
  if(!check||check.sha256!==entry.sha256||check.size!==entry.bytes){entry.result='READBACK_FAILED';throw new Error(`read-back mismatch at ${entry.key}`);}
  entry.result='stored';stored++;
 }
 return {stored,skipped};
}
const hex=bytes=>bytes?Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join(''):undefined;

try{
 if(mode==='local'){
  const persist=value('persist',join(root,'apps/worker/.wrangler/state/v3'));
  // getPlatformProxy gives the production wrangler.jsonc bindings backed by the same local store wrangler dev reads.
  const {getPlatformProxy}=await import('wrangler');
  const configPath=value('config',join(root,'apps/worker/wrangler.jsonc'));
  const proxy=await getPlatformProxy({configPath,persist:{path:persist}});
  try{
   const bucket=proxy.env.PRIVATE_ASSETS;
   if(!bucket)throw new Error('PRIVATE_ASSETS binding missing in apps/worker/wrangler.jsonc');
   const result=await storeAll(async key=>{const o=await bucket.head(key);return o?{sha256:hex(o.checksums.sha256),size:o.size}:null;},
    async(key,body,digest)=>{await bucket.put(key,body,{sha256:digest,httpMetadata:{contentType:'model/gltf-binary'}});});
   console.log(`local (${configPath} ${persist} / ${bucketName}): stored=${result.stored} skipped(existing)=${result.skipped}`);
  }finally{await proxy.dispose();}
 }else if(mode==='remote'){
  const account=process.env.R2_ACCOUNT_ID,keyId=process.env.R2_ACCESS_KEY_ID,secret=process.env.R2_SECRET_ACCESS_KEY;
  if(!account||!keyId||!secret){console.error('remote: R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are required (not set) - nothing uploaded');process.exit(2);}
  const host=`${account}.r2.cloudflarestorage.com`,region='auto',service='s3';
  // Minimal SigV4 with a signed payload hash: the hash is the catalog sha256, so a corrupted body also fails the signature.
  const sign=(method,key,payloadHash,extraHeaders)=>{
   const now=new Date(),amzDate=now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''),date=amzDate.slice(0,8);
   const headers={host,'x-amz-content-sha256':payloadHash,'x-amz-date':amzDate,...extraHeaders};
   const lower=Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),String(v).trim()]));
   const names=Object.keys(lower).sort();
   const canonical=[method,`/${bucketName}/${key}`,'',names.map(h=>`${h}:${lower[h]}\n`).join(''),names.join(';'),payloadHash].join('\n');
   const scope=`${date}/${region}/${service}/aws4_request`;
   const toSign=['AWS4-HMAC-SHA256',amzDate,scope,sha256(canonical)].join('\n');
   const kDate=createHmac('sha256','AWS4'+secret).update(date).digest(),kRegion=createHmac('sha256',kDate).update(region).digest(),kService=createHmac('sha256',kRegion).update(service).digest(),kSigning=createHmac('sha256',kService).update('aws4_request').digest();
   const signature=createHmac('sha256',kSigning).update(toSign).digest('hex');
   return {...headers,Authorization:`AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`};
  };
  const emptyHash=sha256(Buffer.alloc(0));
  const head=async key=>{
   const r=await fetch(`https://${host}/${bucketName}/${key}`,{method:'HEAD',headers:sign('HEAD',key,emptyHash,{'x-amz-checksum-mode':'ENABLED'})});
   if(r.status===404)return null;if(!r.ok)throw new Error(`HEAD ${key}: ${r.status}`);
   const b64=r.headers.get('x-amz-checksum-sha256');return {sha256:b64?Buffer.from(b64,'base64').toString('hex'):undefined,size:Number(r.headers.get('content-length'))};
  };
  const put=async(key,body,digest)=>{
   const r=await fetch(`https://${host}/${bucketName}/${key}`,{method:'PUT',body,headers:sign('PUT',key,digest,{'x-amz-checksum-sha256':Buffer.from(digest,'hex').toString('base64'),'content-type':'model/gltf-binary','content-length':String(body.length),'if-none-match':'*'})});
   if(!r.ok)throw new Error(`PUT ${key}: ${r.status} ${await r.text()}`);
  };
  const result=await storeAll(head,put);
  console.log(`remote (${host}/${bucketName}): stored=${result.stored} skipped(existing)=${result.skipped}`);
 }else{
  console.log('dry-run: no storage touched');
 }
}finally{
 if(manifestPath)writeFileSync(manifestPath,JSON.stringify({mode,bucket:bucketName,at:new Date().toISOString(),entries:manifest},null,2)+'\n');
}
process.exit(bad?1:0);
