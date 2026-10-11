import {useEffect,useState,type ReactNode} from 'react';
import {api} from './shared-room';
import {decideEntry,gateEnforced,inviteFromHash,parseSession,roomSearch,sessionFailure,type SessionCheck} from './entry-decision';
import './entry-gate.css';
const GRAINS=Array.from({length:18},(_,i)=>i);
function Stage({children,view}:{children:ReactNode;view:string}){
 return <main className="entry" data-testid="entry-gate" data-view={view}>
  <div className="entry-sky" aria-hidden="true"><span className="entry-sun"/>{GRAINS.map(i=><i key={i} className="entry-grain" style={{['--i' as string]:i}}/>)}</div>
  <div className="entry-tray" aria-hidden="true"><div className="entry-tray-water"/><div className="entry-tray-sand"/></div>
  <section className="entry-panel">
   <p className="entry-kicker">SANDTRAY</p>
   <h1 className="entry-title">一方沙盤</h1>
   {children}
  </section>
  <p className="entry-foot">未登入無法使用沙盤。會談作品只在會談期間暫存，結束後刪除。</p>
 </main>;
}
function InviteCard({token}:{token:string}){
 const [policy,setPolicy]=useState<{policyVersion?:string}|null>(null),[failed,setFailed]=useState(false),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{let active=true;void api('/api/invites/inspect',{token}).then(value=>{if(active)setPolicy(value);}).catch(()=>{if(active)setFailed(true);});return()=>{active=false;};},[token]);
 async function enter(){setBusy(true);setNotice('');try{const result=await api('/api/invites/redeem',{token});location.search=roomSearch(result.id,location.search);}catch{setNotice('無法進入等候室，邀請可能剛失效，請向治療師索取新的邀請連結。');setBusy(false);}}
 return <div className="entry-card entry-invite">
  <p className="entry-role">案主 · 受邀進入</p>
  {!policy&&!failed&&<p className="entry-wait" role="status">正在確認邀請…</p>}
  {failed&&<><p role="alert" data-testid="invite-failed">這個邀請連結已無法使用（可能已過期、已被使用，或治療師已產生新的連結）。請向治療師索取新的邀請連結。</p><a className="entry-ghost" href="/">回到入口</a></>}
  {policy&&<>
   <p>治療師邀請你一起使用沙盤。會談期間暫存；治療師結束會談或無人操作兩小時後，作品會從伺服器刪除。</p>
   <p className="entry-small">政策版本：{policy.policyVersion}</p>
   <label className="entry-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>我知道指定治療師看得到作品，已閱讀並同意上述保存政策；我可隨時收回操作權。</label>
   <button className="entry-start" disabled={!consent||busy} onClick={()=>void enter()}>{busy?'正在進入…':'進入等候室'}</button>
  </>}
  {notice&&<p role="alert">{notice}</p>}
 </div>;
}
export function EntryGate({children}:{children:ReactNode}){
 const [enforced]=useState(()=>gateEnforced(location.hostname,location.search));
 // 邀請 token 只讀一次就從網址列移除（不留在瀏覽紀錄）；本機未強制時交給 SessionTools 照舊處理。
 const [invite]=useState(()=>enforced?inviteFromHash(location.hash):null);
 const [check,setCheck]=useState<SessionCheck>({kind:'checking'});
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{if(enforced&&invite)history.replaceState(null,'',location.pathname+location.search);},[enforced,invite]);
 useEffect(()=>{if(!enforced||invite)return;let active=true;setCheck({kind:'checking'});void api('/api/session').then(value=>{if(active)setCheck(parseSession(value));}).catch(cause=>{if(active)setCheck(sessionFailure(cause));});return()=>{active=false;};},[enforced,invite,attempt]);
 const roomId=new URLSearchParams(location.search).get('room');
 const decision=decideEntry({enforced,roomId,invite,check,search:location.search});
 useEffect(()=>{if(decision.view==='redirect')location.search=decision.search;},[decision.view,decision.view==='redirect'?decision.search:'']);
 if(decision.view==='app')return <>{children}</>;
 if(decision.view==='invite')return <Stage view="invite"><InviteCard token={decision.token}/></Stage>;
 if(decision.view==='loading'||decision.view==='redirect')return <Stage view={decision.view}><p className="entry-wait" role="status">正在確認身分…</p></Stage>;
 if(decision.view==='error')return <Stage view="error"><div className="entry-card"><p role="alert">暫時無法連線伺服器，沒有確認身分前不能進入沙盤。</p><button className="entry-start" onClick={()=>setAttempt(n=>n+1)}>重試</button></div></Stage>;
 return <Stage view="title">
  <p className="entry-tagline">在沙裡擺放，慢慢說出還說不出口的事。</p>
  {new URLSearchParams(location.search).get('enroll')==='invalid'&&<p className="entry-card" role="alert" data-testid="enroll-invalid">這個加入連結已無法使用（可能已過期、已被使用或已作廢）。請向管理員索取新的連結。</p>}
  <div className="entry-roles">
   <div className="entry-card">
    <p className="entry-role">治療師</p>
    <p>以診所帳號登入後建立會談並邀請案主。</p>
    <a className="entry-start" href="/auth/login">登入開始</a>
   </div>
   <div className="entry-card entry-card-quiet">
    <p className="entry-role">案主</p>
    <p>請開啟治療師傳給你的邀請連結，不需要帳號。</p>
    <span className="entry-lock" aria-hidden="true"/>
   </div>
  </div>
 </Stage>;
}
