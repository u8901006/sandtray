import {bytesToBase64,base64ToBytes,type Heightmap} from '../../../packages/sand-engine/src/core';
import {createTrayHeightmap,TRAY_BASE_COLOR} from '../../../packages/sand-engine/src/tray';
import {STANDARD_ROOM_TRAYS,type TrayId,type RoomTrays} from '../../../packages/protocol/src/index';
export {strokeTray,quantizeWater} from '../../../packages/sand-engine/src/tray';
// REQ-016 (Claude Opus 5.5, 2026-09-30): the two trays live in their own table so an object operation never rewrites ~44 KB of
// heightmap JSON. Rows are written in the same transaction as the operation receipt; erasure / session end delete them with the room.
// A6: each tray's shape and size come from the room record (chosen at creation, immutable); rooms created before A6 use the standard tray.
export const TRAYS_TABLE='CREATE TABLE IF NOT EXISTS trays (id TEXT PRIMARY KEY, data TEXT NOT NULL, water REAL NOT NULL, revision INTEGER NOT NULL)';
// Undo/redo of sand and water: the tray state before and after a history step (same step numbers as the `history` table).
export const TRAY_HISTORY_TABLE='CREATE TABLE IF NOT EXISTS tray_history (step INTEGER NOT NULL, id TEXT NOT NULL, before_data TEXT NOT NULL, before_water REAL NOT NULL, after_data TEXT NOT NULL, after_water REAL NOT NULL, PRIMARY KEY(step,id))';
export const TRAY_IDS=['dry','wet'] as const;
export interface TrayRow {id:TrayId;hm:Heightmap;water:number;revision:number}
type Sql=DurableObjectStorage['sql'];
export function readTrays(sql:Sql,config:RoomTrays=STANDARD_ROOM_TRAYS):TrayRow[]{
 const rows=new Map(sql.exec<{id:string;data:string;water:number;revision:number}>('SELECT id,data,water,revision FROM trays').toArray().map(row=>[row.id,row]));
 return TRAY_IDS.map(id=>{
  const hm=createTrayHeightmap(config[id]);const row=rows.get(id);
  if(!row)return {id,hm,water:0,revision:0};
  const data=base64ToBytes(row.data);if(data.length!==hm.data.length)throw new Error('TRAY_CORRUPT');hm.data.set(data);
  return {id,hm,water:id==='wet'?row.water:0,revision:row.revision};
 });
}
export function writeTray(sql:Sql,tray:TrayRow){sql.exec('INSERT OR REPLACE INTO trays VALUES(?,?,?,?)',tray.id,bytesToBase64(tray.hm.data),tray.water,tray.revision);}
export function trayJson(tray:TrayRow,config:RoomTrays=STANDARD_ROOM_TRAYS){
 const {shape,w,h,depth}=config[tray.id];
 return {id:tray.id,kind:tray.id,shape,sizeCm:{w,h,depth},heightmap:{w:tray.hm.w,h:tray.hm.h,encoding:'u8-base64' as const,data:bytesToBase64(tray.hm.data)},waterLevel:tray.water,baseColor:TRAY_BASE_COLOR,revision:tray.revision};
}
/** One sand/water history step: `before` is kept from the first stroke of a gesture, `after` follows every later stroke of it. */
export function recordTrayStep(sql:Sql,step:number,before:{data:string;water:number},tray:TrayRow){
 const existing=sql.exec<{before_data:string;before_water:number}>('SELECT before_data,before_water FROM tray_history WHERE step=? AND id=?',step,tray.id).toArray()[0];
 const start=existing?{data:existing.before_data,water:existing.before_water}:before;
 sql.exec('INSERT OR REPLACE INTO tray_history VALUES(?,?,?,?,?,?)',step,tray.id,start.data,start.water,bytesToBase64(tray.hm.data),tray.water);
}
/** Tray states to restore when a history step is undone (before) or redone (after). */
export function trayStepStates(sql:Sql,step:number,side:'before'|'after'){
 return sql.exec<{id:string;before_data:string;before_water:number;after_data:string;after_water:number}>('SELECT id,before_data,before_water,after_data,after_water FROM tray_history WHERE step=?',step).toArray()
  .map(row=>({id:row.id as TrayId,data:side==='before'?row.before_data:row.after_data,water:side==='before'?row.before_water:row.after_water}));
}
