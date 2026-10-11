"""Quaternius Ultimate Modular Ruins (CC0 1.0) FBX -> GLB for adventure-v1 (2026-10-10, Claude Opus 5.5).

The pack ships only .blend / .fbx / .obj, so each selected FBX is converted in Blender 5.2 (background, factory startup):
  - only mesh objects are kept (cameras, lights, empties dropped); transforms applied so the GLB has no stray scale
  - materials: metallic 0, roughness 0.8, alpha 1 (FBX import sets alpha 0 -> invisible), specular level 0.5;
    base colours kept; Bark / Leaf materials re-linked to the pack's Textures/*.jpg|png (FBX paths are the author's)
  - no animation, no custom properties
Writes source/adventure-v1/ruins/<stem>.glb (gitignored; import_adventure_v1.py embeds and pins them) and
source/adventure-v1/ruins-report.json. Source folder is never changed.
Usage:
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python tools/assets/build_ruins_v1.py
"""
import json, os, sys
import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'assets'))
from adventure_v1_plan import PACKS, ITEMS  # noqa: E402

SOURCE = os.environ.get('ADVENTURE_SOURCE', './asset-packs')
OUT = os.path.join(ROOT, 'source', 'adventure-v1', 'ruins')
os.makedirs(OUT, exist_ok=True)


def reset():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.objects):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


report = []
for pack, rel, stem, *_ in ITEMS:
    if pack != 'RUN':
        continue
    reset()
    path = os.path.join(SOURCE, PACKS[pack]['folder'], rel)
    bpy.ops.import_scene.fbx(filepath=path)
    for obj in list(bpy.data.objects):
        if obj.type != 'MESH':
            bpy.data.objects.remove(obj, do_unlink=True)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    for mat in bpy.data.materials:
        if not mat.node_tree:
            continue
        for node in mat.node_tree.nodes:
            if node.type != 'BSDF_PRINCIPLED':
                continue
            node.inputs['Metallic'].default_value = 0.0
            node.inputs['Roughness'].default_value = 0.8
            # FBX import maps the pack's transparency factor to Alpha 0, so every stone piece exported fully transparent (MASK, alpha 0).
            node.inputs['Alpha'].default_value = 1.0
            node.inputs['Specular IOR Level'].default_value = 0.5  # 1.0 exported as KHR_materials_specular x2: washed-out white bark
            # The FBX texture paths point at the author's machine; Bark / Leaf materials are re-linked to the pack's Textures folder.
            texture = 'Bark_Texture.jpg' if 'Bark' in mat.name else 'Leaf_Texture.png' if 'Leaf' in mat.name or 'Leaves' in mat.name else None
            if texture:
                image = bpy.data.images.load(os.path.join(SOURCE, PACKS['RUN']['folder'], 'Textures', texture), check_existing=True)
                linked = [l.from_node for l in node.inputs['Base Color'].links if l.from_node.type == 'TEX_IMAGE']
                tex = linked[0] if linked else mat.node_tree.nodes.new('ShaderNodeTexImage')
                tex.image = image
                mat.node_tree.links.new(tex.outputs['Color'], node.inputs['Base Color'])
                if texture.endswith('.png'):
                    mat.node_tree.links.new(tex.outputs['Alpha'], node.inputs['Alpha'])
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    xs, ys, zs = zip(*[(o.matrix_world @ v.co)[:] for o in meshes for v in o.data.vertices])
    out = os.path.join(OUT, stem + '.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_apply=True, export_animations=False,
                              export_extras=False, export_cameras=False, export_lights=False, export_yup=True)
    row = {'stem': stem, 'source': rel, 'objects': len(meshes), 'triangles': tris, 'size': [round(max(a) - min(a), 4) for a in (xs, ys, zs)],
           'materials': sorted(m.name for m in bpy.data.materials if m.users), 'images': sorted(i.name for i in bpy.data.images if i.users), 'bytes': os.path.getsize(out)}
    report.append(row)
    print('RUINS', json.dumps(row, ensure_ascii=False))

with open(os.path.join(ROOT, 'source', 'adventure-v1', 'ruins-report.json'), 'w', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=1)
