import type {Env} from './env';
import {tombstoneTtlMs} from './policy';
// L12-3 B 段（Claude Opus 5, 2026-09-26；使用者裁定 L01-4「不做每日備份」）：runDailyBackups 及其排程分支已移除。
// 本檔只保留 tombstone 清除——tombstone 不是備份機制，它存在的唯一理由是擋晚到寫入與重連復活（L12-4），
// 且最終仍必須零痕跡，所以清除邏輯保留。

// C4 #9 decision (2026-09-17, user): full erasure. Content is purged at deletion time; the
// tombstone only has to outlive anything that could resurrect the scene. Backups expire on
// the same clock as their source (C3-F2), so once deleted_at + ttlMs has passed no backup or
// archive row for that scene can still exist. The coordinator verifies that before it purges.
export async function purgeExpiredTombstones(env:Env){
 const ttlMs=tombstoneTtlMs(env);
 let clinic='',scene='',failed=0,purged=0,skipped=0;
 for(;;){
  const page=await env.DIRECTORY!.prepare('SELECT clinic_id,scene_id FROM scene_tombstones WHERE deleted_at+?<=? AND (clinic_id>? OR (clinic_id=? AND scene_id>?)) ORDER BY clinic_id,scene_id LIMIT 50').bind(ttlMs,Date.now(),clinic,clinic,scene).all<{clinic_id:string;scene_id:string}>();
  if(!page.success)throw new Error('SAVE_FAILED');
  if(!page.results.length)break;
  for(const row of page.results){
   try{const result=await env.SCENE_COORDINATOR_DO.getByName(row.clinic_id+':'+row.scene_id).purgeTombstone(row.clinic_id,row.scene_id);if(result.purged)purged++;else skipped++;}
   catch{failed++;}
  }
  const last=page.results[page.results.length-1];clinic=last.clinic_id;scene=last.scene_id;
 }
 if(failed)throw new Error('SAVE_FAILED');
 return {purged,skipped};
}
