import type {z} from 'zod';
import type {animationSchema} from '../../protocol/src/index';
type Animation=z.infer<typeof animationSchema>;
export function pathPosition(animation:Animation,now:number):[number,number,number]|undefined {
 const path=animation.path;if(!path)return undefined;
 const elapsed=animation.offsetMs+(animation.state==='playing'?Math.max(0,now-animation.serverStartedAt)*animation.speed:0);
 const progress=(animation.loop?elapsed%path.durationMs:Math.min(elapsed,path.durationMs))/path.durationMs;
 const lengths=path.points.slice(1).map((p,i)=>Math.hypot(...p.map((v,axis)=>v-path.points[i][axis])));
 let distance=lengths.reduce((a,b)=>a+b,0)*progress;
 for(let i=0;i<lengths.length;i++){if(distance<=lengths[i]&&lengths[i]>0){const start=path.points[i],end=path.points[i+1];return start.map((v,axis)=>v+(end[axis]-v)*distance/lengths[i]) as [number,number,number];}distance-=lengths[i];}
 return [...path.points.at(-1)!];
}
