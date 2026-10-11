import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {Group,Mesh,BoxGeometry,MeshStandardMaterial} from 'three';
const {load,managers}=vi.hoisted(()=>({load:vi.fn(),managers:[] as any[]}));
vi.mock('three/addons/loaders/GLTFLoader.js',()=>({GLTFLoader:class {constructor(manager:any){managers.push(manager??{abort:vi.fn()});}loadAsync=load}}));
import {acquireAsset} from '../apps/web/src/asset-pool';
function fixture(){const scene=new Group();const geometry=new BoxGeometry();const material=new MeshStandardMaterial();scene.add(new Mesh(geometry,material));return {scene,geometry,material};}
beforeEach(()=>{load.mockReset();managers.length=0;});
afterEach(()=>vi.useRealTimers());
it('retains shared geometry until the final instance releases',async()=>{
 const f=fixture();load.mockResolvedValue({scene:f.scene});const dispose=vi.spyOn(f.geometry,'dispose');const disposeMaterial=vi.spyOn(f.material,'dispose');
 const first=acquireAsset('test-shared');const second=acquireAsset('test-shared');await first.promise;
 expect(load).toHaveBeenCalledTimes(1);first.release();await Promise.resolve();expect(dispose).not.toHaveBeenCalled();
 second.release();await Promise.resolve();expect(dispose).toHaveBeenCalledTimes(1);expect(disposeMaterial).toHaveBeenCalledTimes(1);
 second.release();expect(dispose).toHaveBeenCalledTimes(1);
});
it('unmount before load completion still disposes the eventual result',async()=>{
 const f=fixture();let resolve!:(value:{scene:Group})=>void;load.mockImplementation(()=>new Promise(r=>resolve=r));
 const dispose=vi.spyOn(f.geometry,'dispose');const asset=acquireAsset('test-pending');asset.release();resolve({scene:f.scene});await asset.promise;await Promise.resolve();expect(dispose).toHaveBeenCalledTimes(1);
});
it('failed asset can be removed and retried',async()=>{
 load.mockRejectedValueOnce(new Error('load failed'));const asset=acquireAsset('test-failure');await expect(asset.promise).rejects.toThrow();asset.release();
 load.mockResolvedValueOnce({scene:fixture().scene});const retry=acquireAsset('test-failure');await expect(retry.promise).resolves.toBeDefined();retry.release();
});

it('retries while other failed instances remain and their later release cannot evict the replacement',async()=>{
 load.mockRejectedValueOnce(new Error('temporary'));const oldA=acquireAsset('shared-retry'),oldB=acquireAsset('shared-retry');await expect(oldA.promise).rejects.toThrow();await expect(oldB.promise).rejects.toThrow();
 const f=fixture();load.mockResolvedValueOnce({scene:f.scene});const retry=acquireAsset('shared-retry');await expect(retry.promise).resolves.toBe(f.scene);oldA.release();oldB.release();await Promise.resolve();const another=acquireAsset('shared-retry');await another.promise;expect(load).toHaveBeenCalledTimes(2);const dispose=vi.spyOn(f.geometry,'dispose');retry.release();await Promise.resolve();expect(dispose).not.toHaveBeenCalled();another.release();await Promise.resolve();expect(dispose).toHaveBeenCalledTimes(1);
});

it('times out a stalled asset without aborting another asset and allows retry',async()=>{
 vi.useFakeTimers();load.mockImplementationOnce(()=>new Promise(()=>{}));const stalled=acquireAsset('stalled-timeout');const abort=vi.spyOn(managers[0],'abort');const rejected=expect(stalled.promise).rejects.toThrow(/逾時/);
 const ready=fixture();load.mockResolvedValueOnce({scene:ready.scene});const other=acquireAsset('other-timeout');await other.promise;const otherAbort=vi.spyOn(managers[1],'abort');
 await vi.advanceTimersByTimeAsync(45000);await rejected;expect(abort).toHaveBeenCalledTimes(1);expect(otherAbort).not.toHaveBeenCalled();
 const replacement=fixture();load.mockResolvedValueOnce({scene:replacement.scene});const retry=acquireAsset('stalled-timeout');await expect(retry.promise).resolves.toBe(replacement.scene);stalled.release();retry.release();other.release();expect(vi.getTimerCount()).toBe(0);
});
it('disposes a model that finishes after timeout exactly once',async()=>{
 vi.useFakeTimers();let resolve!:(value:{scene:Group})=>void;load.mockImplementation(()=>new Promise(r=>resolve=r));const f=fixture();const disposed=vi.spyOn(f.geometry,'dispose');const pending=acquireAsset('late-timeout');const rejected=expect(pending.promise).rejects.toThrow(/逾時/);await vi.advanceTimersByTimeAsync(45000);await rejected;pending.release();resolve({scene:f.scene});await Promise.resolve();await Promise.resolve();expect(disposed).toHaveBeenCalledTimes(1);pending.release();expect(disposed).toHaveBeenCalledTimes(1);
});
