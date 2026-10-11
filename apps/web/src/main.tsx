import {SandtraySurface,type SandTool,type SculptHandlers,type HoverHandler} from './sandtray-surface';
import {listableAsset} from './asset-listing';
import {TrayModel,surfaceY,type Point} from './tray-model';
import {trayOffsets,CAMERA_ANGLE,cameraView,type CameraKind} from './tray-layout';
import {TraySetup,describeTray} from './tray-setup';
import {CanvasLifecycle} from './canvas-lifecycle';
import React,{useState,useEffect,useRef,useMemo,useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {Canvas,useThree,useFrame} from '@react-three/fiber';
import {OrbitControls,TransformControls,Html} from '@react-three/drei';
import {Group,Quaternion,Euler,Vector3,Plane,PCFShadowMap,type Mesh,type MeshBasicMaterial} from 'three';
import {devAssets,resolveAsset,supportsColorVariants,COLOR_VARIANT_OPTIONS,type DevAssetId} from '../../../packages/asset-catalog/src/index';
import {validTransform,colorVariantHex,clampToTray,trayHalfUnits,roomTraysSchema,STANDARD_ROOM_TRAYS,STANDARD_TRAY_CONFIG,type Transform,type ColorVariant,type TrayId,type TrayConfig,type RoomTrays} from '../../../packages/protocol/src/index';
import {Model} from './catalog-model';
import {api} from './shared-room';
import './style.css';
import {pathPosition} from '../../../packages/room-core/src/animation';
import {useSharedRoom} from './shared-room';
import type {AssetLoadFailure} from './asset-pool';
// REQ-018 AC18-8: 401/403 on a model is a session or room problem, so no retry button — sign in again or the session is over.
function loadStatusText(reason:AssetLoadFailure|undefined){return reason==='UNAUTHENTICATED'?'登入已失效，請重新登入後再載入模型':reason==='PERMISSION_DENIED'?'會談已結束或沒有這件素材的存取資格，作品仍保留':'模型載入失敗，作品仍保留';}
import {SessionTools} from './session-tools';
import {EntryGate} from './entry-gate';
import {AdminPanel} from './admin-panel';
import {useGarden,GardenControls,GardenWorld,GardenWalk} from './garden-experience';
import {PngCaptureBridge,type PngCapture} from './png-export';
import {Credits,ProvenanceLine} from './credits';
import {shelfGroups} from './shelf-groups';
import {ROLE_COLOR,therapistHolds,dropOffset,DROP_HEIGHT,isSoftwareRenderer,rendererName,type ViewerRole} from './presence';
import {ToolIcon,ViewIcon} from './ui-icons';
const reducedMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
function readPref(key:string,fallback:boolean){try{const v=localStorage.getItem(key);return v===null?fallback:v==='1';}catch{return fallback;}}
function writePref(key:string,value:boolean){try{localStorage.setItem(key,value?'1':'0');}catch{/* private window: the panel still toggles */}}
/** 2026-10-09 UX 建議 9：物件落地時揚起的一點沙。只在畫面上，結束後自行卸載。 */
function SandPuff({onDone}:{onDone:()=>void}){
 const refs=useRef<(Mesh|null)[]>([]);const start=useRef(performance.now());const {invalidate}=useThree();const done=useRef(false);
 useEffect(()=>{invalidate();},[invalidate]);
 useFrame(()=>{const t=(performance.now()-start.current)/450;
  refs.current.forEach((m,k)=>{if(!m)return;const a=k/6*Math.PI*2,r=.35+.5*Math.min(1,t);m.position.set(Math.cos(a)*r,.05+.25*Math.sin(Math.min(1,t)*Math.PI),Math.sin(a)*r);(m.material as MeshBasicMaterial).opacity=Math.max(0,.7*(1-t));});
  if(t>=1){if(!done.current){done.current=true;onDone();}}else invalidate();});
 return <>{Array.from({length:6},(_,k)=><mesh key={k} ref={m=>{refs.current[k]=m;}} raycast={()=>null}><sphereGeometry args={[.05,8,6]}/><meshBasicMaterial color="#d8c7a0" transparent opacity={.7} depthWrite={false}/></mesh>)}</>;
}
type Item={id:string;assetId:DevAssetId;assetVersion?:string;trayId?:TrayId;transform:Transform;materialOverrides?:Record<string,string>;colorVariant?:ColorVariant;hidden?:boolean;revision?:number;animation?:Parameters<typeof pathPosition>[0]};
function ObjectView({item,selected,editable=true,clockOffset=0,retryToken=0,roomId=null,mode,originX=0,tray=STANDARD_TRAY_CONFIG,groundAt,onSelect,onChange,onLoad,ringColor='#426253',heldByTherapist=false,dropIn=false}:{item:Item;selected:boolean;ringColor?:string;heldByTherapist?:boolean;dropIn?:boolean;originX?:number;tray?:TrayConfig;groundAt?:(x:number,z:number)=>number;editable?:boolean;clockOffset?:number;retryToken?:number;roomId?:string|null;mode:'translate'|'rotate';onSelect:()=>void;onChange:(t:Transform)=>void;onLoad:(ok:boolean|undefined,reason?:AssetLoadFailure)=>void;colorVariant?:ColorVariant}) {
 const group=useRef<Group>(null);const {invalidate,gl,controls}=useThree();
 const drag=useRef<{offset:Vector3;plane:Plane;origin:Vector3}|null>(null);
 const orbit=controls as unknown as {enabled:boolean}|null;
 function cancelDrag(){if(drag.current&&group.current){group.current.position.copy(drag.current.origin);drag.current=null;if(orbit)orbit.enabled=true;invalidate();}}
 useEffect(()=>{
  const secondary=(e:PointerEvent)=>{if(e.pointerType==='touch'&&!e.isPrimary)cancelDrag();};
  const cancel=()=>cancelDrag();
  // 2026-10-09：第二根手指可能落在物件旁的快速工具（DOM 疊層）而不是畫布上，所以在 window 捕獲階段聽，任何地方的第二指都取消拖曳。
  window.addEventListener('pointerdown',secondary,true);
  gl.domElement.addEventListener('pointercancel',cancel);
  return()=>{window.removeEventListener('pointerdown',secondary,true);gl.domElement.removeEventListener('pointercancel',cancel);if(orbit)orbit.enabled=true;};
 },[gl,orbit]);
 useFrame(()=>{if(group.current&&item.animation?.state==='playing'){const position=pathPosition(item.animation,Date.now()+clockOffset);if(position)group.current.position.fromArray(position);invalidate();}});
 useEffect(()=>{if(!editable)cancelDrag();invalidate();},[editable,item.animation,invalidate]);
 const [ready,setReady]=useState(false);
 useEffect(()=>{setReady(true);},[]);
 // UX 建議 9：新放下的物件從上方輕輕落下（只動內層顯示，transform 與存檔不變）；系統要求減少動態效果時不播。
 // 從模型載入完成那一刻才開始落（之前看不到，而且載入中連續重繪會拖慢軟體算繪的裝置）。
 const inner=useRef<Group>(null);const drop=useRef<number|null>(null);const wantsDrop=useRef(dropIn&&!reducedMotion()&&!isSoftwareRenderer(rendererName(gl)));const [puff,setPuff]=useState(false);
 // 「已載入」要等落地、揚沙結束才回報：PNG 匯出與畫面穩定檢查都以它為準，不能拍到半空中的物件。
 const landed=useRef<(()=>void)|null>(null);
 function startDrop(){if(!wantsDrop.current||!inner.current)return false;wantsDrop.current=false;inner.current.position.y=DROP_HEIGHT;drop.current=performance.now();invalidate();return true;}
 function settled(){setPuff(false);const report=landed.current;landed.current=null;report?.();}
 useFrame(()=>{const start=drop.current;if(start===null||!inner.current)return;const offset=dropOffset(performance.now()-start);inner.current.position.y=offset;if(offset===0){drop.current=null;setPuff(true);}invalidate();});
 return <><group ref={group} userData={{sandtrayObjectId:item.id}} position={item.transform.position} quaternion={item.transform.rotation} scale={item.transform.scale}
  onClick={event=>{event.stopPropagation();onSelect();}}
  onPointerDown={e=>{
   if(!editable||!selected||mode!=='translate'||e.button!==0||(e.pointerType==='touch'&&!e.isPrimary))return;
   e.stopPropagation();const g=group.current!;const plane=new Plane(new Vector3(0,1,0),-g.position.y);
   const point=e.ray.intersectPlane(plane,new Vector3());if(!point)return;point.x-=originX;
   drag.current={offset:g.position.clone().sub(point),plane,origin:g.position.clone()};
   if(orbit)orbit.enabled=false;(e.target as Element).setPointerCapture(e.pointerId);
  }}
  onPointerMove={e=>{
   const d=drag.current;if(!d)return;e.stopPropagation();const point=e.ray.intersectPlane(d.plane,new Vector3());
   if(point){point.x-=originX;point.add(d.offset);[point.x,point.z]=clampToTray(tray,point.x,point.z);
    // Keep the object on the sand while it moves: up a dune, down into a hollow (GPT-6.1 SOL review 2026-10-05).
    // The sand under the pointer also gets the release click; App ignores it as a drag (delta), so the object stays selected.
    if(groundAt)point.y=groundAt(point.x,point.z);group.current!.position.copy(point);invalidate();}
  }}
  onPointerUp={e=>{
   if(!drag.current)return;e.stopPropagation();drag.current=null;if(orbit)orbit.enabled=true;
   (e.target as Element).releasePointerCapture(e.pointerId);
   onChange({...item.transform,position:group.current!.position.toArray()});invalidate();
  }}>
  <group ref={inner}><Model retryToken={retryToken} assetId={item.assetId} assetVersion={item.assetVersion} roomId={roomId} animation={item.animation} colorVariant={item.colorVariant??(item.assetVersion?(supportsColorVariants(item.assetId,item.assetVersion)?'t2':undefined):undefined)} clockOffset={clockOffset} onLoad={(ok,reason)=>{if(ok===true&&startDrop()){landed.current=()=>onLoad(true);invalidate();return;}if(ok===false)wantsDrop.current=false;landed.current=null;onLoad(ok,reason);invalidate();}}/></group>
  {puff&&<SandPuff onDone={settled}/>}
  {selected&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,0.008,0]}><ringGeometry args={[0.75,0.8,48]}/><meshBasicMaterial color={ringColor} depthTest={false} transparent opacity={0.9}/></mesh>}
  {heldByTherapist&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,0.01,0]}><ringGeometry args={[0.86,0.92,48]}/><meshBasicMaterial color={ROLE_COLOR.therapist} depthTest={false} transparent opacity={0.9}/></mesh>}
 </group>{heldByTherapist&&<Html position={item.transform.position} zIndexRange={[15,0]} pointerEvents="none"><span className="holder-badge" style={{background:ROLE_COLOR.therapist}}>治療師操作中</span></Html>}
 {selected&&editable&&ready&&group.current&&<TransformControls object={group as React.RefObject<Group>} mode={mode} showY={mode==='rotate'}
  onMouseUp={()=>{const g=group.current!;if(mode==='translate'&&groundAt)g.position.y=groundAt(g.position.x,g.position.z);const t={position:g.position.toArray(),rotation:g.quaternion.toArray(),scale:g.scale.x} as Transform;
   if(validTransform(t))onChange(t);else {g.position.fromArray(item.transform.position);g.quaternion.fromArray(item.transform.rotation);g.scale.setScalar(item.transform.scale);}invalidate();}}/>}</>;
}
function Camera({view,trays}:{view:{kind:CameraKind;tick:number};trays:RoomTrays}) {
 const {camera,invalidate,size}=useThree();const controls=useRef<any>(null);const aspect=useRef(1.6);aspect.current=size.width/size.height;
 const traysKey=JSON.stringify(trays);
 useEffect(()=>{const next=cameraView(view.kind,aspect.current,trays);camera.position.set(...next.position);controls.current?.target.set(...next.target);controls.current?.update();invalidate();},[view,camera,invalidate,traysKey]);
 return <OrbitControls ref={controls} makeDefault enableDamping={false} minDistance={4} maxDistance={70} maxPolarAngle={Math.PI/2-0.04}/>;
}
function App(){
 const garden=useGarden();const exploring=garden.enabled&&garden.exploring;
 const roomId=new URLSearchParams(location.search).get('room');const shared=useSharedRoom(roomId);
 // REQ-018 option B (T18-C): private-only models (restricted licences) have no public URL, so local exploration (no room) cannot list them.
 // 2026-09-28 使用者裁定：部署環境（staging／production）的物件庫隱藏 DEV_ 練習素材；本機與測試環境不變。
 // 只影響列表，已存在場景中的 DEV 物件照常解析顯示。
 // 2026-10-03／10-04：規則見 asset-listing.ts（非本機主機一律隱藏非 releasable，不等 health）。
 const [deployed,setDeployed]=useState(false);
 useEffect(()=>{let active=true;fetch('/api/health').then(r=>r.ok?r.json() as Promise<{mode?:string}>:null).then(h=>{if(active&&(h?.mode==='staging'||h?.mode==='production'))setDeployed(true);}).catch(()=>{});return()=>{active=false;};},[]);
 const listable=useMemo(()=>devAssets.filter(a=>listableAsset(a,{roomId,hostname:location.hostname,healthDeployed:deployed})),[roomId,deployed]);
 const [items,setItems]=useState<Item[]>([]);const [selected,setSelected]=useState<string>();
 const [pageSize,setPageSize]=useState(40),[clip,setClip]=useState('');
 const [pending,setPending]=useState<DevAssetId>();const [search,setSearch]=useState('');const [category,setCategory]=useState('全部');const [group,setGroup]=useState('all');
 // UX 建議 1：兩側欄可收起，讓沙盤變大（只記在這台裝置）。
 // 2026-10-11 使用者指示：會談中側欄預設收起讓沙盤更大——治療師兩側都收、案主只收右側；本機探索維持展開。
 // 每個角色各記各的（新 key），舊的全域偏好不會蓋掉新預設；角色資料晚到時（入房前尚未知道）再套用一次。
 const panelRole:'local'|'therapist'|'client'=roomId?(shared.info?.role==='therapist'?'therapist':'client'):'local';
 const panelPref=(name:'libraryOpen'|'inspectorOpen')=>panelRole==='local'?`sandtray.${name}`:`sandtray.${name}.${panelRole}`;
 const panelDefault={local:{libraryOpen:true,inspectorOpen:true},therapist:{libraryOpen:false,inspectorOpen:false},client:{libraryOpen:true,inspectorOpen:false}}[panelRole];
 const [libraryOpen,setLibraryOpen]=useState(()=>readPref(panelPref('libraryOpen'),panelDefault.libraryOpen)),[inspectorOpen,setInspectorOpen]=useState(()=>readPref(panelPref('inspectorOpen'),panelDefault.inspectorOpen));
 // 收起／展開後畫布變寬，重新取景讓沙盤填滿（等版面更新後再算長寬比）。
 const reframe=()=>setTimeout(()=>setView(v=>({kind:v.kind,tick:v.tick+1})),150); // R3F 量測畫布尺寸有約 50 ms 去抖動
 // 2026-10-10 使用者指示：頁首、會談工具、庭園設定與標題可往上收起，畫面盡量只剩沙盤（只記在這台裝置）。
 const [chromeOpen,setChromeOpen]=useState(()=>readPref('sandtray.chromeOpen',true));
 // 2026-10-10 user request: the sand-tool box can fold down to one button so it covers less of the trays.
 const [toolsOpen,setToolsOpen]=useState(()=>readPref('sandtray.sandToolsOpen',true));
 const toggleTools=()=>setToolsOpen(v=>{writePref('sandtray.sandToolsOpen',!v);return !v;});
 const toggleChrome=()=>{setChromeOpen(v=>{writePref('sandtray.chromeOpen',!v);return !v;});reframe();};
 const [toolsNotice,setToolsNotice]=useState('');
 const toggleLibrary=()=>{setLibraryOpen(v=>{writePref(panelPref('libraryOpen'),!v);return !v;});reframe();},toggleInspector=()=>{setInspectorOpen(v=>{writePref(panelPref('inspectorOpen'),!v);return !v;});reframe();};
 const panelRoleSeen=useRef(panelRole);
 useEffect(()=>{if(panelRoleSeen.current===panelRole)return;panelRoleSeen.current=panelRole;setLibraryOpen(readPref(panelPref('libraryOpen'),panelDefault.libraryOpen));setInspectorOpen(readPref(panelPref('inspectorOpen'),panelDefault.inspectorOpen));reframe();},[panelRole]);
 const [mode,setMode]=useState<'translate'|'rotate'>('translate');const [view,setView]=useState({kind:'angle' as CameraKind,tick:0});
 const [notice,setNotice]=useState('從左側選一件物件，放在你想要的位置。');const [loaded,setLoaded]=useState<Record<string,boolean|undefined>>({});const [loadFailure,setLoadFailure]=useState<Record<string,AssetLoadFailure|undefined>>({});
 const [modelRetries,setModelRetries]=useState<Record<string,number>>({});
 const [contextLost,setContextLost]=useState(false);
 // REQ-016 (2026-09-30): dry (left) and wet (right) trays. In a room the Durable Object is the authority and the models replay
 // tray.changed; without a room they are this page's local practice trays.
 const [trays]=useState(()=>({dry:new TrayModel('dry'),wet:new TrayModel('wet')} as Record<TrayId,TrayModel>));
 const [sandTool,setSandTool]=useState<SandTool|null>(null);const [water,setWater]=useState(0);const waterTimer=useRef<ReturnType<typeof setTimeout>>(undefined);
 // REQ-016 A6: tray shapes/sizes. In a room they come from the snapshot (chosen by the therapist at creation); locally from the practice set-up.
 const [localTrays,setLocalTrays]=useState<RoomTrays>(STANDARD_ROOM_TRAYS);
 const roomTrays=useMemo(()=>{const found=shared.scene?.trays;if(!roomId||!Array.isArray(found))return undefined;const pick=(id:TrayId)=>{const t=found.find((x:any)=>x.id===id);return t?.shape&&t.sizeCm?{shape:t.shape,...t.sizeCm}:STANDARD_TRAY_CONFIG;};const parsed=roomTraysSchema.safeParse({dry:pick('dry'),wet:pick('wet')});return parsed.success?parsed.data:undefined;},[roomId,shared.scene]);
 const trayConfigs=roomId?roomTrays??STANDARD_ROOM_TRAYS:localTrays;const offsets=useMemo(()=>trayOffsets(trayConfigs),[trayConfigs]);
 const [setupDraft,setSetupDraft]=useState<RoomTrays>(STANDARD_ROOM_TRAYS);
 // Local practice only: undo/redo of sand and water (a room uses the server's scene.undo / scene.redo, which include sand).
 type LocalStep={trayId:TrayId;before:{data:Uint8Array;water:number};after:{data:Uint8Array;water:number}};
 const localHistory=useRef<{undo:LocalStep[];redo:LocalStep[]}>({undo:[],redo:[]});
 const [localHistorySize,setLocalHistorySize]=useState([0,0]);
 // Sand height under a tray-local point as drawn, within the protocol's y range; seats new and dragged objects.
 const groundY=(id:TrayId,x:number,z:number)=>Math.max(-1.5,Math.min(5,Number(surfaceY(trays[id].display,x,z).toFixed(3))));
 const trayState=(id:TrayId)=>({data:trays[id].confirmed.data.slice(),water:trays[id].water});
 function pushLocalStep(trayId:TrayId,before:{data:Uint8Array;water:number}){const h=localHistory.current;h.undo.push({trayId,before,after:trayState(trayId)});if(h.undo.length>50)h.undo.shift();h.redo=[];setLocalHistorySize([h.undo.length,0]);}
 function moveLocalHistory(direction:'undo'|'redo'){settleLocalWater(true);const h=localHistory.current,step=(direction==='undo'?h.undo:h.redo).pop();if(!step)return;(direction==='undo'?h.redo:h.undo).push(step);const state=direction==='undo'?step.before:step.after;trays[step.trayId].restoreLocal(state.data,state.water);if(step.trayId==='wet')setWater(state.water);setLocalHistorySize([h.undo.length,h.redo.length]);}
 function applyLocalSetup(next:RoomTrays){settleLocalWater(false);setLocalTrays(next);trays.dry.configure(next.dry);trays.wet.configure(next.wet);setWater(0);localHistory.current={undo:[],redo:[]};setLocalHistorySize([0,0]);
  // Keep practice objects on their (possibly smaller or round) tray.
  setItems(list=>list.map(item=>{const [x,z]=clampToTray(next[item.trayId??'dry'],item.transform.position[0],item.transform.position[2]);return {...item,transform:{...item.transform,position:[x,item.transform.position[1],z]}};}));
  setNotice('沙盤已改為：乾 '+describeTray(next.dry)+'；濕 '+describeTray(next.wet)+'。');}
 const canSculpt=!exploring&&(!roomId||shared.info?.role==='client'&&shared.connected);
 useEffect(()=>{for(const tray of shared.scene?.trays??[])if(tray.id==='dry'||tray.id==='wet')trays[tray.id as TrayId].adopt(tray);},[shared.scene,trays]);
 useEffect(()=>{shared.trayListener.current=message=>{const tray=trays[message.trayId as TrayId];if(tray&&!tray.replay(message))void shared.refresh().catch(shared.fail);};return()=>{shared.trayListener.current=null;};});
 useEffect(()=>{if(!shared.connected){trays.dry.clearPending();trays.wet.clearPending();}},[shared.connected,trays]);
 useEffect(()=>trays.wet.subscribe(()=>{if(!waterTimer.current)setWater(trays.wet.water);}),[trays]);
 useEffect(()=>{if(!canSculpt)setSandTool(null);},[canSculpt]);
 // gesture: one id per drag, sent with every sand.stroke of it, so one undo takes back the whole drag. before: local-practice undo snapshot.
 const stroke=useRef<{trayId:TrayId;tool:SandTool;point:Point;timer:ReturnType<typeof setInterval>;batch?:string;count:number;opened:number;last:number;gesture:string;before?:{data:Uint8Array;water:number}}|null>(null);
 const sendRef=useRef(shared.send);sendRef.current=shared.send;
 function flushStroke(){const s=stroke.current;if(!s?.batch)return;const batch=s.batch,tray=trays[s.trayId],points=tray.pending.find(p=>p.id===batch)?.points.slice()??[];s.batch=undefined;s.count=0;
  if(points.length)void sendRef.current({type:'sand.stroke',operationId:batch,trayId:s.trayId,tool:s.tool,points,gestureId:s.gesture},{quiet:true}).catch(()=>{tray.drop(batch);});}
 // One brush application per 16 ms while the pointer is down (about 1 s from the surface to the blue floor, REQ-016 §2.2);
 // at most 8 points per sand.stroke, so a steady stroke stays under the 10/s commit bucket.
 // Applications are due by elapsed time, so a slow or throttled timer still digs at the same speed (at most 4 catch-ups per tick).
 function tickStroke(){const s=stroke.current;if(!s)return;const tray=trays[s.trayId],now=performance.now();
  const due=s.last?Math.min(4,Math.floor((now-s.last)/16)):1;if(!due)return;s.last=due===4?now:(s.last||now)+due*16;
  for(let n=0;n<due;n++){
   if(!roomId){tray.applyLocal(s.tool,s.point);continue;}
   if(!s.batch){s.batch=crypto.randomUUID();s.opened=now;}
   tray.stroke(s.batch,s.tool,s.point);s.count++;if(s.count>=8||now-s.opened>=150)flushStroke();
  }}
 const sculpt:SculptHandlers={tool:canSculpt?sandTool:null,
  start:(trayId,point)=>{if(stroke.current||!sandTool)return;if(!roomId)settleLocalWater(true);else{const sent=sendRoomWater();waterGesture.current=null;if(sent)void sent.catch(shared.fail);}stroke.current={trayId,tool:sandTool,point,count:0,opened:0,last:0,gesture:crypto.randomUUID(),...(roomId?{}:{before:trayState(trayId)}),timer:setInterval(tickStroke,16)};tickStroke();},
  move:point=>{if(stroke.current)stroke.current.point=point;},
  end:()=>{const s=stroke.current;if(!s)return;clearInterval(s.timer);flushStroke();stroke.current=null;if(s.before)pushLocalStep(s.trayId,s.before);}};
 useEffect(()=>()=>{if(stroke.current)clearInterval(stroke.current.timer);},[]);
 // One water gesture = slider changes less than 1.5 s apart; it becomes one undo step (server: gestureId; local: one history entry).
 // Local practice (GPT-6 review F2, 2026-09-30): a pending gesture becomes its history step 1.5 s after the last change, or at once
 // before undo/redo or a new sand drag, so undo always takes back the newest change; resetting the practice trays or entering a room
 // drops it. Its timer is cleared on settle, so it can never add a step (or clear redo) after an undo.
 const waterGesture=useRef<{id:string;at:number;before:{data:Uint8Array;water:number};timer?:ReturnType<typeof setTimeout>}|null>(null);
 function settleLocalWater(keep:boolean){const gesture=waterGesture.current;if(!gesture)return;clearTimeout(gesture.timer);waterGesture.current=null;if(keep&&!roomId&&gesture.timer!==undefined)pushLocalStep('wet',gesture.before);}
 useEffect(()=>{settleLocalWater(false);return()=>settleLocalWater(false);},[roomId]);
 function changeWater(level:number){setWater(level);const now=performance.now();
  if(!waterGesture.current||now-waterGesture.current.at>1500){settleLocalWater(true);waterGesture.current={id:crypto.randomUUID(),at:now,before:trayState('wet')};}else waterGesture.current.at=now;
  if(!roomId){trays.wet.setLocalWater(level);const gesture=waterGesture.current;clearTimeout(gesture.timer);gesture.timer=setTimeout(()=>{if(waterGesture.current===gesture)settleLocalWater(true);},1500);return;}
  roomWater.current={level,gestureId:waterGesture.current.id};clearTimeout(waterTimer.current);waterTimer.current=setTimeout(()=>{const sent=sendRoomWater();if(sent)void sent.catch(shared.fail);},200);}
 // Room (GPT-6 recheck 2026-10-01): the slider sends tray.water 200 ms after the last change. Before scene.undo/redo or a new sand
 // drag that pending level is sent at once (WebSocket order = server order) and its gesture ends, so a late tray.water can never land
 // after an undo as a new step and clear redo. Changing room, losing the connection or leaving drops it and the slider shows the server level.
 // GPT-6 review 2026-10-01 20:53: a tray.water already sent by the timer but not yet ACKed is kept in waterInFlight (the newest one;
 // ACKs arrive in send order), and undo/redo waits for it too, so it never goes out with the revision from before that water change.
 const roomWater=useRef<{level:number;gestureId:string}|null>(null);
 const waterInFlight=useRef<Promise<any>|null>(null);
 // GPT-6 static review 2026-10-04 B-F1: while a level is in flight the server will end at that level, so a pending change is a no-op
 // only when it equals the last level sent (not the last confirmed one); otherwise 0.3 → 0.7 (unACKed) → 0.3 was dropped and stayed 0.7.
 const waterInFlightLevel=useRef<number|null>(null);
 function sendRoomWater(){clearTimeout(waterTimer.current);waterTimer.current=undefined;const pending=roomWater.current;roomWater.current=null;if(!pending)return undefined;
  const next=Math.round(pending.level*100)/100;const inFlight=waterInFlight.current!==null;if(next===(inFlight?waterInFlightLevel.current:trays.wet.water)){if(!inFlight)setWater(trays.wet.water);return undefined;}
  const sent=sendRef.current({type:'tray.water',trayId:'wet',level:next,gestureId:pending.gestureId},{quiet:true}).catch(e=>{setWater(trays.wet.water);throw e;});
  waterInFlight.current=sent;waterInFlightLevel.current=next;void sent.finally(()=>{if(waterInFlight.current===sent){waterInFlight.current=null;waterInFlightLevel.current=null;}}).catch(()=>{});return sent;}
 function dropRoomWater(){clearTimeout(waterTimer.current);waterTimer.current=undefined;roomWater.current=null;waterInFlight.current=null;waterInFlightLevel.current=null;if(roomId)waterGesture.current=null;}
 // Returns the sceneRevision of the water ACK, so the following undo/redo names the revision that already includes it.
 async function settleRoomWater():Promise<number|undefined>{const wait=sendRoomWater()??waterInFlight.current;waterGesture.current=null;if(!wait)return undefined;const ack=await wait;return typeof ack?.sceneRevision==='number'?ack.sceneRevision:undefined;}
 useEffect(()=>()=>dropRoomWater(),[roomId]);
 useEffect(()=>{if(shared.connected)return;const pending=waterTimer.current!==undefined;dropRoomWater();if(pending)setWater(trays.wet.water);},[shared.connected,trays]);
 const onContextLost=useCallback(()=>setContextLost(true),[]),onContextRestored=useCallback(()=>setContextLost(false),[]);
 useEffect(()=>{if(contextLost)garden.pause();},[contextLost]);
 const pngCapture=useRef<PngCapture|null>(null);
 const captureState=useRef({shared,items,loaded,contextLost});
 captureState.current={shared,items,loaded,contextLost};
 function verifyPng(){
  const state=captureState.current;
  if(garden.enabled&&garden.status!=='庭園已準備好')throw new Error('庭園尚未完整載入，請稍後再匯出。');
  if(!state.shared.connected||!state.shared.scene||state.contextLost)throw new Error('請先恢復連線與 3D 畫面，再匯出 PNG。');
  if(state.shared.hasUnconfirmedOperations()||state.items!==state.shared.scene.objects)throw new Error('作品仍在同步，請等待操作確認後匯出。');
  if(state.items.some(item=>item.animation?.state==='playing'))throw new Error('請先停止所有動作，再匯出 PNG。');
  if(state.items.some(item=>state.loaded[item.id]!==true))throw new Error('模型尚未完整載入，請稍後重試。');
  return state.items;
 }
 async function capturePng(expectedRevision:number){
  verifyPng();
  if(captureState.current.shared.scene.sceneRevision!==expectedRevision)throw new Error('作品已更新，請重新匯出。');
  if(!pngCapture.current)throw new Error('3D 畫面尚未準備好。');
  const blob=await pngCapture.current();
  verifyPng();
  if(captureState.current.shared.scene.sceneRevision!==expectedRevision)throw new Error('作品已更新，請重新匯出。');
  return blob;
 }
 useEffect(()=>{if(exploring)setPending(undefined);},[exploring]);
 useEffect(()=>{if(roomId)setItems(shared.scene?.objects??[]);},[roomId,shared.scene]);
 // A new object standing in the wet tray sends a ring across the water (both participants see it: it follows the confirmed scene).
 const seenItems=useRef<Set<string>|null>(null);
 useEffect(()=>{const seen=seenItems.current;seenItems.current=new Set(items.map(item=>item.id));if(!seen)return;for(const item of items)if(!seen.has(item.id)&&item.trayId==='wet')trays.wet.ripple(item.transform.position[0],item.transform.position[2],1);},[items,trays]);
 const current=items.find(i=>i.id===selected);const currentAsset=current?resolveAsset(current.assetId,current.assetVersion):undefined;
 const groups=useMemo(()=>shelfGroups(listable.map(a=>a.category)),[listable]);const activeGroup=groups.find(row=>row.group.id===group);
 const filtered=useMemo(()=>listable.filter(a=>(category!=='全部'?a.category===category:!activeGroup||activeGroup.categories.includes(a.category))&&(a.name+' '+a.category+' '+a.sourcePack).toLowerCase().includes(search.toLowerCase())),[listable,category,search,activeGroup]);
 function place(trayId:TrayId,x:number,z:number){if(!pending||exploring)return;if(items.length>=100){setNotice('沙盤最多放置 100 件物件。');return;}
  const [cx,cz]=clampToTray(trayConfigs[trayId],x,z);const asset=resolveAsset(pending)!;const item:Item={id:crypto.randomUUID(),assetId:pending,assetVersion:asset.version,trayId,transform:{position:[cx,groundY(trayId,cx,cz),cz],rotation:[0,0,0,1],scale:1},materialOverrides:{},hidden:false,revision:0,...(supportsColorVariants(asset.id,asset.version)?{colorVariant:'t2' as const}:{})};
  if(roomId){if(shared.info?.role!=='client'||!shared.connected)return;void shared.send({type:'object.create',objectId:item.id,assetId:item.assetId,assetVersion:item.assetVersion!,transform:item.transform,colorVariant:item.colorVariant,trayId}).catch(shared.fail);}else setItems(v=>[...v,item]);setSelected(item.id);setPending(undefined);setSandTool(null);setNotice('已放置。可拖動軸線，或用右側控制調整。');}
 function update(id:string,t:Transform){if(!validTransform(t)){setNotice('數值超出可用範圍。');return;}if(roomId){void shared.transform(id,t).catch(shared.fail);}else setItems(list=>list.map(i=>i.id===id?{...i,transform:t}:i));}
 const currentVariant=current&&currentAsset&&supportsColorVariants(currentAsset.id,currentAsset.version)?(current.colorVariant??'t2'):undefined;
 function updateColorVariant(variant:ColorVariant){if(!current||!currentAsset||!supportsColorVariants(currentAsset.id,currentAsset.version))return;const next={...current,colorVariant:variant};if(roomId){if(shared.info?.role!=='client'||!shared.connected)return;void shared.send({type:'object.appearance.commit',objectId:current.id,expectedObjectRevision:current.revision??0,materialOverrides:current.materialOverrides??{},hidden:current.hidden??false,colorVariant:variant}).catch(shared.fail);}else setItems(list=>list.map(item=>item.id===current.id?next:item));setNotice('已更新膚色。');}
 function field(key:'x'|'y'|'z'|'angle'|'scale',value:number){if(!current||!Number.isFinite(value))return;const t=structuredClone(current.transform);
  if(key==='scale')t.scale=value;else if(key==='angle')t.rotation=new Quaternion().setFromEuler(new Euler(0,value*Math.PI/180,0)).toArray();else {t.position[{x:0,y:1,z:2}[key]]=value;[t.position[0],t.position[2]]=clampToTray(trayConfigs[current.trayId??'dry'],t.position[0],t.position[2]);}
  update(current.id,t);}
 useEffect(()=>setClip(currentAsset?.clips.find(c=>c.name.toLowerCase()==='idle')?.id??currentAsset?.clips[0]?.id??''),[selected,currentAsset?.id,currentAsset?.version]);
 async function playClip(state:'playing'|'stopped'){if(!current||!currentAsset)return;const clipId=currentAsset.clips.some(c=>c.id===clip)?clip:currentAsset.clips[0]?.id;if(!clipId)return;
  if(roomId){try{await shared.animate(current.id,{clipId,state,offsetMs:0,speed:1,loop:state==='playing'});}catch(e){shared.fail(e);}return;}
  setItems(rows=>rows.map(o=>o.id===current.id?{...o,animation:{clipId,state,serverStartedAt:Date.now(),offsetMs:0,speed:1,loop:state==='playing',initiatedBy:'local'}}:o));}
 function stopLocalAnimations(){
  if(roomId)return;
  const now=Date.now();
  setItems(rows=>rows.map(item=>{
   const animation=item.animation;if(animation?.state!=='playing')return item;
   const position=pathPosition(animation,now);
   return {...item,transform:position?{...item.transform,position}:item.transform,animation:{...animation,state:'stopped',offsetMs:animation.offsetMs+Math.max(0,now-animation.serverStartedAt)*animation.speed}};
  }));
  setNotice('已停止所有動作。');
 }
 const angle=current?Math.round(new Euler().setFromQuaternion(new Quaternion(...current.transform.rotation),'YXZ').y*180/Math.PI):0;
 const viewerRole:ViewerRole=roomId?(shared.info?.role==='therapist'?'therapist':'client'):'local';const isClient=!!roomId&&shared.info?.role==='client';
 // 2026-10-10 案主影片 UX 觀察 2：等候確認時案主看到完整空白沙盤，容易以為已經入房；改在沙盤上蓋一層明確的等候提示。
 const clientWaiting=isClient&&shared.info?.admitted===false;
 const canRemove=!exploring&&(!roomId||!!shared.connected&&shared.info?.role==='client');
 function removeCurrent(){if(!current)return;if(roomId){void shared.send({type:'object.delete',objectId:current.id,expectedObjectRevision:(current as any).revision}).catch(shared.fail);return;}setItems(v=>v.filter(i=>i.id!==current.id));setLoaded(v=>{const next={...v};delete next[current.id];return next;});setSelected(undefined);setNotice('已移除物件。');}
 // UX 建議 4：選中的物件旁邊浮出常用工具；角度一次 45°、大小一次 1.25 倍，與右側欄同一套 field()／權限。
 const turn=(delta:number)=>field('angle',((angle+delta+180)%360+360)%360-180);
 const resize=(factor:number)=>{if(current)field('scale',Math.min(5,Math.max(.1,Math.round(current.transform.scale*factor*10)/10)));};
 // UX 建議 9：只有「場景已載入之後才出現」的物件會落下；第一次載入、重新連線的快照不播。
 const knownIds=useRef<Set<string>|null>(null);const sceneReady=!roomId||!!shared.scene;
 useEffect(()=>{if(sceneReady)knownIds.current=new Set(items.map(i=>i.id));else knownIds.current=null;},[items,sceneReady]);
 // UX 建議 3：從物件架直接拖進沙盤（滑鼠／觸控筆）。觸控維持「點物件 → 點沙盤」，避免和捲動物件架衝突。
 const hover=useRef<{trayId:TrayId;x:number;z:number}|null>(null);const onHover=useCallback<HoverHandler>(h=>{hover.current=h;},[]);
 const placeRef=useRef(place);placeRef.current=place;
 const shelfDrag=useRef<{assetId:DevAssetId;x:number;y:number;active:boolean}|null>(null);
 const [ghost,setGhost]=useState<{assetId:DevAssetId;x:number;y:number}|null>(null);
 useEffect(()=>{
  const move=(e:PointerEvent)=>{const d=shelfDrag.current;if(!d)return;
   if(!d.active){if(Math.hypot(e.clientX-d.x,e.clientY-d.y)<6)return;d.active=true;setPending(d.assetId);setSandTool(null);setSelected(undefined);setNotice('拖到沙盤上放開，就會放在那裡。');}
   setGhost({assetId:d.assetId,x:e.clientX,y:e.clientY});};
  const up=(e:PointerEvent)=>{const d=shelfDrag.current;shelfDrag.current=null;if(!d?.active)return;setGhost(null);
   const target=hover.current,onTray=!!(e.target as Element|null)?.closest?.('.viewport canvas, .viewport');
   if(onTray&&target)placeRef.current(target.trayId,target.x,target.z);else{setPending(undefined);setNotice('已取消放置。');}};
  const cancel=()=>{if(shelfDrag.current?.active){setPending(undefined);setGhost(null);}shelfDrag.current=null;};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);
  return()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);};
 },[]);
 const ghostAsset=ghost?devAssets.find(a=>a.id===ghost.assetId):undefined;
 return <div className={'app'+(isClient?' client-mode':'')+(chromeOpen?'':' chrome-collapsed')}>
  {!chromeOpen&&<div className="chrome-bar" data-testid="chrome-bar"><span className="brand-mark">◒</span><strong>一方沙盤</strong><span className="dot" style={{background:ROLE_COLOR[viewerRole]}}/><span>{roomId?(shared.info?.role==='client'?'案主':shared.info?.role==='therapist'?'治療師':'雙人會談'):'本機探索'}</span><span className="divider"/><span>{roomId?shared.status:'僅此頁暫存'}</span>{!!roomId&&<span className="role-legend" data-testid="role-legend"><i style={{background:ROLE_COLOR.therapist}}/>治療師<i style={{background:ROLE_COLOR.client}}/>案主</span>}
   {/* 收起時仍要看見需要回應的事：等候入房、案主的操作請求、連線中斷。點提示即展開。 */}
   {!!roomId&&shared.info?.role==='therapist'&&shared.info.waitingClient&&<button className="chrome-alert" onClick={toggleChrome}>有人在等候入房</button>}
   {!!roomId&&shared.info?.role==='client'&&Object.keys(shared.info.requests??{}).length>0&&<button className="chrome-alert" onClick={toggleChrome}>治療師請求操作物件</button>}
   {!!roomId&&!shared.connected&&<button className="chrome-alert" onClick={toggleChrome}>連線中斷</button>}
   {toolsNotice&&<span role="alert" data-testid="chrome-notice"><button className="chrome-alert" onClick={toggleChrome}>{toolsNotice}</button></span>}
   <button className="chrome-toggle" aria-expanded={false} aria-controls="session-chrome" onClick={toggleChrome}>展開上方面板 ▾</button></div>}
  <div id="session-chrome" hidden={!chromeOpen}>
  <header><div className="brand"><span className="brand-mark">◒</span><div><h1>一方沙盤</h1><p>留一點空間，讓世界慢慢成形。</p></div></div><div className="session"><span className="dot" style={{background:ROLE_COLOR[viewerRole]}}/><span data-testid="session-mode">{roomId?(shared.info?.role==="client"?"雙人會談 · 案主":shared.info?.role==="therapist"?"雙人會談 · 治療師":"雙人會談"):"本機探索"}</span><span className="divider"/>{roomId?shared.status:'僅此頁暫存'}{!!roomId&&<span className="role-legend" data-testid="role-legend"><i style={{background:ROLE_COLOR.therapist}}/>治療師<i style={{background:ROLE_COLOR.client}}/>案主</span>}<button className="chrome-toggle" aria-expanded={true} aria-controls="session-chrome" onClick={toggleChrome}>收起上方面板 ▴</button></div></header>
  <SessionTools roomId={roomId} shared={shared} selected={selected} capturePng={capturePng} settleWater={settleRoomWater} onNotice={setToolsNotice}/>
  </div>
  <div className={'workspace'+(exploring&&garden.focused?' garden-focused':'')+(libraryOpen?'':' library-closed')+(inspectorOpen?'':' inspector-closed')}>
   <aside className={'library'+(libraryOpen?'':' collapsed')}><button className="panel-toggle" aria-expanded={libraryOpen} aria-label={libraryOpen?'收起物件架':'展開物件架'} onClick={toggleLibrary}>{libraryOpen?'‹':'›'}</button>
    {libraryOpen&&<><div className="section-kicker">物件收藏</div><h2>從一件開始</h2><p className="muted">把物件拖進沙盤，或點一下物件再點沙盤。</p>
    <label className="search"><span>⌕</span><input aria-label="搜尋物件" placeholder="找一件物件…" value={search} onChange={e=>{setSearch(e.target.value);setPageSize(40);}}/></label>
    <div className="shelf-groups" role="group" aria-label="物件大類"><button className={'shelf-group'+(group==='all'?' active':'')} aria-pressed={group==='all'} aria-label="全部物件" onClick={()=>{setGroup('all');setCategory('全部');setPageSize(40);}}><span className="glyph" aria-hidden="true">全</span><span>全部</span></button>
     {groups.map(({group:g})=><button key={g.id} className={'shelf-group'+(group===g.id?' active':'')} aria-pressed={group===g.id} aria-label={g.label+'類'} onClick={()=>{setGroup(g.id);setCategory('全部');setPageSize(40);}}><span className="glyph" aria-hidden="true">{g.glyph}</span><span>{g.label}</span></button>)}</div>
    {activeGroup&&<div className="categories">{activeGroup.categories.map(c=><button key={c} className={category===c?'active':''} aria-pressed={category===c} onClick={()=>{setCategory(category===c?'全部':c);setPageSize(40);}}>{c}</button>)}</div>}
    <div className="asset-grid">{filtered.slice(0,pageSize).map(a=><button key={a.id} disabled={exploring||!!roomId&&(!shared.connected||shared.info?.role!=='client')} className={'asset-card '+(pending===a.id?'chosen':'')} onPointerDown={e=>{if(e.pointerType==='touch'||e.button!==0||e.currentTarget.disabled)return;shelfDrag.current={assetId:a.id,x:e.clientX,y:e.clientY,active:false};}} onClick={()=>{setPending(a.id);setNotice('點沙盤放置「'+a.name+'」，或按「放在中央」。');}} aria-pressed={pending===a.id}>
     <span className="asset-illustration" style={{color:a.color}}>{a.thumbnail?<img loading="lazy" src={a.thumbnail} alt="" draggable={false}/>:a.symbol}</span><span>{a.name}</span><small>{a.sourcePack?'已匯入素材':'練習物件'}</small></button>)}</div>
    {filtered.length>pageSize&&<button onClick={()=>setPageSize(n=>n+40)}>顯示更多物件（{filtered.length-pageSize}）</button>}
    {!filtered.length&&<p className="muted">沒有符合的物件。</p>}
    {!roomId&&<details className="tray-setup-local"><summary>練習用沙盤形狀與尺寸</summary><TraySetup value={setupDraft} onChange={setSetupDraft}/><button disabled={!roomTraysSchema.safeParse(setupDraft).success} onClick={()=>applyLocalSetup(setupDraft)}>套用（清空練習沙面）</button></details>}
    <div className="library-note"><span>關於這個空間</span><p>沒有標準的擺法。可以靠近、分開，也可以先留白。</p></div>
    {/* UX 建議 8：案主畫面不顯示素材授權清單（每件物件的出處仍在右側「物件細節」）。 */}
    {!isClient&&<><Credits assets={devAssets}/>
    <details><summary>原附授權檔</summary><p>熊貓使用補製黑白材質。</p>{['ARENA','DUNGEON','FURNITURE','MINI','ULTIMATE'].map(pack=><p key={pack}><a href={'/imported-assets/v1/'+pack+'-LICENSE.txt'} target="_blank" rel="noreferrer">{pack} 原附授權</a></p>)}</details>
    <p className="dev-note">{devAssets.filter(asset=>asset.sourcePack).length} 件已匯入素材 · {devAssets.filter(asset=>!asset.sourcePack).length} 件練習模型<br/>正式驗收：0 / 100</p></>}
   </>}</aside>
   <main>{(chromeOpen||exploring)&&<GardenControls garden={garden}/>}
    {/* 2026-10-10 user request: no heading row above the trays (the space goes to the trays); tests read data-items. */}
    <div className={'viewport '+(pending?'placing':'')} data-testid="viewport" data-items={items.length}>
     <Canvas shadows={garden.enabled&&garden.shadows?{type:PCFShadowMap}:false} frameloop="demand" style={{position:'absolute',inset:0}} dpr={[1,1.5]} camera={{position:[...CAMERA_ANGLE],fov:42}} fallback={<p role="alert">此裝置無法啟用 3D，請改用支援 WebGL 的瀏覽器。</p>}>
      {garden.enabled?<GardenWorld garden={garden}/>:<><color attach="background" args={['#e9e5db']}/><ambientLight intensity={1.8}/><directionalLight position={[5,10,3]} intensity={2.5}/></>}
      {exploring?<GardenWalk garden={garden}/>:<Camera view={view} trays={trayConfigs}/>}<CanvasLifecycle onLost={onContextLost} onRestored={onContextRestored}/><PngCaptureBridge capture={pngCapture} verify={verifyPng}/>
      <SandtraySurface models={trays} offsets={offsets} placing={!!pending} sculpt={sculpt} onHover={onHover} onPlace={(trayId,x,z,event)=>{if(exploring)return;if(pending)place(trayId,x,z);else if(event.delta<=4)setSelected(undefined);}}/>
      {items.map(item=><group key={item.id} position={[offsets[item.trayId??'dry'],0,0]}><ObjectView item={item} originX={offsets[item.trayId??'dry']} tray={trayConfigs[item.trayId??'dry']} groundAt={(x,z)=>groundY(item.trayId??'dry',x,z)} retryToken={modelRetries[item.id]??0} clockOffset={shared.info?.clockOffset??0} editable={!exploring&&(!roomId||shared.can(mode,item.id))} selected={item.id===selected&&!pending&&!exploring} ringColor={ROLE_COLOR[viewerRole]} heldByTherapist={!!roomId&&therapistHolds(shared.info?.grants,item.id)} dropIn={knownIds.current!==null&&!knownIds.current.has(item.id)} mode={mode} onSelect={()=>{if(!pending&&!exploring)setSelected(item.id);}} onChange={t=>update(item.id,t)} roomId={roomId} onLoad={(ok,reason)=>{setLoaded(s=>({...s,[item.id]:ok}));setLoadFailure(s=>({...s,[item.id]:ok===false?reason??'ERROR':undefined}));}}/></group>)}
      {current&&!pending&&!exploring&&!sandTool&&<group position={[offsets[current.trayId??'dry'],0,0]}><Html position={current.transform.position} zIndexRange={[20,0]}>
       <div className="quick-tools" role="toolbar" aria-label="物件快速工具" onPointerDown={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()}>
        <button aria-label="向左轉 45 度" title="向左轉" disabled={!!roomId&&!shared.can('rotate',current.id)} onClick={()=>turn(-45)}>⟲</button>
        <button aria-label="向右轉 45 度" title="向右轉" disabled={!!roomId&&!shared.can('rotate',current.id)} onClick={()=>turn(45)}>⟳</button>
        <button aria-label="縮小物件" title="縮小" disabled={!!roomId&&!shared.can('scale',current.id)||current.transform.scale<=.1} onClick={()=>resize(1/1.25)}>−</button>
        <button aria-label="放大物件" title="放大" disabled={!!roomId&&!shared.can('scale',current.id)||current.transform.scale>=5} onClick={()=>resize(1.25)}>＋</button>
        <button className="danger" aria-label="拿走這件物件" title="拿走" disabled={!canRemove} onClick={removeCurrent}>✕</button>
       </div></Html></group>}
     </Canvas>
     {contextLost&&<div className="canvas-message" role="alert">3D 顯示暫時中斷，正在等待裝置恢復。作品仍保留在本頁，請勿立即重新整理。</div>}
     {clientWaiting&&<div className="waiting-overlay" data-testid="waiting-overlay"><strong>正在等候治療師確認入房</strong><span>治療師確認後，沙盤會自動開啟，就可以開始擺放。</span><small>請保持這個頁面開著，不需要重新整理。</small></div>}
     {!exploring&&!clientWaiting&&!items.length&&!pending&&<div className="empty-hint"><span>你的世界，從這裡開始</span><small>選一件物件，或先轉轉視角。</small></div>}
     {pending&&<div className="placement"><span>點一下沙盤（左：乾沙盤・右：濕沙盤），決定位置</span><button onClick={()=>place('dry',0,0)}>放在中央</button><button onClick={()=>{setPending(undefined);setNotice('已取消放置。');}}>取消</button></div>}
     {!exploring&&<div className="camera-tools" role="toolbar" aria-label="視角">{([['angle','斜視'],['top','俯視'],['low','盤邊視角'],['dry','聚焦乾沙盤'],['wet','聚焦濕沙盤']] as [CameraKind,string][]).map(([kind,label])=><button key={kind} aria-pressed={view.kind===kind} onClick={()=>setView(v=>({kind,tick:v.tick+1}))}><ViewIcon kind={kind}/><span>{label}</span></button>)}<button onClick={()=>setView(v=>({kind:'angle',tick:v.tick+1}))}><ViewIcon kind="reset"/><span>重置視角</span></button></div>}
     {!exploring&&!toolsOpen&&<div className="sand-tools collapsed" role="toolbar" aria-label="沙盤工具">
      <button className="tools-toggle" aria-expanded={false} aria-label="展開沙盤工具" onClick={toggleTools}><ToolIcon tool={sandTool}/><span>{({dig:'挖沙',mound:'堆沙',smooth:'抹平'} as Record<string,string>)[sandTool??'']??'放置／檢視'}</span><span aria-hidden="true">▾</span></button>
     </div>}
     {!exploring&&toolsOpen&&<div className="sand-tools" role="toolbar" aria-label="沙盤工具">
      {([[null,'放置／檢視'],['dig','挖沙'],['mound','堆沙'],['smooth','抹平']] as [SandTool|null,string][]).map(([tool,label])=><button key={label} aria-pressed={sandTool===tool} disabled={tool!==null&&!canSculpt} onClick={()=>{setSandTool(tool);if(tool){setPending(undefined);setSelected(undefined);setNotice(label+'：在沙面上按住拖曳，橘色圈是一次的範圍。按住約一秒會挖到藍色盤底。');}}}><ToolIcon tool={tool}/><span>{label}</span></button>)}
      <label className="water">濕沙盤水位 <output>{Math.round(water*100)}%</output><input aria-label="濕沙盤水位" type="range" min="0" max="1" step="0.05" value={water} disabled={!canSculpt} onChange={e=>changeWater(Number(e.target.value))}/></label>
      {!roomId&&<><button disabled={!localHistorySize[0]} onClick={()=>moveLocalHistory('undo')}>復原沙盤</button><button disabled={!localHistorySize[1]} onClick={()=>moveLocalHistory('redo')}>重做沙盤</button></>}
      <button className="tools-toggle" aria-expanded={true} aria-label="收起沙盤工具" onClick={toggleTools}><span>收起</span><span aria-hidden="true">▴</span></button>
      <small data-testid="water-hint">水只會出現在挖低的地方：先「挖沙」再調高水位。</small>
      {!!roomId&&shared.info?.role==='client'&&<small>挖沙、堆沙與水位可用上方「復原／重做」退回，一次拖曳算一步。</small>}
      {!!roomId&&shared.info?.role==='therapist'&&<small>挖沙與水位只由案主操作；治療師預設唯讀，移動或縮放物件需先請求案主同意。</small>}
     </div>}
    </div>
    <div className="canvas-footer"><span role="status">{notice}</span>{!roomId&&items.some(item=>item.animation?.state==='playing')&&<button onClick={stopLocalAnimations}>停止所有動作</button>}<small>拖曳空白處轉視角 · 雙指調整視角</small></div>
   </main>
   <aside className={'inspector'+(inspectorOpen?'':' collapsed')}><button className="panel-toggle" aria-expanded={inspectorOpen} aria-label={inspectorOpen?'收起物件細節':'展開物件細節'} onClick={toggleInspector}>{inspectorOpen?'›':'‹'}</button>
    {inspectorOpen&&<><div className="section-kicker">物件細節</div><h2>{currentAsset?.name??'留意你選中的物件'}</h2>
    {!current?<p className="muted">點一下沙盤裡的物件，就能調整它的位置、方向與大小。</p>:<>
     {!!currentAsset?.clips.length&&<fieldset disabled={exploring||!!roomId&&(!shared.connected||!shared.can('animate',current.id))}><legend>角色動作</legend><select aria-label="角色動作" value={clip} onChange={e=>setClip(e.target.value)}>{currentAsset.clips.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><button onClick={()=>void playClip('playing')}>播放角色動作</button><button onClick={()=>void playClip('stopped')}>停止角色動作</button></fieldset>}
     <p className="load-status" data-testid="load-status">{loaded[current.id]===true?'3D 模型已載入':loaded[current.id]===false?loadStatusText(loadFailure[current.id]):'正在載入模型…'}</p>
     {currentVariant&&<fieldset className="color-variant" disabled={exploring||!!roomId&&(shared.info?.role!=='client'||!shared.connected)}><legend>膚色</legend><label><select aria-label="膚色變體" value={currentVariant} onChange={e=>updateColorVariant(e.target.value as ColorVariant)}>{COLOR_VARIANT_OPTIONS.map(variant=><option key={variant} value={variant}>{({t1:'淺膚',t2:'自然',t3:'小麥',t4:'棕褐',t5:'深棕',t6:'深膚',orig:'原始'} as Record<ColorVariant,string>)[variant]}</option>)}</select></label><span aria-hidden="true" style={{display:'inline-block',width:16,height:16,borderRadius:'50%',marginLeft:8,verticalAlign:'middle',backgroundColor:currentVariant==='orig'?'#1E1E1E':colorVariantHex[currentVariant]}}/></fieldset>}
     {loaded[current.id]===false&&loadFailure[current.id]==='UNAUTHENTICATED'&&<a className="reauth" href="/auth/login">重新登入</a>}
     {currentAsset&&<ProvenanceLine asset={currentAsset}/>}
     {loaded[current.id]===false&&loadFailure[current.id]!=='UNAUTHENTICATED'&&loadFailure[current.id]!=='PERMISSION_DENIED'&&<button onClick={()=>setModelRetries(values=>({...values,[current.id]:(values[current.id]??0)+1}))}>重新載入這件模型</button>}
     <fieldset disabled={exploring||!!roomId&&(!shared.connected||!current||!shared.can('translate',current.id))}><div className="mode"><button aria-pressed={mode==='translate'} onClick={()=>setMode('translate')}>移動</button><button aria-pressed={mode==='rotate'} onClick={()=>setMode('rotate')}>旋轉</button></div>
     <div className="field-label">位置</div><div className="coordinates">{(['x','y','z'] as const).map((key,index)=><label key={key}>{['左右','高低','前後'][index]}<input aria-label={['左右位置','高度位置','前後位置'][index]} type="number" step="0.1" min={[-trayHalfUnits(trayConfigs[current.trayId??'dry']).x,-1.5,-trayHalfUnits(trayConfigs[current.trayId??'dry']).z][index]} max={[trayHalfUnits(trayConfigs[current.trayId??'dry']).x,5,trayHalfUnits(trayConfigs[current.trayId??'dry']).z][index]} value={Number(current.transform.position[index].toFixed(2))} onChange={e=>field(key,e.target.valueAsNumber)}/></label>)}</div>
     </fieldset><label className="slider">方向 <output>{angle}°</output><input aria-label="物件方向" disabled={exploring||!!roomId&&!shared.can('rotate',current.id)} type="range" min="-180" max="180" step="5" value={angle} onChange={e=>field('angle',Number(e.target.value))}/></label>
     <label className="slider">大小 <output>{current.transform.scale.toFixed(1)} 倍</output><input aria-label="物件大小" disabled={exploring||!!roomId&&!shared.can('scale',current.id)} type="range" min="0.1" max="5" step="0.1" value={current.transform.scale} onChange={e=>field('scale',Number(e.target.value))}/></label>
     <p className="muted small">這裡只改變物件大小；雙指縮放調整的是你的視角。</p>
     <button className="remove" disabled={!canRemove} onClick={removeCurrent}>移除這件物件</button>
     <details><summary>位置數值</summary><output data-testid="transform">{JSON.stringify(current.transform)}</output></details>
    </>}
    {items.length>0&&<div className="scene-list"><h3>沙盤裡的物件</h3>{items.map((item,i)=><button key={item.id} aria-pressed={selected===item.id} onClick={()=>{setSelected(item.id);setPending(undefined);}}>{devAssets.find(a=>a.id===item.assetId)!.name} {i+1}</button>)}</div>}
    <div className="privacy-note">本機練習原型<p>{roomId?'會談期間暫存於伺服器。重新連線保留已確認作品，但操作授權必須重新取得。':'目前未連線治療師，也不會保存作品。重新整理後會清空。'}</p></div>
   </>}</aside>
  </div>{/* 2026-10-11 使用者指示：拿掉最下方「一方沙盤」那條，治療師／案主圖例搬到上方。 */}
  {ghost&&ghostAsset&&<div className="drag-ghost" aria-hidden="true" style={{left:ghost.x,top:ghost.y}}>{ghostAsset.thumbnail?<img src={ghostAsset.thumbnail} alt="" draggable={false}/>:<span style={{color:ghostAsset.color}}>{ghostAsset.symbol}</span>}</div>}
 </div>;
}
// 2026-10-09：入口閘門（entry-gate.tsx）通過後才掛載 App，未登入者不會建立沙盤或 WebGL。
// 2026-10-11 /admin：帳號管理頁；權限由 Worker 驗證（未登入 401、非管理員 403），不經入口閘門也不掛載沙盤。
createRoot(document.getElementById('root')!).render(location.pathname==='/admin'?<AdminPanel/>:<EntryGate><App/></EntryGate>);



