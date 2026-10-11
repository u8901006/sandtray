import {useEffect,useState} from 'react';
import {useThree} from '@react-three/fiber';
import type {Texture} from 'three';
import {createGardenReflection} from './garden-reflection';
export function GardenWater({normalMap,quality}:{normalMap:Texture|null;quality:'low'|'high'}){
 const [reflection,setReflection]=useState<ReturnType<typeof createGardenReflection>>();const {invalidate}=useThree();
 useEffect(()=>{const owned=createGardenReflection(normalMap,quality==='high'?512:256);setReflection(owned);invalidate();return()=>owned.dispose();},[normalMap,quality,invalidate]);
 return reflection?<primitive object={reflection.object} dispose={null}/>:null;
}
