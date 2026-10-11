import {it,expect,vi} from 'vitest';
import {loadGardenPreferences,saveGardenPreferences,defaultGardenPreferences,gardenPreferencesKey} from '../apps/web/src/garden-preferences';
it('round trips only visual settings and clears them on opt out',()=>{
 let value:string|null=null;const storage={getItem:()=>value,setItem:vi.fn((key:string,next:string)=>value=next),removeItem:vi.fn(()=>value=null)};
 const input={...defaultGardenPreferences,mood:'sunset' as const,volume:.6,sound:true,roomId:'private-room'};
 expect(saveGardenPreferences(storage,true,input)).toBe(true);expect(loadGardenPreferences(storage)).toEqual({remember:true,preferences:{...defaultGardenPreferences,mood:'sunset',volume:.6}});
 expect(JSON.parse(value!).preferences.sound).toBeUndefined();expect(JSON.parse(value!).preferences.roomId).toBeUndefined();expect(storage.setItem).toHaveBeenCalledWith(gardenPreferencesKey,expect.any(String));
 expect(saveGardenPreferences(storage,false,input)).toBe(true);expect(storage.removeItem).toHaveBeenCalledWith(gardenPreferencesKey);expect(loadGardenPreferences(storage).remember).toBe(false);
});
it('ignores corrupt or unknown versions and validates individual fields',()=>{
 for(const value of ['bad','null','[]','{"version":2,"preferences":{}}'])expect(loadGardenPreferences({getItem:()=>value})).toEqual({remember:false,preferences:defaultGardenPreferences});
 expect(loadGardenPreferences({getItem:()=>JSON.stringify({version:1,preferences:{mood:'evening',quality:'ultra',fog:'false',shadows:false,volume:99}})})).toEqual({remember:true,preferences:{...defaultGardenPreferences,mood:'evening',shadows:false}});
});
it('storage denial never prevents this-session use',()=>{
 const failure=()=>{throw new Error('denied');};expect(loadGardenPreferences({getItem:failure})).toEqual({remember:false,preferences:defaultGardenPreferences});expect(saveGardenPreferences({setItem:failure,removeItem:failure},true,defaultGardenPreferences)).toBe(false);expect(saveGardenPreferences({setItem:failure,removeItem:failure},false,defaultGardenPreferences)).toBe(false);
});
