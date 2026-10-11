import {it,expect,vi} from 'vitest';
import {Group,Mesh,BoxGeometry,MeshStandardMaterial,Texture} from 'three';
import {gardenSurfaces} from '../apps/web/src/garden-surfaces';
it('garden surface instances isolate lighting and dispose only owned materials once',()=>{
 const source=new Group(),geometry=new BoxGeometry(),texture=new Texture(),water=new MeshStandardMaterial({map:texture}),lamp=new MeshStandardMaterial();water.name='Pond_Water';lamp.name='Warm_Lantern';source.add(new Mesh(geometry,water),new Mesh(geometry,lamp),new Mesh(geometry,lamp));
 const first=gardenSurfaces(source),second=gardenSurfaces(source);const firstLamp=(first.root.children[1] as Mesh).material as MeshStandardMaterial,secondLamp=(second.root.children[1] as Mesh).material as MeshStandardMaterial;
 first.setLanterns(true);second.setLanterns(false);expect(firstLamp.emissiveIntensity).toBe(2.4);expect(secondLamp.emissiveIntensity).toBe(0);expect(lamp.emissiveIntensity).toBe(1);expect((first.root.children[2] as Mesh).material).toBe(firstLamp);
 const materialDispose=vi.spyOn(firstLamp,'dispose'),geometryDispose=vi.spyOn(geometry,'dispose'),textureDispose=vi.spyOn(texture,'dispose'),sourceDispose=vi.spyOn(lamp,'dispose');first.dispose();first.dispose();expect(materialDispose).toHaveBeenCalledTimes(1);expect(geometryDispose).not.toHaveBeenCalled();expect(textureDispose).not.toHaveBeenCalled();expect(sourceDispose).not.toHaveBeenCalled();expect((first.root.children[0] as Mesh).castShadow).toBe(false);second.dispose();
});
