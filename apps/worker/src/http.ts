export function randomToken() {return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');}
export async function hashToken(token:string) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');}
export function cookieValue(request:Request,name:string) {const values=(request.headers.get('Cookie')??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));return values.length===1?values[0].slice(name.length+1):undefined;}
export function sessionCookie(token:string,maxAge=28800) {return `sandtray_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;}
export const json=(value:unknown,status=200,headers:HeadersInit={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',...headers}});
export const error=(code='UNAUTHENTICATED',status=401)=>json({code,requestId:crypto.randomUUID()},status);
/** Client-caused input errors only (malformed JSON, schema/size violations). Anything else is an infrastructure or programming fault. */
export const isInputError=(cause:unknown)=>cause instanceof SyntaxError||(cause instanceof Error&&(cause.name==='ZodError'||cause.message==='INVALID_PAYLOAD'));
export function sameOrigin(request:Request,origin:string) {return request.headers.get('Origin')===origin;}
export async function body(request:Request) {
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new Error('INVALID_PAYLOAD');
 const reader=request.body?.getReader();if(!reader)throw new Error('INVALID_PAYLOAD');
 const chunks:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();throw new Error('INVALID_PAYLOAD');}chunks.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
 return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
