import {describe,it,expect} from 'vitest';
import {ReceiptRetry,advanceEpochs} from '../apps/web/src/receipt-retry';
describe('online receipt recovery',()=>{
 it('replays the immutable original payload and clears only matching receipts',()=>{const r=new ReceiptRetry();r.bind('room:client');const cmd={type:'object.create',operationId:'a',sessionEpoch:1,transform:{scale:1}};r.remember(cmd);cmd.transform.scale=2;expect(JSON.parse(r.replay()[0])).toMatchObject({sessionEpoch:1,transform:{scale:1}});expect(r.settle('other')).toBe(false);expect(r.size).toBe(1);expect(r.settle('a')).toBe(true);expect(r.replay()).toEqual([]);});
 it.each(['object.appearance.commit','animation.set','animation.stopAll','scene.undo','scene.redo'])('retains the original durable %s command after a lost acknowledgement',type=>{const r=new ReceiptRetry();r.bind('r:client');const command={type,operationId:'lost',sessionEpoch:2,controlEpoch:3,expectedSceneRevision:4};r.remember(command);expect(r.replay()).toEqual([JSON.stringify(command)]);expect(r.settle('lost')).toBe(true);expect(r.size).toBe(0);});
 it('bounds pending edits without dropping earlier uncertain commands',()=>{const r=new ReceiptRetry(1);r.remember({type:'object.delete',operationId:'a'});expect(()=>r.remember({type:'object.create',operationId:'b'})).toThrow();expect(r.size).toBe(1);});
 it('does not retain leases, grants or heartbeats',()=>{const r=new ReceiptRetry();for(const type of ['object.lock.acquire','permission.grant','presence.heartbeat','animation.play'])expect(r.remember({type,operationId:type})).toBe(false);expect(r.size).toBe(0);});
 it('clears sensitive payloads on identity change and explicit leave',()=>{const r=new ReceiptRetry();r.bind('r:a');r.remember({type:'object.create',operationId:'a'});r.bind('r:a');expect(r.size).toBe(1);r.bind('r:b');expect(r.size).toBe(0);r.remember({type:'object.delete',operationId:'b'});r.clear();expect(r.size).toBe(0);});
 it('historical receipts cannot lower session or control epochs',()=>{expect(advanceEpochs({sessionEpoch:5,controlEpoch:8},{sessionEpoch:2,controlEpoch:3})).toEqual({sessionEpoch:5,controlEpoch:8});});
});

