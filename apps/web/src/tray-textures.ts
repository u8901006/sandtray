import {DataTexture,RGBAFormat,UnsignedByteType,RepeatWrapping,SRGBColorSpace,LinearMipmapLinearFilter,LinearFilter} from 'three';
export function createTrayTextures(){
 const size=256,sandPixels=new Uint8Array(size*size*4),normalPixels=new Uint8Array(size*size*4),woodPixels=new Uint8Array(size*size*4),height=new Float32Array(size*size);let seed=9122026;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<height.length;i++)height[i]=random();
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const index=y*size+x,offset=index*4,grain=height[index]-.5,tone=1+grain*.09;
  sandPixels.set([Math.round(210*tone),Math.round(194*tone),Math.round(161*tone),255],offset);
  const dx=(height[y*size+(x+1)%size]-height[y*size+(x+size-1)%size])*.32,dy=(height[((y+1)%size)*size+x]-height[((y+size-1)%size)*size+x])*.32,length=Math.hypot(dx,dy,1);
  normalPixels.set([Math.round((.5-dx/length*.5)*255),Math.round((.5-dy/length*.5)*255),Math.round((.5+.5/length)*255),255],offset);
  const fiber=1+.065*Math.sin(x*.48+Math.sin(y*.049)*.65)+grain*.035;
  woodPixels.set([Math.round(133*fiber),Math.round(98*fiber),Math.round(66*fiber),255],offset);
 }
 const make=(pixels:Uint8Array,color:boolean,repeat:[number,number])=>{const texture=new DataTexture(pixels,size,size,RGBAFormat,UnsignedByteType);texture.wrapS=texture.wrapT=RepeatWrapping;texture.repeat.set(...repeat);texture.magFilter=LinearFilter;texture.minFilter=LinearMipmapLinearFilter;texture.generateMipmaps=true;if(color)texture.colorSpace=SRGBColorSpace;texture.needsUpdate=true;return texture;};
 const sand=make(sandPixels,true,[12,8]),normal=make(normalPixels,false,[12,8]),wood=make(woodPixels,true,[1,1]);let disposed=false;
 return {sand,normal,wood,dispose(){if(disposed)return;disposed=true;sand.dispose();normal.dispose();wood.dispose();}};
}
