import {describe,it,expect} from 'vitest';
import {parseInbound,outboundSchemas,sceneSnapshotV2Schema,traySchema,validTransform} from '../packages/protocol/src/index';
import {createStandardHeightmap,strokeTray,quantizeWater} from '../packages/sand-engine/src/tray';
import {surfaceU8,bytesToBase64} from '../packages/sand-engine/src/core';
import {TrayModel,cellAt,surfaceY,u8ToY,type Point} from '../apps/web/src/tray-model';
// REQ-016 product slice (Claude Opus 5.5, 2026-09-30).
const base={protocolVersion:1,operationId:'op-1',sessionEpoch:1,controlEpoch:1};
const frame=(value:Record<string,unknown>)=>JSON.stringify({...base,...value});
const snapshotTray=(id:'dry'|'wet',hm=createStandardHeightmap(),waterLevel=0,revision=0)=>({id,kind:id,shape:'rect',sizeCm:{w:72,h:57,depth:7},heightmap:{w:hm.w,h:hm.h,encoding:'u8-base64',data:bytesToBase64(hm.data)},waterLevel,baseColor:'#1F5F8B',revision});

describe('protocol: sand.stroke / tray.water / trayId',()=>{
 it('accepts a stroke of 1..8 integer cells on either tray and rejects everything else',()=>{
  expect(parseInbound(frame({type:'sand.stroke',trayId:'dry',tool:'dig',points:[[72,57]]}))).toMatchObject({type:'sand.stroke',trayId:'dry'});
  expect(parseInbound(frame({type:'sand.stroke',trayId:'wet',tool:'smooth',points:Array.from({length:8},(_,i)=>[i,i])}))).toBeTruthy();
  for(const bad of [{points:[]},{points:Array.from({length:9},()=>[1,1])},{points:[[1.5,2]]},{points:[[-1,2]]},{points:[[240,2]]},{tool:'flood'},{trayId:'third'},{radius:30}])
   expect(()=>parseInbound(frame({type:'sand.stroke',trayId:'dry',tool:'dig',points:[[1,1]],...bad}))).toThrow();
 });
 it('only the wet tray has a water level, within 0..1',()=>{
  expect(parseInbound(frame({type:'tray.water',trayId:'wet',level:.4}))).toMatchObject({level:.4});
  expect(()=>parseInbound(frame({type:'tray.water',trayId:'dry',level:.4}))).toThrow();
  expect(()=>parseInbound(frame({type:'tray.water',trayId:'wet',level:1.2}))).toThrow();
  expect(quantizeWater(.456)).toBe(.46);expect(quantizeWater(-1)).toBe(0);
 });
 // 2026-09-30 A6: the wire range now covers the largest (120 cm) tray; the Room rejects -4 on a standard tray (tray-shapes-undo tests).
 it('object.create takes an optional trayId; the wire range covers a 120 cm tray and nothing beyond it',()=>{
  const t={position:[0,0,3.96],rotation:[0,0,0,1],scale:1};
  expect(parseInbound(frame({type:'object.create',objectId:'o1',assetId:'DEV_house',assetVersion:'v1',transform:t,trayId:'wet'}))).toMatchObject({trayId:'wet'});
  expect(()=>parseInbound(frame({type:'object.create',objectId:'o1',assetId:'DEV_house',assetVersion:'v1',transform:t,trayId:'sea'}))).toThrow();
  expect(validTransform({position:[0,0,-4],rotation:[0,0,0,1],scale:1})).toBe(true);
  expect(validTransform({position:[0,0,-8.4],rotation:[0,0,0,1],scale:1})).toBe(false);expect(validTransform({position:[8.4,0,0],rotation:[0,0,0,1],scale:1})).toBe(false);
 });
 it('tray.changed outbound and the v2 snapshot the Worker serves validate against the contracts',()=>{
  expect(outboundSchemas['tray.changed'].parse({protocolVersion:1,type:'tray.changed',sessionEpoch:1,serverSeq:3,trayId:'wet',trayRevision:2,sceneRevision:5,operationId:'op-1',stroke:{tool:'dig',points:[[3,4]]},waterLevel:.3})).toBeTruthy();
  expect(traySchema.parse(snapshotTray('wet',createStandardHeightmap(),.5,3))).toBeTruthy();
  const scene={schemaVersion:2,sceneId:'s1',sceneRevision:4,trays:[snapshotTray('dry'),snapshotTray('wet')],objects:[{id:'o1',assetId:'DEV_house',assetVersion:'v1',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1},materialOverrides:{},hidden:false,revision:0,trayId:'wet'}],environment:{sandColor:'#deceac',backgroundColor:'#e9e5db'},updatedAt:1};
  expect(sceneSnapshotV2Schema.parse(scene).trays[1].revision).toBe(0);
  expect(()=>sceneSnapshotV2Schema.parse({...scene,trays:[snapshotTray('wet'),snapshotTray('dry')]})).toThrow();
 });
});

