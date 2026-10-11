import {isLocalHost} from './asset-listing';
// 2026-10-09 使用者指示（Claude Opus 5.5）：只有已登入的治療師與持治療師邀請連結的案主可以使用沙盤。
// 部署主機一律強制；本機開發主機保留既有本機探索（E2E 依賴），?gate=1 可在本機強制開啟入口以測試。
// 真正的授權仍在 Worker（OIDC、邀請兌換、每個 /api 路由驗 session）；這裡只決定畫面，判定失敗一律不放行。
export type EntrySession={role:'therapist'|'client';roomId?:string|null};
export type SessionCheck={kind:'checking'}|{kind:'none'}|{kind:'error'}|{kind:'ok';session:EntrySession};
export type EntryView={view:'app'}|{view:'loading'}|{view:'title'}|{view:'error'}|{view:'invite';token:string}|{view:'redirect';search:string};
export function gateEnforced(hostname:string,search:string){return !isLocalHost(hostname)||new URLSearchParams(search).get('gate')==='1';}
export function inviteFromHash(hash:string){const token=new URLSearchParams(hash.replace(/^#/,'')).get('invite');return token&&token.trim()?token:null;}
/** 進房網址；本機以 ?gate=1 測試時保留該參數，讓房內畫面也經過入口判定。 */
export function roomSearch(roomId:string,search:string){const next=new URLSearchParams({room:roomId});if(new URLSearchParams(search).get('gate')==='1')next.set('gate','1');return '?'+next.toString();}
/** /api/session 的錯誤：401 UNAUTHENTICATED 才算「未登入」，其他（網路、5xx、非 JSON）顯示錯誤並可重試，不放行。 */
export function sessionFailure(cause:unknown):SessionCheck{return cause instanceof Error&&cause.message==='UNAUTHENTICATED'?{kind:'none'}:{kind:'error'};}
export function parseSession(value:unknown):SessionCheck{
 const v=value as {role?:unknown;roomId?:unknown}|null;
 if(!v||(v.role!=='therapist'&&v.role!=='client'))return {kind:'error'};
 return {kind:'ok',session:{role:v.role,roomId:typeof v.roomId==='string'?v.roomId:null}};
}
export function decideEntry({enforced,roomId,invite,check,search}:{enforced:boolean;roomId:string|null;invite:string|null;check:SessionCheck;search:string}):EntryView{
 if(!enforced)return {view:'app'};
 if(invite)return {view:'invite',token:invite};
 if(check.kind==='checking')return {view:'loading'};
 if(check.kind==='error')return {view:'error'};
 if(check.kind==='none')return {view:'title'};
 const {session}=check;
 if(session.role==='therapist')return {view:'app'};
 // 案主只能在自己受邀的那個房間；本機探索或別的房號都送回自己的房間（伺服器仍會拒絕跨房）。
 if(session.roomId)return roomId===session.roomId?{view:'app'}:{view:'redirect',search:roomSearch(session.roomId,search)};
 return {view:'title'};
}
