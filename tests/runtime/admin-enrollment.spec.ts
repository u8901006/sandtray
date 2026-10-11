import {test,expect,type APIRequestContext} from '@playwright/test';
import {readFileSync} from 'node:fs';
// 2026-10-11 使用者裁定（Claude Opus 5.5 實作）：治療師以「加入碼＋Google 登入」加入，單一診所，多位管理員。
// ID token 驗證已有 unit 測試（oidc.test.ts）；這裡用 /__test/oidc-finish 帶假 subject 走真正的 finishLogin／redeemEnrollment。
const origin='http://127.0.0.1:8788',issuer='https://accounts.google.test';
const sql=(file:string)=>readFileSync(new URL(`../../apps/worker/migrations/${file}`,import.meta.url),'utf8').split('\n').filter(line=>!line.trim().startsWith('--')).join('\n').split(';').map(s=>s.trim()).filter(Boolean);
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
async function exec(api:APIRequestContext,...statements:string[]){const response=await api.post('/__test/d1-exec',{data:{statements}});expect(response.status(),await response.text()).toBe(200);return (await response.json()).results as unknown[][];}
async function as(playwright:{request:{newContext:(o:{baseURL:string})=>Promise<APIRequestContext>}},name:'therapist'|'other'|'outsider'){const api=await playwright.request.newContext({baseURL:origin});expect((await api.post('/__test/login',{data:{name}})).status()).toBe(200);return api;}
async function finish(api:APIRequestContext,subject:string,code?:string){return api.post('/__test/oidc-finish',{data:{subject,...(code?{code}:{})},maxRedirects:0});}
const codeOf=(link:string)=>new URL(link).searchParams.get('code')!;
async function enroll(admin:APIRequestContext,displayName:string,grantAdmin=false){const response=await post(admin,'/api/admin/enrollments',{displayName,grantAdmin});expect(response.status(),await response.text()).toBe(200);return await response.json() as {id:string;link:string;expiresAt:number};}
test.describe.configure({mode:'serial'});
test.beforeEach(async({request})=>{
 expect((await request.post('/__test/clear-deactivated',{data:{ids:['therapist','other','outsider']}})).status()).toBe(200);
 await exec(request,...sql('0001_directory.sql'),...sql('0006_admin_enrollment.sql'));
 await exec(request,'DELETE FROM enrollments','DELETE FROM admin_audit','DELETE FROM therapists','DELETE FROM clinics',
  "INSERT INTO clinics VALUES ('clinic-a'),('clinic-b')",
  `INSERT INTO therapists (participant_id,clinic_id,issuer,subject,active,is_admin,display_name) VALUES ('therapist','clinic-a','${issuer}','sub-therapist',1,1,'主管理員'),('other','clinic-a','${issuer}','sub-other',1,0,'一般治療師'),('outsider','clinic-b','${issuer}','sub-outsider',1,1,'別診所管理員')`);
});
test.afterAll(async({request})=>{await exec(request,'DELETE FROM enrollments','DELETE FROM admin_audit','DELETE FROM therapists','DELETE FROM clinics');});

