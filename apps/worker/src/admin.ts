import {z} from 'zod';
import type {Env,Session} from './env';
import {error,hashToken,json,randomToken} from './http';
// 2026-10-11 使用者裁定（Claude Opus 5.5 實作）：治療師以「加入碼＋Google 登入」加入；單一診所；管理員可有多位。
// 授權一律在這裡向 D1 重新查詢（不信任 session 或畫面狀態），停用與降級即時生效。
// D1 可被 Time Travel 還原，所以「已用／作廢的加入碼」與「已停用的人」另在 AUTH_DO 留圍欄，兩邊都要通過才算數。
const fence=(env:Env)=>env.AUTH_DO.getByName('sessions');
export const ENROLLMENT_TTL_MS=24*3600000;
const CODE=/^[a-f0-9]{64}$/;
export const enrollmentInputSchema=z.strictObject({displayName:z.string().trim().min(1).max(60),grantAdmin:z.boolean()});
type Admin={participantId:string;clinicId:string};
export async function requireAdmin(env:Env,session:Session):Promise<Admin|null>{
 if(session.role!=='therapist'||!env.DIRECTORY)return null;
 // 查詢失敗（例如 migration 0006 未套用）一律視為非管理員：拒絕而不是放行。
 const row=await env.DIRECTORY.prepare('SELECT is_admin AS isAdmin FROM therapists WHERE participant_id=? AND clinic_id=? AND active=1').bind(session.participantId,session.clinicId).first<{isAdmin:number}>().catch(cause=>{console.warn(JSON.stringify({event:'admin_check_failed',message:cause instanceof Error?cause.message.slice(0,120):''}));return null;});
 if(row?.isAdmin!==1||await fence(env).isDeactivated(session.participantId))return null;
 return {participantId:session.participantId,clinicId:session.clinicId};
}
export async function therapistActive(env:Env,participantId:string){
 if(!env.DIRECTORY)return false;
 return (await env.DIRECTORY.prepare('SELECT 1 AS ok FROM therapists WHERE participant_id=? AND active=1').bind(participantId).first())!==null&&!await fence(env).isDeactivated(participantId);
}
/** Non-consuming check so /auth/enroll can refuse a dead link before sending the person to Google. */
export async function enrollmentUsable(env:Env,codeHash:string){
 if(!env.DIRECTORY||!CODE.test(codeHash)||await fence(env).enrollmentFenced(codeHash))return false;
 return (await env.DIRECTORY.prepare('SELECT 1 AS ok FROM enrollments WHERE code_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?').bind(codeHash,Date.now()).first())!==null;
}
/**
 * Consumes the code and binds issuer+subject in one D1 batch (a transaction). Every write after the first is
 * conditioned on "this exact consumption" (used_at=now AND used_by=participantId), so a used, revoked, expired
 * or concurrently consumed code writes nothing. Returns false when the code was not consumed by this call.
 */
