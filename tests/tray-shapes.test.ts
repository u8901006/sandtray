import {describe,it,expect} from 'vitest';
import {trayConfigSchema,roomTraysSchema,insideTray,clampToTray,parseInbound,STANDARD_TRAY_CONFIG,STANDARD_ROOM_TRAYS,type TrayConfig} from '../packages/protocol/src/index';
import {createTrayHeightmap,strokeTray} from '../packages/sand-engine/src/tray';
import {bytesToBase64} from '../packages/sand-engine/src/core';
import {authorizeTransform,objectInTray,type RoomState} from '../packages/room-core/src/index';
import {TrayModel,cellAt} from '../apps/web/src/tray-model';
import {trayOffsets,cameraView} from '../apps/web/src/tray-layout';
// REQ-016 A6 (Claude Opus 5.5, 2026-09-30): tray shape and size chosen at room creation; AC16-11 / AC16-12.
const tray=(shape:TrayConfig['shape'],w:number,h=w,depth=7):TrayConfig=>({shape,w,h,depth});

describe('AC16-12 tray size and shape schema',()=>{
 it('accepts 30-120 cm across and 5-10 cm deep for every shape',()=>{
  for(const t of [tray('rect',30,120,5),tray('rect',120,30,10),tray('square',60),tray('circle',120),tray('octagon',30)])expect(trayConfigSchema.parse(t)).toEqual(t);
  expect(roomTraysSchema.parse({dry:tray('circle',60),wet:tray('octagon',80,80,9)})).toBeTruthy();
 });
 it('rejects sizes out of range, fractional sizes, unequal round/square/octagon trays and unknown shapes',()=>{
  for(const bad of [tray('rect',29,57),tray('rect',72,121),tray('rect',72,57,4),tray('rect',72,57,11),{...tray('rect',72,57),w:72.5},tray('circle',60,61),tray('square',60,59),tray('octagon',80,70),{...tray('rect',72,57),shape:'hexagon'},{...tray('rect',72,57),extra:1}])
   expect(trayConfigSchema.safeParse(bad).success).toBe(false);
  expect(roomTraysSchema.safeParse({dry:STANDARD_TRAY_CONFIG}).success).toBe(false);
 });
 it('heightmap is 2 cells per cm; the standard tray is exactly 144 x 114',()=>{
  expect([createTrayHeightmap().w,createTrayHeightmap().h]).toEqual([144,114]);
  for(const [t,w,h] of [[tray('rect',30,120),60,240],[tray('circle',120),240,240],[tray('octagon',45),90,90]] as const){const hm=createTrayHeightmap(t);expect([hm.w,hm.h]).toEqual([w,h]);}
 });
});

describe('AC16-11 outline: masks and object bounds',()=>{
 it('a circle tray has sand only inside the circle; strokes on masked-out corners change nothing',()=>{
  const hm=createTrayHeightmap(tray('circle',60)),before=hm.data.slice();
  expect(hm.mask[0]).toBe(0);expect(hm.mask[60*120+60]).toBe(1);
  strokeTray(hm,'dig',[[0,0]]);expect(hm.data).toEqual(before);
  strokeTray(hm,'dig',[[60,60]]);expect(hm.data[60*120+60]).toBeLessThan(before[60*120+60]);
  for(let k=0;k<hm.data.length;k++)if(!hm.mask[k])expect(hm.data[k]).toBe(before[k]);
 });
 it('insideTray follows each outline (world units, 7.2 cm per unit)',()=>{
  const r=60/7.2/2;
  expect(insideTray(tray('circle',60),r*.99,0)).toBe(true);expect(insideTray(tray('circle',60),r*.75,r*.75)).toBe(false);
  // Regular octagon (apothem a): the axis points reach a, the corner cut sits at |x|+|z| = a*sqrt2.
  const a=60/7.2/2;expect(insideTray(tray('octagon',60),a*.99,0)).toBe(true);expect(insideTray(tray('octagon',60),a*.9,a*.9)).toBe(false);expect(insideTray(tray('octagon',60),a*.7,a*.7)).toBe(true);
  expect(insideTray(STANDARD_TRAY_CONFIG,5,3.95)).toBe(true);expect(insideTray(STANDARD_TRAY_CONFIG,0,-4)).toBe(false);expect(insideTray(STANDARD_TRAY_CONFIG,5.01,0)).toBe(false);
  expect(insideTray(STANDARD_TRAY_CONFIG,Number.NaN,0)).toBe(false);
  const [x,z]=clampToTray(tray('circle',60),10,10);expect(Math.hypot(x,z)).toBeCloseTo(r,6);
 });
 it('room-core rejects a transform that leaves the tray outline, even when it is inside the wire range',()=>{
  const state:RoomState={roomId:'r',clinicId:'c',sessionEpoch:1,controlEpoch:1,status:'ACTIVE',clientLiveUntil:10_000,writerLeaseUntil:10_000,sceneRevision:0,nextFence:1,
   participants:{p:{id:'p',clinicId:'c',role:'client',sessionEpoch:1,admitted:true}},objects:{o:{transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1},revision:0,trayId:'wet'}},
   grants:{},leases:{o:{id:'l',participantId:'p',fence:1,expiresAt:10_000,sessionEpoch:1,controlEpoch:1}},trays:{dry:STANDARD_TRAY_CONFIG,wet:tray('circle',60)}};
  const cmd=(position:number[])=>({protocolVersion:1,type:'object.transform.commit',operationId:'op',sessionEpoch:1,controlEpoch:1,objectId:'o',leaseId:'l',fencingToken:1,expectedObjectRevision:0,transform:{position,rotation:[0,0,0,1],scale:1}});
  const connection={participantId:'p',clinicId:'c',sessionEpoch:1};
  expect(()=>authorizeTransform(state,connection,cmd([3,0,3]),1000)).toThrow('INVALID_PAYLOAD');
  expect(()=>authorizeTransform(state,connection,cmd([4,0,0]),1000)).not.toThrow();
  expect(objectInTray({},undefined,[5,0,3.96])).toBe(true);expect(objectInTray({},'dry',[0,0,4])).toBe(false);
 });
 it('the wire range is the largest tray: a 120 cm tray edge parses, beyond it does not',()=>{
  const frame=(position:number[])=>JSON.stringify({protocolVersion:1,operationId:'o',sessionEpoch:1,controlEpoch:1,type:'object.create',objectId:'x',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position,rotation:[0,0,0,1],scale:1},trayId:'dry'});
  expect(parseInbound(frame([8.33,-1.39,-8.33]))).toBeTruthy();expect(()=>parseInbound(frame([8.35,0,0]))).toThrow();expect(()=>parseInbound(frame([0,-1.6,0]))).toThrow();
 });
});

