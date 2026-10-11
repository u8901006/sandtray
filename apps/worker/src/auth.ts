import { createRemoteJWKSet } from 'jose';
import type { Env,Session } from './env';
import { verifyIdentityToken } from './oidc-verify';
import { randomToken,hashToken,cookieValue,sessionCookie,error } from './http';
import { enrollmentUsable,redeemEnrollment,therapistActive } from './admin';
export async function authenticate(request:Request,env:Env):Promise<{session:Session;hash:string}|null>{const token=cookieValue(request,'sandtray_session');if(!token||!/^[a-f0-9]{64}$/.test(token))return null;const hash=await hashToken(token);const session=await env.AUTH_DO.getByName('sessions').lookup(hash);return session?{session,hash}:null;}
type ConfiguredOidcEnv=Env&Required<Pick<Env,'APP_ORIGIN'|'OIDC_ISSUER'|'OIDC_CLIENT_ID'|'OIDC_AUTHORIZATION_URL'|'OIDC_TOKEN_URL'|'OIDC_JWKS_URL'|'DIRECTORY'>>;
function hasValidOidcConfiguration(env:Env):env is ConfiguredOidcEnv {
 const needsClientSecret=env.DEPLOY_ENV==='staging'||env.DEPLOY_ENV==='production';
 if(env.DEPLOY_ENV!==undefined&&!needsClientSecret)return false;
 const required=[env.APP_ORIGIN,env.OIDC_ISSUER,env.OIDC_CLIENT_ID,env.OIDC_AUTHORIZATION_URL,env.OIDC_TOKEN_URL,env.OIDC_JWKS_URL,...(needsClientSecret?[env.OIDC_CLIENT_SECRET]:[])];
 if(required.some(value=>typeof value!=='string'||value.trim()==='')||!env.DIRECTORY)return false;
 try {
  for(const value of [env.APP_ORIGIN,env.OIDC_ISSUER,env.OIDC_AUTHORIZATION_URL,env.OIDC_TOKEN_URL,env.OIDC_JWKS_URL])if(new URL(value!).protocol!=='https:')return false;
 } catch {
  return false;
 }
 return true;
}
export async function oidc(request:Request,env:Env):Promise<Response> {
 const url=new URL(request.url);
 if(!hasValidOidcConfiguration(env))return error('SERVICE_MISCONFIGURED',503);
 const origin=env.APP_ORIGIN;
 const auth=env.AUTH_DO.getByName('sessions');const redirectUri=origin+'/auth/callback';
 const headers=new Headers({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
 if(url.pathname==='/auth/login'||url.pathname==='/auth/enroll'){
  // 2026-10-11 加入碼：只驗是否仍可用、不消耗；雜湊隨登入嘗試存在 AUTH_DO，callback 驗完身分才消耗並綁定。
  let enrollHash:string|undefined;
  if(url.pathname==='/auth/enroll'){const code=url.searchParams.get('code')??'';enrollHash=/^[a-f0-9]{64}$/.test(code)?await hashToken(code):undefined;if(!enrollHash||!await enrollmentUsable(env,enrollHash)){headers.set('Location','/?enroll=invalid');return new Response(null,{status:302,headers});}}
  const browser=randomToken(),nonce=randomToken(),verifier=randomToken();
  const state=await auth.begin({nonce,verifier,browserHash:await hashToken(browser),expiresAt:Date.now()+600000,...(enrollHash?{enrollHash}:{})});
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
  const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const target=new URL(env.OIDC_AUTHORIZATION_URL);for(const [k,v] of Object.entries({response_type:'code',client_id:env.OIDC_CLIENT_ID,redirect_uri:redirectUri,scope:'openid',state,nonce,code_challenge:challenge,code_challenge_method:'S256'}))target.searchParams.set(k,v);
  // 加入時一定讓對方挑帳號：瀏覽器同時登入多個 Google 帳號時，不能默默綁到錯的那一個。
  if(enrollHash)target.searchParams.set('prompt','select_account');
  headers.set('Location',target.href);headers.append('Set-Cookie',`sandtray_login=${browser}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);return new Response(null,{status:302,headers});
 }
 // Staging diagnosis (2026-09-28): log only the failing stage and the IdP's error code, never tokens, codes, secrets or subject.
 const fail=(stage:string,detail='')=>{console.warn(JSON.stringify({event:'oidc_callback_rejected',stage,detail}));return error();};
 const state=url.searchParams.get('state'),code=url.searchParams.get('code'),browser=cookieValue(request,'sandtray_login');
 if(!state||!code||!browser||state.length>128||code.length>4096)return fail('params',!browser?'no_login_cookie':'');
 const attempt=await auth.consume(state,await hashToken(browser));if(!attempt)return fail('state');
 const params=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirectUri,client_id:env.OIDC_CLIENT_ID,code_verifier:attempt.verifier});
 if(env.OIDC_CLIENT_SECRET)params.set('client_secret',env.OIDC_CLIENT_SECRET);
 // Workers reject redirect:'error' with a TypeError; 'manual' surfaces a 3xx as !response.ok, which fails closed below.
 const response=await fetch(env.OIDC_TOKEN_URL,{method:'POST',body:params,redirect:'manual',signal:AbortSignal.timeout(10000)});
 if(!response.ok){let idpError='';try{idpError=String((await response.json() as {error?:unknown}).error??'').slice(0,64);}catch{/* non-JSON body */}return fail('token_exchange',response.status+' '+idpError);}const tokens=await response.json() as {id_token?:string};if(typeof tokens.id_token!=='string')return fail('no_id_token');
 const subject=await verifyIdentityToken(tokens.id_token,createRemoteJWKSet(new URL(env.OIDC_JWKS_URL)),{issuer:env.OIDC_ISSUER,clientId:env.OIDC_CLIENT_ID,nonce:attempt.nonce}).catch(cause=>{console.warn(JSON.stringify({event:'oidc_callback_rejected',stage:'id_token',detail:cause instanceof Error?(cause as {code?:string}).code??cause.message.slice(0,64):''}));throw cause;});
 return finishLogin(request,env,env.OIDC_ISSUER,subject,attempt.enrollHash);
}
/** After the ID token is verified: redeem an enrollment code if the login carried one, then open a therapist session. */
export async function finishLogin(request:Request,env:Env,issuer:string,subject:string,enrollHash?:string):Promise<Response>{
 const fail=(stage:string)=>{console.warn(JSON.stringify({event:'oidc_callback_rejected',stage,detail:''}));return error();};
 if(!env.DIRECTORY)return error('SERVICE_MISCONFIGURED',503);
 const auth=env.AUTH_DO.getByName('sessions'),headers=new Headers({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
 headers.append('Set-Cookie','sandtray_login=; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
 if(enrollHash&&!await redeemEnrollment(env,issuer,subject,enrollHash)){headers.set('Location','/?enroll=invalid');return new Response(null,{status:302,headers});}
 const identity=await env.DIRECTORY.prepare('SELECT participant_id AS participantId, clinic_id AS clinicId FROM therapists WHERE issuer=? AND subject=? AND active=1').bind(issuer,subject).first<{participantId:string;clinicId:string}>();
 if(!identity)return fail('directory');const old=await authenticate(request,env);if(old)await auth.revoke(old.hash);
 const {token}=await auth.createSession({...identity,role:'therapist'});
 // 停用與登入同時發生：停用先寫 D1 再撤銷 session；這裡在 session 建立後再查一次，兩種先後順序都不會留下有效 session。
 if(!await therapistActive(env,identity.participantId)){await auth.revoke(await hashToken(token));return fail('directory_race');}
 headers.set('Location','/');headers.append('Set-Cookie',sessionCookie(token));return new Response(null,{status:302,headers});
}
