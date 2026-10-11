import navigation from './garden-colliders-v2.json';
// 2026-10-10 garden-visual-v4 (user adopted proposals 1-4 and the three guardrails). Pure, deterministic layout data:
// where grass grows and where the added three-layer planting goes. No three.js here so it is unit-testable and the
// navigation module can import the tree trunks as colliders.
export type GardenTier='low'|'high'|'cinema';
export type PlantKind='tree'|'bush'|'ground'|'reed';
export type Placement={variant:string;x:number;z:number;scale:number;rotation:number};

/** Guardrail 1: the sandtray platform stays the focus. Nothing taller than ground cover inside this rectangle. */
export const TRAY_FOCUS={halfX:16,minZ:-10,maxZ:18};
/** Deck around the two trays (Oiled_Timber platform): no grass, no planting. */
export const DECK={halfX:9,halfZ:7.2};
export const POND={x:-23,z:10,radiusX:11.7,radiusZ:8.7};
export const MEDITATION_CIRCLE={x:8,z:-18,radius:4.4};
export const TEA_HOUSE={minX:14,maxX:28.5,minZ:-22,maxZ:-9.5};
export const GRAVEL_PATH={minX:6,maxX:24,minZ:-11.6,maxZ:-5};
export const BRIDGE={minX:-36,maxX:-10,minZ:8.4,maxZ:11.6};
const STOPS=[[3,8],[-10,10],[21,-9],[9,-13]] as const;
// Walking lines between the deck, the bridge, the gravel path and the circle (x,z pairs).
const PATHS:[number,number,number,number][]=[[-8,6,-11.5,9.6],[3,7,3,12],[7,-5,9,-13],[8,-5,15,-8.5],[-1,-7,8,-13.5]];
const trunks=(navigation.colliders as {name:string;x:number;z:number}[]).filter(c=>c.name==='Tree_trunk');
const boulders=(navigation.colliders as {name:string;x:number;z:number;radiusX?:number}[]).filter(c=>c.name==='Boulder');

function hash(ix:number,iz:number,seed:number){let h=Math.imul(ix,374761393)^Math.imul(iz,668265263)^Math.imul(seed,2246822519);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;}
const smooth=(t:number)=>t*t*(3-2*t);
/** Value noise in [0,1]; the GLSL twin in garden-shaders.ts only shades colour, so the two need not match bit for bit. */
export function noise(x:number,z:number,seed=1){const ix=Math.floor(x),iz=Math.floor(z),fx=smooth(x-ix),fz=smooth(z-iz);const a=hash(ix,iz,seed),b=hash(ix+1,iz,seed),c=hash(ix,iz+1,seed),d=hash(ix+1,iz+1,seed);return a+(b-a)*fx+(c-a)*fz+(a-b-c+d)*fx*fz;}
const fbm=(x:number,z:number)=>noise(x,z,1)*.55+noise(x*2.1,z*2.1,2)*.3+noise(x*4.3,z*4.3,3)*.15;
const step=(a:number,b:number,v:number)=>{const t=Math.min(1,Math.max(0,(v-a)/(b-a)));return smooth(t);};
function segmentDistance(x:number,z:number,[ax,az,bx,bz]:[number,number,number,number]){const dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)));return Math.hypot(x-ax-t*dx,z-az-t*dz);}
export const pathDistance=(x:number,z:number)=>Math.min(...PATHS.map(p=>segmentDistance(x,z,p)));
const pondValue=(x:number,z:number)=>((x-POND.x)/POND.radiusX)**2+((z-POND.z)/POND.radiusZ)**2;
const inRect=(x:number,z:number,r:{minX:number;maxX:number;minZ:number;maxZ:number},m=0)=>x>r.minX-m&&x<r.maxX+m&&z>r.minZ-m&&z<r.maxZ+m;
export const inTrayFocus=(x:number,z:number)=>Math.abs(x)<TRAY_FOCUS.halfX&&z>TRAY_FOCUS.minZ&&z<TRAY_FOCUS.maxZ;

