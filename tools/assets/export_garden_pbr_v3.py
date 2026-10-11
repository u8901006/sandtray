"""Export a browser candidate from the PBR Blender source; keep v2 unchanged."""
import bpy,json,hashlib,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'apps/web/public/environments/garden-v3';OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'working/garden-pbr-v3/garden-source.blend'))
scene=bpy.context.scene
bpy.ops.object.select_all(action='DESELECT')
for obj in list(scene.objects):
 if obj.type=='MESH':
  bpy.context.view_layer.objects.active=obj;obj.select_set(True)
  for mod in list(obj.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
  obj.select_set(False)
for mat in bpy.data.materials:
 objects=[o for o in scene.objects if o.type=='MESH' and len(o.data.materials)==1 and o.data.materials[0]==mat and not o.name.startswith(('Pavilion_louver','Pavilion_beam','Pavilion_crossbeam'))]
 if not objects:continue
 bpy.ops.object.select_all(action='DESELECT')
 for obj in objects:obj.select_set(True)
 bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();objects[0].name='Garden_'+mat.name
for quality in ['high','low']:
 if quality=='low':
  for obj in list(scene.objects):
   if obj.type=='MESH' and len(obj.data.polygons)>300:
    mod=obj.modifiers.new('Lightweight browser mesh','DECIMATE');mod.ratio=.4;bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=mod.name)
 bpy.ops.export_scene.gltf(filepath=str(OUT/f'garden-{quality}.glb'),export_format='GLB',export_cameras=False,export_lights=False,export_animations=False,export_image_format='JPEG',export_jpeg_quality=85)
for name in ['garden-ambience.wav','navigation.json']:shutil.copyfile(ROOT/'apps/web/public/environments/garden-v2'/name,OUT/name)
shutil.copyfile(ROOT/'assets/garden-pbr-v1/manifest.json',OUT/'material-sources.json')
report={'generator':'Headless Blender '+bpy.app.version_string,'source':'working/garden-pbr-v3/garden-source.blend','extentMeters':[220,220],'files':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in OUT.iterdir() if p.suffix in ['.glb','.wav']},'materials':'material-sources.json','status':'CANDIDATE_PENDING_BROWSER_VERIFICATION'}
(OUT/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('EXPORT_COMPLETE',json.dumps(report))
