// 2026-10-10 garden-visual-v4: third tier 'cinema' and a vegetation switch. Stored version stays 1: both fields are
// additive, and an older build reading 'cinema' falls back to its default tier.
export type GardenQuality='low'|'high'|'cinema';
export type GardenPreferences={quality:GardenQuality;mood:'day'|'sunset'|'evening';fog:boolean;shadows:boolean;lanterns:boolean;reflections:boolean;vegetation:boolean;volume:number};
export const defaultGardenPreferences:GardenPreferences={quality:'low',mood:'day',fog:true,shadows:true,lanterns:true,reflections:false,vegetation:true,volume:.25};
export const gardenPreferencesKey='sandtray.garden.preferences.v1';
function normalize(value:unknown):GardenPreferences{
 const result={...defaultGardenPreferences};if(!value||typeof value!=='object'||Array.isArray(value))return result;
 const input=value as Record<string,unknown>;
 if(input.quality==='low'||input.quality==='high'||input.quality==='cinema')result.quality=input.quality;
 if(input.mood==='day'||input.mood==='sunset'||input.mood==='evening')result.mood=input.mood;
 for(const key of ['fog','shadows','lanterns','reflections','vegetation'] as const){const field=input[key];if(typeof field==='boolean')result[key]=field;}
 if(typeof input.volume==='number'&&Number.isFinite(input.volume)&&input.volume>=0&&input.volume<=1)result.volume=input.volume;
 return result;
}
export function loadGardenPreferences(storage:Pick<Storage,'getItem'>):{remember:boolean;preferences:GardenPreferences}{
 try{const value=JSON.parse(storage.getItem(gardenPreferencesKey)??'null');if(value?.version===1&&value.preferences&&typeof value.preferences==='object'&&!Array.isArray(value.preferences))return {remember:true,preferences:normalize(value.preferences)};}catch{}
 return {remember:false,preferences:{...defaultGardenPreferences}};
}
export function saveGardenPreferences(storage:Pick<Storage,'setItem'|'removeItem'>,remember:boolean,preferences:GardenPreferences):boolean{
 try{if(remember)storage.setItem(gardenPreferencesKey,JSON.stringify({version:1,preferences:normalize(preferences)}));else storage.removeItem(gardenPreferencesKey);return true;}catch{return false;}
}
