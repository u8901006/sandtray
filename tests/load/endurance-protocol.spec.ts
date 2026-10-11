import {test,expect,type Page,type APIRequestContext,type BrowserContext} from '@playwright/test';
import {writeFileSync,appendFileSync,readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertStagingHealthMode} from '../../tools/verification/endurance-target';
// C12-F1：validTransform 自檢用——腳本產生的 transform 必須先通過與伺服器相同的協定驗證（C12 §4）。
import {validTransform} from '../../packages/protocol/src/index';
// AC13 60 分鐘協定耐久（門檻已由使用者 2026-09-15 核准，見 specs/001-sandtray/acceptance.md 附錄）。
// 2026-09-15 11:55 裁定（C 明確版）：ACK p50／p95 本機只記錄（localReportOnly，staging 判定）；
// 本機 60 分鐘 PASS＝其餘七項＋同機單房 E3 p50≤100（endurance-e3-ack-latency.spec.ts 單獨量測）。
// 2026-09-17 C16 補充（G13）：記憶體 ratio 亦改本機只記錄（staging 判定；兩層曲線見 summary
// memoryByLayer）——本機 PASS＝六項＋E3。
// 2026-09-17 C17 補充（G14）：建房速率上限來源 sync.ts:49（每連線每秒 10 次 commit 的協定不變式）——
// 建房每批 ≥125 ms（8/s 留 20% 餘裕）；RATE_LIMITED rejected 由 countedSend 計數並立即失敗。
// 故障注入：ENDURANCE_ACK_DEADLINE_MS 可縮短穩態 ACK 期限（預設 10000），用於驗證 C7-F1 逾時重同步
// 路徑；建房階段與收尾對帳不受影響，收尾 ackTimeouts=0 斷言在注入下會如實失敗。
// 預設值即核准形狀；smoke 驗證以 ENDURANCE_* 縮短時程，smoke 結果不構成耐久證據。
// 建房階段（每房 100 個 object.create）不計入 60 分鐘計時（核准決策明文）。
// 穩態操作集（皆為 runtime 既有已驗證操作）：
// - 每房每 tick「刪最舊＋建新件」淨零輪替：object.create 受每房 100 件硬上限（sync.ts:81 拒絕 >=100，
//   smoke run2 實測確認），且 appearance.commit 無 WS case（sync.ts switch 無該 case，落 default
//   INVALID_PAYLOAD），故持續寫入採 delete+create 輪替，輪替後 ledger 仍與 snapshot 全集比對。
// - 重送回原 ack（sync.ts:55-58 receipt 跨重連 epoch、先於 command epoch 檢查）、治療師寫入拒絕、
//   snapshot 對帳、跨房 403、client 接管重連（takeover=1，並斷言舊 socket 收 4001，C10-F1）。
// 不含動畫／授權／lease 迴圈（C4 §2 對動畫的 RATE_LIMITED 建議僅適用於耐久含動畫之情境；本腳本不含
// 動畫，故不適用，亦無 GRANT_EXPIRED 誤報面）。
// G29（C25 §2，2026-09-18 使用者裁定交 GLM）：ENDURANCE_ORIGIN 有值＝對外部（staging）跑——config 不起
// 本機 webServer、baseURL 同步指向它（playwright.endurance.config.ts）；WS 由 connect() 的
// location.origin.replace('http','ws') 自然對 https 產生 wss。staging 下：登入改塞
// ENDURANCE_SESSION_COOKIE、不啟本機 sampler（memoryByLayer 標 NOT_SAMPLED_LOCAL，記憶體判定走
// C25 §3 Dashboard）、p50/p95 斷言生效（100／300）。三 env 未設時行為與既有本機路徑完全相同。
const origin=process.env.ENDURANCE_ORIGIN??'http://127.0.0.1:8788';
const staging=Boolean(process.env.ENDURANCE_ORIGIN);
const ROOMS=10;
const DURATION_MS=Number(process.env.ENDURANCE_DURATION_MS??3600000);
const SNAPSHOT_MS=Number(process.env.ENDURANCE_SNAPSHOT_MS??300000);
const PERCENTILE_MS=Number(process.env.ENDURANCE_PERCENTILE_MS??60000);
const RECONNECT_MS=Number(process.env.ENDURANCE_RECONNECT_MS??600000);
const DUPLICATE_MS=Number(process.env.ENDURANCE_DUPLICATE_MS??30000);
const CREATE_INTERVAL_MS=Number(process.env.ENDURANCE_CREATE_INTERVAL_MS??1000);
const MEMORY_MS=Number(process.env.ENDURANCE_MEMORY_MS??30000);
// G14（C17 選項 A）：建房每批下限——sync.ts:49 每連線每秒 10 次 commit 為協定不變式，8/s 留 20% 餘裕。
const BUILD_BATCH_INTERVAL_MS=Number(process.env.ENDURANCE_BUILD_BATCH_INTERVAL_MS??125);
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
// C11-F1：Node 側每分頁 in-phase 標記（connect／evaluate 粒度；info／ws 分化由完成送出回傳的
// infoMs 事後補）。獨立心跳以此推導每房 inFlight——主迴圈停滯在 await 期間 Node event loop
// 空閒，心跳計時器必跑，停滯不會再零資料。
const activeByPage=new Map<Page,{phase:string;since:number;opId:string|null}>();
const mark=(page:Page,phase:string|null,opId:string|null)=>{if(phase===null)activeByPage.delete(page);else activeByPage.set(page,{phase,since:Date.now(),opId});};
async function connect(page:Page,id:string,takeover=false){
 mark(page,'connect','connect');
 try{
  await page.goto('/api/health');
  expect(await page.evaluate(({id,takeover})=>new Promise<boolean>(resolve=>{
   const w=window as any;w.events=[];w.eventCount=0;w.closeCode=null;
   // C10-F3：events 只留最近 200 筆＋eventCount 總數，避免 60 分鐘廣播在分頁內無上限累積。
   w.ws=new WebSocket(location.origin.replace('http','ws')+`/api/rooms/${id}/socket${takeover?'?takeover=1':''}`);
   w.ws.onmessage=(event:MessageEvent)=>{w.eventCount++;w.events.push(JSON.parse(event.data));if(w.events.length>200)w.events.shift();};
   // C10-F1：接管重連時由舊頁捕獲關閉碼（伺服器對舊 socket 送 4001 SEAT_TAKEN_OVER，sync.ts:36）。
   w.ws.onclose=(event:CloseEvent)=>{w.closeCode=event.code;};
   w.ws.onopen=()=>resolve(true);w.ws.onerror=()=>resolve(false);
  }),{id,takeover})).toBe(true);
 }finally{mark(page,null,null);}
}
async function send(page:Page,id:string,command:Record<string,unknown>,deadlineMs=10000){
 // evaluateMs 為 Node 側 page.evaluate 往返總耗時（含 /info fetch 與序列化）；ms 為瀏覽器內 send→ack 耗時；
 // infoMs 為瀏覽器內 /info fetch 耗時（ws 階段 ≈ ms−infoMs，供 H1 停滯的事後歸因）。
 const evaluateBegan=Date.now();
 mark(page,'evaluate',String(command.operationId));
 try{
  const result=await page.evaluate(async({id,command,deadlineMs})=>{
   const infoBegan=performance.now();
   // C10-F3：/info 加 10 秒 timeout——卡住的 fetch 以前會讓整個 tick 無限等待且無任何計數。
   const state=await(await fetch(`/api/rooms/${id}/info`,{signal:AbortSignal.timeout(10000)})).json() as {sessionEpoch:number;controlEpoch:number};
   const infoMs=performance.now()-infoBegan;
   const payload={protocolVersion:1,sessionEpoch:state.sessionEpoch,controlEpoch:state.controlEpoch,...command};
   const ws=(window as any).ws as WebSocket;
   // C12-F2／G19：與 command.operationId 匹配的 rejected 照常 resolve（S1 後 INVALID_PAYLOAD 也會帶回
   // 原 operationId），由 countedSend 依 event.type／旗標判別並立即失敗；'invalid'（非 JSON／壞 id，
   // S1 不回聲）走 unattributed、RATE_LIMITED 走 rateLimited。
   return new Promise<{event:any;ms:number;infoMs:number;unattributed?:boolean;rateLimited?:boolean}>((resolve,reject)=>{
    const began=performance.now();
    const finish=(event:MessageEvent)=>{const value=JSON.parse(event.data);const unattributed=value.type==='operation.rejected'&&value.operationId==='invalid';const rateLimited=value.type==='operation.rejected'&&value.code==='RATE_LIMITED';if(value.operationId!==command.operationId&&!unattributed)return;clearTimeout(timer);ws.removeEventListener('message',finish);resolve({event:value,ms:performance.now()-began,infoMs,...(unattributed?{unattributed:true}:{}),...(rateLimited?{rateLimited:true}:{})});};
    const timer=setTimeout(()=>{ws.removeEventListener('message',finish);reject(new Error(`ACK deadline exceeded (readyState=${ws.readyState} closeCode=${(window as any).closeCode} lastEvents=${JSON.stringify(((window as any).events??[]).slice(-3).map((e:any)=>e?.type??e))})`));},deadlineMs);
    ws.addEventListener('message',finish);ws.send(JSON.stringify(payload));
   });
  },{id,command,deadlineMs});
  return{...result,evaluateMs:Date.now()-evaluateBegan};
 }finally{mark(page,null,null);}
}
function percentiles(samples:number[]){
 const sorted=[...samples].sort((a,b)=>a-b);
 return{count:sorted.length,p50Ms:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],p99Ms:sorted[Math.ceil(sorted.length*.99)-1],maxMs:sorted[sorted.length-1]};
}
test('ten two-seat rooms sustain paced commits for the endurance window within approved protocol thresholds',async({request:fixtureRequest,playwright,browser},testInfo)=>{
 test.setTimeout(0);
 if(staging){
  // Fail closed before cookie use or any room/session write. A mistyped production URL is read-only probed, then refused.
  const preflight=await playwright.request.newContext({baseURL:origin});
  try{
   const health=await preflight.get('/api/health',{timeout:10000});
   expect(health.status()).toBe(200);
   assertStagingHealthMode(await health.json());
  }finally{await preflight.dispose();}
 }
 const samplerPath=fileURLToPath(new URL('../../tools/verification/memory-sampler.mjs',import.meta.url));
 const memoryPath=testInfo.outputPath('memory.jsonl'),percentilePath=testInfo.outputPath('ack-percentiles.jsonl'),ticksPath=testInfo.outputPath('tick-metrics.jsonl'),heartbeatPath=testInfo.outputPath('heartbeat.jsonl');
 let heartbeat:ReturnType<typeof setInterval>|null=null;
 const rooms:{id:string;api:APIRequestContext;cc:BrowserContext;tc:BrowserContext;c:Page;t:Page}[]=[];
 const contexts:BrowserContext[]=[],apis:APIRequestContext[]=[],ids:string[]=[];
 // 2026-09-28 user ruling: staging judges ACK p50/p95/p99 on the Room DO's own ack.serverMs (client RTT to the
 // Cloudflare colo, e.g. Taiwan->SJC ~150 ms, made the client-side 100/300 ms bounds unreachable); client ms is report-only there.
 const buildSamples:number[]=[],samples:number[]=[],serverSamples:number[]=[],ledger:string[][]=[];
 const serverMsOf=(event:any)=>{expect(typeof event.serverMs).toBe('number');return event.serverMs as number;};
  const counters={ticks:0,duplicateProbes:0,reconnects:0,snapshotChecks:0,crossRoomDenials:0,healthProbes:0,ackTimeouts:0,ledgerResyncs:0,protocolRejections:0,httpFailures:0,rateLimited:0};
  // C12-F3：http 失敗明細——每個 path 記錄首個錯誤訊息（完整計數在 counters.httpFailures），
  // 隨 summary 落地；心跳每 5 秒帶 counters 快照，停滯當下即可見。
  const httpFailures:Record<string,string>={};
 // C10-F2：每房上一 tick 的耗時（delete／create 為瀏覽器內 ack 耗時；evaluate 為 Node 側往返合計，僅計成功送出；
 // tick 為該房整 tick 牆鐘）。逾時者以 ackTimeouts／ledgerResyncs 呈現，不計入 evaluate 耗時。
 const lastTick:{deleteMs:number|null;createMs:number|null;deleteInfoMs:number|null;createInfoMs:number|null;evaluateMs:number|null;tickMs:number|null;ledgerLen:number|null}[]=rooms.map(()=>({deleteMs:null,createMs:null,deleteInfoMs:null,createInfoMs:null,evaluateMs:null,tickMs:null,ledgerLen:null}));
 // C12-F1：position 以 objectId 數字尾碼 n 產生（x∈[-4,4]、z∈[-3,3]，均在協定 x∈[-5,5]、z∈[-3.5,3.5] 內）。
 // 舊式以 objectId「長度」運算：sustain-100 起長度 18 → z=-4 違反協定，parseInbound() 在 cmd 賦值前
 // 拋 INVALID_PAYLOAD，rejected 帶 operationId:'invalid' 被客戶端過濾——三輪耐久在 tick 100 撞牆的根因
 // （C12 §1）。非數字尾碼 fallback 0，任何 objectId 產生的 position 都合法。
 const create=(roomIndex:number,objectId:string)=>{
  const n=Number(objectId.split('-').pop())||0;
  return {type:'object.create',operationId:crypto.randomUUID(),objectId,assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[(n%9)-4,0,(n%7)-3],rotation:[0,0,0,1],scale:1}};
 };
 let sampler:ReturnType<typeof spawn>|null=null;
 // G29（C25 §2.2）：staging 無 /__test/login（entry.ts 是測試 Worker）。ENDURANCE_SESSION_COOKIE 有值時
 // 改以自建 request context 直接帶 sandtray_session cookie（治療師先在瀏覽器走一次 OIDC，把
 // sandtray_session=<token> 貼進 env；值不進 repo／log／summary——本檔任何輸出（summary／heartbeat／
 // 錯誤訊息）都不含 env 原值）；瀏覽器 context 由 storageState 承襲同一 cookie（屬性比照
 // apps/worker/src/http.ts sessionCookie：Path=/、HttpOnly、SameSite=Lax、https 時 Secure）。
 // 沒值時維持 fixture request ＋ /__test/login（本機路徑，行為不變）。
 const request:APIRequestContext=process.env.ENDURANCE_SESSION_COOKIE
  ?await playwright.request.newContext({baseURL:origin,storageState:{cookies:[(()=>{
    const raw=process.env.ENDURANCE_SESSION_COOKIE!;const eq=raw.indexOf('=');
    const name=eq>=0?raw.slice(0,eq):'sandtray_session';const value=eq>=0?raw.slice(eq+1):raw;
    return{name,value,domain:new URL(origin).hostname,path:'/',expires:-1,httpOnly:true,secure:origin.startsWith('https'),sameSite:'Lax' as const};
   })()],origins:[]}})
  :fixtureRequest;
 if(!process.env.ENDURANCE_SESSION_COOKIE)await request.post('/__test/login',{data:{name:'therapist'}});
 try{
  // C12-F1：腳本自檢——以最長 sustain objectId（5 位數）驗證 position 產生式必過協定；
  // 違反即腳本缺陷，立即失敗，不進耐久視窗（三輪 tick-100 撞牆型成本的防線，C12 §4）。
  expect(validTransform(create(0,'room-0-sustain-99999').transform)).toBe(true);
  for(let index=0;index<ROOMS;index++){
   const response=await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'});expect(response.status()).toBe(200);const {id}=await response.json();ids.push(id);
   const {token}=await(await post(request,`/api/rooms/${id}/invites`)).json();
   const api=await playwright.request.newContext({baseURL:origin});apis.push(api);
   const redeemed=await post(api,'/api/invites/redeem',{token,nickname:`endurance-${index}`});expect(redeemed.status()).toBe(200);
   expect((await post(request,`/api/rooms/${id}/admit`,{participantId:(await redeemed.json()).participantId})).status()).toBe(200);
   const tc=await browser.newContext({storageState:await request.storageState()});contexts.push(tc);
   const cc=await browser.newContext({storageState:await api.storageState()});contexts.push(cc);
   const t=await tc.newPage(),c=await cc.newPage();await connect(t,id);await connect(c,id);
   rooms.push({id,api,cc,tc,c,t});ledger.push([]);
  }
  // C11-F1：獨立心跳——setInterval(5000) 與主迴圈無關，await 期間 Node event loop 空閒，計時器必跑；
  // 建房段即啟動（首次 60 分鐘跑的停滯若在建房段也不會零資料）。inFlight 以 activeByPage 推導，
  // 重連換頁（新 Page 物件無標記）自動歸 idle。
  const hbBegan=Date.now();let hbStage='building';
  heartbeat=setInterval(()=>{
   // C12-F4：每房 ledgerLength 讓「create 是否套用」可從心跳檔直接讀出（撞牆後帳目漂移可觀察）。
   try{appendFileSync(heartbeatPath,JSON.stringify({elapsedMs:Date.now()-hbBegan,stage:hbStage,counters:{...counters},inFlight:rooms.map((room,index)=>{const a=activeByPage.get(room.c);return{room:index,phase:a?.phase??'idle',sinceMs:a?Date.now()-a.since:0,opId:a?.opId??null,ledgerLength:ledger[index]?.length??0};})})+'\n');}catch{/* 心跳自身失敗不得干擾主流程 */}
  },5000);
  // 建房階段：每房 100 個 object.create（batch 模式同 ten-rooms），不計入 60 分鐘；batch 99 做原 ack 重送探針。
  // G14（C17 選項 A，2026-09-17）：每批 ≥BUILD_BATCH_INTERVAL_MS（預設 125 ms＝8 commit/s/連線）——
  // 建房速率上限來源 sync.ts:49（每連線每秒 10 次 commit 的協定不變式；run19 三連敗實證未節流必撞限）。
  for(let batch=0;batch<100;batch++){
   const batchBegan=Date.now();
   const results=await Promise.all(rooms.map(async(room,index)=>{
    const objectId=`room-${index}-object-${batch}`;
    const command=create(index,objectId);
    const receipt=await send(room.c,room.id,command);expect(receipt.event.type).toBe('operation.ack');buildSamples.push(receipt.ms);ledger[index].push(objectId);
    if(batch===99){const duplicate=await send(room.c,room.id,command);expect(duplicate.event).toEqual(receipt.event);}
    return receipt;
   }));expect(results).toHaveLength(ROOMS);
   await sleep(Math.max(0,batchBegan+BUILD_BATCH_INTERVAL_MS-Date.now()));
  }
  for(const room of rooms){
   const denied=await send(room.t,room.id,{type:'object.create',operationId:crypto.randomUUID(),objectId:'forbidden',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1}});expect(denied.event.code).toBe('PERMISSION_DENIED');
  }
  // 60 分鐘（或 smoke 時程）穩態：以主迴圈依到期時間分派，避免 interval 與斷言競態。
  const began=Date.now();const deadline=began+DURATION_MS;hbStage='sustain';
  let nextCreate=began+CREATE_INTERVAL_MS,nextHealth=began+30000,nextDuplicate=began+DUPLICATE_MS,nextPercentile=began+PERCENTILE_MS,nextReconnect=began+RECONNECT_MS,nextSnapshot=began+SNAPSHOT_MS;
 // C6-F2：樹根取 runner（本 worker 的父程序）——webServer（runtime-server→wrangler→workerd）與
 // 各 worker 都是 runner 的子樹；取 worker 自身會漏掉 wrangler/workerd。
 // G29（C25 §2.3）：staging 沒有本機程序可量——不啟 sampler（memory／memoryByLayer 標 NOT_SAMPLED_LOCAL）。
 if(!staging)sampler=spawn(process.execPath,[samplerPath,'--out',memoryPath,'--interval-ms',String(MEMORY_MS),'--duration-ms',String(DURATION_MS+30000),'--root-pid',String(process.ppid)],{stdio:'ignore'});
  const lastCommand:{command:Record<string,unknown>;event:unknown}[]=rooms.map(()=>({command:null as unknown as Record<string,unknown>,event:null}));
  // C6-F3：ACK 逾時計數而不中止。C7-F1：逾時後該房帳目狀態不明（刪除可能已／未套用），立即以
  // snapshot 重同步 ledger（伺服器為準，計數 ledgerResyncs）——後續 create 不會因刪除未確認而撞
  // 100 件上限被拒（run3 型第一次即中止、summary 缺失），帳目也不隨猜測漂移。逾時本身仍計數，
  // 收尾 ackTimeouts=0 斷言照常裁決，重同步不掩蓋逾時。operation.rejected 與連線層錯誤仍即時失敗。
  // C12-F3：Node 側 GET 統一 10 秒 timeout——無 timeout 的 GET 在半開連線下無限等待、ECONNRESET
  // 直接中止（run2 即死於 snapshot GET 的 ECONNRESET）。失敗計 counters.httpFailures＋per-path 首個
  // 錯誤訊息落地，回 null 讓呼叫方跳過該次對帳繼續——保留 60 分鐘證據；收尾 httpFailures=0 斷言
  // 確保失敗不被掩蓋（C12 §4）。
  const apiGet=(index:number,path:string)=>rooms[index].api.get(path,{timeout:10000}).catch((error:unknown)=>{
   counters.httpFailures++;const key=path.replace(/\?.*$/,'');if(!httpFailures[key])httpFailures[key]=error instanceof Error?error.message:String(error);
   return null;
  });
  const resyncLedger=async(index:number)=>{
   const response=await apiGet(index,`/api/rooms/${rooms[index].id}/snapshot`);
   if(!response)return;// C12-F3：http 失敗已計數；ledger 維持現況（狀態不明），由後續 snapshot 對帳與收尾裁決。
   const snapshot=await response.json();
   ledger[index]=snapshot.objects.map((o:any)=>o.id);counters.ledgerResyncs++;
  };
  const countedSend=async(index:number,command:Record<string,unknown>)=>{
   // ENDURANCE_ACK_DEADLINE_MS 僅為故障注入用（驗證 C7-F1 重同步路徑）；預設 10000 即核准行為。
   const deadlineMs=Number(process.env.ENDURANCE_ACK_DEADLINE_MS??10000);
   try{
    const receipt=await send(rooms[index].c,rooms[index].id,command,deadlineMs);
    // C12-F2：operationId:'invalid' 的 rejected＝伺服器無法解析 payload（腳本或協定錯誤），
    // 非耐久指標——計數並立即失敗，不讓 60 分鐘持續送非法 payload（三輪撞牆型成本，C12 §0）。
    if(receipt.unattributed){counters.protocolRejections++;throw new Error(`unattributed protocol rejection (operationId='invalid') for ${JSON.stringify(command)}`);}
    // G14（C17）：RATE_LIMITED＝腳本超過協定 10 commit/s/連線（sync.ts:49），非耐久指標——計數並立即失敗。
    if(receipt.rateLimited){counters.rateLimited++;throw new Error(`RATE_LIMITED (script exceeded protocol 10 commit/s/connection, sync.ts:49) for ${JSON.stringify(command)}`);}
    // G19（S1 落地後續，2026-09-17）：S1 使 INVALID_PAYLOAD 的 rejected 帶回原 operationId（sync.ts catch
    // 僅回聲、不持久化），與原操作匹配的 rejected 因此不再走 unattributed 路徑——此處直接判別 type：
    // 任何 rejected（不論 code）對耐久而言都是腳本／協定錯誤，計數並立即失敗，錯誤訊息帶 code 與
    // operationId 以便歸因（C12 撞牆型成本的可觀察性缺口由 S1 補上）。
    if(receipt.event.type==='operation.rejected'){counters.protocolRejections++;throw new Error(`protocol rejected (code=${receipt.event.code}, operationId=${receipt.event.operationId}) for ${JSON.stringify(command)}`);}
    return receipt;
   }catch(error){
    // Playwright 會把瀏覽器端 rejection 以「page.evaluate: 」前綴重拋，須用 includes 比對
    // （run7-attempt1 證實精確比對永不成立——逾時會被誤判為直接中止，C6-F3 計數路徑首度被實際執行）。
    if(error instanceof Error&&error.message.includes('ACK deadline exceeded')){counters.ackTimeouts++;await resyncLedger(index);return null;}
    throw error;
   }
  };
  while(Date.now()<deadline){
   const now=Date.now();
   if(now>=nextCreate){
    nextCreate=now+CREATE_INTERVAL_MS;
    await Promise.all(rooms.map(async(room,index)=>{
     // 先刪最舊（建房件 revision 恆為 0，未被 transform 過）再建新件：100 件上限下淨零輪替。
     // C6-F3：逾時計數不中止；未確認的刪除不移出 ledger，由 snapshot 對帳裁決。
     const tickBegan=Date.now();
     const removed=ledger[index][0];
     const remove={type:'object.delete',operationId:crypto.randomUUID(),objectId:removed,expectedObjectRevision:0} as Record<string,unknown>;
     const removedReceipt=await countedSend(index,remove);
     if(removedReceipt){expect(removedReceipt.event.type).toBe('operation.ack');samples.push(removedReceipt.ms);serverSamples.push(serverMsOf(removedReceipt.event));ledger[index].shift();}
     const objectId=`room-${index}-sustain-${counters.ticks}`;
     const command=create(index,objectId);
     const receipt=await countedSend(index,command);
     if(receipt){expect(receipt.event.type).toBe('operation.ack');samples.push(receipt.ms);serverSamples.push(serverMsOf(receipt.event));ledger[index].push(objectId);lastCommand[index]={command,event:receipt.event};}
     lastTick[index]={deleteMs:removedReceipt?removedReceipt.ms:null,createMs:receipt?receipt.ms:null,deleteInfoMs:removedReceipt?removedReceipt.infoMs:null,createInfoMs:receipt?receipt.infoMs:null,evaluateMs:(removedReceipt?removedReceipt.evaluateMs:0)+(receipt?receipt.evaluateMs:0),tickMs:Date.now()-tickBegan,ledgerLen:ledger[index].length};
    }));
    counters.ticks++;
   }
   if(now>=nextHealth){
    nextHealth=now+30000;
    // C12-F3：health 探針同走 10 秒 timeout；失敗計 httpFailures 並繼續（不中止），收尾斷言裁決。
    const health=await request.get('/api/health',{timeout:10000}).catch((error:unknown)=>{counters.httpFailures++;if(!httpFailures['/api/health'])httpFailures['/api/health']=error instanceof Error?error.message:String(error);return null;});
    if(health){expect(health.status()).toBe(200);counters.healthProbes++;}
   }
   if(now>=nextDuplicate){
    nextDuplicate=now+DUPLICATE_MS;
    const index=counters.duplicateProbes%ROOMS;counters.duplicateProbes++;
    const target=lastCommand[index];expect(target.command).not.toBeNull();expect(target.event).not.toBeNull();
    const duplicate=await send(rooms[index].c,rooms[index].id,target.command);
    expect(duplicate.event).toEqual(target.event);
   }
   if(now>=nextPercentile){
    nextPercentile=now+PERCENTILE_MS;
    appendFileSync(percentilePath,JSON.stringify({elapsedMs:now-began,...percentiles(samples)})+'\n');
    // C10-F2：中途失敗不再歸零——counters 快照與每房最近 tick 耗時隨分位數週期落地。
    appendFileSync(ticksPath,JSON.stringify({elapsedMs:now-began,counters:{...counters},lastTickPerRoom:lastTick})+'\n');
   }
   if(now>=nextReconnect){
    nextReconnect=now+RECONNECT_MS;
    const index=counters.reconnects%ROOMS;counters.reconnects++;
    // C10-F1：舊頁保持開啟以接收關閉事件；新頁以 takeover=1 連線（產品「接管此席位」同路徑，
    // 會 bump sessionEpoch 並清 grants/leases/consent——send() 每次取 /info 新 epoch，無需特殊處理）。
    // 舊 socket 未收到 4001 SEAT_TAKEN_OVER 即失敗（-1 為 5 秒輪詢逾時），順帶驗證接管不變式。
    const oldPage=rooms[index].c;
    const newPage=await rooms[index].cc.newPage();
    await connect(newPage,rooms[index].id,true);
    const oldCode=await oldPage.evaluate(()=>new Promise<number>(resolve=>{
     const w=window as any;const started=Date.now();
     const poll=()=>{if(typeof w.closeCode==='number'){resolve(w.closeCode);return;}if(Date.now()-started>5000){resolve(-1);return;}setTimeout(poll,100);};
     poll();
    }));
    expect(oldCode).toBe(4001);
    await oldPage.close();rooms[index].c=newPage;
   }
   if(now>=nextSnapshot){
    nextSnapshot=now+SNAPSHOT_MS;
    for(const [index,room] of rooms.entries()){
     // C12-F3：對帳／跨房探針走 apiGet（10 秒 timeout、失敗計數回 null）——該房該輪跳過、
     // 對帳計數不增加，httpFailures=0 收尾斷言確保不被掩蓋。
     const snapshotResponse=await apiGet(index,`/api/rooms/${room.id}/snapshot`);
     if(snapshotResponse){
      const snapshot=await snapshotResponse.json();
      expect(snapshot.objects.map((o:any)=>o.id).sort()).toEqual([...ledger[index]].sort());
      counters.snapshotChecks++;
     }
     const crossResponse=await apiGet(index,`/api/rooms/${rooms[(index+1)%ROOMS].id}/snapshot`);
     if(crossResponse){expect(crossResponse.status()).toBe(403);counters.crossRoomDenials++;}
    }
   }
   const next=Math.min(nextCreate,nextHealth,nextDuplicate,nextPercentile,nextReconnect,nextSnapshot,deadline);
   await sleep(Math.max(0,next-Date.now()));
  }
  // C6-F1：先寫 summary／final 分位數／記憶體評估，再進門檻斷言——60 分鐘跑到尾才失敗時仍留下完整產物
  // （smoke run3 即因順序相反而在失敗時沒有 summary）。
  if(sampler){sampler.kill();sampler=null;}
  hbStage='closing';if(heartbeat){clearInterval(heartbeat);heartbeat=null;}
  const final=percentiles(samples);
  const serverFinal=percentiles(serverSamples);
  appendFileSync(percentilePath,JSON.stringify({elapsedMs:Date.now()-began,final:true,...final})+'\n');
  for(const [index,room] of rooms.entries()){
   const snapshotResponse=await apiGet(index,`/api/rooms/${room.id}/snapshot`);
   if(!snapshotResponse)continue;// C12-F3：失敗已計數；收尾 httpFailures=0 斷言將如實失敗。
   const snapshot=await snapshotResponse.json();
   expect(snapshot.objects.map((o:any)=>o.id).sort()).toEqual([...ledger[index]].sort());counters.snapshotChecks++;
  }
  // 記憶體趨勢：最後 10 分鐘均值 ≤ 前 10 分鐘均值 ×1.5（C6-F2 取樣限測試程序樹；樣本不足時如實記錄，不宣稱達標）。
  // G29（C25 §2.3）：staging 不取樣本機 RSS——狀態標 NOT_SAMPLED_LOCAL（判定走 §3 Dashboard DO 曲線 ×1.5）。
  let memory=(staging?{status:'NOT_SAMPLED_LOCAL'}:{status:'INSUFFICIENT_SAMPLES'}) as {status:string;firstMeanWs?:number;lastMeanWs?:number;ratio?:number;samples?:number};
  if(!staging)try{
   const lines=readFileSync(memoryPath,'utf8').trim().split('\n').map(line=>JSON.parse(line));
   const totals=lines.map(line=>line.totalWs??line.processes.filter((p:any)=>!p.error).reduce((sum:number,p:any)=>sum+p.ws,0));
   const window=600000;
   const first=totals.filter((_,index)=>lines[index].elapsedMs<window);
   const last=lines.map((line,index)=>({line,index})).filter(({line})=>line.elapsedMs>=DURATION_MS-window).map(({index})=>totals[index]);
   if(first.length>=2&&last.length>=2){
    const firstMean=first.reduce((a,b)=>a+b,0)/first.length,lastMean=last.reduce((a,b)=>a+b,0)/last.length;
    memory={status:lastMean<=firstMean*1.5?'PASS':'FAIL',firstMeanWs:Math.round(firstMean),lastMeanWs:Math.round(lastMean),ratio:Number((lastMean/firstMean).toFixed(3)),samples:totals.length};
   }else memory={status:'INSUFFICIENT_SAMPLES',samples:totals.length};
  }catch{}
  // G13（C16 2026-09-17）：記憶體本機改 localReportOnly（staging 判定）；兩層 workerd 起迄／速率
  // 由 sampler 的 cmd 欄辨識（socket-addr entry=8788＝proxy workerd；其餘 workerd＝user worker，G11-D1）。
  const memoryByLayer=staging?'NOT_SAMPLED_LOCAL':(()=>{try{
   const rows=readFileSync(memoryPath,'utf8').trim().split('\n').map(line=>JSON.parse(line)) as {elapsedMs:number;processes?:{name:string;pid:number;ws:number;cmd?:string}[]}[];
   const roleByPid=new Map<string,'proxy'|'user'>();
   const series:{proxy:{t:number;pid:number;ws:number}[];user:{t:number;pid:number;ws:number}[]}={proxy:[],user:[]};
   for(const row of rows){if(!row.processes)continue;for(const p of row.processes){if(p.name!=='workerd')continue;
    if(p.cmd)roleByPid.set(String(p.pid),p.cmd.includes('socket-addr=entry=127.0.0.1:8788')?'proxy':'user');
    const role=roleByPid.get(String(p.pid));if(role)series[role].push({t:row.elapsedMs,pid:p.pid,ws:p.ws});}}
   const summarize=(points:{t:number;pid:number;ws:number}[])=>{if(points.length<2)return{samples:points.length};const a=points[0],b=points[points.length-1];
    return{pid:a.pid,startWs:a.ws,endWs:b.ws,elapsedMs:b.t-a.t,rateMbps:Number(((b.ws-a.ws)/((b.t-a.t)/1000)/1e6).toFixed(3)),samples:points.length};};
   return{proxy:summarize(series.proxy),user:summarize(series.user)};
  }catch{return{error:'unavailable'}}})();
  writeFileSync(testInfo.outputPath('endurance-summary.json'),JSON.stringify({
   scope:'Smoke or full endurance run as configured by ENDURANCE_* env. Only an uninterrupted full-window run with all asserts passing counts as AC13 evidence; a smoke run validates the script only. Per 2026-09-15 11:55 decision (option C explicit) + 2026-09-17 C16 supplement: ACK p50/p95 and memory ratio are recorded locally as localReportOnly and judged on staging; a local full-window PASS gates the remaining six approved items plus single-room E3 ack p50<=100 (endurance-e3-ack-latency.spec.ts). G29 (2026-09-18): with ENDURANCE_ORIGIN set (staging) p50/p95 thresholds are asserted in this run, login uses ENDURANCE_SESSION_COOKIE, and the local memory sampler is not started (memory judged via C25 §3 Dashboard).',
   staging,
   envMs:{duration:DURATION_MS,snapshot:SNAPSHOT_MS,percentile:PERCENTILE_MS,reconnect:RECONNECT_MS,duplicate:DUPLICATE_MS,createInterval:CREATE_INTERVAL_MS,memory:MEMORY_MS},
   rooms:ROOMS,sockets:ROOMS*2,buildingObjects:ROOMS*100,buildingAck:percentiles(buildSamples),sustainAck:final,sustainServerAck:serverFinal,ackJudgedOn:staging?'sustainServerAck (Room DO ack.serverMs; 2026-09-28 user ruling)':'sustainAck (client)',
   counters,ticksNote:'each sustain tick = per room one object.delete (oldest, revision 0) + one object.create (100-object cap keeps state net-zero)',memory,memoryJudgedOn:staging?'staging (C25 §3 Dashboard DO curves x1.5)':'staging',memoryByLayer,windowsMs:{sustainDuration:Date.now()-began},
   httpFailuresDetail:httpFailures,
   instrumentation:{reconnect:'takeover=1; asserts old socket close 4001 SEAT_TAKEN_OVER (C10-F1)',periodicLanding:'counters + per-room last-tick durations to tick-metrics.jsonl every percentile window (C10-F2); per-room ledgerLength in heartbeat.jsonl (C12-F4)',clientGuard:'/info fetch 10s timeout; page events capped at 200 + eventCount total (C10-F3); node-side GET 10s timeout with httpFailures counting, never aborting the window (C12-F3)',rejectionGuard:"any operation.rejected fails immediately via countedSend: operationId='invalid' as unattributed (C12-F2), RATE_LIMITED as rateLimited (C17/G14), attributed rejections (S1 echoes the original operationId, sync.ts catch, reply-only) detected by event type since G19; position derived from objectId numeric suffix validated against protocol schema before building (C12-F1)"},
   thresholdsApproved:{ackP50:{ms:100,judgedOn:staging?'this run (staging)':'staging'},ackP95:{ms:300,judgedOn:staging?'this run (staging)':'staging'},ackP99:{ms:1000,judgedOn:staging?'this run (staging, sustainServerAck)':'local'},ackTimeouts:0,exits:0,snapshotMismatches:0,crossRoomDenials:0,duplicateResend:'original ack',memoryRatio:{limit:1.5,judgedOn:'staging (C25 §3)'},singleRoomE3AckP50:{ms:100,measuredBy:'tests/load/endurance-e3-ack-latency.spec.ts'}},
   localReportOnly:staging?[]:['ackP50','ackP95','memoryRatio']
  },null,2)+'\n');
  // 收尾斷言（2026-09-15 11:55 裁定 C 明確版＋2026-09-17 C16 補充）：ACK p50／p95 與記憶體 ratio 本機只記錄不判（staging 判定）；
  // 本機 PASS＝p99≤1000、逾時 0（其餘項目——退出 0、快照 0、跨房 0、重送 100%——
  // 由主迴圈與收尾對帳的即時斷言涵蓋）；單房 E3 p50≤100 由 e3 spec 單獨量測。
  // C8-F1：ticks／逾時先斷言，p99 以 count>0 guard——全逾時跑次（如故障注入）不再以 undefined matcher 錯誤掩蓋設計斷言。
  expect(counters.ticks).toBeGreaterThan(0);
  expect(counters.ackTimeouts).toBe(0);
  // C12-F3：視窗內任何 Node 側 GET 失敗（逾時／ECONNRESET）都會保留證據跑完，但在此如實失敗——
  // 保留證據不等於掩蓋失敗。
  expect(counters.httpFailures).toBe(0);
  if(final.count>0){
   // G29（C25 §2.3）＋2026-09-28 使用者裁定：staging 以伺服器端 ack.serverMs 判定 p50／p95／p99（100／300／1000）；
   // 客戶端 ms 在 staging 只記錄（含到 colo 的網路 RTT）。本機維持客戶端 p99≤1000、p50／p95 只記錄。
   if(staging){expect(serverFinal.count).toBe(final.count);expect(serverFinal.p50Ms).toBeLessThanOrEqual(100);expect(serverFinal.p95Ms).toBeLessThanOrEqual(300);expect(serverFinal.p99Ms).toBeLessThanOrEqual(1000);}
   else expect(final.p99Ms).toBeLessThanOrEqual(1000);
  }
  // G13（C16 9/17）：記憶體 ratio 不再本機判定——兩層曲線交 staging（summary memoryByLayer／memoryJudgedOn）。
 }finally{
  if(heartbeat){clearInterval(heartbeat);heartbeat=null;}
  if(sampler)sampler.kill();
  for(const id of ids)await post(request,`/api/rooms/${id}/close`).catch(()=>{});
  for(const context of contexts)await context.close();for(const api of apis)await api.dispose();
  if(request!==fixtureRequest)await request.dispose();
 }
});