test('only an active administrator reaches /api/admin; others get 401/403 and see no admin flag',async({request,playwright})=>{
 const anonymous=await playwright.request.newContext({baseURL:origin});
 expect((await anonymous.get('/api/admin/directory')).status()).toBe(401);
 expect((await anonymous.get('/api/admin/me')).status()).toBe(401);
 const other=await as(playwright,'other');
 expect(await (await other.get('/api/admin/me')).json()).toEqual({isAdmin:false});
 expect((await other.get('/api/admin/directory')).status()).toBe(403);
 expect((await post(other,'/api/admin/enrollments',{displayName:'偷加',grantAdmin:true})).status()).toBe(403);
 expect((await post(other,'/api/admin/therapists/therapist/deactivate')).status()).toBe(403);
 // 案主 session（role client）不能進後台
 const admin=await as(playwright,'therapist');
 const {id}=await (await post(admin,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json();
 const {token}=await (await post(admin,`/api/rooms/${id}/invites`)).json();
 const client=await playwright.request.newContext({baseURL:origin});
 expect((await post(client,'/api/invites/redeem',{token,acceptedPolicyVersion:'dev-v1'})).status()).toBe(200);
 expect((await client.get('/api/admin/directory')).status()).toBe(403);
 await post(admin,`/api/rooms/${id}/close`);
 // 管理權在每個請求都重查 D1：降級立即生效，不必重新登入
 expect(await (await admin.get('/api/admin/me')).json()).toEqual({isAdmin:true});
 await exec(request,"UPDATE therapists SET is_admin=0 WHERE participant_id='therapist'");
 expect((await admin.get('/api/admin/directory')).status()).toBe(403);
 expect(await (await admin.get('/api/admin/me')).json()).toEqual({isAdmin:false});
});

test('an enrollment link binds a new Google identity once; the raw code is never stored',async({request,playwright})=>{
 const admin=await as(playwright,'therapist');
 const created=await enroll(admin,'王治療師');
 expect(created.link.startsWith(origin+'/auth/enroll?code=')).toBe(true);
 const code=codeOf(created.link);expect(code).toMatch(/^[a-f0-9]{64}$/);
 const stored=await exec(request,'SELECT * FROM enrollments');
 expect(JSON.stringify(stored)).not.toContain(code);
 expect((await (await admin.get('/api/admin/directory')).json()).enrollments.map((e:{displayName:string})=>e.displayName)).toEqual(['王治療師']);
 // 尚未加入前，這個 Google 身分登入會被擋
 const newcomer=await playwright.request.newContext({baseURL:origin});
 expect((await finish(newcomer,'sub-new')).status()).toBe(401);
 const joined=await finish(newcomer,'sub-new',code);
 expect(joined.status()).toBe(302);expect(joined.headers().location).toBe('/');
 const session=await (await newcomer.get('/api/session')).json();
 expect(session.role).toBe('therapist');
 const directory=await (await admin.get('/api/admin/directory')).json();
 const row=directory.therapists.find((t:{participantId:string})=>t.participantId===session.participantId);
 expect(row).toEqual({participantId:session.participantId,displayName:'王治療師',isAdmin:false,active:true});
 expect(directory.enrollments).toEqual([]);
 expect(directory.audit.map((a:{action:string})=>a.action)).toEqual(['enrollment_redeemed','enrollment_created']);
 expect(await (await newcomer.get('/api/admin/me')).json()).toEqual({isAdmin:false});
 // 同一個碼第二次（另一個 Google 身分）：不寫入，導回 /?enroll=invalid，且該身分仍無法登入
 const thief=await playwright.request.newContext({baseURL:origin});
 const reused=await finish(thief,'sub-thief',code);
 expect(reused.status()).toBe(302);expect(reused.headers().location).toBe('/?enroll=invalid');
 expect((await finish(thief,'sub-thief')).status()).toBe(401);
 expect(await exec(request,"SELECT COUNT(*) AS n FROM therapists WHERE subject='sub-thief'")).toEqual([[{n:0}]]);
 // 已加入者之後一般登入（不帶碼）照常成功
 expect((await finish(newcomer,'sub-new')).status()).toBe(302);
});

test('revoked, expired, and other-clinic codes cannot be redeemed or revoked across clinics',async({request,playwright})=>{
 const admin=await as(playwright,'therapist'),outsider=await as(playwright,'outsider');
 const revoked=await enroll(admin,'作廢者');
 expect((await post(outsider,`/api/admin/enrollments/${revoked.id}/revoke`)).status()).toBe(403);
 expect((await post(admin,`/api/admin/enrollments/${revoked.id}/revoke`)).status()).toBe(200);
 expect((await post(admin,`/api/admin/enrollments/${revoked.id}/revoke`)).status()).toBe(403);
 const visitor=await playwright.request.newContext({baseURL:origin});
 expect((await finish(visitor,'sub-revoked',codeOf(revoked.link))).headers().location).toBe('/?enroll=invalid');
 const expired=await enroll(admin,'過期者');
 await exec(request,`UPDATE enrollments SET expires_at=${Date.now()-1} WHERE code_hash='${expired.id}'`);
 expect((await finish(visitor,'sub-expired',codeOf(expired.link))).headers().location).toBe('/?enroll=invalid');
 expect(await exec(request,"SELECT COUNT(*) AS n FROM therapists WHERE subject IN ('sub-revoked','sub-expired')")).toEqual([[{n:0}]]);
 // 別診所管理員看不到 clinic-a 的名單與加入碼
 const seen=await (await outsider.get('/api/admin/directory')).json();
 expect(seen.therapists.map((t:{participantId:string})=>t.participantId)).toEqual(['outsider']);
 expect(seen.enrollments).toEqual([]);
 // 格式錯誤的輸入
 expect((await post(admin,'/api/admin/enrollments',{displayName:'',grantAdmin:false})).status()).toBe(400);
 expect((await post(admin,'/api/admin/enrollments',{displayName:'x'.repeat(61),grantAdmin:false})).status()).toBe(400);
 expect((await post(admin,'/api/admin/enrollments',{displayName:'多欄位',grantAdmin:false,clinicId:'clinic-b'})).status()).toBe(400);
});

test('deactivation revokes live sessions at once, blocks login, and a new code reactivates the same identity',async({request,playwright})=>{
 const admin=await as(playwright,'therapist'),outsider=await as(playwright,'outsider');
 const created=await enroll(admin,'將被停用者');
 const person=await playwright.request.newContext({baseURL:origin});
 await finish(person,'sub-leaving',codeOf(created.link));
 const second=await playwright.request.newContext({baseURL:origin});await finish(second,'sub-leaving');
 const {participantId}=await (await person.get('/api/session')).json();
 expect((await second.get('/api/session')).status()).toBe(200);
 // 別診所管理員不能停用 clinic-a 的人
 expect((await post(outsider,`/api/admin/therapists/${participantId}/deactivate`)).status()).toBe(403);
 expect((await person.get('/api/session')).status()).toBe(200);
 expect((await post(admin,`/api/admin/therapists/${participantId}/deactivate`)).status()).toBe(200);
 expect((await person.get('/api/session')).status()).toBe(401);
 expect((await second.get('/api/session')).status()).toBe(401);
 expect((await finish(person,'sub-leaving')).status()).toBe(401);
 expect((await post(admin,`/api/admin/therapists/${participantId}/deactivate`)).status()).toBe(403);
 const audit=(await (await admin.get('/api/admin/directory')).json()).audit as {action:string;target:string}[];
 expect(audit.filter(a=>a.action==='therapist_deactivated')).toEqual([expect.objectContaining({target:participantId})]);
 // 重新發碼：同一個 Google 身分回來，participantId 不變
 const again=await enroll(admin,'回來的人');
 expect((await finish(person,'sub-leaving',codeOf(again.link))).headers().location).toBe('/');
 expect((await (await person.get('/api/session')).json()).participantId).toBe(participantId);
});

test('an admin code grants admin; the last active admin cannot be removed, even by two admins at once',async({request,playwright})=>{
 const admin=await as(playwright,'therapist');
 expect(await (await post(admin,'/api/admin/therapists/therapist/deactivate')).json()).toEqual(expect.objectContaining({code:'LAST_ADMIN'}));
 const backup=await enroll(admin,'備用管理員',true);
 const backupApi=await playwright.request.newContext({baseURL:origin});
 await finish(backupApi,'sub-backup',codeOf(backup.link));
 const backupId=(await (await backupApi.get('/api/session')).json()).participantId;
 expect(await (await backupApi.get('/api/admin/me')).json()).toEqual({isAdmin:true});
 // 兩位管理員同時停用對方：只能成功一個，診所永遠留有一位管理員
 const [a,b]=await Promise.all([post(admin,`/api/admin/therapists/${backupId}/deactivate`),post(backupApi,'/api/admin/therapists/therapist/deactivate')]);
 const statuses=[a.status(),b.status()].sort();
 expect(statuses[0]).toBe(200);expect([401,403,409]).toContain(statuses[1]);
 const left=await exec(request,"SELECT COUNT(*) AS n FROM therapists WHERE clinic_id='clinic-a' AND is_admin=1 AND active=1");
 expect(left).toEqual([[{n:1}]]);
});

// GPT-6 2026-10-11 SPEC CONFLICT：D1 Time Travel 還原不得復活已用／作廢的加入碼或已停用的帳號。
// 以直接把 D1 列改回舊值模擬還原；AUTH_DO 的圍欄不受 D1 還原影響，必須仍然擋下。
test('a D1 restore cannot resurrect a used or revoked code, or a deactivated therapist',async({request,playwright})=>{
 const admin=await as(playwright,'therapist');
 const used=await enroll(admin,'已用者'),revoked=await enroll(admin,'作廢者');
 const first=await playwright.request.newContext({baseURL:origin});
 expect((await finish(first,'sub-first',codeOf(used.link))).headers().location).toBe('/');
 expect((await post(admin,`/api/admin/enrollments/${revoked.id}/revoke`)).status()).toBe(200);
 await exec(request,'UPDATE enrollments SET used_at=NULL, used_by=NULL, revoked_at=NULL');
 const thief=await playwright.request.newContext({baseURL:origin});
 expect((await finish(thief,'sub-thief-1',codeOf(used.link))).headers().location).toBe('/?enroll=invalid');
 expect((await finish(thief,'sub-thief-2',codeOf(revoked.link))).headers().location).toBe('/?enroll=invalid');
 expect(await exec(request,"SELECT COUNT(*) AS n FROM therapists WHERE subject LIKE 'sub-thief%'")).toEqual([[{n:0}]]);
 // 停用一位管理員後把 D1 改回「使用中」：仍不能登入、不能進後台，名單顯示已停用，也不算進「還有其他管理員」
 const backup=await enroll(admin,'被停用的管理員',true);
 const backupApi=await playwright.request.newContext({baseURL:origin});
 await finish(backupApi,'sub-backup',codeOf(backup.link));
 const backupId=(await (await backupApi.get('/api/session')).json()).participantId;
 expect((await post(admin,`/api/admin/therapists/${backupId}/deactivate`)).status()).toBe(200);
 await exec(request,`UPDATE therapists SET active=1 WHERE participant_id='${backupId}'`);
 expect((await finish(backupApi,'sub-backup')).status()).toBe(401);
 const directory=await (await admin.get('/api/admin/directory')).json();
 expect(directory.therapists.find((t:{participantId:string})=>t.participantId===backupId).active).toBe(false);
 expect(await (await post(admin,'/api/admin/therapists/therapist/deactivate')).json()).toEqual(expect.objectContaining({code:'LAST_ADMIN'}));
 // 以 /__test/login 直接拿到 session 也一樣：管理權必須同時通過 D1 與圍欄
 await exec(request,"UPDATE therapists SET active=1, is_admin=1 WHERE participant_id='other'");
 expect((await post(admin,'/api/admin/therapists/other/deactivate')).status()).toBe(200);
 await exec(request,"UPDATE therapists SET active=1 WHERE participant_id='other'");
 // GPT-6 F2 之後：停用者的 session 在 AUTH_DO lookup 就失效（401），比只擋管理權（403）更早拒絕。
 const other=await as(playwright,'other');
 expect((await other.get('/api/admin/directory')).status()).toBe(401);
 // 管理員重新發碼給同一人：圍欄解除，可以回來
 const again=await enroll(admin,'回來的管理員',true);
 expect((await finish(backupApi,'sub-backup',codeOf(again.link))).headers().location).toBe('/');
 expect(await (await backupApi.get('/api/admin/me')).json()).toEqual({isAdmin:true});
});

// 2026-10-11 GPT-6 REQUEST_CHANGES F1–F6：審查反證改成回歸測試，斷言的是不變式（原本「bug 重現」的反面）。
const fenced=async(api:APIRequestContext,id:string)=>(await (await api.post('/__test/admin-fence-status',{data:{id}})).json()).fenced as boolean;

test('F1: a restored-but-fenced admin is not counted; two admins removing each other leave one effective admin',async({request,playwright})=>{
 await exec(request,"UPDATE therapists SET is_admin=1 WHERE participant_id='other'",`INSERT INTO therapists (participant_id,clinic_id,issuer,subject,active,is_admin) VALUES ('ghost','clinic-a','${issuer}','sub-ghost',1,1)`);
 await request.post('/__test/admin-fence',{data:{id:'ghost'}});
 const a=await as(playwright,'therapist'),b=await as(playwright,'other');
 await request.post('/__test/admin-gate',{data:{action:'two'}});
 const responses=await Promise.all([post(a,'/api/admin/therapists/other/deactivate'),post(b,'/api/admin/therapists/therapist/deactivate')]);
 const statuses=responses.map(r=>r.status()).sort();
 expect(statuses[0]).toBe(200);expect([401,403,409]).toContain(statuses[1]);
 const live=(await exec(request,"SELECT participant_id AS id FROM therapists WHERE clinic_id='clinic-a' AND is_admin=1 AND active=1"))[0] as {id:string}[];
 const effective:string[]=[];for(const {id} of live)if(!await fenced(request,id))effective.push(id);
 expect(effective).toHaveLength(1);
 // 只剩一位有效管理員時，仍可停用 D1 顯示使用中、但已在圍欄內的 ghost（它本來就不算數）
 const survivor=effective[0]==='therapist'?a:b;
 expect((await post(survivor,'/api/admin/therapists/ghost/deactivate')).status()).toBe(200);
 expect(await (await post(survivor,`/api/admin/therapists/${effective[0]}/deactivate`)).json()).toEqual(expect.objectContaining({code:'LAST_ADMIN'}));
});

test('F2: a failing room notification still revokes every session, and a fenced participant session is never accepted',async({request,playwright})=>{
 const admin=await as(playwright,'therapist');
 const roomId='admin-f2-room';
 const {tokens}=await (await request.post('/__test/admin-seed-sessions',{data:{id:'other',clinicId:'clinic-a',roomId}})).json() as {tokens:string[]};
 const withCookie=(token:string)=>({headers:{Cookie:'sandtray_session='+token}});
 const probe=await playwright.request.newContext({baseURL:origin});
 for(const token of tokens)expect((await probe.get('/api/session',withCookie(token))).status()).toBe(200);
 await request.post('/__test/admin-room-failure',{data:{roomId,fail:true}});
 try{
  expect((await post(admin,'/api/admin/therapists/other/deactivate')).status()).toBe(200);
 }finally{await request.post('/__test/admin-room-failure',{data:{roomId,fail:false}});}
 expect((await (await request.post('/__test/admin-sessions',{data:{id:'other'}})).json()).count).toBe(0);
 for(const token of tokens){
  expect((await probe.get('/api/session',withCookie(token))).status()).toBe(401);
  expect((await probe.post('/api/rooms',{data:{retentionMode:'session-only',policyVersion:'dev-v1'},headers:{Origin:origin,Cookie:'sandtray_session='+token}})).status()).toBe(401);
 }
 // 圍欄存在但 session 還沒被撤（例如撤銷前中斷）：lookup 本身就拒絕
 await exec(request,"UPDATE therapists SET active=1 WHERE participant_id='other'");
 const leftover=await as(playwright,'other');
 expect((await leftover.get('/api/session')).status()).toBe(401);
});

test('F3: an older re-enrollment cannot erase a newer deactivation fence',async({request,playwright})=>{
 const admin=await as(playwright,'therapist'),person=await playwright.request.newContext({baseURL:origin});
 expect((await post(admin,'/api/admin/therapists/other/deactivate')).status()).toBe(200);
 const created=await enroll(admin,'回來又被停用');
 await request.post('/__test/admin-gate',{data:{action:'hold-clear'}});
 const pending=finish(person,'sub-other',codeOf(created.link));
 try{
  await expect.poll(async()=>(await (await request.post('/__test/admin-gate',{data:{action:'status'}})).json()).clearReached).toBe(true);
  expect((await post(admin,'/api/admin/therapists/other/deactivate')).status()).toBe(200);
 }finally{await request.post('/__test/admin-gate',{data:{action:'release-clear'}});}
 expect((await pending).status()).toBe(401);
 expect(await fenced(request,'other')).toBe(true);
 await exec(request,"UPDATE therapists SET active=1 WHERE participant_id='other'");
 expect((await finish(person,'sub-other')).status()).toBe(401);
});

test('F4: another clinic code neither consumes itself nor clears a foreign deactivation fence',async({request,playwright})=>{
 const admin=await as(playwright,'therapist'),outsiderAdmin=await as(playwright,'outsider');
 await exec(request,`INSERT INTO therapists (participant_id,clinic_id,issuer,subject,active,is_admin) VALUES ('b-staff','clinic-b','${issuer}','sub-b-staff',1,0)`);
 expect((await post(outsiderAdmin,'/api/admin/therapists/b-staff/deactivate')).status()).toBe(200);
 const created=await enroll(admin,'給 A 診所的新人');
 const person=await playwright.request.newContext({baseURL:origin});
 expect((await finish(person,'sub-b-staff',codeOf(created.link))).headers().location).toBe('/?enroll=invalid');
 expect(await fenced(request,'b-staff')).toBe(true);
 expect(await exec(request,`SELECT used_at,used_by FROM enrollments WHERE code_hash='${created.id}'`)).toEqual([[{used_at:null,used_by:null}]]);
 expect(await exec(request,"SELECT clinic_id,active FROM therapists WHERE subject='sub-b-staff'")).toEqual([[{clinic_id:'clinic-b',active:0}]]);
 await exec(request,"UPDATE therapists SET active=1 WHERE participant_id='b-staff'");
 expect((await finish(person,'sub-b-staff')).status()).toBe(401);
 // 正當的人仍能用這個碼
 const newcomer=await playwright.request.newContext({baseURL:origin});
 expect((await finish(newcomer,'sub-a-new',codeOf(created.link))).headers().location).toBe('/');
});

test('F5: a rolled-back redeem leaves the code retryable, while a committed one stays fenced across a D1 restore',async({request,playwright})=>{
 const admin=await as(playwright,'therapist'),person=await playwright.request.newContext({baseURL:origin});
 const created=await enroll(admin,'重試者');
 await exec(request,"CREATE TRIGGER admin_f5_fail BEFORE INSERT ON admin_audit WHEN NEW.action='enrollment_redeemed' BEGIN SELECT RAISE(ABORT,'injected redeem rollback'); END");
 try{
  expect((await finish(person,'sub-retry',codeOf(created.link))).headers().location).toBe('/?enroll=invalid');
 }finally{await exec(request,'DROP TRIGGER IF EXISTS admin_f5_fail');}
 expect(await exec(request,`SELECT used_at,revoked_at FROM enrollments WHERE code_hash='${created.id}'`)).toEqual([[{used_at:null,revoked_at:null}]]);
 expect(await exec(request,"SELECT COUNT(*) AS n FROM therapists WHERE subject='sub-retry'")).toEqual([[{n:0}]]);
 expect((await finish(person,'sub-retry',codeOf(created.link))).headers().location).toBe('/');
 await exec(request,`UPDATE enrollments SET used_at=NULL, used_by=NULL WHERE code_hash='${created.id}'`);
 const thief=await playwright.request.newContext({baseURL:origin});
 expect((await finish(thief,'sub-retry-thief',codeOf(created.link))).headers().location).toBe('/?enroll=invalid');
});

test('F6: a permanent deactivation marker is never scheduled as an alarm date',async({request})=>{
 const result=await (await request.post('/__test/admin-only-permanent',{data:{}})).json();
 expect(result).toEqual({error:null,result:{revoked:0,notifyFailed:0},alarm:null,fenced:true});
});
