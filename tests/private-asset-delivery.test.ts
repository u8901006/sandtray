import {describe,it,expect,vi} from 'vitest';
import {deliverAsset,resolvePrivateModel} from '../apps/worker/src/asset-delivery';
import imported from '../packages/asset-catalog/src/imported-v1.json';
import type {Env} from '../apps/worker/src/env';
import {authenticate} from '../apps/worker/src/auth';
vi.mock('../apps/worker/src/auth',()=>({authenticate:vi.fn()}));
const model=imported[0];
const url=`https://example.test/api/assets/${model.id}/${model.version}/model.glb?roomId=room-a`;
function fixture(){
 const authorize=vi.fn().mockResolvedValue(undefined),cancel=vi.fn();
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));},cancel});
 const object={size:model.bytes,checksums:{sha256:Uint8Array.from(Buffer.from(model.sha256,'hex')).buffer},body:stream};
 const get=vi.fn().mockResolvedValue(object),consume=vi.fn().mockResolvedValue(0),canAddressRoom=vi.fn().mockResolvedValue(true);
 const env={AUTH_DO:{getByName:()=>({consumeAssetRequest:consume,canAddressRoom})},ROOM_DO:{getByName:()=>({authorizeAsset:authorize})},PRIVATE_ASSETS:{get}} as unknown as Env;
 vi.mocked(authenticate).mockResolvedValue({hash:'session-hash',session:{participantId:'p',clinicId:'c',role:'therapist',expiresAt:Date.now()+60000}});
 return {env,authorize,cancel,object,get,consume,canAddressRoom};
}
describe('private model delivery',()=>{
 it('pins all 270 legacy imports and rejects unknown/version/draft/unverified resources',()=>{
  for(const a of imported)expect(resolvePrivateModel(a.id,a.version)).toEqual({key:`models/${a.sha256}.glb`,sha256:a.sha256,bytes:a.bytes});
  for(const [id,version] of [['DEV_ROCK','dev-v1'],['USR_ANIMAL_panda','unknown'],[model.id,'newer'],['../key',model.version]])expect(resolvePrivateModel(id,version)).toBeUndefined();
 });
 it('rejects anonymous requests before touching limiter, room or R2',async()=>{
  const f=fixture();vi.mocked(authenticate).mockResolvedValue(null);
  const r=await deliverAsset(new Request(url.replace(model.id,'missing')) ,f.env);
  expect(r.status).toBe(401);expect(r.headers.get('cache-control')).toBe('private, no-store');
  expect(f.consume).not.toHaveBeenCalled();expect(f.authorize).not.toHaveBeenCalled();expect(f.get).not.toHaveBeenCalled();
 });
 it('rejects unregistered room IDs before Room DO lookup or R2 access',async()=>{
  const f=fixture();f.canAddressRoom.mockResolvedValue(false);
  const r=await deliverAsset(new Request(url),f.env);expect(r.status).toBe(403);
  expect(f.authorize).not.toHaveBeenCalled();expect(f.get).not.toHaveBeenCalled();
 });
 it('never emits bytes if authorization is revoked while R2 is pending',async()=>{
  const f=fixture();f.authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('UNAUTHENTICATED'));
  const r=await deliverAsset(new Request(url),f.env);expect(r.status).toBe(401);expect(f.cancel).toHaveBeenCalledOnce();
  expect(await r.text()).not.toContain('1,2,3');
 });
 it('rejects wrong R2 size/checksum and cancels the stream',async()=>{
  for(const fault of ['size','hash'] as const){const f=fixture();if(fault==='size')f.object.size++;else f.object.checksums.sha256=new ArrayBuffer(32);
   const r=await deliverAsset(new Request(url),f.env);expect(r.status).toBe(503);expect(f.cancel).toHaveBeenCalledOnce();}
 });
 it('never grants a conditional 304 and only reads an immutable catalog key',async()=>{
  const f=fixture();const r=await deliverAsset(new Request(url,{headers:{'If-None-Match':'"'+model.sha256+'"',Range:'bytes=0-1'}}),f.env);
  expect(r.status).toBe(200);expect(r.headers.get('etag')).toBe('"'+model.sha256+'"');
  expect(r.headers.get('cache-control')).toBe('private, no-store');expect(r.headers.get('content-length')).toBe(String(model.bytes));
  expect(f.get).toHaveBeenCalledExactlyOnceWith(`models/${model.sha256}.glb`);expect(f.authorize).toHaveBeenCalledTimes(2);await r.body!.cancel();
 });
 it('HEAD authenticates, rechecks and cancels without a response body',async()=>{
  const f=fixture();const r=await deliverAsset(new Request(url,{method:'HEAD'}),f.env);
  expect(r.status).toBe(200);expect(r.body).toBeNull();expect(f.authorize).toHaveBeenCalledTimes(2);expect(f.cancel).toHaveBeenCalledOnce();
 });
 it('rate limits with Retry-After before R2 I/O',async()=>{
  const f=fixture();f.consume.mockResolvedValue(23);const r=await deliverAsset(new Request(url),f.env);
  expect(r.status).toBe(429);expect(r.headers.get('retry-after')).toBe('23');expect(f.get).not.toHaveBeenCalled();
 });
 it('fails closed when storage is unavailable or room context is ambiguous',async()=>{
  const f=fixture();f.get.mockRejectedValue(new Error('private backend details'));
  expect((await deliverAsset(new Request(url),f.env)).status).toBe(503);
  for(const suffix of ['','?roomId=a&roomId=b','?roomId=../a']){
   const r=await deliverAsset(new Request(url.split('?')[0]+suffix),f.env);expect(r.status).toBe(403);
  }
 });
});
