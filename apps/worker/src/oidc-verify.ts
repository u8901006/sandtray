import { jwtVerify, type JWTVerifyGetKey } from 'jose';
export async function verifyIdentityToken(token:string, keys:JWTVerifyGetKey, config:{issuer:string;clientId:string;nonce:string}):Promise<string> {
 const {payload}=await jwtVerify(token,keys,{issuer:config.issuer,audience:config.clientId,algorithms:['RS256','ES256'],requiredClaims:['sub','exp','iat','nonce'],maxTokenAge:'10m'});
 if(payload.nonce!==config.nonce || !payload.sub || payload.sub.length>255 ||
   (payload.azp!==undefined && payload.azp!==config.clientId) ||
   (Array.isArray(payload.aud)&&payload.aud.length>1&&payload.azp!==config.clientId)) throw new Error('UNAUTHENTICATED');
 return payload.sub;
}
