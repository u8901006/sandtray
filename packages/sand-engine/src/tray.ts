import {createHeightmap,applyBrush,DEFAULT_RADIUS_CM,DEFAULT_STRENGTH_Q8,SMOOTH_STRENGTH_Q8,CELLS_PER_CM,type Heightmap,type BrushTool} from './core';
import {STANDARD_TRAY_CONFIG,type TrayConfig} from '../../protocol/src/index';
// REQ-016 product slice (Claude Opus 5.5, 2026-09-30): the single stroke function shared by the Room Durable Object (authority)
// and the web client (optimistic display + replay of tray.changed). Same kernel, radius and strength on both sides; points are
// integer cell indices so no float rounding can differ between engines.
/** International standard sandtray: inside 72 x 57 cm, 7 cm deep (REQ-016 §2.0). */
export const STANDARD_TRAY={shape:'rect' as const,sizeCm:{w:72,h:57,depth:7}};
export const TRAY_BASE_COLOR='#1F5F8B';
export function createStandardHeightmap():Heightmap{return createHeightmap(STANDARD_TRAY.shape,STANDARD_TRAY.sizeCm);}
/** REQ-016 A6: heightmap for a tray chosen at room creation (2 cells per cm, mask from the shape). */
export function createTrayHeightmap(tray:TrayConfig=STANDARD_TRAY_CONFIG):Heightmap{return createHeightmap(tray.shape,{w:tray.w,h:tray.h,depth:tray.depth});}
export function strokeTray(hm:Heightmap,tool:BrushTool,points:readonly (readonly [number,number])[]){
 for(const [i,j] of points)applyBrush(hm,{tool,cx:i/CELLS_PER_CM,cz:j/CELLS_PER_CM,radiusCm:DEFAULT_RADIUS_CM,strength:tool==='smooth'?SMOOTH_STRENGTH_Q8:DEFAULT_STRENGTH_Q8});
}
/** Water level is stored at 1 % steps so every client renders the same plane. */
export function quantizeWater(level:number){return Math.round(Math.min(1,Math.max(0,level))*100)/100;}
