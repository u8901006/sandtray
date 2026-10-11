"""Isolated, reproducible candidate build. Never publishes or modifies references.
Run Blender --background --factory-startup --python this_file -- [ST-046 ...].
"""
import bpy
import sys
import json
import math
import hashlib
import importlib
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))
GROUPS = {
    "pilot_static_v1": ["ST-046", "ST-048", "ST-056", "ST-064", "ST-084"],
    "pilot_organic_v1": ["ST-021", "ST-036", "ST-092"],
    "pilot_humans_v1": ["ST-007", "ST-020"],
}

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def export(path):
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB",
        export_yup=True, export_animations=True, export_animation_mode="NLA_TRACKS",
        export_apply=False, export_cameras=False, export_lights=False)

def mesh_stats():
    bpy.context.view_layer.update()
    triangles = 0
    points = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.hide_render or not obj.visible_get():
            continue
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        triangles += len(mesh.loop_triangles)
        points.extend(obj.matrix_world @ v.co for v in mesh.vertices)
        evaluated.to_mesh_clear()
    if not points:
        raise ValueError("No model geometry")
    lower = [min(p[i] for p in points) for i in range(3)]
    upper = [max(p[i] for p in points) for i in range(3)]
    return {"triangles": triangles, "lower": lower, "upper": upper}

def consolidate():
    # Preserve animated wing nodes and skinning; combine static geometry per parent.
    groups = {}
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH" or obj.animation_data:
            continue
        bpy.context.view_layer.objects.active = obj
        for modifier in list(obj.modifiers):
            if modifier.type != "ARMATURE":
                bpy.ops.object.modifier_apply(modifier=modifier.name)
        rig = next((m.object for m in obj.modifiers if m.type == "ARMATURE"), None)
        groups.setdefault((obj.parent, rig), []).append(obj)
    for objects in groups.values():
        if len(objects) < 2:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()

def render_views(folder):
    # Reimport exported artifact: previews must show actual GLB, not source-only features.
    reset()
    bpy.ops.import_scene.gltf(filepath=str(folder / "model.glb"))
    scene = bpy.context.scene
    scene.frame_set(0)
    stats = mesh_stats()
    lo, hi = Vector(stats["lower"]), Vector(stats["upper"])
    center, span = (lo + hi) / 2, max(hi - lo)
    world = bpy.data.worlds.new("PreviewWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.82, 0.80, 0.76, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    scene.world = world
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 12
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 400
    scene.render.resolution_y = 400
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    for name, direction, energy, size in [
        ("Key", (2,-3,4), 450, 4), ("Fill", (-3,-1,2), 200, 3),
        ("Rim", (1,3,3), 350, 3)]:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy * span * span
        data.shape = "DISK"
        data.size = size * span
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = center + Vector(direction) * span
        obj.rotation_euler = (center - obj.location).to_track_quat("-Z", "Y").to_euler()
    camera_data = bpy.data.cameras.new("PreviewCamera")
    camera = bpy.data.objects.new("PreviewCamera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = span * 1.6
    views = {"hero": (2,-3,2), "front": (0,-1,0), "back": (0,1,0),
             "left": (-1,0,0), "right": (1,0,0), "top": (0,0,1),
             "bottom": (0,0,-1)}
    for n in range(8):
        angle = n * math.tau / 8
        views[f"turn-{n:02d}"] = (math.sin(angle), -math.cos(angle), 0.5)
    for name, direction in views.items():
        camera.location = center + Vector(direction).normalized() * span * 5
        camera.rotation_euler = (center-camera.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(folder / f"{name}.png")
        bpy.ops.render.render(write_still=True)
    return stats

def build_one(asset_id, module):
    folder = ROOT / "working" / "pilot-v1" / asset_id
    folder.mkdir(parents=True, exist_ok=True)
    reset()
    metadata = importlib.import_module(module).build(asset_id)
    bpy.context.scene.frame_set(0)
    consolidate()
    initial = mesh_stats()
    offset = Vector((-(initial["lower"][0]+initial["upper"][0])/2,
                     -(initial["lower"][1]+initial["upper"][1])/2,
                     -initial["lower"][2]))
    for obj in list(bpy.context.scene.objects):
        if obj.parent is None:
            obj.location += offset
    stats = mesh_stats()
    bpy.ops.wm.save_as_mainfile(filepath=str(folder / "source.blend"))
    export(folder / "model.glb")
    # Bake geometric modifiers into the LOD while preserving armatures/weights.
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        bpy.context.view_layer.objects.active = obj
        for modifier in list(obj.modifiers):
            if modifier.type != "ARMATURE":
                bpy.ops.object.modifier_apply(modifier=modifier.name)
        if len(obj.data.polygons) > 12:
            modifier = obj.modifiers.new("CandidateLOD", "DECIMATE")
            modifier.ratio = 0.5
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    export(folder / "lod.glb")
    provenance = json.loads((ROOT / "references/reference-provenance-100.json").read_text(encoding="utf-8-sig"))
    source = next(item for item in provenance["items"] if item["assetId"] == asset_id)
    actual_hash = hashlib.sha256((ROOT / source["candidateFile"]).read_bytes()).hexdigest()
    if actual_hash != source["sha256"]:
        raise ValueError("Reference hash mismatch")
    metadata.update({"assetId": asset_id, "status": "MESH_DRAFT",
        "animationClass": source["animationClass"], "nameZhTW": source["nameZhTW"],
        "referencePath": source["candidateFile"], "referenceSha256": actual_hash,
        "builder": module, "blenderVersion": bpy.app.version_string,
        "sourceStats": stats, "styleApproved": False, "termsReview": "PENDING",
        "sourceProvider": "dreamina text2image 5.0",
        "reconstruction": "local procedural Blender modeling guided by reference",
        "artifacts": {p.name: {"bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                      for p in [folder/"model.glb", folder/"lod.glb", folder/"source.blend"]}})
    (folder / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    imported = render_views(folder)
    (folder / "render-evidence.json").write_text(json.dumps({
        "source": "model.glb", "sha256": metadata["artifacts"]["model.glb"]["sha256"],
        "importedStats": imported, "views": ["hero","front","back","left","right","top","bottom"] +
        [f"turn-{n:02d}" for n in range(8)], "humanReview": "PENDING"}, indent=2), encoding="utf-8")
    print("PILOT_COMPLETE", asset_id, flush=True)

if __name__ == "__main__":
    selected = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
    render_only = "--render-only" in selected
    selected = [arg for arg in selected if arg != "--render-only"]
    for module, ids in GROUPS.items():
        for asset_id in ids:
            if not selected or asset_id in selected:
                if render_only:
                    folder = ROOT / "working" / "pilot-v1" / asset_id
                    stats = render_views(folder)
                    evidence = json.loads((folder / "render-evidence.json").read_text())
                    evidence["importedStats"] = stats
                    (folder / "render-evidence.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
                else:
                    build_one(asset_id, module)