export async function redeemEnrollment(env:Env,issuer:string,subject:string,codeHash:string){
 const db=env.DIRECTORY;if(!db||!CODE.test(codeHash))return false;
 const auth=fence(env),op=crypto.randomUUID(),until=Date.now()+ENROLLMENT_TTL_MS+3600000;
 // 先在 AUTH_DO 保留圍欄再消耗：之後任何 D1 還原都不能讓這個碼再被用一次；同時只允許一次兌換進行。
 if(!await auth.reserveEnrollment(codeHash,op,until))return false;
 const now=Date.now();
 const existing=await db.prepare('SELECT participant_id AS participantId FROM therapists WHERE issuer=? AND subject=?').bind(issuer,subject).first<{participantId:string}>();
 const participantId=existing?.participantId??crypto.randomUUID();
 // GPT-6 F3：記下兌換開始前的停用世代；之後只解除這一代，較晚的停用不受影響。
 const priorGeneration=existing?await auth.deactivationGeneration(participantId):null;
 const mine='code_hash=? AND used_at=? AND used_by=?';
 let consumed:boolean;
 try{
  const [result]=await db.batch([
   // GPT-6 F4：只有在「這個 Google 身分還沒有名單列，或名單列就是 participantId 且在加入碼的診所」時才消耗；
   // 身分屬於別的診所（或名單在讀取後被別人搶先建立）時整筆不寫，也不會碰任何人的停用圍欄。
   db.prepare('UPDATE enrollments SET used_at=?, used_by=? WHERE code_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>? AND (SELECT participant_id FROM therapists WHERE issuer=? AND subject=?) IS ? AND NOT EXISTS (SELECT 1 FROM therapists WHERE issuer=? AND subject=? AND clinic_id<>enrollments.clinic_id)').bind(now,participantId,codeHash,now,issuer,subject,existing?participantId:null,issuer,subject),
   // 已在名單上（含先前被停用者）：重新啟用、管理員只升不降、改用加入碼上的名字。只動同一診所的那一列。
   db.prepare(`UPDATE therapists SET active=1, is_admin=MAX(is_admin,(SELECT grant_admin FROM enrollments WHERE ${mine})), display_name=(SELECT display_name FROM enrollments WHERE ${mine}) WHERE issuer=? AND subject=? AND clinic_id=(SELECT clinic_id FROM enrollments WHERE ${mine})`).bind(codeHash,now,participantId,codeHash,now,participantId,issuer,subject,codeHash,now,participantId),
   db.prepare(`INSERT INTO therapists (participant_id,clinic_id,issuer,subject,active,is_admin,display_name) SELECT ?,clinic_id,?,?,1,grant_admin,display_name FROM enrollments WHERE ${mine} AND NOT EXISTS (SELECT 1 FROM therapists WHERE issuer=? AND subject=?)`).bind(participantId,issuer,subject,codeHash,now,participantId,issuer,subject),
   db.prepare(`INSERT INTO admin_audit (clinic_id,at,actor,action,target,detail) SELECT clinic_id,?,created_by,'enrollment_redeemed',?,CASE grant_admin WHEN 1 THEN 'admin' ELSE 'therapist' END FROM enrollments WHERE ${mine}`).bind(now,participantId,codeHash,now,participantId),
  ]);
  consumed=result.meta.changes===1;
 }catch(cause){
  // GPT-6 F5：batch 拋錯時結果不明（明確 rollback，或已 commit 但回應遺失）；回 D1 看這一次的消耗是否落地。
  // 連查都失敗就保留圍欄（fail-closed），碼最多晚一小時隨圍欄到期，之後已過效期。
  const landed=await db.prepare(`SELECT 1 AS ok FROM enrollments WHERE ${mine}`).bind(codeHash,now,participantId).first().catch(()=>undefined);
  if(landed===undefined)throw cause;
  consumed=landed!==null;
  if(!consumed)console.warn(JSON.stringify({event:'enrollment_redeem_rolled_back',message:cause instanceof Error?cause.message.slice(0,120):''}));
 }
 if(!consumed){
  // 這次沒有消耗：碼在 D1 仍未使用／未作廢時撤掉自己的保留，讓同一個碼在效期內能重試；碼本來就失效則保留圍欄封住。
  const usable=await db.prepare('SELECT 1 AS ok FROM enrollments WHERE code_hash=? AND used_at IS NULL AND revoked_at IS NULL').bind(codeHash).first().catch(()=>null);
  if(usable)await auth.releaseEnrollment(codeHash,op);
  return false;
 }
 await auth.fenceEnrollment(codeHash,until);
 // 同一人以新加入碼回來：只解除兌換開始前那一代的停用圍欄（D1 那一列已在同一交易中重新啟用）。
 if(priorGeneration!==null)await auth.clearDeactivated(participantId,priorGeneration);
 return true;
}
export async function adminDirectory(env:Env,admin:Admin){
 const db=env.DIRECTORY!,now=Date.now();
 const [therapists,enrollments,audit]=await db.batch([
  db.prepare('SELECT participant_id AS participantId, display_name AS displayName, is_admin AS isAdmin, active FROM therapists WHERE clinic_id=? ORDER BY active DESC, is_admin DESC, display_name').bind(admin.clinicId),
  db.prepare('SELECT code_hash AS id, display_name AS displayName, grant_admin AS grantAdmin, created_at AS createdAt, expires_at AS expiresAt FROM enrollments WHERE clinic_id=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC').bind(admin.clinicId,now),
  db.prepare('SELECT at, actor, action, target, detail FROM admin_audit WHERE clinic_id=? ORDER BY id DESC LIMIT 50').bind(admin.clinicId),
 ]);
 const rows=therapists.results as {participantId:string;displayName:string|null;isAdmin:number;active:number}[];
 const fenced=new Set(await fence(env).deactivatedAmong(rows.map(t=>t.participantId)));
 return {
  me:admin.participantId,
  therapists:rows.map(t=>({participantId:t.participantId,displayName:t.displayName,isAdmin:t.isAdmin===1,active:t.active===1&&!fenced.has(t.participantId)})),
  enrollments:(enrollments.results as {id:string;displayName:string;grantAdmin:number;createdAt:number;expiresAt:number}[]).map(e=>({...e,grantAdmin:e.grantAdmin===1})),
  audit:audit.results,
 };
}
export async function createEnrollment(env:Env,admin:Admin,input:z.infer<typeof enrollmentInputSchema>,origin:string){
 const code=randomToken(),codeHash=await hashToken(code),now=Date.now(),expiresAt=now+ENROLLMENT_TTL_MS,db=env.DIRECTORY!;
 await db.batch([
  db.prepare('INSERT INTO enrollments (code_hash,clinic_id,display_name,grant_admin,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').bind(codeHash,admin.clinicId,input.displayName,input.grantAdmin?1:0,admin.participantId,now,expiresAt),
  db.prepare('INSERT INTO admin_audit (clinic_id,at,actor,action,target,detail) VALUES (?,?,?,?,?,?)').bind(admin.clinicId,now,admin.participantId,'enrollment_created',codeHash.slice(0,12),input.grantAdmin?'admin':'therapist'),
 ]);
 // 加入碼只在這一次回應中出現；資料庫只留雜湊。
 return {id:codeHash,link:origin+'/auth/enroll?code='+code,expiresAt};
}
export async function revokeEnrollment(env:Env,admin:Admin,codeHash:string){
 const db=env.DIRECTORY!,now=Date.now();
 const owned=await db.prepare('SELECT expires_at AS expiresAt FROM enrollments WHERE code_hash=? AND clinic_id=?').bind(codeHash,admin.clinicId).first<{expiresAt:number}>();
 if(!owned)return error('PERMISSION_DENIED',403);
 await fence(env).fenceEnrollment(codeHash,owned.expiresAt+3600000);
 const [revoked]=await db.batch([
  db.prepare('UPDATE enrollments SET revoked_at=? WHERE code_hash=? AND clinic_id=? AND used_at IS NULL AND revoked_at IS NULL').bind(now,codeHash,admin.clinicId),
  db.prepare("INSERT INTO admin_audit (clinic_id,at,actor,action,target,detail) SELECT clinic_id,?,?,'enrollment_revoked',?,NULL FROM enrollments WHERE code_hash=? AND clinic_id=? AND revoked_at=?").bind(now,admin.participantId,codeHash.slice(0,12),codeHash,admin.clinicId,now),
 ]);
 return revoked.meta.changes===1?json({revoked:true}):error('PERMISSION_DENIED',403);
}
/**
 * Deactivation is one conditional UPDATE, so two admins removing each other cannot both succeed: D1 serialises
 * writes and the second statement sees only one effective admin left. Sessions are revoked after the row is
 * inactive; the OIDC callback re-checks the row after creating a session, which closes the opposite ordering.
 */