describe('shared stroke kernel',()=>{
 it('standard tray is 144 x 114 cells with the original surface at u8 179 (world y ~ 0)',()=>{
  const hm=createStandardHeightmap();expect([hm.w,hm.h]).toEqual([144,114]);expect(hm.data.every(v=>v===surfaceU8(7))).toBe(true);expect(u8ToY(179)).toBe(0);
 });
 it('digs to the blue floor after 60 applications (about one second at one per 16 ms), not before 50',()=>{
  const hm=createStandardHeightmap(),c=72*1+57*144;
  for(let n=1;n<=60;n++){strokeTray(hm,'dig',[[72,57]]);if(n===50)expect(hm.data[c]).toBeGreaterThan(0);}
  expect(hm.data[c]).toBe(0);
 });
 it('mounds at most 3 cm above the original surface (u8 255)',()=>{const hm=createStandardHeightmap();for(let n=0;n<200;n++)strokeTray(hm,'mound',[[10,10]]);expect(Math.max(...hm.data)).toBe(255);});
});

describe('client TrayModel replays the server exactly',()=>{
 const ops:{id:string;tool:'dig'|'mound'|'smooth';points:Point[]}[]=[{id:'a',tool:'dig',points:[[20,20],[21,20],[22,21]]},{id:'b',tool:'mound',points:[[60,40]]},{id:'c',tool:'smooth',points:[[21,20],[60,40]]}];
 it('confirmed bytes equal the authority after in-order replay; optimistic display converges',()=>{
  const server=createStandardHeightmap(),client=new TrayModel('dry');
  for(const p of ops[0].points)client.stroke('a',ops[0].tool,p);
  ops.forEach((op,i)=>{strokeTray(server,op.tool,op.points);expect(client.replay({trayId:'dry',trayRevision:i+1,operationId:op.id,stroke:{tool:op.tool,points:op.points},waterLevel:0})).toBe(true);});
  expect(Buffer.from(client.confirmed.data).equals(Buffer.from(server.data))).toBe(true);
  expect(Buffer.from(client.display.data).equals(Buffer.from(server.data))).toBe(true);expect(client.pending).toEqual([]);
 });
 it('a revision gap asks for a snapshot; stale events and older snapshots are ignored',()=>{
  const client=new TrayModel('wet');
  expect(client.replay({trayId:'wet',trayRevision:2,operationId:'x',waterLevel:.5})).toBe(false);expect(client.water).toBe(0);
  const hm=createStandardHeightmap();strokeTray(hm,'dig',[[5,5]]);client.adopt(snapshotTray('wet',hm,.5,2));
  expect(client.revision).toBe(2);expect(client.water).toBe(.5);
  expect(client.replay({trayId:'wet',trayRevision:2,operationId:'x',waterLevel:.9})).toBe(true);expect(client.water).toBe(.5);
  client.adopt(snapshotTray('wet',createStandardHeightmap(),0,1));expect(client.revision).toBe(2);expect(client.display.data[5*144+5]).toBe(hm.data[5*144+5]);
 });
 it('a rejected stroke disappears from the display',()=>{
  const client=new TrayModel('dry');client.stroke('r',"dig",[30,30]);expect(client.display.data[30*144+30]).toBeLessThan(179);
  client.drop('r');expect(client.display.data[30*144+30]).toBe(179);
 });
 it('maps tray-local world coordinates to cells and seats objects on the sand',()=>{
  const hm=createStandardHeightmap();expect(cellAt(hm,0,0)).toEqual([72,57]);expect(cellAt(hm,-4.99,-3.95)).toEqual([0,0]);expect(cellAt(hm,5.01,0)).toBeUndefined();
  for(let n=0;n<60;n++)strokeTray(hm,'dig',[[72,57]]);expect(surfaceY(hm,0,0)).toBeLessThan(-.9);expect(surfaceY(hm,4,3)).toBeCloseTo(u8ToY(179),5);
 });
});
