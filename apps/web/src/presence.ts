// 2026-10-09 UX 建議 7、9（Claude Opus 5.5）：只做顯示。誰能操作仍由 server 端 grant／lease 決定，這裡只讀 info 做畫面提示。
export type ViewerRole='therapist'|'client'|'local';
export const ROLE_COLOR:Record<ViewerRole,string>={therapist:'#2f6f73',client:'#c9773b',local:'#c9773b'};
type GrantLike={objectId?:string;active?:boolean;expiresAt?:number};
/** An object the therapist may operate right now (an active, unexpired grant the client gave). */
export function therapistHolds(grants:Record<string,GrantLike>|undefined,objectId:string,now=Date.now()){
 return Object.values(grants??{}).some(g=>g.objectId===objectId&&g.active===true&&typeof g.expiresAt==='number'&&g.expiresAt>now);
}
/** Drop-in for a newly placed object: height above its resting place, 0 when done. Ease-out fall over `ms`. */
export const DROP_MS=320,DROP_HEIGHT=0.9;
export function dropOffset(elapsedMs:number,ms=DROP_MS,height=DROP_HEIGHT){
 if(!(elapsedMs>0))return height;if(elapsedMs>=ms)return 0;const t=elapsedMs/ms;return height*(1-t)*(1-t);
}
/** 軟體算繪（無 GPU：SwiftShader、llvmpipe、Microsoft Basic Render）每一格都吃 CPU，裝飾性的落下動畫在這類裝置不播。 */
export function isSoftwareRenderer(name:string|undefined|null){return !!name&&/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);}
const rendererNames=new WeakMap<object,string>();
export function rendererName(gl:{getContext():WebGLRenderingContext|WebGL2RenderingContext}){
 const context=gl.getContext();const cached=rendererNames.get(context);if(cached!==undefined)return cached;
 let name='';try{const info=context.getExtension('WEBGL_debug_renderer_info');name=String(context.getParameter(info?info.UNMASKED_RENDERER_WEBGL:context.RENDERER)??'');}catch{/* unknown renderer: keep the animation */}
 rendererNames.set(context,name);return name;
}
