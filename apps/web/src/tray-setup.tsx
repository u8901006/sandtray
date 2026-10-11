import {roomTraysSchema,STANDARD_ROOM_TRAYS,STANDARD_TRAY_CONFIG,type RoomTrays,type TrayConfig,type TrayId} from '../../../packages/protocol/src/index';
// REQ-016 A6 (Claude Opus 5.5, 2026-09-30): the therapist chooses each tray's shape and size when creating the room (fixed afterwards);
// the same form sets up the local practice trays. Sizes are whole centimetres: 30-120 across, 5-10 deep.
const SHAPES:[TrayConfig['shape'],string][]=[['rect','矩形'],['square','正方形'],['circle','圓形'],['octagon','八邊形']];
const ACROSS:Record<TrayConfig['shape'],string>={rect:'長',square:'邊長',circle:'直徑',octagon:'對邊距'};
const clampInt=(value:number,min:number,max:number,fallback:number)=>Number.isFinite(value)?Math.min(max,Math.max(min,Math.round(value))):fallback;
/** Keep a tray valid while it is being edited: non-rectangular trays have equal width and height. */
export function normalizeTray(tray:TrayConfig):TrayConfig{
 const w=clampInt(tray.w,30,120,72),depth=clampInt(tray.depth,5,10,7);
 return {shape:tray.shape,w,h:tray.shape==='rect'?clampInt(tray.h,30,120,57):w,depth};
}
export function describeTray(tray:TrayConfig){return tray.shape==='rect'?`矩形 ${tray.w}×${tray.h} cm，深 ${tray.depth} cm`:`${SHAPES.find(([s])=>s===tray.shape)![1]}，${ACROSS[tray.shape]} ${tray.w} cm，深 ${tray.depth} cm`;}
export function TraySetup({value,onChange,disabled}:{value:RoomTrays;onChange:(next:RoomTrays)=>void;disabled?:boolean}){
 // Typed values are kept as typed (so 100 can be typed digit by digit); the schema check below blocks creation until they are valid.
 const set=(id:TrayId,patch:Partial<TrayConfig>)=>{const next={...value[id],...patch};if(next.shape!=='rect')next.h=next.w;onChange({...value,[id]:next});};
 const valid=roomTraysSchema.safeParse(value).success;
 return <fieldset className="tray-setup" disabled={disabled}><legend>沙盤形狀與尺寸（建立後不可更改）</legend>
  {(['dry','wet'] as const).map(id=>{const tray=value[id];return <div key={id} className="tray-setup-row" data-tray={id}>
   <strong>{id==='dry'?'乾沙盤（左）':'濕沙盤（右）'}</strong>
   <label>形狀<select aria-label={(id==='dry'?'乾':'濕')+'沙盤形狀'} value={tray.shape} onChange={e=>{const shape=e.target.value as TrayConfig['shape'];set(id,shape==='rect'?{shape,w:tray.w,h:tray.shape==='rect'?tray.h:tray.w}:{shape});}}>{SHAPES.map(([shape,label])=><option key={shape} value={shape}>{label}</option>)}</select></label>
   <label>{ACROSS[tray.shape]}<input aria-label={(id==='dry'?'乾':'濕')+'沙盤'+ACROSS[tray.shape]} type="number" min={30} max={120} step={1} value={Number.isFinite(tray.w)?tray.w:""} onChange={e=>set(id,{w:e.target.valueAsNumber})}/> cm</label>
   {tray.shape==='rect'&&<label>寬<input aria-label={(id==='dry'?'乾':'濕')+'沙盤寬'} type="number" min={30} max={120} step={1} value={Number.isFinite(tray.h)?tray.h:""} onChange={e=>set(id,{h:e.target.valueAsNumber})}/> cm</label>}
   <label>深<input aria-label={(id==='dry'?'乾':'濕')+'沙盤深'} type="number" min={5} max={10} step={1} value={Number.isFinite(tray.depth)?tray.depth:""} onChange={e=>set(id,{depth:e.target.valueAsNumber})}/> cm</label>
   <button type="button" onClick={()=>onChange({...value,[id]:STANDARD_TRAY_CONFIG})}>國際標準 72×57×7</button>
  </div>;})}
  {!valid&&<span role="alert">尺寸需為 30–120 cm、深 5–10 cm。</span>}
 </fieldset>;
}
export {STANDARD_ROOM_TRAYS};
