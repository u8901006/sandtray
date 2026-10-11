"""Independent audit of exported v2 human GLBs; writes only motion-v3 evidence."""
import bpy, json, math, hashlib
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'working/motion-v3'
OUT.mkdir(parents=True, exist_ok=True)
report=[]
for aid in ['ST-007','ST-019','ST-008','ST-020']:
 for variant in ['model','lod']:
  bpy.ops.wm.read_factory_settings(use_empty=True)
  path=ROOT/'working/pilot-v2'/aid/(variant+'.glb')
  bpy.ops.import_scene.gltf(filepath=str(path))
  scene=bpy.context.scene
  meshes=[o for o in scene.objects if o.type=='MESH']
  anim=[o.animation_data for o in scene.objects if o.animation_data]
  scene.render.engine='CYCLES'; scene.cycles.samples=4; scene.cycles.use_denoising=True
  scene.render.resolution_x=300; scene.render.resolution_y=420; scene.render.resolution_percentage=100
  world=bpy.data.worlds.new('AuditWorld'); world.use_nodes=True
  world.node_tree.nodes['Background'].inputs[0].default_value=(.65,.65,.65,1)
  world.node_tree.nodes['Background'].inputs[1].default_value=.7; scene.world=world
  bpy.ops.object.camera_add(location=(0,-5,.95)); camera=bpy.context.object
  camera.rotation_euler=(Vector((0,0,.9))-camera.location).to_track_quat('-Z','Y').to_euler()
  camera.data.type='ORTHO'; camera.data.ortho_scale=2.2; scene.camera=camera
  for pos in [(-3,-4,4),(3,-2,3)]:
   bpy.ops.object.light_add(type='AREA',location=pos); light=bpy.context.object
   light.data.energy=350; light.data.size=4
   light.rotation_euler=(Vector((0,0,1))-light.location).to_track_quat('-Z','Y').to_euler()
  entry={'assetId':aid,'variant':variant,'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'samples':[]}
  for clip in ['rest','idle','walk','wave']:
   for ad in anim:
    ad.action=None
    for track in ad.nla_tracks:
     track.mute=not(track.name==clip or any(s.action and s.action.name==clip for s in track.strips))
   for frame in ([0] if clip=='rest' else [1,9,17,25]):
    scene.frame_set(frame); bpy.context.view_layer.update()
    coords=[]; degenerate=0; faces=0
    for obj in meshes:
     ev=obj.evaluated_get(bpy.context.evaluated_depsgraph_get()); me=ev.to_mesh(); me.calc_loop_triangles()
     coords.extend(tuple(ev.matrix_world@v.co) for v in me.vertices)
     for tri in me.loop_triangles:
      a,b,c=[me.vertices[i].co for i in tri.vertices]
      degenerate+=((b-a).cross(c-a).length<1e-12); faces+=1
     ev.to_mesh_clear()
    sample={'clip':clip,'frame':frame,'finite':all(math.isfinite(c) for p in coords for c in p),'lower':[min(p[i] for p in coords) for i in range(3)],'upper':[max(p[i] for p in coords) for i in range(3)],'degenerateTriangles':degenerate,'triangles':faces}
    if aid in ['ST-007','ST-019']:
     filename=f'{aid}-{variant}-{clip}-{frame:02d}.png'
     scene.render.filepath=str(OUT/filename); bpy.ops.render.render(write_still=True)
     sample['image']=filename
    entry['samples'].append(sample)
  report.append(entry)
  (OUT/'audit.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
  print('AUDIT_DONE',aid,variant,flush=True)
