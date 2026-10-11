import {loadGardenPreferences,saveGardenPreferences} from './garden-preferences';
import {useEffect,useRef,useState} from 'react';
import {useFrame,useThree} from '@react-three/fiber';
import {GardenSky} from './garden-sky';
import {GardenWater} from './garden-water';
import type {DirectionalLight} from 'three';
import {createSkyEnvironment} from './garden-environment';
import {bakeGardenGround,type GardenGround} from './garden-ground';
import {createFogUniforms,createGroundUniforms} from './garden-shaders';
import {GardenVegetation} from './garden-vegetation';
import type {GardenQuality} from './garden-preferences';
import {acquireAsset} from './asset-pool';
import {moveInGarden,gardenFloor,gardenStops,type GardenTree} from './garden-navigation';
import './garden.css';
import {gardenSurfaces} from './garden-surfaces';
import {createGardenAudio} from './garden-audio';
type Stop=keyof typeof gardenStops;type Mood='day'|'sunset'|'evening';
// 2026-10-10 garden-visual-v4: fog colours lean blue (aerial perspective); env = sky-lit PMREM strength; bounce = ground
// colour under the horizon in that environment; haze/groundFog drive the custom atmosphere in garden-shaders.ts.
const moods={day:{sky:'#b3c7c8',fog:'#b2c4cc',sun:[24,38,12],color:'#fff1da',energy:3.1,ambient:.75,exposure:1.05,env:.22,bounce:'#5d6a3c',haze:.0105,groundFog:.3},sunset:{sky:'#d0ad8a',fog:'#c7b5a6',sun:[-35,12,18],color:'#ffd0a0',energy:3.0,ambient:.55,exposure:1,env:.2,bounce:'#5f5638',haze:.0115,groundFog:.38},evening:{sky:'#394951',fog:'#5d6f78',sun:[-25,4,-25],color:'#acbacf',energy:.7,ambient:.4,exposure:.85,env:.14,bounce:'#2c3328',haze:.013,groundFog:.42}};
/** Guardrail 2: three tiers. low = phones / iPad, cinema = desktop GPUs. Each effect also has its own switch. */
const TIER={low:{glb:'low',shadowMap:1024,shadowRadius:2},high:{glb:'high',shadowMap:2048,shadowRadius:3},cinema:{glb:'high',shadowMap:4096,shadowRadius:4}} as const;
export function useGarden(){
 const [initial]=useState(()=>loadGardenPreferences({getItem:key=>window.localStorage.getItem(key)}));
 const [remember,setRemember]=useState(initial.remember),[preferenceError,setPreferenceError]=useState('');
 const savedPreferences=useRef(initial.remember);

 const [focused,setFocused]=useState(false),[settingsOpen,setSettingsOpen]=useState(false);
 const [enabled,setEnabled]=useState(false),[quality,setQuality]=useState<GardenQuality>(initial.preferences.quality),[mood,setMood]=useState<Mood>(initial.preferences.mood),[fog,setFog]=useState(initial.preferences.fog),[shadows,setShadows]=useState(initial.preferences.shadows),[lanterns,setLanterns]=useState(initial.preferences.lanterns),[reflections,setReflections]=useState(initial.preferences.reflections),[vegetation,setVegetation]=useState(initial.preferences.vegetation),[status,setStatus]=useState('正在準備庭園…'),[retry,setRetry]=useState(0);
 const [exploring,setExploring]=useState(false),[stop,setStop]=useState<Stop>('entry'),[stopTick,setStopTick]=useState(0),[pose,setPose]=useState(''),[sound,setSound]=useState(false),[volume,setVolume]=useState(initial.preferences.volume),[soundError,setSoundError]=useState('');
 useEffect(()=>{
  if(!remember&&!savedPreferences.current){setPreferenceError('');return;}
  const success=saveGardenPreferences({setItem:(key,value)=>window.localStorage.setItem(key,value),removeItem:key=>window.localStorage.removeItem(key)},remember,{quality,mood,fog,shadows,lanterns,reflections,vegetation,volume});
  if(success)savedPreferences.current=remember;
  setPreferenceError(success?'':remember?'無法記住設定，本次調整仍可使用。':'無法移除已記住的設定，請檢查瀏覽器儲存設定。');
 },[remember,quality,mood,fog,shadows,lanterns,reflections,vegetation,volume]);
 const directions=useRef(new Set<string>()),wake=useRef<()=>void>(()=>{});
 // Added trees that are drawn right now; GardenVegetation keeps it in sync so hidden trees never block walking.
 const trees=useRef<readonly GardenTree[]>([]),[treeCount,setTreeCount]=useState(0);
 const setTrees=(list:readonly GardenTree[])=>{trees.current=list;setTreeCount(list.length);};
 const [audio]=useState(()=>createGardenAudio(()=>new Audio('/environments/garden-v3/garden-ambience.wav'),(playing,error)=>{setSound(playing);setSoundError(error);}));
 const toggleSound=()=>audio.toggle();
 const pause=()=>{audio.stop();directions.current.clear();};
 useEffect(()=>audio.setVolume(volume),[audio,volume]);
 useEffect(()=>{if(!enabled){audio.stop();setExploring(false);directions.current.clear();}},[audio,enabled]);
 useEffect(()=>{const hide=()=>{if(document.hidden){audio.stop();directions.current.clear();}};document.addEventListener('visibilitychange',hide);return()=>{document.removeEventListener('visibilitychange',hide);audio.dispose();};},[audio]);
 useEffect(()=>{if(!exploring)setFocused(false);},[exploring]);
 useEffect(()=>{if(!focused)setSettingsOpen(false);},[focused]);
 function visit(next:Stop){setStop(next);setStopTick(v=>v+1);setExploring(true);directions.current.clear();}
 return {remember,setRemember,preferenceError,focused,setFocused,settingsOpen,setSettingsOpen,enabled,setEnabled,quality,setQuality,mood,setMood,fog,setFog,shadows,setShadows,lanterns,setLanterns,reflections,setReflections,vegetation,setVegetation,status,setStatus,retry,setRetry,exploring,setExploring,stop,stopTick,visit,pose,setPose,sound,volume,setVolume,soundError,toggleSound,directions,wake,trees,treeCount,setTrees,pause};
}
export type Garden=ReturnType<typeof useGarden>;
export function GardenControls({garden:g}:{garden:Garden}){
 if(!g.enabled)return <button className="garden-enter" onClick={()=>g.setEnabled(true)}>走進自然庭園</button>;
 return <section className="garden-panel" aria-label="自然庭園設定"><div className="garden-panel-title"><div><span>山林・水岸・木屋</span><strong>在自然裡，留一方自己的空間。</strong></div><button onClick={()=>g.setEnabled(false)}>切回簡約沙盤</button></div>
 <div id="garden-settings-options" hidden={g.focused&&!g.settingsOpen}><div className="garden-options"><label>光照<select aria-label="庭園光照" value={g.mood} onChange={e=>g.setMood(e.target.value as Mood)}><option value="day">清朗日光</option><option value="sunset">金色夕照</option><option value="evening">藍調暮色</option></select></label><label>畫質<select aria-label="庭園畫質" value={g.quality} onChange={e=>g.setQuality(e.target.value as GardenQuality)}><option value="low">流暢</option><option value="high">細緻</option><option value="cinema">電影（桌機）</option></select></label><label><input aria-label="庭園霧氣" type="checkbox" checked={g.fog} onChange={e=>g.setFog(e.target.checked)}/>遠山薄霧</label><label><input aria-label="庭園陰影" type="checkbox" checked={g.shadows} onChange={e=>g.setShadows(e.target.checked)}/>日光陰影</label><label><input aria-label="庭園暖光" type="checkbox" checked={g.lanterns} onChange={e=>g.setLanterns(e.target.checked)}/>暮色暖燈</label><label><input aria-label="水面倒影" type="checkbox" checked={g.reflections} onChange={e=>g.setReflections(e.target.checked)}/>水面倒影（較耗效能）</label><label><input aria-label="庭園草木" type="checkbox" checked={g.vegetation} onChange={e=>g.setVegetation(e.target.checked)}/>草叢與花木</label><button onClick={g.toggleSound}>{g.sound?'關閉環境音':'開啟環境音'}</button><label>音量<input aria-label="庭園音量" type="range" min="0" max="1" step=".05" value={g.volume} onChange={e=>g.setVolume(Number(e.target.value))}/></label><label><input type="checkbox" checked={g.remember} onChange={e=>g.setRemember(e.target.checked)}/>在這台裝置記住庭園設定</label></div>
 <div className="garden-visits">{([['entry','漫步庭園'],['water','探索水岸'],['cabin','探索木屋'],['circle','前往靜心石庭']] as const).map(([stop,label])=><button key={stop} disabled={g.status!=='庭園已準備好'} onClick={()=>g.visit(stop)}>{label}</button>)}</div></div>
 {g.preferenceError&&<p role="status">{g.preferenceError}</p>}
 {g.exploring&&<div className="garden-actions"><button className="garden-return" onClick={()=>{g.setExploring(false);g.directions.current.clear();}}>回到沙盤</button><button aria-pressed={g.focused} onClick={()=>g.setFocused(v=>!v)}>{g.focused?'還原探索畫面':'放大探索畫面'}</button>{g.focused&&<button aria-expanded={g.settingsOpen} aria-controls="garden-settings-options" onClick={()=>g.setSettingsOpen(v=>!v)}>{g.settingsOpen?'收起庭園設定':'顯示庭園設定'}</button>}</div>}
 <p data-testid="garden-status" data-trees={g.treeCount} role="status">{g.status}</p>{g.status.startsWith('庭園載入失敗')&&<button onClick={()=>g.setRetry(v=>v+1)}>重新載入庭園</button>}{g.soundError&&<p role="alert">{g.soundError}</p>}
 {g.exploring&&<div className="garden-walk"><p data-testid="explore-status" data-pose={g.pose}>探索中：拖曳看四周，WASD／方向鍵移動，Esc 回到沙盤繼續創作。</p><div aria-label="探索方向控制">{[['w','向前走'],['a','向左走'],['s','向後走'],['d','向右走']].map(([key,label])=><button key={key} onPointerDown={e=>{if(!e.isPrimary||e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);g.directions.current.add(key);g.wake.current();}} onPointerUp={()=>g.directions.current.delete(key)} onPointerCancel={()=>g.directions.current.delete(key)} onLostPointerCapture={()=>g.directions.current.delete(key)}>{label}</button>)}</div></div>}
 </section>;
}
export function GardenWorld({garden:g}:{garden:Garden}){
 const [surfaces,setSurfaces]=useState<ReturnType<typeof gardenSurfaces>>(),[ground,setGround]=useState<GardenGround>();const world=surfaces?.root;const {scene,gl,invalidate}=useThree();const mood=moods[g.mood],tier=TIER[g.quality];
 const [patch]=useState(()=>({fog:createFogUniforms(),ground:createGroundUniforms()}));
 useEffect(()=>{let active=true;let owned:ReturnType<typeof gardenSurfaces>|undefined,baked:GardenGround|undefined;setSurfaces(undefined);setGround(undefined);g.setStatus('正在準備庭園…');const handle=acquireAsset('/environments/garden-v3/garden-'+tier.glb+'.glb');void handle.promise.then(root=>{if(!active)return;owned=gardenSurfaces(root,patch);baked=bakeGardenGround(owned.root);patch.ground.gardenGroundMap.value=baked.texture;setSurfaces(owned);setGround(baked);g.setStatus('庭園已準備好');invalidate();}).catch(()=>{if(active)g.setStatus('庭園載入失敗，請重試或切回簡約沙盤。');});return()=>{active=false;if(baked&&patch.ground.gardenGroundMap.value===baked.texture)patch.ground.gardenGroundMap.value=null;baked?.dispose();owned?.dispose();handle.release();};},[tier.glb,g.retry]);
 // Proposal 1: sky-lit environment, rebuilt per mood and after a WebGL context restore (render-target contents are lost).
 const [restored,setRestored]=useState(0);
 useEffect(()=>{const bump=()=>setRestored(v=>v+1);gl.domElement.addEventListener('webglcontextrestored',bump);return()=>gl.domElement.removeEventListener('webglcontextrestored',bump);},[gl]);
 useEffect(()=>{const environment=createSkyEnvironment(gl,mood.sun,mood.bounce),old=scene.environment,oldIntensity=scene.environmentIntensity,exposure=gl.toneMappingExposure;scene.environment=environment.texture;scene.environmentIntensity=mood.env;gl.toneMappingExposure=mood.exposure;invalidate();return()=>{scene.environment=old;scene.environmentIntensity=oldIntensity;gl.toneMappingExposure=exposure;environment.dispose();};},[g.mood,restored]);
 useEffect(()=>{patch.fog.gardenFogDensity.value=mood.haze;patch.fog.gardenGroundFog.value=mood.groundFog;invalidate();},[g.mood]);
 // A changed shadow-map size only takes effect once the old map is released.
 const sun=useRef<DirectionalLight>(null);
 useEffect(()=>{const light=sun.current;if(light?.shadow.map){light.shadow.map.dispose();light.shadow.map=null;}invalidate();},[g.quality]);
 // 2026-09-30: the pavilion roof stays hidden in both modes now that its posts are removed (garden-surfaces.ts).
 useEffect(()=>{invalidate();},[world,g.exploring,g.fog,g.shadows,g.vegetation,invalidate]);
 useEffect(()=>{surfaces?.setReflections(g.reflections);invalidate();},[surfaces,g.reflections]);
 const lit=g.lanterns&&g.mood!=='day';
 useEffect(()=>{surfaces?.setLanterns(lit);invalidate();},[surfaces,lit]);
 return <><color attach="background" args={[mood.sky]}/>{g.fog&&<fog attach="fog" args={[mood.fog,28,150]}/>}<GardenSky sun={mood.sun}/><hemisphereLight args={['#d9e4e7','#6b6647',mood.ambient]}/><directionalLight ref={sun} position={mood.sun as [number,number,number]} color={mood.color} intensity={mood.energy} castShadow={g.shadows} shadow-mapSize-width={tier.shadowMap} shadow-mapSize-height={tier.shadowMap} shadow-radius={tier.shadowRadius} shadow-camera-left={-48} shadow-camera-right={48} shadow-camera-top={48} shadow-camera-bottom={-48} shadow-camera-near={1} shadow-camera-far={180} shadow-bias={-.0004} shadow-normalBias={.07}/>{lit&&<group>{([[-12,8],[-35,8],[11,-5],[16,-9],[25,-9],[-10,-8],[5,-12]] as const).map(([x,z])=><pointLight key={`${x}:${z}`} position={[x,gardenFloor(x,z)+1.4,z]} color="#ffd29b" intensity={g.mood==='evening'?14:5} distance={8} decay={2}/>)}<pointLight position={[21,2.6,-16]} color="#ffdcaa" intensity={g.mood==='evening'?30:10} distance={12} decay={2}/></group>}{surfaces&&g.reflections&&<GardenWater normalMap={surfaces.waterNormal} quality={g.quality==='low'?'low':'high'}/>} {world&&<primitive object={world} dispose={null}/>}{ground&&g.vegetation&&<GardenVegetation ground={ground} tier={g.quality} patch={patch} onTrees={g.setTrees}/>}</>;
}
export function GardenWalk({garden:g}:{garden:Garden}){
 const {camera,gl,invalidate}=useThree();const angles=useRef({yaw:0,pitch:0}),drag=useRef<{x:number;y:number}|null>(null),lastPose=useRef(0);
 useEffect(()=>{const stop=gardenStops[g.stop];camera.position.set(stop.position[0],gardenFloor(stop.position[0],stop.position[2])+1.65,stop.position[2]);angles.current={yaw:stop.yaw,pitch:0};camera.rotation.order='YXZ';camera.rotation.set(0,stop.yaw,0);g.setPose(camera.position.toArray().map(n=>n.toFixed(2)).join(','));invalidate();},[g.stop,g.stopTick]);
 useEffect(()=>{g.wake.current=invalidate;const keys=g.directions.current;const down=(e:KeyboardEvent)=>{if((e.target as HTMLElement)?.closest('input,select,textarea,[contenteditable=true]')||e.ctrlKey||e.metaKey||e.altKey)return;if(e.key==='Escape'){e.preventDefault();keys.clear();g.setExploring(false);return;}const key=({ArrowUp:'w',ArrowDown:'s',ArrowLeft:'a',ArrowRight:'d'} as Record<string,string>)[e.key]??e.key.toLowerCase();if(['w','a','s','d'].includes(key)){e.preventDefault();keys.add(key);invalidate();}};const up=(e:KeyboardEvent)=>{const key=({ArrowUp:'w',ArrowDown:'s',ArrowLeft:'a',ArrowRight:'d'} as Record<string,string>)[e.key]??e.key.toLowerCase();keys.delete(key);};const clear=()=>{keys.clear();drag.current=null;};const visibility=()=>{if(document.hidden)clear();};const start=(e:PointerEvent)=>{if(e.button!==0||!e.isPrimary||drag.current)return;drag.current={x:e.clientX,y:e.clientY};gl.domElement.setPointerCapture(e.pointerId);};const move=(e:PointerEvent)=>{if(!drag.current)return;angles.current.yaw-=(e.clientX-drag.current.x)*.004;angles.current.pitch=Math.max(-1.2,Math.min(1.2,angles.current.pitch-(e.clientY-drag.current.y)*.004));drag.current={x:e.clientX,y:e.clientY};camera.rotation.set(angles.current.pitch,angles.current.yaw,0,'YXZ');invalidate();};const end=()=>{drag.current=null;};
 window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',clear);document.addEventListener('visibilitychange',visibility);gl.domElement.addEventListener('pointerdown',start);gl.domElement.addEventListener('pointermove',move);gl.domElement.addEventListener('pointerup',end);gl.domElement.addEventListener('pointercancel',end);gl.domElement.addEventListener('lostpointercapture',end);return()=>{g.wake.current=()=>{};clear();window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',visibility);gl.domElement.removeEventListener('pointerdown',start);gl.domElement.removeEventListener('pointermove',move);gl.domElement.removeEventListener('pointerup',end);gl.domElement.removeEventListener('pointercancel',end);gl.domElement.removeEventListener('lostpointercapture',end);};},[gl,camera]);
 useFrame((_,delta)=>{if(g.status!=='庭園已準備好')return;const keys=g.directions.current;const forward=Number(keys.has('w'))-Number(keys.has('s')),side=Number(keys.has('d'))-Number(keys.has('a'));if(forward||side){const length=Math.hypot(forward,side),speed=3*Math.min(delta,.05)/length,yaw=angles.current.yaw;const x=camera.position.x+(-Math.sin(yaw)*forward+Math.cos(yaw)*side)*speed,z=camera.position.z+(-Math.cos(yaw)*forward-Math.sin(yaw)*side)*speed;const moved=moveInGarden(camera.position.x,camera.position.z,x-camera.position.x,z-camera.position.z,g.trees.current);camera.position.set(moved.x,gardenFloor(moved.x,moved.z)+1.65,moved.z);if(performance.now()-lastPose.current>150){g.setPose(camera.position.toArray().map(n=>n.toFixed(2)).join(','));lastPose.current=performance.now();}invalidate();}});return null;
}
