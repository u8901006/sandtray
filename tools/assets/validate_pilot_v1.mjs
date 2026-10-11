import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Box3, Vector3, AnimationMixer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const base = path.join(root, 'working/pilot-v1');
const ids = ['007','020','021','036','046','048','056','064','084','092'].map(x => `ST-${x}`);
function jsonChunk(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid GLB header/length');
  const size = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || size + 20 > bytes.length) throw new Error('Invalid GLB JSON chunk');
  return JSON.parse(bytes.subarray(20, 20 + size).toString('utf8'));
}
async function inspect(file) {
  const bytes = await readFile(file);
  const data = jsonChunk(bytes);
  let triangles = 0;
  for (const mesh of data.meshes ?? []) for (const p of mesh.primitives) {
    const count = data.accessors[p.indices ?? p.attributes.POSITION].count;
    const mode = p.mode ?? 4;
    if (mode === 4) triangles += count / 3;
    else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
    else throw new Error(`Non-triangle primitive ${mode}`);
  }
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(gltf.scene);
  const size = bounds.getSize(new Vector3()).toArray();
  let meshes = 0; let skinnedMeshes = 0;
  const materialNames = new Set();
  gltf.scene.traverse(object => {
    if (!object.isMesh) return;
    meshes++;
    if (object.isSkinnedMesh) skinnedMeshes++;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materialNames.add(material.name);
      if (!material.color) throw new Error('Material does not support color editing');
      const before = material.color.clone();
      material.color.setRGB(0.123, 0.456, 0.789);
      if (material.color.equals(before)) throw new Error('Material mutation failed');
      material.color.copy(before);
    }
  });
  const copy = clone(gltf.scene);
  copy.position.set(2, 3, 4); copy.rotation.y = 0.5; copy.scale.setScalar(1.25); copy.updateMatrixWorld(true);
  if (copy === gltf.scene || gltf.scene.position.equals(copy.position)) throw new Error('Independent clone transform failed');
  const animationChecks = [];
  for (const clip of gltf.animations) {
    if (!(clip.duration > 0) || !clip.tracks.length) throw new Error(`Empty animation ${clip.name}`);
    const mixer = new AnimationMixer(copy);
    mixer.clipAction(clip).play(); mixer.update(0);
    copy.updateMatrixWorld(true);
    const beforePose = new Map();
    copy.traverse(o => beforePose.set(o.uuid, [...o.matrixWorld.elements]));
    mixer.update(Math.min(0.25, clip.duration / 3));
    copy.updateMatrixWorld(true);
    let movedNodes = 0;
    copy.traverse(o => { if (o.matrixWorld.elements.some((n,i) => Math.abs(n-beforePose.get(o.uuid)[i]) > 1e-7)) movedNodes++; });
    if (!movedNodes) throw new Error('Animation does not change any node: '+clip.name);
    copy.traverse(o => { if (!o.matrixWorld.elements.every(Number.isFinite)) throw new Error(`Non-finite animation ${clip.name}`); });
    mixer.stopAllAction(); mixer.uncacheRoot(copy);
    animationChecks.push({ name: clip.name, duration: clip.duration, tracks: clip.tracks.length, movedNodes, mixerUpdate: 'PASS' });
  }
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), triangles, meshes, skinnedMeshes,
    skins: data.skins?.length ?? 0, jointCounts: (data.skins ?? []).map(s => s.joints.length),
    materialNames: [...materialNames], materialCount: data.materials?.length ?? 0, size, min: bounds.min.toArray(), max: bounds.max.toArray(),
    animationChecks, loader: 'PASS', materialMutation: 'PASS', cloneTransform: 'PASS' };
}
const results = [];
for (const assetId of ids) {
  const item = { assetId, status: 'FAIL', errors: [], warnings: [] };
  try {
    item.model = await inspect(path.join(base, assetId, 'model.glb'));
    item.lod = await inspect(path.join(base, assetId, 'lod.glb'));
    const metadata = JSON.parse(await readFile(path.join(base, assetId, 'metadata.json'), 'utf8'));
    for (const name of ['model.glb','lod.glb','source.blend']) {
      const artifact = await readFile(path.join(base, assetId, name));
      const recorded = metadata.artifacts?.[name];
      if (!recorded || recorded.bytes !== artifact.length || recorded.sha256 !== createHash('sha256').update(artifact).digest('hex'))
        item.errors.push('Artifact provenance mismatch: '+name);
    }
    const reference = await readFile(path.join(root, 'references', assetId, 'candidate-1.png'));
    if (metadata.referenceSha256 !== createHash('sha256').update(reference).digest('hex')) item.errors.push('Reference hash mismatch');
    const render = JSON.parse(await readFile(path.join(base, assetId, 'render-evidence.json'), 'utf8'));
    if (render.sha256 !== item.model.sha256) item.errors.push('Render evidence uses a different model');
    const views = ['hero','front','back','left','right','top','bottom',...Array.from({length:8},(_,i)=>'turn-'+String(i).padStart(2,'0'))];
    for (const view of views) {
      const png = await readFile(path.join(base, assetId, view+'.png'));
      if (!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) item.errors.push('Invalid render PNG: '+view);
    }
    item.renderArtifacts = views.length;
    item.editableMaterials = metadata.editableMaterials;
    for (const [label, model] of [['model', item.model], ['lod', item.lod]]) {
      if (!model.meshes || !model.size.every(n => Number.isFinite(n) && n > 0.001)) item.errors.push(`${label}: empty or flat bounds`);
      if (model.materialCount > 3) item.errors.push(`${label}: over 3 materials`);
      if (model.meshes > 10) item.errors.push(label+': over 10 draw primitives');
      if (model.triangles > 15000) item.errors.push(label+': over 15000 triangles');
      if (Math.abs(model.min[1]) > 0.01) item.errors.push(label+': base is not at ground origin');
      if ([0,2].some(axis=>Math.abs((model.min[axis]+model.max[axis])/2)>0.02)) item.errors.push(label+': base pivot is not centered');
      if (model.bytes > 2 * 1024 * 1024) item.errors.push(`${label}: exceeds 2 MiB target; exception review required`);
    }
    if (!(item.lod.triangles < item.model.triangles)) item.errors.push('LOD triangle count is not lower');
    if (!Array.isArray(metadata.editableMaterials) || !metadata.editableMaterials.length) item.errors.push('Missing editable material metadata');
    else for (const name of metadata.editableMaterials) if (!item.model.materialNames.includes(name)) item.errors.push(`Editable material missing: ${name}`);
    if (['ST-007', 'ST-020'].includes(assetId)) {
      for (const [label, model] of [['model', item.model], ['lod', item.lod]]) {
        if (!model.skins || !model.skinnedMeshes || !model.jointCounts.some(n => n > 1)) item.errors.push(`${label}: human lacks skin/joints`);
        for (const clip of ['idle','walk','wave']) if (!model.animationChecks.some(a => a.name === clip)) item.errors.push(`${label}: missing ${clip} animation`);
      }
    }
    if (assetId === 'ST-036' && (!item.model.animationChecks.length || !item.lod.animationChecks.length)) item.errors.push('Butterfly requires motion in both LODs');
    item.warnings.push('Style, skin deformation quality, six-view visual review, real-device performance, and provenance terms require separate acceptance.');
    if (!item.errors.length) item.status = 'PASS';
  } catch (error) { item.errors.push(`${error.code ?? error.name}: ${error.message}`); }
  results.push(item);
}
const report = { generatedAt: new Date().toISOString(), status: results.every(x => x.status === 'PASS') ? 'PASS' : 'FAIL',
  scope: 'Local GLB structure and Three.js loader behavior; candidate validation only, not RELEASED.',
  passed: results.filter(x => x.status === 'PASS').length, expected: ids.length, results };
await mkdir(base, { recursive: true });
await writeFile(path.join(base, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === 'PASS' ? 0 : 1;
