import {describe,it,expect} from 'vitest';
import {clientPresence,CLIENT_PRESENCE_MS,reduceTransform,type RoomState} from '../packages/room-core/src/index';
import type {TransformCommit} from '../packages/protocol/src/index';
// C55 (2026-09-21): server-side presence rule behind the ui.spec GRANT_EXPIRED flake. The matrix is the whole contract:
// only the client's socket lifecycle moves clientLiveUntil; a therapist socket can neither end nor create presence.
const now=100000,live=now+9000,absent=now-1;
describe('clientPresence — who may move the client presence window',()=>{
 it('client connect and heartbeat re-arm the window to now + 15 s',()=>{
  expect(CLIENT_PRESENCE_MS).toBe(15000);
  for(const event of ['connect','heartbeat'] as const){expect(clientPresence(absent,'client',event,now)).toBe(now+15000);expect(clientPresence(live,'client',event,now)).toBe(now+15000);}
 });
 it('client disconnect ends the window immediately',()=>{expect(clientPresence(live,'client','disconnect',now)).toBe(0);expect(clientPresence(absent,'client','disconnect',now)).toBe(0);});
 it('a therapist socket never shortens a live window (the ui.spec flake)',()=>{
  for(const event of ['connect','heartbeat','disconnect'] as const)expect(clientPresence(live,'therapist',event,now)).toBe(live);
 });
 it('a therapist socket never creates or extends presence for an absent client (threat: therapist-only room)',()=>{
  for(const event of ['connect','heartbeat','disconnect'] as const){expect(clientPresence(absent,'therapist',event,now)).toBe(absent);expect(clientPresence(0,'therapist',event,now)).toBe(0);}
 });
 it('a therapist heartbeat leaves an expired window expired, so reduceTransform still denies with GRANT_EXPIRED',()=>{
  const state:RoomState={roomId:'r',clinicId:'c',sessionEpoch:1,controlEpoch:1,status:'ACTIVE',clientLiveUntil:0,writerLeaseUntil:now+15000,sceneRevision:0,nextFence:1,
   participants:{t:{id:'t',clinicId:'c',role:'therapist',sessionEpoch:1,admitted:true},k:{id:'k',clinicId:'c',role:'client',sessionEpoch:1,admitted:true}},
   objects:{a:{transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1},revision:0}},
   grants:{g:{id:'g',objectId:'a',participantId:'t',actions:['translate'],version:1,sessionEpoch:1,expiresAt:now+300000,active:true}},
   leases:{a:{id:'lease',participantId:'t',fence:1,expiresAt:now+15000,sessionEpoch:1,controlEpoch:1}}};
  state.clientLiveUntil=clientPresence(state.clientLiveUntil,'therapist','heartbeat',now);
  const cmd:TransformCommit={protocolVersion:1,type:'object.transform.commit',operationId:'op',sessionEpoch:1,controlEpoch:1,objectId:'a',expectedObjectRevision:0,leaseId:'lease',fencingToken:1,grantId:'g',grantVersion:1,transform:{position:[1,0,0],rotation:[0,0,0,1],scale:1}};
  expect(()=>reduceTransform(state,{participantId:'t',clinicId:'c',sessionEpoch:1},cmd,now)).toThrow('GRANT_EXPIRED');
  state.clientLiveUntil=clientPresence(state.clientLiveUntil,'client','heartbeat',now);
  expect(reduceTransform(state,{participantId:'t',clinicId:'c',sessionEpoch:1},cmd,now).objects.a.transform.position).toEqual([1,0,0]);
 });
});
