import type { AuthDurableObject } from './sessions';
import type { RoomDurableObject } from './sync';
import type { SceneCoordinatorDurableObject } from './coordinator';
export interface Identity { participantId:string; clinicId:string; role:'client'|'therapist'; roomId?:string; sceneId?:string }
export interface Session extends Identity { expiresAt:number }
export interface Env extends Partial<Pick<AssetDeliveryBindings,'PRIVATE_ASSETS'>> {
 ASSETS:Fetcher;
 AUTH_DO:DurableObjectNamespace<AuthDurableObject>;
 ROOM_DO:DurableObjectNamespace<RoomDurableObject>;
 SCENE_COORDINATOR_DO:DurableObjectNamespace<SceneCoordinatorDurableObject>;
 DIRECTORY?:D1Database;
 PRIVATE_SCENES?:R2Bucket;
 RETENTION_POLICY?:string;
 // L12-6：僅未設 DEPLOY_ENV 的 local/test prototype 可覆寫；staging／production 固定 8 h 並拒絕任何 override。
 TOMBSTONE_TTL_MS?:string;
 APP_ORIGIN?:string;
 DEPLOY_ENV?:'staging'|'production'; // V8-L03-1: reported by /api/health; unset means the local prototype.
 OIDC_ISSUER?:string; OIDC_CLIENT_ID?:string; OIDC_CLIENT_SECRET?:string;
 OIDC_AUTHORIZATION_URL?:string; OIDC_TOKEN_URL?:string; OIDC_JWKS_URL?:string;
}