describe('layout and client model',()=>{
 it('standard trays stay at x -5.6 / +5.6; mixed sizes keep a 1.2 unit gap and do not overlap',()=>{
  expect(trayOffsets()).toEqual({dry:-5.6,wet:5.6});
  const trays={dry:tray('rect',120,40),wet:tray('circle',30)},o=trayOffsets(trays);
  expect(o.wet-30/7.2/2-(o.dry+120/7.2/2)).toBeCloseTo(1.2,5);
  expect(cameraView('angle',1.6,STANDARD_ROOM_TRAYS).position).toEqual(cameraView('angle',1.6).position);
  expect(cameraView('dry',1.6,trays).target[0]).toBeCloseTo(o.dry,5);
  // A larger room is framed from further away.
  expect(cameraView('top',1.6,{dry:tray('rect',120,120),wet:tray('rect',120,120)}).position[1]).toBeGreaterThan(cameraView('top',1.6).position[1]);
 });
 it('a snapshot with another shape reconfigures the tray; cells outside the outline are not sand',()=>{
  const model=new TrayModel('wet'),hm=createTrayHeightmap(tray('octagon',60));strokeTray(hm,'dig',[[60,60]]);
  model.adopt({id:'wet',shape:'octagon',sizeCm:{w:60,h:60,depth:7},heightmap:{w:hm.w,h:hm.h,data:bytesToBase64(hm.data)},waterLevel:.3,revision:4});
  expect(model.config).toEqual(tray('octagon',60));expect(model.display.data).toEqual(hm.data);expect(model.revision).toBe(4);expect(model.water).toBe(.3);
  expect(cellAt(model.display,0,0)).toEqual([60,60]);expect(cellAt(model.display,4.1,4.1)).toBeUndefined();
  expect(()=>model.adopt({id:'wet',shape:'octagon',sizeCm:{w:60,h:50,depth:7},heightmap:{w:120,h:100,data:''},waterLevel:0})).toThrow('TRAY_SHAPE_UNSUPPORTED');
 });
 it('ripples: own strokes ripple when drawn, another tab\'s strokes ripple when replayed, never twice',()=>{
  const model=new TrayModel('wet'),seen:number[][]=[];model.onRipple((x,z,s)=>seen.push([x,z,s]));
  model.stroke('mine','dig',[72,57]);expect(seen).toHaveLength(1);expect(seen[0][0]).toBeCloseTo(.25/7.2,9);
  model.replay({trayId:'wet',trayRevision:1,operationId:'mine',stroke:{tool:'dig',points:[[72,57]]},waterLevel:0});expect(seen).toHaveLength(1);
  model.replay({trayId:'wet',trayRevision:2,operationId:'theirs',stroke:{tool:'dig',points:[[10,10]]},waterLevel:0});expect(seen).toHaveLength(2);
  model.ripple(1,2);expect(seen.at(-1)).toEqual([1,2,1]);
 });
 it('local undo helper puts back exactly the saved sand and water',()=>{
  const model=new TrayModel('wet'),before=model.confirmed.data.slice();model.applyLocal('dig',[40,40]);model.setLocalWater(.4);
  model.restoreLocal(before,0);expect(model.display.data).toEqual(before);expect(model.water).toBe(0);
 });
});
