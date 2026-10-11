import {describe,it,expect} from 'vitest';
import {pathPosition} from '../packages/room-core/src/animation';
const animation={clipId:'path',state:'playing' as const,serverStartedAt:1000,offsetMs:0,speed:1,loop:false,initiatedBy:'client',path:{points:[[0,0,0],[1,0,0],[1,0,3]] as [number,number,number][],durationMs:4000}};
describe('server-time path interpolation',()=>{
 it('travels by distance, not equal time per segment',()=>{expect(pathPosition(animation,3000)).toEqual([1,0,1]);});
 it('clamps before start and after end',()=>{expect(pathPosition(animation,0)).toEqual([0,0,0]);expect(pathPosition(animation,6000)).toEqual([1,0,3]);});
 it('paused animation uses its confirmed offset',()=>{expect(pathPosition({...animation,state:'paused',offsetMs:2000},9000)).toEqual([1,0,1]);});
 it('loop and speed share the same server clock',()=>{expect(pathPosition({...animation,loop:true,speed:2},3500)).toEqual([1,0,0]);});
 it('handles repeated points and zero-length paths',()=>{expect(pathPosition({...animation,path:{points:[[1,0,0],[1,0,0]],durationMs:1000}},4000)).toEqual([1,0,0]);});
});
