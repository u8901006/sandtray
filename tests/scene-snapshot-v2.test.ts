import {describe,it,expect} from 'vitest';
import * as protocol from '../packages/protocol/src/index';
import {artifacts} from '../tools/contracts';

const legacySnapshot={
 schemaVersion:1,sceneId:'scene-legacy',sceneRevision:7,
 objects:[{id:'stone',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[1,0,2],rotation:[0,0,0,1],scale:1},materialOverrides:{},hidden:false,revision:3}],
 environment:{sandColor:'#deceac',backgroundColor:'#e9e5db'},updatedAt:1234,
};
type MigratedSnapshot={schemaVersion:2;sceneId:string;sceneRevision:number;objects:Array<{id:string;trayId:string}>;trays:Array<{id:string;kind:string;shape:string;sizeCm:{w:number;h:number;depth:number};heightmap:{w:number;h:number;encoding:string;data:string};waterLevel:number;baseColor:string}>;environment:unknown;updatedAt:number};
function migrate(value:unknown){
 const fn=Reflect.get(protocol,'migrateSceneSnapshot');
 if(typeof fn!=='function')throw new Error('MIGRATION_FUNCTION_MISSING');
 return fn(value) as MigratedSnapshot;
}

describe('REQ-016 scene snapshot v2 migration',()=>{
 it('reads a strict v1 snapshot and adds two flat standard trays without changing scene identity',()=>{
  const actual=migrate(legacySnapshot);
  expect(actual.schemaVersion).toBe(2);
  expect(actual).toMatchObject({sceneId:'scene-legacy',sceneRevision:7,updatedAt:1234,environment:legacySnapshot.environment});
  expect(actual.objects).toEqual([{...legacySnapshot.objects[0],trayId:'dry'}]);
  expect(actual.trays.map(({id,kind,shape,sizeCm,waterLevel,baseColor})=>({id,kind,shape,sizeCm,waterLevel,baseColor}))).toEqual([
   {id:'dry',kind:'dry',shape:'rect',sizeCm:{w:72,h:57,depth:7},waterLevel:0,baseColor:'#1F5F8B'},
   {id:'wet',kind:'wet',shape:'rect',sizeCm:{w:72,h:57,depth:7},waterLevel:0,baseColor:'#1F5F8B'},
  ]);
  for(const tray of actual.trays){
   expect(tray.heightmap).toMatchObject({w:144,h:114,encoding:'u8-base64'});
   const bytes=Buffer.from(tray.heightmap.data,'base64');
   expect(bytes).toHaveLength(144*114);
   expect(new Set(bytes)).toEqual(new Set([179]));
  }
 });

 it('is idempotent when a v2 snapshot is read and written again',()=>{
  const once=migrate(legacySnapshot);
  const persisted=JSON.parse(JSON.stringify(once));
  expect(migrate(persisted)).toEqual(once);
  expect(migrate(once)).toEqual(once);
 });

 it('rejects a legacy snapshot with unknown keys instead of silently dropping data',()=>{
  expect(()=>migrate({...legacySnapshot,unexpectedAuthority:{grant:'active'}})).toThrow();
 });

 it('rejects malformed v2 tray dimensions, heightmap lengths, duplicate kinds and dry water',()=>{
  const valid=migrate(legacySnapshot);
  const cases=[
   (value:MigratedSnapshot)=>{value.trays[0].sizeCm.w=29;},
   (value:MigratedSnapshot)=>{value.trays[0].sizeCm.w=121;},
   (value:MigratedSnapshot)=>{value.trays[0].sizeCm.depth=4;},
   (value:MigratedSnapshot)=>{value.trays[0].sizeCm.depth=11;},
   (value:MigratedSnapshot)=>{value.trays[0].shape='circle';},
   (value:MigratedSnapshot)=>{value.trays[0].heightmap.w=143;},
   (value:MigratedSnapshot)=>{value.trays[1].kind='dry';},
   (value:MigratedSnapshot)=>{value.trays[0].waterLevel=0.1;},
   (value:MigratedSnapshot)=>{value.trays[1].id='dry';},
   (value:MigratedSnapshot)=>{value.objects[0].trayId='missing';},
   (value:MigratedSnapshot)=>{value.objects.push(structuredClone(value.objects[0]));},
   (value:MigratedSnapshot)=>{value.trays[0].heightmap.data=value.trays[0].heightmap.data.slice(0,-4);},
  ];
  for(const mutate of cases){const bad=structuredClone(valid);mutate(bad);expect(()=>migrate(bad)).toThrow();}
 });
 it('publishes v2 as the current scene contract while preserving an explicit v1 reader contract',()=>{
  const generated=artifacts() as Record<string,any>;
  expect(generated['scene.schema.json'].properties.schemaVersion.const).toBe(2);
  expect(generated['scene.schema.json'].required).toContain('trays');
  expect(generated['scene.schema.json']['x-sandtray-invariants']).toContain('heightmap.w = sizeCm.w * 2 and heightmap.h = sizeCm.h * 2');
  expect(generated['scene.schema.json']['x-sandtray-invariants']).toContain('object ids are unique');
  expect(generated['openapi.json'].components.schemas.Scene['x-sandtray-invariants']).toContain('object ids are unique');
  expect(generated['scene-v1.schema.json'].properties.schemaVersion.const).toBe(1);
 });

 it('requires the stable dry-left, wet-right tray order',()=>{
  const reversed=structuredClone(migrate(legacySnapshot));
  reversed.trays.reverse();
  expect(()=>migrate(reversed)).toThrow();
 });
});
