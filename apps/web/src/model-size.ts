// 2026-10-10 adventure-v1 (Claude Opus 5.5): placed catalogue models are normalised so their longest edge equals the asset's
// displaySize in tray units (1 unit = 7.2 cm). Assets without displaySize keep the catalogue-wide 1.6 they always had, so
// existing rooms, saves and restores render exactly as before.
export const DEFAULT_DISPLAY_SIZE=1.6;
export function normalizedScale(size:{x:number;y:number;z:number},displaySize?:number):number{
 return (displaySize??DEFAULT_DISPLAY_SIZE)/Math.max(size.x,size.y,size.z);
}
