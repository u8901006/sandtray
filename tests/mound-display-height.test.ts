import {describe,it,expect} from 'vitest';
import {createTrayHeightmap,strokeTray} from '../packages/sand-engine/src/tray';
import {surfaceU8} from '../packages/sand-engine/src/core';
import {surfaceY,u8ToY,sandHeightsY,CM_PER_UNIT} from '../apps/web/src/tray-model';
// User report 2026-10-05 (Claude Opus 5.5): a mound stopped growing at about 3 cm (u8 255 = original surface + 3 cm), too low for a
// small dune. User decision: keep the u8 format (server, sync, saves) and draw the sand above the original surface 3x taller; the part
// above the surface is also rounded so the clamped flat top does not turn into a pillar with cliff sides.
const cm=(y:number)=>y*CM_PER_UNIT;

describe('mound grows into a small dune (display only)',()=>{
 for(const depth of [5,7,10])it(`${depth} cm tray: a mound held in one place reaches about 9 cm above the original surface`,()=>{
  const hm=createTrayHeightmap({shape:'rect',w:72,h:57,depth}),centre:[number,number]=[72,57];
  for(let n=0;n<200;n++)strokeTray(hm,'mound',[centre]);
  expect(hm.data[57*144+72]).toBe(255);
  expect(cm(surfaceY(hm,0,0))).toBeGreaterThan(8.5);expect(cm(surfaceY(hm,0,0))).toBeLessThan(9.5);
 });
 it('the original surface stays at y 0 and digging keeps its scale (floor at -depth, water unaffected)',()=>{
  for(const depth of [5,7,10]){
   const s=surfaceU8(depth);
   expect(u8ToY(s,depth)).toBe(0);
   expect(cm(u8ToY(0,depth))).toBeCloseTo(-s/255*(depth+3),6);
   expect(cm(u8ToY(s-10,depth))).toBeCloseTo(-10/255*(depth+3),6);
  }
 });
 it('height is continuous and strictly increasing across the original surface',()=>{
  for(const depth of [5,7,10]){let last=-Infinity;for(let v=0;v<=255;v++){const y=u8ToY(v,depth);expect(y).toBeGreaterThan(last);if(v>0)expect(y-last).toBeLessThan(.025);last=y;}}
 });

 it('a held mound is a rounded dune, not a flat-topped pillar; a wide mound tops out at 9 cm',()=>{
  const hm=createTrayHeightmap({shape:'rect',w:72,h:57,depth:7});
  for(let n=0;n<200;n++)strokeTray(hm,'mound',[[72,57]]);
  const y=sandHeightsY(hm),row=(d:number)=>cm(y[57*144+72+d]);
  // Saturated cells (u8 255) reach 6 cells out; drawn, the height must keep falling across them and the steepest step stays gentle.
  expect(hm.data[57*144+78]).toBe(255);expect(row(3)).toBeLessThan(row(0)-.8);expect(row(6)).toBeLessThan(row(3)-2);
  let steepest=0;for(let d=0;d<16;d++)steepest=Math.max(steepest,row(d)-row(d+1));
  expect(steepest).toBeLessThan(1.5); // cm per 0.5 cm cell; undrawn-rounded x3 would be a 9 cm cliff in one cell
  const wide=createTrayHeightmap({shape:'rect',w:72,h:57,depth:7}),line:[number,number][]=[];
  for(let i=40;i<=100;i+=2)for(let j=40;j<=74;j+=2)line.push([i,j]);
  for(let n=0;n<120;n++)strokeTray(wide,'mound',line);
  const top=Math.max(...sandHeightsY(wide))*CM_PER_UNIT;expect(top).toBeGreaterThan(8.9);expect(top).toBeLessThanOrEqual(9.0001);
 });
 it('the drawn surface and object seating agree at a cell centre',()=>{
  const hm=createTrayHeightmap({shape:'rect',w:72,h:57,depth:7});
  for(let n=0;n<200;n++)strokeTray(hm,'mound',[[100,80]]);
  const h2=sandHeightsY(hm),x=((100+.5)/144-.5)*10,z=((80+.5)/114-.5)*(57/7.2);
  expect(surfaceY(hm,x,z)).toBeCloseTo(h2[80*144+100],6);
 });
});
