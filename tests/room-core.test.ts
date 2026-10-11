import { describe,it,expect } from 'vitest';
import { reduceTransform,revokeAll,resetSession,acquireLease,type RoomState } from '../packages/room-core/src/index';
import type { TransformCommit } from '../packages/protocol/src/index';
const transform={position:[0,0,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:1};
const connection={participantId:'therapist',clinicId:'clinic-a',sessionEpoch:1};
const client={...connection,participantId:'client'};
function fixture():RoomState {return {roomId:'room-a',clinicId:'clinic-a',sessionEpoch:1,controlEpoch:1,status:'ACTIVE',clientLiveUntil:16000,writerLeaseUntil:16000,sceneRevision:0,nextFence:1,
  participants:{therapist:{id:'therapist',clinicId:'clinic-a',role:'therapist',sessionEpoch:1,admitted:true},client:{id:'client',clinicId:'clinic-a',role:'client',sessionEpoch:1,admitted:true}},
  objects:{a:{transform:structuredClone(transform),revision:0},b:{transform:structuredClone(transform),revision:0}},
  grants:{g:{id:'g',objectId:'a',participantId:'therapist',actions:['translate'],version:1,sessionEpoch:1,expiresAt:300000,active:true}},
  leases:{a:{id:'lease',participantId:'therapist',fence:1,expiresAt:15000,sessionEpoch:1,controlEpoch:1}}};}
function command():TransformCommit{return {protocolVersion:1,type:'object.transform.commit',operationId:'op',sessionEpoch:1,controlEpoch:1,objectId:'a',expectedObjectRevision:0,leaseId:'lease',fencingToken:1,grantId:'g',grantVersion:1,transform:{...structuredClone(transform),position:[1,0,0]}};}
describe('T03 seed / server authority',()=>{
  it('accepts authorized translation without mutating the input',()=>{const s=fixture();const before=structuredClone(s);expect(reduceTransform(s,connection,command(),1000).objects.a.transform.position).toEqual([1,0,0]);expect(s).toEqual(before);});
  it('A02 rejects default read-only and preserves scene',()=>{const s=fixture();s.grants={};expect(()=>reduceTransform(s,connection,command(),1000)).toThrow('PERMISSION_DENIED');expect(s.sceneRevision).toBe(0);});
  it('A03 rejects wrong object even with a matching object lease',()=>{const s=fixture();s.leases.b=s.leases.a;expect(()=>reduceTransform(s,connection,{...command(),objectId:'b'},1000)).toThrow('PERMISSION_DENIED');});
  it('A04 inspects every changed transform component (smuggled scale)',()=>{const cmd=command();cmd.transform.scale=2;expect(()=>reduceTransform(fixture(),connection,cmd,1000)).toThrow('PERMISSION_DENIED');});
  it('A05 rejects old packet after revoke and forbids therapist revoke',()=>{expect(()=>revokeAll(fixture(),connection)).toThrow('PERMISSION_DENIED');const s=revokeAll(fixture(),client);expect(()=>reduceTransform(s,connection,command(),1000)).toThrow('STALE_EPOCH');expect(s.objects.a.revision).toBe(0);});
  it('rejects revoked grant even when attacker guesses new epoch',()=>{const s=revokeAll(fixture(),client);expect(()=>reduceTransform(s,connection,{...command(),controlEpoch:s.controlEpoch},1000)).toThrow('PERMISSION_DENIED');});
  it('A06 uses server clock at exact expiry',()=>{const s=fixture();s.grants.g.expiresAt=2000;expect(()=>reduceTransform(s,connection,command(),2000)).toThrow('GRANT_EXPIRED');});
  it('A07 rejects stale client presence',()=>{const s=fixture();s.clientLiveUntil=1000;expect(()=>reduceTransform(s,connection,command(),1000)).toThrow('GRANT_EXPIRED');});
  it('A07 lease expires even if grant has time remaining',()=>{expect(()=>reduceTransform(fixture(),connection,command(),15000)).toThrow('LOCKED');});
  it('A08 admits only one lease and increases fence after expiry',()=>{const s=fixture();expect(()=>acquireLease(s,client,'a',['translate'],1000,'new')).toThrow('LOCKED');const next=acquireLease(s,client,'a',['translate'],15000,'new');expect(next.leases.a.fence).toBe(2);expect(next.leases.a.expiresAt).toBe(16000);});
  it('fencing rejects delayed holder',()=>{const s=fixture();s.leases.a.fence=2;expect(()=>reduceTransform(s,connection,command(),1000)).toThrow('STALE_FENCE');});
  it('stops writing at coordinator lease boundary',()=>{const s=fixture();s.writerLeaseUntil=1000;expect(()=>reduceTransform(s,connection,command(),1000)).toThrow('STALE_FENCE');});
  it('rejects revision conflict',()=>{const s=fixture();s.objects.a.revision=1;expect(()=>reduceTransform(s,connection,command(),1000)).toThrow('REVISION_CONFLICT');});
  it('A14 denies cross-clinic and unadmitted participants',()=>{expect(()=>reduceTransform(fixture(),{...connection,clinicId:'clinic-b'},command(),1000)).toThrow('UNAUTHENTICATED');const s=fixture();s.participants.therapist.admitted=false;expect(()=>reduceTransform(s,connection,command(),1000)).toThrow('UNAUTHENTICATED');});
  it('reconnect clears authority but preserves confirmed scene',()=>{const s=resetSession(fixture());expect(s.grants).toEqual({});expect(s.leases).toEqual({});expect(s.objects).toEqual(fixture().objects);expect(()=>reduceTransform(s,connection,command(),1000)).toThrow();});
  it('does not trust payload role or time',()=>{expect(()=>reduceTransform(fixture(),connection,{...command(),role:'client',now:0},1000)).toThrow('INVALID_PAYLOAD');});
  it('rejects quaternion / non-finite / bounds violations',()=>{for(const t of [{...transform,rotation:[0,0,0,0]},{...transform,scale:Infinity},{...transform,position:[6,0,0]}])expect(()=>reduceTransform(fixture(),connection,{...command(),transform:t},1000)).toThrow('INVALID_PAYLOAD');});
});
