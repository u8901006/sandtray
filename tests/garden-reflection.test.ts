import {it,expect,vi} from 'vitest';
import {Texture,ShaderMaterial} from 'three';
import {createGardenReflection} from '../apps/web/src/garden-reflection';
it('water reflection releases its render target and geometry once without deleting borrowed maps',()=>{
 const texture=new Texture(),owned=createGardenReflection(texture,256),target=owned.object.getRenderTarget();const mapDispose=vi.spyOn(texture,'dispose'),targetDispose=vi.spyOn(target,'dispose'),geometryDispose=vi.spyOn(owned.object.geometry,'dispose'),materialDispose=vi.spyOn(owned.object.material as ShaderMaterial,'dispose');
 expect((owned.object.material as ShaderMaterial).uniforms.normalMap.value).toBe(texture);expect(target.width).toBe(256);expect(owned.object.position.toArray()).toEqual([-23,-.697,10]);owned.dispose();owned.dispose();expect(targetDispose).toHaveBeenCalledTimes(1);expect(geometryDispose).toHaveBeenCalledTimes(1);expect(materialDispose).toHaveBeenCalledTimes(1);expect(mapDispose).not.toHaveBeenCalled();
});
