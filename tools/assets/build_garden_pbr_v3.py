"""Create a new editable PBR garden candidate from the preserved v2 Blender source."""
import bpy,json,hashlib
from mathutils import Vector
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'working/garden-pbr-v3';OUT.mkdir(parents=True,exist_ok=True)
MAPS=ROOT/'assets/garden-pbr-v1'
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'working/garden-v2/garden-source.blend'))
for name,asset,meters in [('Forest_Floor','forest_ground_04',3.15),('Oiled_Timber','wood_floor',1.7)]:
 material=bpy.data.materials[name];nodes=material.node_tree.nodes;links=material.node_tree.links;p=nodes.get('Principled BSDF')
 for n in list(nodes):
  if n.type not in ['BSDF_PRINCIPLED','OUTPUT_MATERIAL']:nodes.remove(n)
 p.inputs['Base Color'].default_value=(1,1,1,1)
 for channel,socket in [('Diffuse','Base Color'),('Rough','Roughness'),('nor_gl','Normal')]:
  tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(MAPS/f'{asset}-{channel}-1k.jpg'));tex.image.pack()
  if channel!='Diffuse':tex.image.colorspace_settings.name='Non-Color'
  if channel=='nor_gl':
   normal=nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.55;links.new(tex.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],p.inputs[socket])
  else:links.new(tex.outputs['Color'],p.inputs[socket])
 for obj in bpy.context.scene.objects:
  if obj.type=='MESH' and material in list(obj.data.materials) and obj.data.uv_layers:
   for uv in obj.data.uv_layers.active.data:uv.uv/= .35*meters
scene=bpy.context.scene;scene.cycles.samples=32;scene.render.resolution_percentage=75
scene.view_settings.exposure=-1.0
scene.world.node_tree.nodes.get("Background").inputs["Strength"].default_value=.12
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'garden-source.blend'))
scene.render.filepath=str(OUT/'garden-overview.png');bpy.ops.render.render(write_still=True)
camera=scene.camera;camera.location=(21,8,1.65);camera.rotation_euler=(Vector((21,17,1.1))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=22
scene.render.filepath=str(OUT/'garden-interior.png');bpy.ops.render.render(write_still=True)
print('PBR_CANDIDATE_COMPLETE',str(OUT))
