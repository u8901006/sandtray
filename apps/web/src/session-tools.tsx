import {useEffect,useState,useRef} from 'react';
import {api,useSharedRoom} from './shared-room';
import {resolveAsset,creditsText} from '../../../packages/asset-catalog/src/index';
import {TraySetup,STANDARD_ROOM_TRAYS} from './tray-setup';
import {requestObjectLabel} from './request-label';
import {roomTraysSchema,type RoomTrays} from '../../../packages/protocol/src/index';
export function SessionTools({roomId,shared,selected,capturePng,settleWater,onNotice}:{roomId:string|null;shared:ReturnType<typeof useSharedRoom>;selected?:string;capturePng:(expectedRevision:number)=>Promise<Blob>;settleWater?:()=>Promise<number|undefined>;onNotice?:(notice:string)=>void}){
 const [session,setSession]=useState<any>(null),[invite,setInvite]=useState(''),[incoming]=useState(()=>new URLSearchParams(location.hash.slice(1)).get('invite')),[consent,setConsent]=useState(false),[notice,setNotice]=useState('');
 // 2026-10-11：只有管理員看得到「帳號管理」；這只是連結顯示，/admin 與 /api/admin 由 Worker 重驗。
 const [isAdmin,setIsAdmin]=useState(false);
 useEffect(()=>{if(session?.role!=='therapist'){setIsAdmin(false);return;}let active=true;void api('/api/admin/me').then(value=>{if(active)setIsAdmin(value.isAdmin===true);}).catch(()=>{if(active)setIsAdmin(false);});return()=>{active=false;};},[session?.role]);
 const [pngBusy,setPngBusy]=useState(false);const [trays,setTrays]=useState<RoomTrays>(STANDARD_ROOM_TRAYS);
 const latestShared=useRef(shared);latestShared.current=shared;
 // GPT-6 review 2026-10-10 F1: an operation can fail after the top panels were collapsed; the parent mirrors the notice on the collapsed bar.
 useEffect(()=>{onNotice?.(notice);},[notice,onNotice]);
 const [invitePolicy,setInvitePolicy]=useState<any>(null);const [inviteFailed,setInviteFailed]=useState(false);
 useEffect(()=>{let active=true;if(incoming)void api('/api/invites/inspect',{token:incoming}).then(value=>{if(active){setInvitePolicy(value);setConsent(false);}}).catch(()=>{if(active)setInviteFailed(true);});return()=>{active=false;};},[incoming]);
 useEffect(()=>{if(location.hash)history.replaceState(null,'',location.pathname+location.search);void api('/api/session').then(setSession).catch(()=>{});},[]);
 async function run(fn:()=>Promise<unknown>){try{await fn();setNotice('');}catch(e){setNotice(e instanceof Error?e.message:'操作失敗');}}
 async function exportPng(){
  setPngBusy(true);
  try{
   const state=latestShared.current;
   if(!state.connected||!state.scene||state.hasUnconfirmedOperations())throw new Error('請等待作品同步完成後匯出。');
   const sceneId=state.info.sceneId,revision=state.scene.sceneRevision,consentVersion=state.info.exportConsent?.version??'self';
   const request={format:'png',consentVersion,expectedSceneRevision:revision};
   const authorize=async()=>{
    const result=await api('/api/scenes/'+sceneId+'/exports',request);
    if(result.authorized!==true||result.sceneRevision!==revision)throw new Error('作品已更新，請重新匯出。');
   };
   await authorize();
   const blob=await capturePng(revision);
   await authorize();
   const current=latestShared.current;
   if(!current.connected||current.info?.sceneId!==sceneId||current.scene?.sceneRevision!==revision||current.hasUnconfirmedOperations())throw new Error('作品或連線已更新，請重新匯出。');
   const url=URL.createObjectURL(blob);
   try{const anchor=document.createElement('a');anchor.href=url;anchor.download='sandtray.png';anchor.click();}
   finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
   // REQ-017 AC17-7: the exported picture travels with its credits (CC-BY attribution must survive outside the app).
   const used=current.scene.objects.map((o:any)=>resolveAsset(o.assetId,o.assetVersion)).filter((a:any)=>a);
   const credits=URL.createObjectURL(new Blob([creditsText(used)],{type:'text/plain;charset=utf-8'}));
   try{const anchor=document.createElement('a');anchor.href=credits;anchor.download='sandtray-credits.txt';anchor.click();}
   finally{setTimeout(()=>URL.revokeObjectURL(credits),1000);}
  }finally{setPngBusy(false);}
 }
 return <section className="session-tools" aria-label="雙人會談">
 {!roomId&&!incoming&&<>{/* 2026-10-09 使用者回報：登入後仍見「治療師登入」，且不知邀請連結要進會談後才產生 */}{session?.role!=='therapist'&&<a href="/auth/login">治療師登入</a>}{/* V8-L12-3：會談一律只在會談期間暫存（使用者裁定 L01-4），不再提供雲端保存模式 */}{session?.role==='therapist'&&<><TraySetup value={trays} onChange={setTrays}/><button disabled={!roomTraysSchema.safeParse(trays).success} onClick={()=>void run(async()=>{const room=await api('/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1',trays});location.search='?room='+room.id;})}>建立虛構資料會談</button><span data-testid="invite-hint">邀請案主：先按「建立虛構資料會談」，進入會談後按「產生邀請連結」，再把連結傳給案主。</span></>}<span>本機探索不保存；會談只在進行期間暫存，結束後刪除，需要留存請在會談中匯出 PNG。</span></>}
 {!roomId&&!incoming&&session?.role==='therapist'&&<>{isAdmin&&<a href="/admin" data-testid="admin-link">帳號管理</a>}<button onClick={()=>void run(async()=>{await api('/auth/logout',{});setSession(null);location.href='/';})}>登出</button></>}
 {incoming&&<>{/* Production two-person test 2026-10-04: a rejected inspect left 「正在讀取…」 and a grey button forever, and the page below looked like a joined session. */}{!invitePolicy&&!inviteFailed&&<span>正在讀取會談保存政策…</span>}{inviteFailed&&<span role="alert" data-testid="invite-failed">這個邀請連結已無法使用（可能已過期、已被使用，或治療師已產生新的連結）。請向治療師索取新的邀請連結；下方沙盤只是本機練習，不會傳給治療師。</span>}{invitePolicy&&<><p>會談期間暫存；治療師結束會談或無人操作兩小時後，作品會從伺服器刪除。 政策版本：{invitePolicy.policyVersion}</p><label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>我知道指定治療師看得到作品，已閱讀並同意上述保存政策；我可隨時收回操作權。</label></>}<button disabled={!consent||!invitePolicy} onClick={()=>void run(async()=>{const result=await api('/api/invites/redeem',{token:incoming});location.search='?room='+result.id;})}>進入等候室</button></>}
 {roomId&&<><strong>{shared.info?.role==='client'?'案主':'治療師'} · {shared.info?.role==='therapist'?'預設唯讀':''}</strong><span role="status">{shared.status}</span>
 {/* L12-5（Claude Opus 5.5, 2026-09-26）：兩席在會談中都看得到結束即刪的提醒，不只在邀請頁與確認框 */}<p className="retention-note">本次會談結束後，作品將從伺服器刪除且無法再開啟；需要留存請先匯出 PNG。</p>
 {!shared.connected&&<><button onClick={()=>void shared.connect()}>重新連線</button><button onClick={()=>void shared.connect(true)}>接管此席位</button></>}
 {shared.info?.role==='therapist'&&<><button onClick={()=>void run(async()=>{const result=await api(`/api/rooms/${roomId}/invites`,{});setInvite(location.origin+'/#invite='+result.token);})}>產生邀請連結</button>{invite&&<input aria-label="邀請連結" readOnly value={invite} onFocus={e=>e.target.select()}/>}{shared.info.waitingClient&&<><button onClick={()=>void run(async()=>{await api(`/api/rooms/${roomId}/admit`,{participantId:shared.info.waitingClient});await shared.refresh();})}>確認等候者入房</button><button onClick={()=>void run(async()=>{await api(`/api/rooms/${roomId}/waiting/cancel`,{participantId:shared.info.waitingClient});setInvite('');await shared.refresh();})}>取消等候席位</button></>}{selected&&<button disabled={!shared.connected} onClick={()=>void run(()=>shared.send({type:'permission.request',objectId:selected,actions:['translate','rotate','scale']}))}>請求操作選中物件</button>}{selected&&<button disabled={!shared.connected} onClick={()=>void run(()=>shared.send({type:'permission.request',objectId:selected,actions:['animate']}))}>請求播放選中物件動作</button>}</>}
 {shared.info?.role==='client'&&<><button disabled={!shared.connected} onClick={()=>void run(()=>shared.send({type:'control.revokeAll'}))}>收回全部操作</button><button disabled={!shared.connected} onClick={()=>void run(()=>shared.send({type:'animation.stopAll'}))}>停止所有動作</button>{Object.entries(shared.info.requests??{}).map(([requestId,r]:[string,any])=><div className="permission-request" key={requestId}><span>治療師請求操作「{requestObjectLabel(shared.scene?.objects,r.objectId)}」：{r.actions.map((a:string)=>({translate:'移動',rotate:'旋轉',scale:'縮放',animate:'動畫'}[a])).join('、')}，5 分鐘</span><button onClick={()=>void run(()=>shared.send({type:'permission.grant',objectId:r.objectId,requestId,actions:r.actions,durationMs:300000}))}>同意上述動作</button><button onClick={()=>void run(()=>shared.send({type:'permission.reject',requestId}))}>拒絕</button></div>)}</>}
 {/* GPT-6 recheck 2026-10-01: a pending room water change is sent and ACKed first, so undo/redo always acts on the newest step. */}{shared.info?.role==='client'&&<><button disabled={!shared.connected} onClick={()=>void run(async()=>{const revision=await settleWater?.();return shared.send({type:'scene.undo',expectedSceneRevision:revision??shared.scene?.sceneRevision});})}>復原</button><button disabled={!shared.connected} onClick={()=>void run(async()=>{const revision=await settleWater?.();return shared.send({type:'scene.redo',expectedSceneRevision:revision??shared.scene?.sceneRevision});})}>重做</button><button onClick={()=>void run(async()=>{await api('/api/rooms/'+roomId+'/export-consent',{formats:Array.from(new Set([...(shared.info.exportConsent?.formats??[]),'png']))});await shared.refresh();})}>允許治療師匯出 PNG</button><button onClick={()=>void run(async()=>{await api(`/api/rooms/${roomId}/export-consent`,{formats:[]});await shared.refresh();})}>收回匯出同意</button></>}
 <button disabled={pngBusy||!shared.connected} onClick={()=>void run(exportPng)}>{pngBusy?'正在產生 PNG…':'匯出 PNG'}</button>
 {selected&&shared.can('animate',selected)&&<button onClick={()=>void run(async()=>{const o=shared.scene.objects.find((o:any)=>o.id===selected);await shared.animate(selected,{clipId:'path',state:'playing',offsetMs:0,speed:1,loop:false,path:{points:[o.transform.position,[Math.min(5,o.transform.position[0]+1),o.transform.position[1],o.transform.position[2]]],durationMs:5000}});})}>向右移動一格（5 秒）</button>}
 {/* V8-L12-1A／L12-5：案主只能離開、不會刪除會談；治療師結束會談才刪除，先確認並提醒只能匯出 PNG */}{shared.info?.role==='client'?<button onClick={()=>void run(async()=>{if(!confirm('離開後需要治療師重新邀請才能再進來。確定離開會談嗎？'))return;await api(`/api/rooms/${roomId}/leave`,{});location.href='/';})}>離開會談</button>:<button onClick={()=>void run(async()=>{if(!confirm('結束會談後，這次的作品會從伺服器刪除，之後無法再開啟。需要留存請先按「匯出 PNG」。確定結束嗎？'))return;const closed=await api(`/api/rooms/${roomId}/close`,{});if(closed?.deletion!=='COMPLETE')alert('會談已結束，作品已無法再開啟；伺服器仍在清除資料，系統會自動重試直到完成。');location.href='/';})}>結束會談並刪除作品</button>}</>}
 {notice&&<span role="alert">{notice}</span>}
 </section>;
}


