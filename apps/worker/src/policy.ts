import {z} from 'zod';
import type {Env} from './env';
import {Rejected} from '../../../packages/room-core/src/index';
import {id} from '../../../packages/protocol/src/index';
// L12-3 B2（Claude Opus 5, 2026-09-26）：跨會談版本（VersionStore）隨 cloud 移除，但 tombstone 的存續期
// 仍由同一份保留政策提供（coordinator.purgeTombstone／tombstones.purgeExpiredTombstones）。政策本身
// 因此搬到這個獨立模組，不再寄生在版本檔裡。

const policySchema=z.strictObject({version:id,ttlMs:z.number().int().min(1000).max(86400000),purpose:z.literal('synthetic-testing')});
export function retentionPolicy(env:Env,version?:string){
 let input:unknown;try{input=JSON.parse(env.RETENTION_POLICY??'null');}catch{throw new Rejected('PERMISSION_DENIED');}
 const policy=policySchema.safeParse(input);
 if(!policy.success||(version!==undefined&&policy.data.version!==version)||!env.PRIVATE_SCENES||!env.DIRECTORY)throw new Rejected('PERMISSION_DENIED');
 return policy.data;
}

// L12-6（使用者裁定，2026-09-26）：tombstone 自 deleted_at 起固定保留 8 h，之後只有在各儲存層均可清除時才 purge。
// staging／production 一律用固定值，任何 env override 都 fail-loud；只有未設定 DEPLOY_ENV 的 local/test prototype
// 可使用 synthetic RETENTION_POLICY 或 TOMBSTONE_TTL_MS 加速測試。
export const DEFAULT_TOMBSTONE_TTL_MS=8*60*60*1000;
export function tombstoneTtlMs(env:Env){
 if(!env.DIRECTORY||!env.PRIVATE_SCENES)throw new Rejected('PERMISSION_DENIED');
 if(env.DEPLOY_ENV!==undefined){
  if(env.DEPLOY_ENV!=='staging'&&env.DEPLOY_ENV!=='production')throw new Rejected('PERMISSION_DENIED');
  if(env.RETENTION_POLICY!==undefined||env.TOMBSTONE_TTL_MS!==undefined)throw new Rejected('PERMISSION_DENIED');
  return DEFAULT_TOMBSTONE_TTL_MS;
 }
 if(env.TOMBSTONE_TTL_MS!==undefined){
  const ttl=z.coerce.number().int().min(1000).max(86400000).safeParse(env.TOMBSTONE_TTL_MS);
  if(!ttl.success)throw new Rejected('PERMISSION_DENIED');
  return ttl.data;
 }
 if(env.RETENTION_POLICY!==undefined)return retentionPolicy(env).ttlMs;
 return DEFAULT_TOMBSTONE_TTL_MS;
}
