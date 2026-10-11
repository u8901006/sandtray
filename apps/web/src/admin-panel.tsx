import {useCallback,useEffect,useState} from 'react';
import {api} from './shared-room';
import './admin-panel.css';
// 2026-10-11 使用者裁定：治療師以「加入碼＋Google 登入」加入；本頁只是畫面，管理權每個請求都由 Worker 向 D1 重驗。
type Therapist={participantId:string;displayName:string|null;isAdmin:boolean;active:boolean};
type Enrollment={id:string;displayName:string;grantAdmin:boolean;createdAt:number;expiresAt:number};
type Audit={at:number;actor:string;action:string;target:string;detail:string|null};
type Directory={me:string;therapists:Therapist[];enrollments:Enrollment[];audit:Audit[]};
const ACTIONS:Record<string,string>={enrollment_created:'產生加入連結',enrollment_revoked:'作廢加入連結',enrollment_redeemed:'完成加入',therapist_deactivated:'停用治療師'};
const ERRORS:Record<string,string>={LAST_ADMIN:'這是最後一位管理員，不能停用。請先加入另一位管理員。',PERMISSION_DENIED:'找不到這筆資料，或你已沒有管理權限。重新整理後再試。',INVALID_PAYLOAD:'名字需要 1 到 60 個字。',UNAUTHENTICATED:'登入已失效，請重新登入。'};
const time=(ms:number)=>new Date(ms).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
export function AdminPanel(){
 const [state,setState]=useState<'loading'|'login'|'denied'|'error'|'ready'>('loading'),[data,setData]=useState<Directory|null>(null);
 const [name,setName]=useState(''),[grantAdmin,setGrantAdmin]=useState(false),[link,setLink]=useState<{link:string;name:string;expiresAt:number}|null>(null);
 const [confirm,setConfirm]=useState<Therapist|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false);
 const load=useCallback(async()=>{try{setData(await api('/api/admin/directory'));setState('ready');}catch(cause){const code=cause instanceof Error?cause.message:'';setState(code==='UNAUTHENTICATED'?'login':code==='PERMISSION_DENIED'?'denied':'error');}},[]);
 useEffect(()=>{void load();},[load]);
 async function run(action:()=>Promise<void>){setBusy(true);setNotice('');try{await action();await load();}catch(cause){const code=cause instanceof Error?cause.message:'';setNotice(ERRORS[code]??'操作沒有完成，請稍後再試。');}finally{setBusy(false);}}
 const create=()=>run(async()=>{const result=await api('/api/admin/enrollments',{displayName:name.trim(),grantAdmin});setLink({link:result.link,name:name.trim(),expiresAt:result.expiresAt});setCopied(false);setName('');setGrantAdmin(false);});
 async function copy(){if(!link)return;try{await navigator.clipboard.writeText(link.link);setCopied(true);}catch{setCopied(false);}}
 if(state!=='ready'||!data)return <main className="admin admin-center" data-testid="admin-panel" data-state={state}>
  {state==='loading'&&<p role="status">正在確認管理權限…</p>}
  {state==='login'&&<><p>請先以管理員的 Google 帳號登入。</p><a className="admin-primary" href="/auth/login">登入</a></>}
  {state==='denied'&&<><p role="alert">這個帳號沒有管理權限。</p><a href="/">回到沙盤</a></>}
  {state==='error'&&<><p role="alert">暫時無法讀取帳號資料。</p><button className="admin-primary" onClick={()=>{setState('loading');void load();}}>重試</button></>}
 </main>;
 const active=data.therapists.filter(t=>t.active),inactive=data.therapists.filter(t=>!t.active);
 return <main className="admin" data-testid="admin-panel" data-state="ready">
  <header className="admin-head"><div><p className="admin-kicker">一方沙盤 · 帳號管理</p><h1>治療師與管理員</h1></div><a href="/">回到沙盤</a></header>
  {notice&&<p className="admin-notice" role="alert">{notice}</p>}
  <section className="admin-block" aria-labelledby="admin-add">
   <h2 id="admin-add">新增治療師</h2>
   <p className="admin-hint">產生一次性連結，傳給對方。對方點開後用自己的 Google 帳號登入，就會加入名單。連結 24 小時內有效，只能用一次。</p>
   <form className="admin-form" onSubmit={e=>{e.preventDefault();if(name.trim())void create();}}>
    <label htmlFor="admin-name">名字（只給你辨認用）</label>
    <input id="admin-name" value={name} maxLength={60} onChange={e=>setName(e.target.value)} placeholder="例如：王治療師"/>
    <label className="admin-check" htmlFor="admin-grant"><input id="admin-grant" type="checkbox" checked={grantAdmin} onChange={e=>setGrantAdmin(e.target.checked)}/>同時給管理權限</label>
    <button className="admin-primary" disabled={busy||!name.trim()}>產生加入連結</button>
   </form>
   {link&&<div className="admin-link" data-testid="admin-new-link">
    <p>給 <strong>{link.name}</strong> 的加入連結，{time(link.expiresAt)} 前有效。這個連結只會顯示這一次。</p>
    <input id="admin-link-value" aria-label="加入連結" readOnly value={link.link} onFocus={e=>e.target.select()}/>
    <button onClick={()=>void copy()}>{copied?'已複製':'複製連結'}</button>
   </div>}
  </section>
  <section className="admin-block" aria-labelledby="admin-list">
   <h2 id="admin-list">使用中（{active.length}）</h2>
   <ul className="admin-rows">{active.map(t=><li key={t.participantId} data-testid="admin-therapist">
    <span className="admin-name">{t.displayName??'（未命名）'}{t.participantId===data.me&&<em>（你）</em>}</span>
    <span className={t.isAdmin?'admin-pill admin-pill-admin':'admin-pill'}>{t.isAdmin?'管理員':'治療師'}</span>
    {confirm?.participantId===t.participantId
     ?<span className="admin-confirm">停用後對方立刻登出，之後無法登入。<button className="admin-danger" disabled={busy} onClick={()=>void run(async()=>{await api(`/api/admin/therapists/${t.participantId}/deactivate`,{});setConfirm(null);})}>確定停用</button><button onClick={()=>setConfirm(null)}>取消</button></span>
     :<button className="admin-quiet" disabled={busy} onClick={()=>setConfirm(t)}>停用</button>}
   </li>)}</ul>
  </section>
  <section className="admin-block" aria-labelledby="admin-pending">
   <h2 id="admin-pending">等待加入（{data.enrollments.length}）</h2>
   {data.enrollments.length===0?<p className="admin-hint">目前沒有尚未使用的加入連結。</p>:
   <ul className="admin-rows">{data.enrollments.map(e=><li key={e.id} data-testid="admin-enrollment">
    <span className="admin-name">{e.displayName}</span>
    <span className="admin-pill admin-pill-wait">{e.grantAdmin?'管理員':'治療師'} · {time(e.expiresAt)} 到期</span>
    <button className="admin-quiet" disabled={busy} onClick={()=>void run(async()=>{await api(`/api/admin/enrollments/${e.id}/revoke`,{});})}>作廢連結</button>
   </li>)}</ul>}
  </section>
  {inactive.length>0&&<section className="admin-block" aria-labelledby="admin-off">
   <h2 id="admin-off">已停用（{inactive.length}）</h2>
   <p className="admin-hint">要讓已停用的人回來，請重新產生加入連結給他。</p>
   <ul className="admin-rows">{inactive.map(t=><li key={t.participantId}><span className="admin-name">{t.displayName??'（未命名）'}</span><span className="admin-pill">已停用</span></li>)}</ul>
  </section>}
  <section className="admin-block" aria-labelledby="admin-audit">
   <h2 id="admin-audit">紀錄</h2>
   <ul className="admin-audit">{data.audit.map((a,i)=><li key={i}><time>{time(a.at)}</time> {ACTIONS[a.action]??a.action}{a.detail==='admin'?'（管理員）':''}</li>)}</ul>
  </section>
 </main>;
}
