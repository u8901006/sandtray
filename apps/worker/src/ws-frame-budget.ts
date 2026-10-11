import {Rejected} from '../../../packages/room-core/src/index';

export interface FrameBudget {
 window:number;
 normal:number;
 priority:number;
 commits:number;
 previews:number;
 invalidFrames?:number;
}

/** Parse one inbound frame while bounding repeated malformed input per connection. */
export function parseInboundFrame<T>(raw:string|ArrayBuffer,budget:FrameBudget,now:number,parse:(raw:string)=>T):T{
 if(now-budget.window>=1000){budget.window=now;budget.normal=0;budget.priority=0;budget.commits=0;budget.previews=0;budget.invalidFrames=0;}
 budget.invalidFrames??=0;
 if(budget.invalidFrames>=10)throw new Rejected('RATE_LIMITED',Math.max(1,budget.window+1000-now));
 try{
  if(typeof raw!=='string')throw new Rejected('INVALID_PAYLOAD');
  return parse(raw);
 }catch(cause){budget.invalidFrames=(budget.invalidFrames??0)+1;throw cause;}
}

/** Recover attribution for ordinary parse failures, but never inspect a frame rejected by the pre-parse gate. */
export function recoverRejectedOperationId(raw:string|ArrayBuffer,blockedBeforeParse:boolean,parse:(raw:string)=>unknown=JSON.parse):string|undefined{
 if(blockedBeforeParse||typeof raw!=='string'||raw.length>16384||new TextEncoder().encode(raw).length>16384)return undefined;
 try{
  const value=parse(raw);
  if(value&&typeof value==='object'){
   const operationId=(value as {operationId?:unknown}).operationId;
   if(Object.hasOwn(value,'operationId')&&typeof operationId==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(operationId))return operationId;
  }
 }catch{/* unparseable payload keeps 'invalid' */}
 return undefined;
}
