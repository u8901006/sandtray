export type GardenAudioElement=Pick<HTMLAudioElement,'play'|'pause'|'load'|'removeAttribute'|'addEventListener'|'removeEventListener'|'loop'|'volume'>;
/** A pending play may settle after stop, retry, page hide or teardown. */
export function createGardenAudio(factory:()=>GardenAudioElement,onState:(playing:boolean,error:string)=>void){
 let audio:GardenAudioElement|undefined,requested=false,revision=0,volume=.25;
 const errorMessage='環境音無法播放，請稍後重試。';
 const mediaError=()=>{if(requested){revision++;requested=false;audio?.pause();onState(false,errorMessage);}};
 function stop(){revision++;requested=false;audio?.pause();onState(false,'');}
 function start(){
  const token=++revision;requested=true;
  if(!audio){audio=factory();audio.loop=true;audio.addEventListener('error',mediaError);}
  const current=audio;current.volume=volume;onState(true,'');
  void Promise.resolve().then(()=>{if(token!==revision||!requested)return;return current.play();}).then(()=>{
   if(!requested||current!==audio)current.pause();
  }).catch(()=>{if(token===revision&&requested){requested=false;current.pause();onState(false,errorMessage);}});
 }
 return {toggle(){if(requested)stop();else start();},stop,setVolume(value:number){volume=Number.isFinite(value)?Math.min(1,Math.max(0,value)):.25;if(audio)audio.volume=volume;},dispose(){stop();if(audio){audio.removeEventListener('error',mediaError);audio.removeAttribute('src');audio.load();audio=undefined;}}};
}
