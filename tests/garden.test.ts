import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {missingLocalAssetsReason} from './runtime/local-asset-gate';
const gardenRoot='apps/web/public/environments/garden-v3/';
import {canWalkGarden,gardenFloor,gardenStops,moveInGarden} from '../apps/web/src/garden-navigation';
describe('garden exploration boundaries',()=>{
 it('allows destinations and tea house entrance, excludes pond except bridge and solid walls',()=>{
  for(const stop of Object.values(gardenStops)){expect(canWalkGarden(stop.position[0],stop.position[2])).toBe(true);expect(Number.isFinite(gardenFloor(stop.position[0],stop.position[2]))).toBe(true);}
  expect(canWalkGarden(-23,14)).toBe(false);expect(canWalkGarden(-23,10)).toBe(true);expect(gardenFloor(-23,10)).toBeGreaterThan(.8);
  expect(canWalkGarden(21,-12)).toBe(true);expect(canWalkGarden(21,-20)).toBe(false);expect(canWalkGarden(16,-17)).toBe(false);
  expect(canWalkGarden(67,0)).toBe(false);expect(canWalkGarden(NaN,0)).toBe(false);expect(canWalkGarden(7.5,0)).toBe(false);
 });
 it('exports embedded PBR models with independently hideable overhead beams and verified bytes',ctx=>{
  const reason=missingLocalAssetsReason(['manifest.json','garden-high.glb','garden-low.glb','garden-ambience.wav'].map(f=>gardenRoot+f),'garden-v3 delivered environment');
  if(reason){console.warn(reason);ctx.skip(reason);}
  const root='apps/web/public/environments/garden-v3/';const manifest=JSON.parse(readFileSync(root+'manifest.json','utf8'));
  for(const file of ['garden-high.glb','garden-low.glb']){const b=readFileSync(root+file);expect(b.length).toBeLessThan(25*1024*1024);expect(createHash('sha256').update(b).digest('hex')).toBe(manifest.files[file].sha256);expect(new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(8,true)).toBe(b.length);const json=JSON.parse(b.subarray(20,20+new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(12,true)).toString());expect(json.buffers.every((v:any)=>!v.uri)).toBe(true);expect(json.images.length).toBeGreaterThan(5);expect(json.images.every((v:any)=>v.bufferView!==undefined&&!v.uri)).toBe(true);expect(json.nodes.some((v:any)=>v.name?.startsWith('Pavilion_louver'))).toBe(true);expect(json.meshes.length).toBeGreaterThan(10);}
  const wav=readFileSync(root+'garden-ambience.wav');expect(wav.subarray(0,4).toString()).toBe('RIFF');expect([...wav.subarray(44,48)]).toEqual([0,0,0,0]);expect([...wav.subarray(-4)]).toEqual([0,0,0,0]);expect(new DataView(wav.buffer,wav.byteOffset,wav.byteLength).getUint16(22,true)).toBe(2);expect(new DataView(wav.buffer,wav.byteOffset,wav.byteLength).getUint32(24,true)).toBe(24000);expect(new DataView(wav.buffer,wav.byteOffset,wav.byteLength).getUint32(40,true)/(24000*2*2)).toBe(24);expect(createHash('sha256').update(wav).digest('hex')).toBe(manifest.files['garden-ambience.wav'].sha256);
 });
});

it('prevents furniture and sandbox tunnelling and slides along an obstruction',()=>{
 expect(canWalkGarden(21,-14.8)).toBe(false);expect(canWalkGarden(19,-17)).toBe(false);expect(canWalkGarden(0,0)).toBe(false);
 const table=moveInGarden(21,-13,0,-4);expect(table.z).toBeGreaterThan(-14);expect(canWalkGarden(table.x,table.z)).toBe(true);
 // REQ-016 (2026-09-30): the two-tray footprint front edge is z 4.21 (+0.22 body radius); was 3.75 for the single tray.
 const slide=moveInGarden(4,4.66,1,-1);expect(slide.x).toBeGreaterThan(4);expect(slide.z).toBeGreaterThanOrEqual(4.43);
 expect(moveInGarden(3,8,NaN,1)).toEqual({x:3,z:8});
});

it('uses the same collision data delivered by the Blender scene build',ctx=>{
 const reason=missingLocalAssetsReason([gardenRoot+'navigation.json'],'garden-v3 delivered navigation');
 if(reason){console.warn(reason);ctx.skip(reason);}
 const bundled=JSON.parse(readFileSync('apps/web/src/garden-colliders-v2.json','utf8'));const delivered=JSON.parse(readFileSync('apps/web/public/environments/garden-v3/navigation.json','utf8'));expect(bundled).toEqual(delivered);expect(bundled.colliders.length).toBeGreaterThan(150);for(const name of ['Sofa_frame','Tree_trunk','Boulder','Teahouse_back_wall'])expect(bundled.colliders.some((c:any)=>c.name===name)).toBe(true);
});
