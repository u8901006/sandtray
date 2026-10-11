import type {Env} from './env';
import {authenticate} from './auth';
import {error} from './http';
// 2026-10-09 使用者裁定（Claude Opus 5.5）：素材（GLB、縮圖、庭園環境檔）登入才能下載。
// wrangler run_worker_first=true，所有靜態請求都先經過這裡。staging／production（任何已設 DEPLOY_ENV 的環境）
// 未登入時只放行入口殼：`/`、`/index.html`、vite bundle `/assets/<檔名>`；其餘一律 401（白名單，fail-closed）。
// 白名單不接受百分比編碼與點開頭片段，避免 `/assets/..%2Fimported-assets/…` 之類被資產伺服器解碼成別的檔。
// 本機原型（未設 DEPLOY_ENV）維持公開，供 vite／runtime 測試的本機探索使用。
const PUBLIC_SHELL=/^\/(?:index\.html|assets\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)?$/;
export function staticLoginRequired(env:Pick<Env,'DEPLOY_ENV'>,pathname:string){return env.DEPLOY_ENV!==undefined&&!PUBLIC_SHELL.test(pathname);}
const CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'";
export async function serveStatic(request:Request,env:Env,pathname:string):Promise<Response>{
 const gated=staticLoginRequired(env,pathname);
 if(gated&&!await authenticate(request,env))return error();
 const assetResponse=await env.ASSETS.fetch(request);
 // GPT-6 review F1（2026-10-09）：讀檔期間可能登出／撤銷／過期；交付 bytes 前再驗一次，失效就取消 body 回 401（同 asset-delivery.ts）。
 if(gated&&!await authenticate(request,env)){await assetResponse.body?.cancel();return error();}
 const response=new Response(assetResponse.body,assetResponse);
 response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Content-Type-Options','nosniff');
 // L07-2B C4(c): the HTML shell is always revalidated, so a reload after an upgrade loads the new (hashed) bundle.
 if(response.headers.get('Content-Type')?.startsWith('text/html'))response.headers.set('Cache-Control','no-cache');
 // 需登入的檔案不得進共用快取；瀏覽器可留存但每次都要經 Worker 重新驗證（ETag／304 由資產伺服器處理）。
 else if(gated)response.headers.set('Cache-Control','private, no-cache');
 if(gated)response.headers.append('Vary','Cookie');
 response.headers.set('Content-Security-Policy',CSP);return response;
}
