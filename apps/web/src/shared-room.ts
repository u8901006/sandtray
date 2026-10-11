import {ReceiptRetry,advanceEpochs} from './receipt-retry';
import {useEffect,useRef,useState} from 'react';
import {PROTOCOL_CAPABILITY_HEADER,PROTOCOL_CAPABILITY,WS_SUBPROTOCOL,type Transform,type Action} from '../../../packages/protocol/src/index';
// L07-2B C4: every request declares the two-tray (v2) capability; the Worker answers 426 UPGRADE_REQUIRED to clients that do not.
export async function api(path:string,data?:unknown){const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:{[PROTOCOL_CAPABILITY_HEADER]:PROTOCOL_CAPABILITY,...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data),cache:'no-store'});if(!response.ok){const value=await response.json() as {code:string};throw new Error(value.code);}return response.status===204?{}:await response.json() as any;}
export const words:Record<string,string>={PERMISSION_DENIED:'目前沒有這項操作的授權。',STALE_EPOCH:'連線已更新，請重新操作。',LOCKED:'物件正在操作中，請稍後再試。',GRANT_EXPIRED:'授權已到期，請重新請求。',UNAUTHENTICATED:'登入已失效，請重新登入。',ROOM_CLOSED:'會談已結束。',ROOM_FULL:'此席位已在另一頁開啟，可明確接管。',RATE_LIMITED:'操作太快，請稍後再試。',UPGRADE_REQUIRED:'沙盤程式已更新，請重新整理頁面。',STALE_FENCE:'物件操作權已更新，請重新選取物件後再操作。',REVISION_CONFLICT:'作品剛有更新，請再試一次。',INVALID_PAYLOAD:'這項操作無法完成，請重新操作。',SAVE_FAILED:'暫時無法保存，請稍後再試。'};
const WAITING_ROOM_POLL_MS=1000;
export function useSharedRoom(roomId:string|null){
 const [info,setInfo]=useState<any>(null),[scene,setScene]=useState<any>(null),[status,setStatus]=useState('尚未連線'),[connected,setConnected]=useState(false);
 const socket=useRef<WebSocket|null>(null),latest=useRef<any>(null),pending=useRef(new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>());
 const receipts=useRef(new ReceiptRetry());
 // REQ-016: tray.changed is replayed by the tray models directly (no snapshot refetch per stroke).
 const trayListener=useRef<((message:any)=>void)|null>(null);
 // GPT-5 2026-09-22: a terminal ROOM_CLOSED result must stop the waiter timer; a new roomId resets it.
 const active=useRef(true),generation=useRef(0),refreshNumber=useRef(0),connecting=useRef(false),waitingPollStopped=useRef(false);
 const inflight=useRef<{run:number;promise:Promise<void>}|null>(null);
 // C55 (2026-09-21, GPT-5 review finding): a refresh superseded by a newer one used to resolve immediately, so
 // `await refresh()` inside send()/transform() could observe latest.current from BEFORE the newest /info landed
 // (e.g. the lease of the lock that was just ACKed → leases[objectId] undefined → commit never sent). A superseded
 // refresh now settles only after the newest in-flight refresh has applied; generation/epoch/close guards unchanged.
 function refresh():Promise<void>{if(!roomId)return Promise.resolve();const run=++refreshNumber.current;const promise=(async()=>{await load(run);const newer=inflight.current;if(newer&&newer.run!==run&&newer.run===refreshNumber.current)await newer.promise;})();inflight.current={run,promise};return promise;}
 async function load(run:number){const value=await api(`/api/rooms/${roomId}/info`);if(!active.current||run!==refreshNumber.current)return;receipts.current.bind(`${roomId}:${value.participantId}`);value.clockOffset=value.serverNow-Date.now();latest.current={...advanceEpochs(value,latest.current??{}),ready:latest.current?.ready??false};setInfo(value);if(value.admitted){const snapshot=await api(`/api/rooms/${roomId}/snapshot`);if(active.current&&run===refreshNumber.current)setScene(snapshot);}else {setScene(null);setStatus('等候治療師確認入房');}}
 function clearPending(){for(const p of pending.current.values()){clearTimeout(p.timer);p.reject(new Error('連線中斷，操作尚未確認。'));}pending.current.clear();}
 async function connectInternal(takeover=false){if(!roomId||connecting.current)return;connecting.current=true;if(latest.current)latest.current.ready=false;setConnected(false);clearPending();try{await refresh();if(!latest.current?.admitted)return;
  const run=++generation.current;socket.current?.close();const ws=new WebSocket(location.origin.replace(/^http/,'ws')+`/api/rooms/${roomId}/socket${takeover?'?takeover=1':''}`,WS_SUBPROTOCOL);socket.current=ws;
  ws.onopen=()=>{if(run!==generation.current)return;setStatus('連線中，正在核對會談狀態');};
  ws.onmessage=event=>{if(run!==generation.current)return;const message=JSON.parse(event.data);if(latest.current){latest.current=advanceEpochs(latest.current,message);}
   if(message.type==='room.snapshot'){void refresh().then(()=>{if(run!==generation.current||ws.readyState!==WebSocket.OPEN)return;latest.current={...latest.current,ready:true};setConnected(true);setStatus(receipts.current.size?'正在核對未確認操作':'已連線・會談期間暫存');for(const payload of receipts.current.replay())ws.send(payload);}).catch(fail);}
   if(message.type==='operation.ack'||message.type==='operation.rejected'){const recovered=receipts.current.settle(message.operationId);if(recovered){void refresh().then(()=>{if(run===generation.current)setStatus(message.type==='operation.ack'?(receipts.current.size?'仍有操作等待確認':'操作已確認於會談暫存'):(message.code==='STALE_EPOCH'?'上次操作未保存，請重新操作。':words[message.code]??message.code));}).catch(fail);}const p=pending.current.get(message.operationId);if(p){clearTimeout(p.timer);pending.current.delete(message.operationId);message.type==='operation.ack'?p.resolve(message):p.reject(new Error(words[message.code]??message.code));}}
   if(message.type==='tray.changed'){setScene((prev:any)=>prev&&prev.sceneRevision<message.sceneRevision?{...prev,sceneRevision:message.sceneRevision}:prev);trayListener.current?.(message);}
   if(['scene.patch','permission.changed','permission.requested','lock.changed','sync.required'].includes(message.type))void refresh().catch(fail);
  };
  ws.onerror=()=>{if(run===generation.current)setStatus('連線失敗；另一頁佔用時請按接管此席位。');};
  ws.onclose=event=>{if(run!==generation.current)return;const wasAdmitted=latest.current?.admitted===true;if(socket.current===ws)socket.current=null;refreshNumber.current++;if(latest.current)latest.current.ready=false;setConnected(false);setScene(null);clearPending();if(event.code===4001)receipts.current.clear();if(event.code===4003){receipts.current.clear();latest.current=null;setInfo(null);waitingPollStopped.current=true;}setStatus(event.code===4001?'席位已由另一頁接管。':wasAdmitted&&event.code===4003?'登入已失效，請重新登入。':'已斷線，請重新連線；操作授權需要重新取得。');};
 }catch(e){fail(e);}finally{connecting.current=false;}}
 async function connect(takeover=false){waitingPollStopped.current=false;return connectInternal(takeover);}
  function fail(e:unknown){
  const code=e instanceof Error?e.message:'';
  const waitingForAdmission=!socket.current&&!latest.current?.admitted;
  // close() removes the active room after its final checkpoint, so a previously
  // confirmed waiting client sees PERMISSION_DENIED rather than ROOM_CLOSED.
  const waitingRoomGone=code==='PERMISSION_DENIED'&&latest.current?.roomId===roomId&&latest.current?.admitted===false;
  const terminalCode=code==='ROOM_CLOSED'||waitingRoomGone?'ROOM_CLOSED':code;
  // A waiting /info rejection cannot recover by polling: the room is closed,
  // access is denied for this room, or the session is no longer valid. Keep
  // network failures retryable, but invalidate any late /info response before
  // clearing the waiting snapshot.
  const waitingTerminal=waitingForAdmission&&['UNAUTHENTICATED','PERMISSION_DENIED','ROOM_CLOSED'].includes(code);
  if(waitingTerminal){waitingPollStopped.current=true;refreshNumber.current++;}
  if(['UNAUTHENTICATED','PERMISSION_DENIED','ROOM_CLOSED'].includes(terminalCode)){receipts.current.clear();latest.current=null;setInfo(null);setScene(null);setConnected(false);socket.current?.close();}
  setStatus(e instanceof Error?(words[terminalCode]??e.message):'操作失敗');
 }
 // quiet (REQ-016 sand strokes): no /info+/snapshot refetch and no status churn per ACK; the caller may pre-assign operationId.
 async function send(input:Record<string,unknown>,options:{quiet?:boolean;ignoreFailure?:boolean}={}){if(socket.current?.readyState!==WebSocket.OPEN||!latest.current?.ready)throw new Error('尚未連線，操作未送出。');const state=latest.current;const operationId=typeof input.operationId==='string'?input.operationId:crypto.randomUUID();const heartbeat=input.type==='presence.heartbeat'||options.quiet===true;const command={protocolVersion:1,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...input,operationId};if(!heartbeat)setStatus('同步中');try{const result=await new Promise<any>((resolve,reject)=>{receipts.current.remember(command);const timer=setTimeout(()=>{pending.current.delete(operationId);generation.current++;refreshNumber.current++;if(latest.current)latest.current.ready=false;setConnected(false);setScene(null);clearPending();const expired=socket.current;socket.current=null;expired?.close();reject(new Error('尚未收到保存確認，請重新連線核對。'));},8000);pending.current.set(operationId,{resolve,reject,timer});try{socket.current!.send(JSON.stringify(command));}catch(e){clearTimeout(timer);pending.current.delete(operationId);receipts.current.settle(operationId);reject(e);}});if(options.quiet!==true)await refresh();if(!heartbeat)setStatus(receipts.current.size?'仍有操作等待確認':'已保存於會談暫存');return result;}catch(e){if(options.ignoreFailure!==true&&input.type!=='presence.heartbeat'||e instanceof Error&&['UNAUTHENTICATED','PERMISSION_DENIED','ROOM_CLOSED'].includes(e.message))fail(e);throw e;}}
  useEffect(()=>{active.current=true;waitingPollStopped.current=false;if(roomId)void connectInternal();const heartbeatTimer=setInterval(()=>{if(socket.current?.readyState===WebSocket.OPEN)void send({type:'presence.heartbeat'}).catch(()=>{});},5000);const waitingTimer=setInterval(()=>{if(roomId&&!waitingPollStopped.current&&!latest.current?.admitted&&!connecting.current)void connectInternal();},WAITING_ROOM_POLL_MS);return()=>{active.current=false;waitingPollStopped.current=true;generation.current++;clearInterval(heartbeatTimer);clearInterval(waitingTimer);socket.current?.close();clearPending();receipts.current.clear();latest.current=null;setInfo(null);setScene(null);setConnected(false);};},[roomId]);
 function can(action:Action,objectId:string){return connected&&(info?.role==='client'||Object.values(info?.grants??{}).some((g:any)=>g.objectId===objectId&&g.active&&g.expiresAt>Date.now()&&g.actions.includes(action)));}
 async function transform(objectId:string,transform:Transform){await refresh();const object=scene?.objects.find((o:any)=>o.id===objectId);if(!object)throw new Error('物件已不存在');const actions:Action[]=[];if(object.transform.position.some((v:number,i:number)=>v!==transform.position[i]))actions.push('translate');if(object.transform.rotation.some((v:number,i:number)=>v!==transform.rotation[i]))actions.push('rotate');if(object.transform.scale!==transform.scale)actions.push('scale');if(!actions.length)return;
  const grant=Object.values(latest.current.grants??{}).find((g:any)=>g.objectId===objectId&&g.active) as any;const approval=info.role==='therapist'?{grantId:grant?.id,grantVersion:grant?.version}:{};
  await send({type:'object.lock.acquire',objectId,actions,...approval});const lease=latest.current.leases[objectId];try{await send({type:'object.transform.commit',objectId,expectedObjectRevision:object.revision,leaseId:lease.id,fencingToken:lease.fence,transform,...approval});}finally{await send({type:'object.lock.release',objectId,leaseId:lease.id,fencingToken:lease.fence,...approval},{ignoreFailure:true}).catch(()=>{});}
 }
 async function animate(objectId:string,animation:Record<string,unknown>){
  await refresh();const object=scene?.objects.find((o:any)=>o.id===objectId);if(!object)throw new Error('物件已不存在');
  const grant=Object.values(latest.current.grants??{}).find((g:any)=>g.objectId===objectId&&g.active&&g.actions.includes('animate')) as any;
  const approval=latest.current.role==='therapist'?{grantId:grant?.id,grantVersion:grant?.version}:{};
  await send({type:'object.lock.acquire',objectId,actions:['animate'],...approval});const lease=latest.current.leases[objectId];
  try{await send({type:'animation.set',objectId,expectedObjectRevision:object.revision,leaseId:lease.id,fencingToken:lease.fence,...animation,...approval});}
  finally{await send({type:'object.lock.release',objectId,leaseId:lease.id,fencingToken:lease.fence,...approval},{ignoreFailure:true}).catch(()=>{});}
 }
 return {info,scene,status,connected,connect,send,refresh,can,transform,animate,fail,trayListener,hasUnconfirmedOperations:()=>pending.current.size>0||receipts.current.size>0};
}