export async function deactivateTherapist(env:Env,admin:Admin,participantId:string){
 const db=env.DIRECTORY!,now=Date.now();
 // 還原後 D1 可能把已停用的管理員算回「使用中」；最後一位管理員的判斷要扣掉 AUTH_DO 圍欄裡的人。
 // GPT-6 F1：這個扣除必須進到 D1 的條件 UPDATE 裡，否則兩位有效管理員同時互停時，交易內的 COUNT 會把圍欄內的人算進去。
 // 圍欄名單讀在交易外：期間只可能因重新加入而變短，名單過長只會讓判斷更保守（多擋，不會少擋）。
 const admins=(await db.prepare('SELECT participant_id AS participantId FROM therapists WHERE clinic_id=? AND is_admin=1 AND active=1').bind(admin.clinicId).all<{participantId:string}>()).results.map(r=>r.participantId);
 const fenced=await fence(env).deactivatedAmong(admins);
 const effectiveOthers=admins.filter(id=>id!==participantId&&!fenced.includes(id));
 if(admins.includes(participantId)&&!fenced.includes(participantId)&&effectiveOthers.length===0)return error('LAST_ADMIN',409);
 const fencedJson=JSON.stringify(fenced);
 const [changed]=await db.batch([
  db.prepare('UPDATE therapists SET active=0 WHERE participant_id=? AND clinic_id=? AND active=1 AND (is_admin=0 OR participant_id IN (SELECT value FROM json_each(?)) OR (SELECT COUNT(*) FROM therapists AS t WHERE t.clinic_id=? AND t.is_admin=1 AND t.active=1 AND t.participant_id<>? AND t.participant_id NOT IN (SELECT value FROM json_each(?)))>0)').bind(participantId,admin.clinicId,fencedJson,admin.clinicId,participantId,fencedJson),
  db.prepare("INSERT INTO admin_audit (clinic_id,at,actor,action,target,detail) SELECT clinic_id,?,?,'therapist_deactivated',participant_id,NULL FROM therapists WHERE participant_id=? AND clinic_id=? AND active=0 AND changes()=1").bind(now,admin.participantId,participantId,admin.clinicId),
 ]);
 if(changed.meta.changes!==1){
  const target=await db.prepare('SELECT is_admin AS isAdmin, active FROM therapists WHERE participant_id=? AND clinic_id=?').bind(participantId,admin.clinicId).first<{isAdmin:number;active:number}>();
  // 已是停用狀態（例如上一次在寫圍欄前中斷）：補寫圍欄並撤銷 session，讓重試能修復。
  if(target&&target.active===0){await fence(env).markDeactivated(participantId);await fence(env).revokeParticipant(participantId);}
  return target?.active===1&&target.isAdmin===1?error('LAST_ADMIN',409):error('PERMISSION_DENIED',403);
 }
 await fence(env).markDeactivated(participantId);
 // 先刪光 session 再通知房間；房間通知失敗只記 log（lookup 已查 pd，殘留的房內連線下一個指令就會被拒）。
 await fence(env).revokeParticipant(participantId);
 return json({deactivated:true});
}
