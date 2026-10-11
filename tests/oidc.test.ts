import { describe,it,expect } from 'vitest';
import { SignJWT, generateKeyPair, createLocalJWKSet, exportJWK } from 'jose';
import { verifyIdentityToken } from '../apps/worker/src/oidc-verify';
const pair=await generateKeyPair('RS256');
const keys=createLocalJWKSet({keys:[{...await exportJWK(pair.publicKey),kid:'key',alg:'RS256'}]});
const config={issuer:'https://issuer.example',clientId:'sandtray',nonce:'nonce'};
async function token(claims:Record<string,unknown>={}) {return new SignJWT({nonce:'nonce',...claims}).setProtectedHeader({alg:'RS256',kid:'key'}).setSubject('user').setIssuer(config.issuer).setAudience(config.clientId).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);}
describe('OIDC identity validation',()=>{
 it('accepts verified subject',async()=>{expect(await verifyIdentityToken(await token(),keys,config)).toBe('user');});
 it('rejects wrong nonce',async()=>{await expect(verifyIdentityToken(await token({nonce:'attacker'}),keys,config)).rejects.toThrow();});
 it('rejects issuer and audience mismatch',async()=>{for(const change of [{issuer:'https://evil.example'},{clientId:'another'}])await expect(verifyIdentityToken(await token(),keys,{...config,...change})).rejects.toThrow();});
 it('rejects expired token',async()=>{const jwt=await new SignJWT({nonce:'nonce'}).setProtectedHeader({alg:'RS256',kid:'key'}).setSubject('user').setIssuer(config.issuer).setAudience(config.clientId).setIssuedAt(1).setExpirationTime(2).sign(pair.privateKey);await expect(verifyIdentityToken(jwt,keys,config)).rejects.toThrow();});
 it('rejects azp for another authorized party',async()=>{await expect(verifyIdentityToken(await token({azp:'other'}),keys,config)).rejects.toThrow();});
 it('rejects forged signature',async()=>{const other=await generateKeyPair('RS256');const jwt=await new SignJWT({nonce:'nonce'}).setProtectedHeader({alg:'RS256',kid:'key'}).setSubject('user').setIssuer(config.issuer).setAudience(config.clientId).setIssuedAt().setExpirationTime('5m').sign(other.privateKey);await expect(verifyIdentityToken(jwt,keys,config)).rejects.toThrow();});
});
