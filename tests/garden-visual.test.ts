import {describe,it,expect} from 'vitest';
import {BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshStandardMaterial,ShaderLib,UniformsUtils} from 'three';
import {gardenPlanting,grassDensity,builtGround,inTrayFocus,plantedTrunks,VARIANTS,MAX_GROUND_COVER_HEIGHT,POND,DECK,MEDITATION_CIRCLE,type PlantKind} from '../apps/web/src/garden-layout';
import {canWalkGarden,moveInGarden,gardenStops} from '../apps/web/src/garden-navigation';
import {loadGardenPreferences,defaultGardenPreferences} from '../apps/web/src/garden-preferences';
import {grassClumpGeometry,plantVariants,GRASS_BUDGET} from '../apps/web/src/garden-vegetation';
import {bakeGardenGround} from '../apps/web/src/garden-ground';
import {patchGardenMaterial,createFogUniforms,createGroundUniforms} from '../apps/web/src/garden-shaders';
import {assetById,provenanceIssues} from '../packages/asset-catalog/src/index';
// 2026-10-10 garden-visual-v4: proposals 1-4 and the three guardrails (sandtray focus, three tiers, calm / static).
const heightOf=(kind:PlantKind,variant:string,scale:number)=>VARIANTS[kind].find(v=>v.id===variant)!.height*scale;
describe('garden planting layout',()=>{
 it('is deterministic and every tier keeps the same trees and a nested subset of the rest',()=>{
  const low=gardenPlanting('low'),high=gardenPlanting('high'),cinema=gardenPlanting('cinema');
  expect(gardenPlanting('high')).toEqual(high);expect(low.tree).toEqual(cinema.tree);expect(cinema.tree.length).toBeGreaterThanOrEqual(20);
  for(const kind of ['bush','ground','reed'] as const){
   expect(low[kind].length).toBeLessThan(high[kind].length);expect(high[kind].length).toBeLessThan(cinema[kind].length);
   const key=(p:{x:number;z:number})=>p.x+':'+p.z,inCinema=new Set(cinema[kind].map(key)),inHigh=new Set(high[kind].map(key));
   expect(low[kind].every(p=>inHigh.has(key(p)))).toBe(true);expect(high[kind].every(p=>inCinema.has(key(p)))).toBe(true);
  }
 });
 it('guardrail 1: only low ground cover inside the sandtray focus area, nothing on the deck, pond, circle or paths',()=>{
  const all=gardenPlanting('cinema');let ground=0;
  for(const kind of Object.keys(all) as PlantKind[])for(const p of all[kind]){
   if(inTrayFocus(p.x,p.z)){expect(kind).toBe('ground');expect(heightOf(kind,p.variant,p.scale)).toBeLessThanOrEqual(MAX_GROUND_COVER_HEIGHT);ground++;}
   expect(Math.abs(p.x)<DECK.halfX&&Math.abs(p.z)<DECK.halfZ).toBe(false);
   expect(((p.x-POND.x)/POND.radiusX)**2+((p.z-POND.z)/POND.radiusZ)**2).toBeGreaterThan(1.04);
   if(kind!=='reed')expect(builtGround(p.x,p.z)).toBe(false);
  }
  for(const g of VARIANTS.ground)expect(g.height*g.scale[1]).toBeLessThanOrEqual(MAX_GROUND_COVER_HEIGHT);
  expect(ground).toBeGreaterThan(0);
 });
 it('grass never grows on built ground but covers meadows and the far hills',()=>{
  for(const [x,z] of [[0,0],[5,-3],[POND.x,POND.z],[MEDITATION_CIRCLE.x+MEDITATION_CIRCLE.radius,MEDITATION_CIRCLE.z],[21,-15],[15,-8]])expect(grassDensity(x,z)).toBe(0);
  let covered=0;for(let i=0;i<400;i++){const a=i*2.399,r=12+(i%40);if(grassDensity(Math.cos(a)*r,Math.sin(a)*r)>.5)covered++;}
  expect(covered).toBeGreaterThan(120);expect(grassDensity(0,56)).toBeGreaterThan(.6);
 });
 it('drawn added trees block walking, yet every stop stays reachable and can still move',()=>{
  const trunks=plantedTrunks();expect(trunks.length).toBe(gardenPlanting('low').tree.length);
  for(const t of trunks)expect(canWalkGarden(t.x,t.z,trunks)).toBe(false);
  for(const stop of Object.values(gardenStops)){const [x,,z]=stop.position;expect(canWalkGarden(x,z,trunks)).toBe(true);
   const moved=moveInGarden(x,z,-Math.sin(stop.yaw)*.6,-Math.cos(stop.yaw)*.6,trunks);expect(Math.hypot(moved.x-x,moved.z-z)).toBeGreaterThan(.3);}
 });
 // GPT-6 review F1 (2026-10-10 20:45): with 草叢與花木 off, or a tree model that failed to load, nothing is drawn there,
 // so nothing may block there either.
 it('hidden or unloaded trees leave no invisible obstacle',()=>{
  const trunks=plantedTrunks();
  for(const t of trunks){expect(canWalkGarden(t.x,t.z)).toBe(true);expect(canWalkGarden(t.x,t.z,[])).toBe(true);
   const moved=moveInGarden(t.x,t.z,1,0);expect(moved.x).toBeGreaterThan(t.x+.9);}
  const failed=trunks[0].variant,loaded=trunks.filter(t=>t.variant!==failed),missing=trunks.filter(t=>t.variant===failed);
  expect(missing.length).toBeGreaterThan(0);expect(loaded.length).toBeGreaterThan(0);
  for(const t of missing)expect(canWalkGarden(t.x,t.z,loaded)).toBe(true);
  for(const t of loaded)expect(canWalkGarden(t.x,t.z,loaded)).toBe(false);
 });
 it('a walker inside a tree that just appeared can step out, but not deeper in or back into it',()=>{
  const trunks=plantedTrunks();
  for(const t of trunks){
   const x=t.x+t.radius*.5,z=t.z;expect(canWalkGarden(x,z,trunks)).toBe(false);
   const out=moveInGarden(x,z,2,0,trunks);expect(out.x).toBeGreaterThan(x+1.5);expect(canWalkGarden(out.x,out.z,trunks)).toBe(true);
   const deeper=moveInGarden(x,z,-.2,0,trunks);expect(deeper.x).toBe(x);
   const back=moveInGarden(out.x,out.z,-(out.x-t.x),0,trunks);expect(canWalkGarden(back.x,back.z,trunks)).toBe(true);
  }
 });
 it('every planted variant is a CC0 model already in the catalog',()=>{
  for(const id of plantVariants('cinema')){const asset=assetById.get(id);expect(asset,id).toBeDefined();expect(asset!.provenance.license).toBe('CC0-1.0');expect(provenanceIssues(asset!)).toEqual([]);expect(asset!.url).toMatch(/^\/imported-assets\/megakits-v1\//);}
 });
});
describe('garden tiers and switches (guardrail 2)',()=>{
 it('stores the cinema tier and the vegetation switch, and keeps v1 values from older builds',()=>{
  const load=(preferences:object)=>loadGardenPreferences({getItem:()=>JSON.stringify({version:1,preferences})}).preferences;
  expect(load({quality:'cinema',vegetation:false})).toEqual({...defaultGardenPreferences,quality:'cinema',vegetation:false});
  expect(load({quality:'high',fog:false})).toEqual({...defaultGardenPreferences,quality:'high',fog:false});
  expect(load({quality:'ultra',vegetation:'no'})).toEqual(defaultGardenPreferences);expect(defaultGardenPreferences.quality).toBe('low');
 });
 it('grass budget grows with the tier',()=>{expect(GRASS_BUDGET.low.clumps).toBeLessThan(GRASS_BUDGET.high.clumps);expect(GRASS_BUDGET.high.clumps).toBeLessThan(GRASS_BUDGET.cinema.clumps);expect(GRASS_BUDGET.low.clumps*grassClumpGeometry().index!.count/3).toBeLessThan(400000);});
});
describe('garden rendering helpers',()=>{
 it('grass blades are double-wound with upward normals (no black back faces)',()=>{
  const g=grassClumpGeometry(),n=g.getAttribute('normal');for(let i=0;i<n.count;i++)expect(n.getY(i)).toBe(1);
  expect(g.index!.count/3).toBe(9*10);
 });
 it('patches the stock physical shader at every insertion point',()=>{
  for(const mode of ['none','floor','occlude'] as const){
   const material=new MeshStandardMaterial(),fog=createFogUniforms(),ground=createGroundUniforms();
   patchGardenMaterial(material,mode==='none'?{fog}:{fog,ground,groundMode:mode});
   const shader={uniforms:UniformsUtils.clone(ShaderLib.physical.uniforms),vertexShader:ShaderLib.physical.vertexShader,fragmentShader:ShaderLib.physical.fragmentShader} as any;
   material.onBeforeCompile(shader,undefined as any);
   expect(shader.vertexShader).toContain('vGardenWorld=(modelMatrix*gardenWorld).xyz');expect(shader.fragmentShader).toContain('gardenFogDensity*gardenFogDensity');expect(shader.fragmentShader).not.toContain('#include <fog_fragment>');
   expect(shader.uniforms.gardenFogDensity).toBe(fog.gardenFogDensity);
   if(mode!=='none'){expect(shader.fragmentShader).toContain('reflectedLight.indirectDiffuse*=gardenGround.r');expect(shader.uniforms.gardenGroundMap).toBe(ground.gardenGroundMap);}
   expect(shader.fragmentShader.includes('mix(grass,moss')).toBe(mode==='floor');
   expect(material.customProgramCacheKey()).toBe('garden-v4-'+mode);
  }
 });
 it('bakes heights from the real terrain, keeps the deck bare and darkens ground under a canopy',()=>{
  const plane=(name:string,y:number,size:number,cx=0,cz=0)=>{const g=new BufferGeometry();const s=size/2;g.setAttribute('position',new Float32BufferAttribute([cx-s,y,cz-s,cx+s,y,cz-s,cx+s,y,cz+s,cx-s,y,cz+s],3));g.setIndex([0,2,1,0,3,2]);const m=new MeshStandardMaterial();m.name=name;return new Mesh(g,m);};
  const root=new Group();root.add(plane('Forest_Floor',-.4,200),plane('Oiled_Timber',-.3,14));
  const canopy=plane('Foliage_0',8,4,-30,30);root.add(canopy);
  // dense canopy points: many vertices in a 4 m square
  const pts:number[]=[];for(let i=0;i<4000;i++)pts.push(-32+(i%63)/16,8,28+Math.floor(i/63)/16);canopy.geometry=new BufferGeometry();canopy.geometry.setAttribute('position',new Float32BufferAttribute(pts,3));
  const ground=bakeGardenGround(root);
  expect(ground.heightAt(20,-35)).toBeCloseTo(-.4,3);expect(ground.grassAt(0,0)).toBe(0);expect(ground.grassAt(3,-2)).toBe(0);
  expect(ground.occlusionAt(-30,30)).toBeLessThan(.7);expect(ground.occlusionAt(30,-30)).toBeGreaterThan(.95);
  ground.dispose();
 });
});