/** Built ground: deck, pond, bridge, tea house, gravel and the stone circle. Nothing grows here. */
export function builtGround(x:number,z:number,margin=0){
 return (Math.abs(x)<DECK.halfX+margin&&Math.abs(z)<DECK.halfZ+margin)||pondValue(x,z)<1.04+margin*.1||inRect(x,z,BRIDGE,margin)||inRect(x,z,TEA_HOUSE,margin)||inRect(x,z,GRAVEL_PATH,margin)||Math.abs(Math.hypot(x-MEDITATION_CIRCLE.x,z-MEDITATION_CIRCLE.z)-MEDITATION_CIRCLE.radius)<.9+margin;
}
/** 0..1 grass cover: meadow patches near the garden, grassy hills further out, worn earth on walking lines. */
export function grassDensity(x:number,z:number){
 if(builtGround(x,z))return 0;
 const r=Math.hypot(x,z);let g=step(.36,.6,fbm(x*.07+11,z*.07-7));
 g=Math.max(g,.85*step(36,52,r));
 const bank=pondValue(x,z);if(bank<1.5)g=Math.max(g,step(1.5,1.12,bank));
 g*=step(.8,2.2,pathDistance(x,z));
 for(const [sx,sz] of STOPS)g*=step(.4,1.6,Math.hypot(x-sx,z-sz));
 return Math.min(1,g);
}
/** 0..1 bare-earth amount on walking lines (shaded as trodden soil, never grass). */
export const wornPath=(x:number,z:number)=>1-step(.6,2,pathDistance(x,z));

/** Share of the full planting each tier keeps (trees excepted: they are colliders, so every tier has all of them). */
export const TIER_SHARE:Record<GardenTier,number>={low:.4,high:.7,cinema:1};
/** height = the model's own height in metres (measured from the GLB bounds), before scale. */
export const VARIANTS:Record<PlantKind,{id:string;height:number;scale:[number,number]}[]>={
 tree:[{id:'MK_SN_CommonTree_1',height:7.02,scale:[1.3,1.6]},{id:'MK_SN_CommonTree_2',height:7.4,scale:[1.3,1.6]},{id:'MK_SN_CommonTree_3',height:9.18,scale:[1.1,1.4]},{id:'MK_SN_CommonTree_4',height:9.2,scale:[1.1,1.4]},{id:'MK_SN_CommonTree_5',height:6.76,scale:[1.3,1.7]}],
 bush:[{id:'MK_SN_Bush_Common',height:1.35,scale:[.9,1.4]},{id:'MK_SN_Bush_Common_Flowers',height:1.35,scale:[.9,1.3]},{id:'MK_SN_Fern_1',height:2.44,scale:[.28,.4]},{id:'MK_SN_Plant_1_Big',height:3.7,scale:[.3,.42]}],
 ground:[{id:'MK_SN_Flower_3_Group',height:2.02,scale:[.26,.36]},{id:'MK_SN_Flower_4_Group',height:2.43,scale:[.24,.32]},{id:'MK_SN_Clover_1',height:1.13,scale:[.35,.5]},{id:'MK_SN_Plant_7_Big',height:0.3,scale:[.7,1]},{id:'MK_SN_Mushroom_Common',height:0.45,scale:[.5,.8]}],
 reed:[{id:'MK_SN_Grass_Wispy_Tall',height:1.64,scale:[.45,.65]},{id:'MK_SN_Grass_Common_Tall',height:1.84,scale:[.4,.6]}]
};
/** Heights in metres after scaling, used by the guardrail tests and the focus rule. */
export const MAX_GROUND_COVER_HEIGHT=.8;

