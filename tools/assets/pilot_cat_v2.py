"""ST-021 continuous-surface cat candidate; original references remain unchanged.

Design reference: anyCreature's attached-volume and smooth-body principles.
No upstream code or assets are incorporated. Run with Blender for smoke artifacts.
"""
import sys
import json
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
from pilot_organic_v1 import ell, tube, material, thick_shape


def build(asset_id):
    if asset_id != 'ST-021':
        raise ValueError(asset_id)
    fur = material('fur', (1, 1, 1))
    dark = material('eyes_nose', (.022, .013, .009))
    iris = material('iris', (.25, .34, .15))
    ell('Torso', (0, .035, .255), (.11, .205, .12), fur, 24, 16)
    ell('Chest', (0, -.12, .295), (.098, .11, .135), fur, 24, 16)
    for side in (-1, 1):
        for y in (-.13, .16):
            ell('Leg', (side*.074, y, .12), (.036, .041, .113), fur)
            ell('Paw', (side*.074, y-.014, .029), (.043, .055, .029), fur)
    ell('Head', (0, -.16, .433), (.105, .091, .098), fur, 32, 24)
    for side in (-1, 1):
        ell('Muzzle volume', (side*.029, -.232, .398), (.044, .037, .035), fur, 24, 16)
        ear = thick_shape('Attached ear', [(side*.033,.48), (side*.075,.566), (side*.101,.478)], .048, fur)
        ear.location.y = -.157
    tube('Tail', [(0,.205,.29), (0,.29,.31), (-.03,.355,.38), (-.065,.35,.42)], .022, fur)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for ob in meshes:
        ob.select_set(True)
    body = meshes[0]
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body.name = 'Continuous cat surface'
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mod = body.modifiers.new('Fuse overlapping sculpt volumes', 'REMESH')
    mod.mode = 'VOXEL'
    mod.voxel_size = .0035
    mod.use_smooth_shade = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    smooth = body.modifiers.new('Smooth sculpt transitions', 'SMOOTH')
    smooth.factor = .55
    smooth.iterations = 5
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    dec = body.modifiers.new('Candidate triangle budget', 'DECIMATE')
    dec.ratio = min(1, 11000 / max(1, len(body.data.polygons)*2))
    bpy.ops.object.modifier_apply(modifier=dec.name)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(body.data)
    bm.free()
    for p in body.data.polygons:
        p.use_smooth = True
    # Fur markings are colour on the continuous surface, never intersecting shells.
    colors = body.data.color_attributes.new(name='FurColor', type='FLOAT_COLOR', domain='POINT')
    for v, entry in zip(body.data.vertices, colors.data):
        x, y, z = v.co
        muzzle = ((x/.079)**2 + ((z-.398)/.048)**2 < 1 and y < -.225)
        bib = ((x/.068)**2 + ((z-.295)/.09)**2 < 1 and y < -.183)
        paws = z < .048
        entry.color = (.76,.70,.59,1) if muzzle or bib or paws else (.30,.285,.27,1)
    node = fur.node_tree.nodes.new('ShaderNodeVertexColor')
    node.layer_name = 'FurColor'
    fur.node_tree.links.new(node.outputs['Color'], fur.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    for side in (-1, 1):
        eye = ell('Attached eye', (side*.043,-.243,.444), (.017,.011,.019), iris, 24, 16)
        pupil = ell('Pupil', (side*.043,-.252,.444), (.005,.004,.013), dark, 16, 12)
        eye['lod_preserve'] = pupil['lod_preserve'] = True
    nose = ell('Nose', (0,-.27,.409), (.010,.007,.0065), dark, 20, 12)
    nose['lod_preserve'] = True
    # Ground contact remains exact after voxel smoothing.
    floor = min(v.co.z for v in body.data.vertices)
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH':
            ob.location.z -= floor
    return {'editableMaterials':['fur'], 'clips':[], 'changeNotes':[
        'Unified head, muzzle, ears and body; no separate cream facial/bib shells.',
        'Surface colour replaces intersecting cream overlays; attached eyes and nose.',
        'lod_preserve=True on eye, pupil and nose objects; keep these meshes separate.']}


def smoke():
    from build_pilot_v1 import export, mesh_stats, reset
    folder = Path(__file__).resolve().parents[2] / 'working/cat-v2-smoke'
    folder.mkdir(parents=True, exist_ok=True)
    reset()
    metadata = build('ST-021')
    metadata['stats'] = mesh_stats()
    metadata['nonManifoldEdges'] = {}
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH':
            bm=bmesh.new(); bm.from_mesh(ob.data)
            metadata['nonManifoldEdges'][ob.name] = sum(not e.is_manifold for e in bm.edges)
            bm.free()
    bpy.ops.wm.save_as_mainfile(filepath=str(folder/'source.blend'))
    export(folder/'model.glb')
    for ob in list(bpy.context.scene.objects):
        if ob.type == 'MESH' and not ob.get('lod_preserve'):
            bpy.context.view_layer.objects.active=ob
            mod=ob.modifiers.new('LOD', 'DECIMATE'); mod.ratio=.5
            bpy.ops.object.modifier_apply(modifier=mod.name)
    metadata['lodStats']=mesh_stats()
    export(folder/'lod.glb')
    (folder/'evidence.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
    for asset in ['model','lod']:
        reset()
        bpy.ops.import_scene.gltf(filepath=str(folder/(asset+'.glb')))
        scene=bpy.context.scene
        scene.render.engine='CYCLES'; scene.cycles.samples=16
        scene.render.resolution_x=600; scene.render.resolution_y=600
        scene.render.resolution_percentage=100
        world=bpy.data.worlds.new('World'); world.use_nodes=True
        world.node_tree.nodes['Background'].inputs[0].default_value=(.7,.7,.7,1)
        world.node_tree.nodes['Background'].inputs[1].default_value=.6
        scene.world=world
        for loc,power in [((1,-1,2),100),((-1,-.5,1),50)]:
            data=bpy.data.lights.new('Soft light','AREA'); data.energy=power; data.size=1
            ob=bpy.data.objects.new('Soft light',data); scene.collection.objects.link(ob)
            ob.location=loc; ob.rotation_euler=(Vector((0,0,.3))-ob.location).to_track_quat('-Z','Y').to_euler()
        data=bpy.data.cameras.new('Camera'); data.type='ORTHO'; data.ortho_scale=.7
        camera=bpy.data.objects.new('Camera',data); scene.collection.objects.link(camera);scene.camera=camera
        for name,loc in [('front',(0,-2,.3)),('hero',(1,-2,1)),('side',(2,0,.3))]:
            camera.location=loc
            camera.rotation_euler=(Vector((0,0,.28))-camera.location).to_track_quat('-Z','Y').to_euler()
            scene.render.filepath=str(folder/(asset+'-'+name+'.png'))
            bpy.ops.render.render(write_still=True)

if __name__ == '__main__':
    smoke()
