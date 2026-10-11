import {deliverAsset} from './asset-delivery';
import {purgeExpiredTombstones} from './tombstones';
import {z} from 'zod';
import type {Env} from './env';
import {id,inviteInspectSchema,inviteRedeemSchema,roomTraysSchema,hasV2Capability,offersWsSubprotocol,PROTOCOL_CAPABILITY_HEADER,PROTOCOL_CAPABILITY,WS_SUBPROTOCOL} from '../../../packages/protocol/src/index';
import {authenticate,oidc} from './auth';
import {adminDirectory,createEnrollment,deactivateTherapist,enrollmentInputSchema,requireAdmin,revokeEnrollment} from './admin';
import {serveStatic} from './static-gate';
import {body,cookieValue,error,isInputError,hashToken,json,randomToken,sameOrigin,sessionCookie} from './http';
export {AuthDurableObject} from './sessions';
export {RoomDurableObject} from './sync';
export {SceneCoordinatorDurableObject} from './coordinator';
export type {Env} from './env';
// V8-L12-3 (user ruling L01-4, session-only): rooms are always session-only; cloud retention and reopening saved scenes are gone.
// REQ-016 A6 (2026-09-30): the therapist chooses each tray's shape and size when creating the room; omitted = both standard.
const create=z.strictObject({retentionMode:z.literal('session-only'),policyVersion:id,trays:roomTraysSchema.optional()});
export default {
 async scheduled(_controller:ScheduledController,env:Env){
  // L12-3 B 段（使用者裁定 L01-4：不做每日備份）：本排程只剩 C4 #9 的 tombstone 清除。
  // 沒有備份分支，排程執行後不得產生任何備份物件（回歸案：tombstone-erasure.spec）。
  await purgeExpiredTombstones(env);
 },
 async fetch(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url),path=url.pathname;
  try{
   if(path.startsWith('/api/assets/'))return await deliverAsset(request,env);
   if(path==='/api/health')return json({status:'ok',mode:env.DEPLOY_ENV??'LOCAL_PROTOTYPE',sharedEditing:true});
   if(path.startsWith('/api/')||path.startsWith('/auth/')){
    if(!['GET','HEAD'].includes(request.method)&&!sameOrigin(request,env.APP_ORIGIN??url.origin))return error('PERMISSION_DENIED',403);
    if((path==='/auth/login'||path==='/auth/callback')&&request.method==='GET')return await oidc(request,env);
    if(path==='/auth/enroll'&&request.method==='GET')return await oidc(request,env);
    if(path==='/api/invites/inspect'&&request.method==='POST'){
      const input=inviteInspectSchema.parse(await body(request));const [roomId,secret,...extra]=input.token.split('.');if(extra.length||!id.safeParse(roomId).success||!secret)return error('PERMISSION_DENIED',403);
      const auth=env.AUTH_DO.getByName('sessions'),registration=await auth.activeInviteRegistration(roomId);if(!registration)return error('PERMISSION_DENIED',403);const secretHash=await hashToken(secret);if(registration.tokenHash!==null&&registration.tokenHash!==secretHash)return error('PERMISSION_DENIED',403);
      const room=env.ROOM_DO.getByName(roomId);await room.assertAvailable();return json(await room.inspectInvite(secretHash));
    }
    if(path==='/api/invites/redeem'&&request.method==='POST'){
      const input=inviteRedeemSchema.parse(await body(request));
      const [roomId,secret,...extra]=input.token.split('.');if(extra.length||!id.safeParse(roomId).success||!secret)return error('PERMISSION_DENIED',403);
      const auth=env.AUTH_DO.getByName('sessions'),registration=await auth.activeInviteRegistration(roomId);if(!registration)return error('PERMISSION_DENIED',403);const secretHash=await hashToken(secret);if(registration.tokenHash!==null&&registration.tokenHash!==secretHash)return error('PERMISSION_DENIED',403);
      const room=env.ROOM_DO.getByName(roomId);await room.assertAvailable();const p=await room.redeem(secretHash,input.acceptedPolicyVersion);const {token}=await auth.createSession(p);
      await auth.clearInviteRoom(roomId,registration);
      return json({id:roomId,participantId:p.participantId},200,{'Set-Cookie':sessionCookie(token)});
    }
    const auth=await authenticate(request,env);if(!auth)return error();const p=auth.session;
    const addressedRoom=path.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)(?:\/|$)/);if(addressedRoom){const authStore=env.AUTH_DO.getByName('sessions');if(!await authStore.canAddressRoom(auth.hash,addressedRoom[1]))return error('PERMISSION_DENIED',403);await env.ROOM_DO.getByName(addressedRoom[1]).assertAvailable();}
    if(path==='/auth/logout'&&request.method==='POST'){await env.AUTH_DO.getByName('sessions').revoke(auth.hash);return new Response(null,{status:204,headers:{'Cache-Control':'no-store','Set-Cookie':sessionCookie('',0)}});}
    if(path==='/api/session'&&request.method==='GET')return json({participantId:p.participantId,role:p.role,roomId:p.roomId});
    // 2026-10-11 管理員後台：每個請求都向 D1 重驗管理權（requireAdmin），只看得到、只動得到自己診所。
    if(path==='/api/admin/me'&&request.method==='GET')return json({isAdmin:(await requireAdmin(env,p))!==null});
    if(path.startsWith('/api/admin/')){const admin=await requireAdmin(env,p);if(!admin)return error('PERMISSION_DENIED',403);
     if(path==='/api/admin/directory'&&request.method==='GET')return json(await adminDirectory(env,admin));
     if(path==='/api/admin/enrollments'&&request.method==='POST'){const input=enrollmentInputSchema.parse(await body(request));return json(await createEnrollment(env,admin,input,env.APP_ORIGIN??url.origin));}
     const adminEnrollment=path.match(/^\/api\/admin\/enrollments\/([a-f0-9]{64})\/revoke$/);
     if(adminEnrollment&&request.method==='POST'){z.strictObject({}).parse(await body(request));return await revokeEnrollment(env,admin,adminEnrollment[1]);}
     const adminTherapist=path.match(/^\/api\/admin\/therapists\/([A-Za-z0-9_-]+)\/deactivate$/);
     if(adminTherapist&&request.method==='POST'){z.strictObject({}).parse(await body(request));return await deactivateTherapist(env,admin,adminTherapist[1]);}
     return error('PERMISSION_DENIED',403);
    }
    if(path==='/api/rooms'&&request.method==='POST'){
      const input=create.parse(await body(request));if(p.role!=='therapist')return error('PERMISSION_DENIED',403);
      const roomId=crypto.randomUUID(),sceneId=crypto.randomUUID(),authStore=env.AUTH_DO.getByName('sessions');
      if(!await authStore.registerRoom(roomId,p.clinicId,sceneId,p.expiresAt,true))return error('PERMISSION_DENIED',403);
      try{return json(await env.ROOM_DO.getByName(roomId).initialize(p,roomId,sceneId,input.policyVersion,'session-only',undefined,undefined,undefined,input.trays));}catch(cause){try{await authStore.unregisterRoom(roomId,p.clinicId,sceneId);}catch{/* expired registry entries fail closed and are alarm-purged */}throw cause;}
    }
        const exports=path.match(/^\/api\/scenes\/([A-Za-z0-9_-]+)\/exports$/);
    if(exports&&request.method==='POST'){const input=z.strictObject({format:z.literal('png'),consentVersion:id,expectedSceneRevision:z.number().int().nonnegative().optional()}).parse(await body(request));if(!await env.AUTH_DO.getByName('sessions').hasActiveScene(p.clinicId,exports[1]))return error('PERMISSION_DENIED',403);const roomId=await env.SCENE_COORDINATOR_DO.getByName(p.clinicId+':'+exports[1]).active();if(!roomId)return error('PERMISSION_DENIED',403);return json(await env.ROOM_DO.getByName(roomId).exportScene(p,input.format,input.consentVersion,input.expectedSceneRevision));}
    const consent=path.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)\/export-consent$/);
    if(consent&&request.method==='POST'){const input=z.strictObject({formats:z.array(z.literal('png')).max(1)}).parse(await body(request));return json(await env.ROOM_DO.getByName(consent[1]).consent(p,input.formats));}
    const waiting=path.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)\/waiting\/cancel$/);
    if(waiting&&request.method==='POST'){const input=z.strictObject({participantId:id}).parse(await body(request)),authStore=env.AUTH_DO.getByName('sessions'),registration=await authStore.activeInviteRegistration(waiting[1]);const result=await env.ROOM_DO.getByName(waiting[1]).cancelWaiting(p,input.participantId);await authStore.clearInviteRoom(waiting[1],registration);return json(result);}
    const socket=path.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)\/socket$/);
    if(socket&&request.method==='GET'){
     if(!sameOrigin(request,env.APP_ORIGIN??url.origin)||request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return error('PERMISSION_DENIED',403);
     // L07-2B C4: an old single-tray client is refused here, before the Room DO bumps epochs or broadcasts a snapshot.
     if(!hasV2Capability(request.headers))return error('UPGRADE_REQUIRED',426);
     const forwarded:Record<string,string>={Upgrade:'websocket','X-Session-Hash':auth.hash,[PROTOCOL_CAPABILITY_HEADER]:PROTOCOL_CAPABILITY};
     if(offersWsSubprotocol(request.headers))forwarded['Sec-WebSocket-Protocol']=WS_SUBPROTOCOL;
     return await env.ROOM_DO.getByName(socket[1]).fetch(new Request(request.url,{headers:forwarded}));
    }
    const leave=path.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)\/leave$/);
    // V8-L12-1A: client leaves the session without ending it; its session is revoked so the seat cannot be reused.
    if(leave&&request.method==='POST'){z.strictObject({}).parse(await body(request));const result=await env.ROOM_DO.getByName(leave[1]).leave(p);await env.AUTH_DO.getByName('sessions').revoke(auth.hash);return json(result,200,{'Set-Cookie':sessionCookie('',0)});}
    const match=path.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)\/(invites|admit|snapshot|info|close)$/);
    if(match){const [,roomId,action]=match;const room=env.ROOM_DO.getByName(roomId);
      if(action==='invites'&&request.method==='POST'){z.strictObject({}).parse(await body(request));const token=randomToken(),inviteHash=await hashToken(token),result=await room.invite(p,inviteHash);const authStore=env.AUTH_DO.getByName('sessions'),info=await room.info(p);if(!await authStore.registerRoom(roomId,p.clinicId,info.sceneId,p.expiresAt))return error('PERMISSION_DENIED',403);if(!await authStore.registerInviteRoom(roomId,result.expiresAt,inviteHash,result.generation))return error('PERMISSION_DENIED',403);return json({token:roomId+'.'+token,expiresAt:result.expiresAt});}
     if(action==='admit'&&request.method==='POST'){const input=z.strictObject({participantId:id}).parse(await body(request));return json(await room.admit(p,input.participantId));}
      if(action==='info'&&request.method==='GET'){const info=await room.info(p);if(!await env.AUTH_DO.getByName('sessions').registerRoom(roomId,p.clinicId,info.sceneId,p.expiresAt))return error('PERMISSION_DENIED',403);return json(info);}
     if(action==='snapshot'&&request.method==='GET'){if(!hasV2Capability(request.headers))return error('UPGRADE_REQUIRED',426);return json(await room.snapshot(p));}
     if(action==='close'&&request.method==='POST'){z.strictObject({}).parse(await body(request));
       const closed=await room.close(p);
       const authStore=env.AUTH_DO.getByName('sessions');try{await authStore.unregisterRoom(closed.id,closed.clinicId,closed.sceneId);await authStore.detachRoom(auth.hash,closed.id);await authStore.detachRoomFromAll(closed.id);}catch{/* room is already closed; expiring indexes cannot authorize Room DO operations */}
      // L12-2（L01-4）：結束會談＝刪除整個場景。deletion 由 coordinator 執行（tombstone → 各房 eraseScene → R2 → D1），
      // 失敗留 PENDING 並由它的 alarm 重試；close 已經把作用中的房間移除，因此重試期間任何讀寫都已被拒絕。
      const deletion=await env.SCENE_COORDINATOR_DO.getByName(closed.clinicId+':'+closed.sceneId).endSession(closed.clinicId,closed.sceneId,closed.id);
      return json({id:closed.id,deletion:deletion.status});}
    }
    return error('PERMISSION_DENIED',403);
   }
   // 2026-10-09：部署環境的靜態素材需登入（static-gate.ts）；HTML no-cache 與 CSP 也在那裡設定。
   return await serveStatic(request,env,path);
  }catch(cause){const message=cause instanceof Error?cause.message:'';if(path.startsWith('/auth/'))console.warn(JSON.stringify({event:'auth_exception',name:cause instanceof Error?cause.name:typeof cause,message:message.slice(0,120)}));else if(!isInputError(cause)&&!['LOCKED','ROOM_CLOSED','ROOM_FULL','PERMISSION_DENIED','UNAUTHENTICATED','REVISION_CONFLICT','SAVE_FAILED','RATE_LIMITED'].some(code=>message.includes(code)))console.error(JSON.stringify({event:'http_unexpected_exception',route:path.replace(/[0-9a-f-]{36}/g,':id'),method:request.method,name:cause instanceof Error?cause.name:typeof cause,message:message.slice(0,200)}));const code=['LOCKED','ROOM_CLOSED','ROOM_FULL','PERMISSION_DENIED','UNAUTHENTICATED','REVISION_CONFLICT','SAVE_FAILED','RATE_LIMITED'].find(code=>message.includes(code));return code||path.startsWith('/auth/')||isInputError(cause)?error(code??'INVALID_PAYLOAD',code==='UNAUTHENTICATED'?401:code==='SAVE_FAILED'?503:code==='RATE_LIMITED'?429:code==='LOCKED'||code==='ROOM_FULL'||code==='REVISION_CONFLICT'?409:code?403:400):error('SAVE_FAILED',503);}
 }
} satisfies ExportedHandler<Env>;


