import {test,expect,type APIRequestContext} from '@playwright/test';
// C4 #9／A17 的抹除守門（Claude Opus 5, 2026-09-26）：`purgeErasure` 是最後一步——它把 Room DO 的儲存
// 整個 deleteAll。每一個拒絕理由都是一條「還不能刪」的證據，覆蓋它們的 tombstone-purge.spec（8 案）與
// deletion.spec（3 案）在 L12-3 A 段隨 cloud 入口移除被刪掉，機制卻還在程式裡（本席 review 的 F2）。
// 本檔把拒絕理由補回：NOT_ERASED（沒抹除標記且房間仍有資料）、KEY_MISMATCH（標記屬別的場景）、
// SOCKETS_ATTACHED（仍有連線附著）。VERSIONS_REMAIN／BUSY 隨 B2 移除 VersionStore 一併消失，見下方註記。
const origin='http://127.0.0.1:8788';
const post=(api:APIRequestContext,path:string,data:unknown={})=>api.post(path,{data,headers:{Origin:origin}});
type Purge={purged:boolean;reason?:string};
const purge=async(api:APIRequestContext,roomId:string,clinicId:string,sceneId:string)=>
 (await (await post(api,`/__test/room/${roomId}/purge-erasure`,{clinicId,sceneId})).json()) as Purge;
async function room(request:APIRequestContext){
 await request.post('/__test/login',{data:{name:'therapist'}});
 expect((await post(request,'/__test/migrate')).status()).toBe(200);
 const {id,sceneId}=await (await post(request,'/api/rooms',{retentionMode:'session-only',policyVersion:'dev-v1'})).json() as {id:string;sceneId:string};
 return {id,sceneId};
}

test('C4#9 a live room with no erasure marker refuses to purge (NOT_ERASED) and keeps its data',async({request})=>{
 test.setTimeout(60000);const {id,sceneId}=await room(request);
 // The room is still active: purging here would destroy a live session's storage.
 expect(await purge(request,id,'clinic-a',sceneId)).toEqual({purged:false,reason:'NOT_ERASED'});
 const storage=await (await request.get(`/__test/room/${id}/storage-inspect`)).json() as {room:number};
 expect(storage.room).toBe(1);
 expect((await request.get(`/api/rooms/${id}/snapshot`)).status()).toBe(200);
});

test('C4#9 an erasure marker for another scene refuses to purge (KEY_MISMATCH)',async({request})=>{
 test.setTimeout(60000);const {id,sceneId}=await room(request);
 // End the session so this room carries a real erasure marker for its own scene.
 expect((await post(request,`/api/rooms/${id}/close`)).status()).toBe(200);
 await expect.poll(async()=>(await (await request.get(`/__test/room/${id}/storage-inspect`)).json() as {erasure:number}).erasure,{timeout:20000}).toBe(1);
 // A purge addressed at a different scene must be refused: the marker is the only proof of what was erased.
 expect(await purge(request,id,'clinic-a',crypto.randomUUID())).toEqual({purged:false,reason:'KEY_MISMATCH'});
 expect(await purge(request,id,'clinic-b',sceneId)).toEqual({purged:false,reason:'KEY_MISMATCH'});
 // The correct key still purges, so the refusal above was about the key and not a blanket denial.
 expect(await purge(request,id,'clinic-a',sceneId)).toEqual({purged:true});
});

// L12-3 B2（同輪移除）：跨會談版本 outbox 隨 cloud 一併移除後，`versions` 表不再存在，
// `VERSIONS_REMAIN` 與 versions 的 `BUSY` 兩個拒絕理由連同機制一起消失（不是把守門放寬）。
// 抹除現在只需要「標記存在且對應正確、且沒有連線附著」。SOCKETS_ATTACHED 由 test-socket fixture 覆蓋於下案。
test('C4#9 a socket still attached refuses to purge (SOCKETS_ATTACHED)',async({request})=>{
 test.setTimeout(60000);const {id,sceneId}=await room(request);
 expect((await post(request,`/api/rooms/${id}/close`)).status()).toBe(200);
 await expect.poll(async()=>(await (await request.get(`/__test/room/${id}/storage-inspect`)).json() as {erasure:number}).erasure,{timeout:20000}).toBe(1);
 // A socket attached to the erased room must block the final deleteAll: its close handler still reads storage.
 expect((await post(request,`/__test/room/${id}/test-socket`,{open:true})).status()).toBe(200);
 expect(await purge(request,id,'clinic-a',sceneId)).toEqual({purged:false,reason:'SOCKETS_ATTACHED'});
 // fixture 限制：WebSocketPair 的另一端沒有對象，伺服器端 close 不會完成交握，socket 不會離開
 // getWebSockets()。因此本案只證明「有 socket 附著時拒絕」；抹除後真正 purge 成功的正向路徑由上一案
 // （KEY_MISMATCH 結尾的 purged:true）覆蓋。
});
