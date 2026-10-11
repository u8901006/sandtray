import {resolveAsset,provenanceIssues,pinnedModels} from '../../../packages/asset-catalog/src/index';
import {authenticate} from './auth';
import type {Env} from './env';

// Only catalog-pinned, reviewed-license sources. No caller-controlled bucket keys or draft manifests.
// T18-C: pinnedModels = imported-v1 + the private-only ITHappy animals; UNVERIFIED/DEV entries still fail the provenance gate below.
const models=new Map(pinnedModels.map(asset=>[asset.id+'\0'+asset.version,asset]));
export function resolvePrivateModel(id:string,version:string){
 const asset=resolveAsset(id,version),model=models.get(id+'\0'+version);
 if(!asset||!model||!asset.provenance.releasable||provenanceIssues(asset).length||
  !/^[a-f0-9]{64}$/.test(model.sha256)||model.bytes<=0)return undefined;
 return {key:'models/'+model.sha256+'.glb',sha256:model.sha256,bytes:model.bytes};
}

const privateHeaders={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export async function deliverAsset(request:Request,env:Env):Promise<Response>{
 const reject=(code:string,status:number,extra:HeadersInit={})=>{
  const headers=new Headers(privateHeaders);headers.set('Content-Type','application/json');
  new Headers(extra).forEach((v,k)=>headers.set(k,v));
  return new Response(request.method==='HEAD'?null:JSON.stringify({code,requestId:crypto.randomUUID()}),{status,headers});
 };
 try{
  // Authentication precedes method, path, catalog and storage lookup: no anonymous existence oracle.
  const auth=await authenticate(request,env);if(!auth)return reject('UNAUTHENTICATED',401);
  const retryAfter=await env.AUTH_DO.getByName('sessions').consumeAssetRequest(auth.hash);
  if(retryAfter>0)return reject('RATE_LIMITED',429,{'Retry-After':String(retryAfter)});
  if(!['GET','HEAD'].includes(request.method))return reject('METHOD_NOT_ALLOWED',405,{'Allow':'GET, HEAD'});
  const url=new URL(request.url),rooms=url.searchParams.getAll('roomId');
  if(rooms.length!==1||!/^[A-Za-z0-9_-]{1,128}$/.test(rooms[0]))return reject('PERMISSION_DENIED',403);
  if(!await env.AUTH_DO.getByName('sessions').canAddressRoom(auth.hash,rooms[0]))return reject('PERMISSION_DENIED',403);
  const room=env.ROOM_DO.getByName(rooms[0]);await room.authorizeAsset(auth.hash);
  const match=url.pathname.match(/^\/api\/assets\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/model\.glb$/);
  const model=match?resolvePrivateModel(match[1],match[2]):undefined;
  if(!model)return reject('ASSET_NOT_FOUND',404);
  if(!env.PRIVATE_ASSETS)return reject('ASSET_UNAVAILABLE',503);
  const object=await env.PRIVATE_ASSETS.get(model.key);
  try{
   // R2 I/O can overlap logout, seat cancellation, room close or deletion. Recheck before emitting bytes.
   await room.authorizeAsset(auth.hash);
   if(!object)return reject('ASSET_NOT_FOUND',404);
   const checksum=object.checksums.sha256;
   const digest=checksum?Array.from(new Uint8Array(checksum),b=>b.toString(16).padStart(2,'0')).join(''):'';
   if(object.size!==model.bytes||digest!==model.sha256){await object.body.cancel();return reject('ASSET_UNAVAILABLE',503);}
   const headers=new Headers(privateHeaders);headers.set('Content-Type','model/gltf-binary');
   headers.set('Content-Length',String(object.size));headers.set('ETag','"'+model.sha256+'"');
   // Never forward object cache metadata, honor If-None-Match or issue a reusable redirect.
   if(request.method==='HEAD'){await object.body.cancel();return new Response(null,{headers});}
   return new Response(object.body,{headers});
  }catch(cause){await object?.body.cancel();throw cause;}
 }catch(cause){
  const message=cause instanceof Error?cause.message:'';
  if(message.includes('UNAUTHENTICATED'))return reject('UNAUTHENTICATED',401);
  if(message.includes('PERMISSION_DENIED')||message.includes('ROOM_CLOSED'))return reject('PERMISSION_DENIED',403);
  return reject('ASSET_UNAVAILABLE',503);
 }
}
