/** Memory-only receipts for commands actually sent online. Never renew their authority. */
export class ReceiptRetry {
 private commands = new Map<string,string>();
 private identity: string | undefined;
 constructor(private readonly limit=32) {}
 bind(identity:string){if(this.identity!==identity){this.clear();this.identity=identity;}}
 remember(command:Record<string,unknown>){
  if(!['object.create','object.delete','object.transform.commit','object.appearance.commit','animation.set','animation.stopAll','scene.undo','scene.redo'].includes(String(command.type)))return false;
  if(this.commands.size>=this.limit)throw new Error('尚有操作等待確認，請重新連線核對。');
  this.commands.set(String(command.operationId),JSON.stringify(command));return true;
 }
 settle(id:string){return this.commands.delete(id);}
 replay(){return [...this.commands.values()];}
 clear(){this.commands.clear();this.identity=undefined;}
 get size(){return this.commands.size;}
}
export function advanceEpochs(state:any,message:any){return {...state,sessionEpoch:Math.max(state.sessionEpoch??0,message.sessionEpoch??0),controlEpoch:Math.max(state.controlEpoch??0,message.controlEpoch??0)};}

