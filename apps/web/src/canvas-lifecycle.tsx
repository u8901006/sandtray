import {useEffect} from 'react';
import {useThree} from '@react-three/fiber';
export function CanvasLifecycle({onLost,onRestored}:{onLost:()=>void;onRestored:()=>void}){
 const {gl,invalidate}=useThree();
 useEffect(()=>{
  const canvas=gl.domElement;
  const lost=(event:Event)=>{event.preventDefault();onLost();};
  const restored=()=>{onRestored();invalidate();};
  canvas.addEventListener('webglcontextlost',lost);canvas.addEventListener('webglcontextrestored',restored);
  return()=>{canvas.removeEventListener('webglcontextlost',lost);canvas.removeEventListener('webglcontextrestored',restored);};
 },[gl,invalidate,onLost,onRestored]);return null;
}
