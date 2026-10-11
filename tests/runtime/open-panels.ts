import type {Browser,BrowserContextOptions} from '@playwright/test';
// 2026-10-11: in a room the side panels now start folded (therapist both, client the right one; see
// tests/runtime/panel-defaults.spec.ts). Specs that exercise the object shelf or the details panel for other features open
// a context with both panels expanded, unless the spec itself has already stored a choice.
export async function roomContext(browser:Browser,options?:BrowserContextOptions){
 const context=await browser.newContext(options);
 await context.addInitScript(()=>{try{for(const role of ['therapist','client'])for(const name of ['libraryOpen','inspectorOpen']){const key=`sandtray.${name}.${role}`;if(localStorage.getItem(key)===null)localStorage.setItem(key,'1');}}catch{/* storage blocked: defaults apply */}});
 return context;
}
