import {useEffect,type MutableRefObject} from 'react';
import {useThree} from '@react-three/fiber';
import type {Transform} from '../../../packages/protocol/src/index';

export type PngCapture = () => Promise<Blob>;
export function PngCaptureBridge({capture,verify}: {capture:MutableRefObject<PngCapture|null>;verify:()=>Array<{id:string;transform:Transform}>}) {
 const {gl,scene,camera}=useThree();
 useEffect(()=>{
  const captureFrame:PngCapture=()=>new Promise((resolve,reject)=>{
   requestAnimationFrame(()=>{
    try {
     const objects=verify();
     if(gl.getContext().isContextLost()||!gl.domElement.width||!gl.domElement.height)throw new Error('3D 畫面尚未準備好，請稍後重試。');
     const found=new Set<string>();
     scene.traverse(object=>{
      const id=object.userData.sandtrayObjectId;
      if(!id)return;
      const expected=objects.find(item=>item.id===id);
      const close=(a:number[],b:number[])=>a.every((v,i)=>Math.abs(v-b[i])<0.00001);
      if(!expected||!close(object.position.toArray(),expected.transform.position)||!close(object.quaternion.toArray(),expected.transform.rotation)||!close(object.scale.toArray(),[expected.transform.scale,expected.transform.scale,expected.transform.scale]))throw new Error('物件仍在調整中，請完成操作並等待確認後匯出。');
      found.add(id);
     });
     if(found.size!==objects.length)throw new Error('模型尚未完整載入，請稍後重試。');
     // Capture immediately after rendering: no persistent drawing buffer is needed.
     gl.render(scene,camera);
     gl.domElement.toBlob(blob=>blob&&blob.size>0?resolve(blob):reject(new Error('無法產生 PNG，請重試。')),'image/png');
    }catch(error){reject(error);}
   });
  });
  capture.current=captureFrame;
  return()=>{if(capture.current===captureFrame)capture.current=null;};
 },[gl,scene,camera,capture,verify]);
 return null;
}