function rng(seed:number){let s=seed>>>0;return()=>{s=(s+0x6d2b79f5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
const near=(list:{x:number;z:number}[],x:number,z:number,d:number)=>list.some(p=>Math.hypot(p.x-x,p.z-z)<d);

function plantAllowed(kind:PlantKind,x:number,z:number){
 const r=Math.hypot(x,z);if(r>62)return false;
 if(kind==='reed'){const v=pondValue(x,z);return v>1.06&&v<1.4&&!inRect(x,z,BRIDGE,1.2)&&!inTrayFocus(x,z);}
 if(builtGround(x,z,kind==='ground'?.4:1.2))return false;
 if(kind!=='ground'&&inTrayFocus(x,z))return false;
 if(kind==='tree'){if(near(trunks,x,z,5)||STOPS.some(([sx,sz])=>Math.hypot(x-sx,z-sz)<6)||pathDistance(x,z)<3.5||builtGround(x,z,3))return false;}
 if(kind==='bush'){if(STOPS.some(([sx,sz])=>Math.hypot(x-sx,z-sz)<2.5)||pathDistance(x,z)<1.6||near(boulders,x,z,1.2))return false;}
 if(kind==='ground'&&(pathDistance(x,z)<.7||STOPS.some(([sx,sz])=>Math.hypot(x-sx,z-sz)<1)))return false;
 return true;
}
let full:Record<PlantKind,Placement[]>|undefined;
/** Deterministic full planting; the same seed always yields the same garden on every device. */
function fullPlanting():Record<PlantKind,Placement[]>{
 if(full)return full;
 const random=rng(20261010),out:Record<PlantKind,Placement[]>={tree:[],bush:[],ground:[],reed:[]};
 const pick=(kind:PlantKind,x:number,z:number)=>{const list=VARIANTS[kind],v=list[Math.floor(random()*list.length)];out[kind].push({variant:v.id,x,z,scale:v.scale[0]+random()*(v.scale[1]-v.scale[0]),rotation:random()*Math.PI*2});};
 const scatter=(kind:PlantKind,target:number,sample:()=>[number,number],spacing:number)=>{
  for(let attempt=0;attempt<target*40&&out[kind].length<target;attempt++){const [x,z]=sample();if(plantAllowed(kind,x,z)&&!near(out[kind],x,z,spacing)&&(kind!=='bush'||!near(out.tree,x,z,2.2)))pick(kind,x,z);}
 };
 const annulus=(min:number,max:number)=>():[number,number]=>{const a=random()*Math.PI*2,r=Math.sqrt(min*min+random()*(max*max-min*min));return [Math.cos(a)*r,Math.sin(a)*r];};
 const aroundTrunk=(min:number,max:number)=>():[number,number]=>{const t=trunks[Math.floor(random()*trunks.length)],a=random()*Math.PI*2,r=min+random()*(max-min);return [t.x+Math.cos(a)*r,t.z+Math.sin(a)*r];};
 scatter('tree',26,annulus(17,60),7);
 scatter('bush',80,aroundTrunk(1.8,4.5),2.4);scatter('bush',160,annulus(10,58),2.4);
 const meadow=()=>{for(let i=0;i<30;i++){const [x,z]=annulus(9,50)();if(grassDensity(x,z)>.5)return [x,z] as [number,number];}return annulus(9,50)();};
 scatter('ground',270,meadow,1.1);
 scatter('reed',90,()=>{const a=random()*Math.PI*2,s=1.05+random()*.17;return [POND.x+Math.cos(a)*POND.radiusX*s,POND.z+Math.sin(a)*POND.radiusZ*s];},.9);
 full=out;return out;
}
/** A tier keeps a stable, evenly spread subset (by index hash), so switching tier never moves a plant. */
export function gardenPlanting(tier:GardenTier):Record<PlantKind,Placement[]>{
 const all=fullPlanting(),keep=(list:Placement[])=>list.filter((_,i)=>hash(i,7,99)<TIER_SHARE[tier]);
 return {tree:all.tree,bush:keep(all.bush),ground:keep(all.ground),reed:keep(all.reed)};
}
/** Added trees (identical in every tier). They block walking only while drawn: see GardenVegetation onTrees. */
export type PlantedTrunk={x:number;z:number;radius:number;variant:string};
export const plantedTrunks=():PlantedTrunk[]=>fullPlanting().tree.map(t=>({x:t.x,z:t.z,radius:.3*t.scale,variant:t.variant}));
