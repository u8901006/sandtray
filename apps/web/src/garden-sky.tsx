import {useEffect,useState} from 'react';
import {useThree} from '@react-three/fiber';
import {Sky} from 'three/addons/objects/Sky.js';
import {configureSky} from './garden-environment';
export function GardenSky({sun}:{sun:readonly number[]}){
 const [sky]=useState(()=>{const value=new Sky();value.scale.setScalar(450);configureSky(value,[0,1,0]);return value;});
 const {invalidate}=useThree();
 useEffect(()=>{sky.material.uniforms.sunPosition.value.fromArray(sun);invalidate();},[sky,sun,invalidate]);
 useEffect(()=>()=>{sky.geometry.dispose();sky.material.dispose();},[sky]);
 return <primitive object={sky} dispose={null}/>;
}
