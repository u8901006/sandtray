"""Reference-led sculptural candidates, not approved or released assets.

Observed PNGs: ST-021 grey/cream standing cat; ST-036 thick ochre/brown
butterfly with cream markings; ST-092 mint quadruped dragon with warm horns.
All forms are geometry. No image planes or externally generated meshes.
"""
import math
import bpy
import bmesh
from mathutils import Vector


def material(name, color):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (*color, 1)
    bs.inputs["Roughness"].default_value = .77
    return m


def ell(name, location, scale, mat, segments=16, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def tube(name, points, radius, mat):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 8
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    curve.use_fill_caps = True
    sp = curve.splines.new("BEZIER")
    sp.bezier_points.add(len(points)-1)
    for p, co in zip(sp.bezier_points, points):
        p.co = co[:3]
        p.radius = co[3] if len(co) == 4 else 1
        p.handle_left_type = p.handle_right_type = "AUTO"
    ob = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target="MESH")
    result=bpy.context.object
    bm=bmesh.new()
    bm.from_mesh(result.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=0.000001)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(result.data)
    bm.free()
    return result


def thick_shape(name, points, depth, mat):
    # Polygon in x/z plane, with actual closed front/back and edge volume.
    n = len(points)
    verts = [(x, y, z) for y in (-depth/2, depth/2) for x,z in points]
    faces = [tuple(reversed(range(n))), tuple(range(n,2*n))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    bm=bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    bevel = ob.modifiers.new("Soft sculpted edges", "BEVEL")
    bevel.width = depth*.35
    bevel.segments = 2
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    ob.select_set(False)
    for p in mesh.polygons:
        p.use_smooth = True
    return ob


def cat():
    fur = material("fur", (.37,.34,.31))
    cream = material("cream", (.83,.77,.64))
    dark = material("eyes_nose", (.075,.04,.023))
    ell("Torso", (0,.015,.245), (.115,.205,.115), fur)
    ell("Chest", (0,-.125,.28), (.106,.095,.135), fur)
    ell("Cream bib", (0,-.19,.29), (.075,.024,.106), cream)
    for side in (-1,1):
        for y in (-.12,.155):
            ell("Leg", (side*.074,y,.119), (.042,.043,.103), fur)
            ell("Cream paw", (side*.074,y-.012,.027), (.047,.059,.027), cream)
    ell("Head", (0,-.155,.425), (.111,.096,.101), fur)
    for side in (-1,1):
        ear = thick_shape("Rounded ear", [(side*.042,.474),(side*.087,.55),(side*.105,.467)], .045, fur)
        ear.location.y = -.151
        ell("Cheek", (side*.036,-.23,.389), (.048,.037,.043), cream)
        ell("Eye", (side*.043,-.239,.434), (.018,.012,.021), dark)
        ell("Eye glint", (side*.039,-.249,.442), (.005,.003,.006), cream, 12,8)
    ell("Muzzle bridge", (0,-.238,.413), (.024,.018,.029), cream)
    ell("Nose", (0,-.266,.402), (.011,.009,.008), dark,12,8)
    tube("Curved round tail", [(0,.18,.27),(0,.26,.3),(-.025,.32,.35),(-.06,.33,.365)], .025, fur)
    return {"editableMaterials":["fur"], "clips":[]}


def butterfly():
    ochre = material("wings", (.66,.29,.095))
    brown = material("body_border", (.19,.065,.033))
    cream = material("wing_markings", (.84,.76,.5))
    ell("Thorax", (0,0,.15), (.018,.022,.027), brown)
    ell("Abdomen", (0,0,.105), (.014,.016,.033), brown)
    ell("Head", (0,0,.187), (.02,.019,.018), brown)
    for side in (-1,1):
        tube("Thick antenna", [(side*.009,0,.195),(side*.018,0,.217),(side*.032,0,.232)], .003, brown)
        ell("Antenna tip", (side*.032,0,.232), (.004,.004,.004),brown,12,8)
        pivot=bpy.data.objects.new("wing_left" if side<0 else "wing_right",None)
        bpy.context.collection.objects.link(pivot)
        pivot.location=(side*.009,0,.151)
        bpy.context.view_layer.update()
        before=set(bpy.context.scene.objects)
        upper=[(.006,.153),(.035,.213),(.09,.286),(.126,.3),(.145,.287),(.148,.265),(.132,.218),(.13,.177),(.104,.163)]
        lower=[(.006,.149),(.103,.153),(.128,.13),(.122,.095),(.093,.041),(.069,.025),(.047,.044),(.031,.08)]
        for outline in (upper,lower):
            thick_shape("Wing border", [(side*x,z) for x,z in outline],.013,brown)
            cx=sum(x for x,z in outline)/len(outline); cz=sum(z for x,z in outline)/len(outline)
            inner=thick_shape("Ochre wing membrane",[(side*(cx+(x-cx)*.82),cz+(z-cz)*.82) for x,z in outline],.0145,ochre)
        for x,z,sx,sz in [(.099,.258,.012,.023),(.088,.218,.012,.008),(.06,.204,.008,.015),(.089,.181,.016,.006),(.054,.13,.009,.012),(.087,.131,.013,.006),(.083,.104,.014,.006),(.065,.078,.006,.013)]:
            spot=ell("Raised cream marking",(side*x,-.008,z),(sx,.0027,sz),cream,8,6)
            ell("Reverse cream marking",(side*x,.008,z),(sx,.0027,sz),cream,8,6)
        for ob in set(bpy.context.scene.objects)-before:
            if ob!=pivot:
                ob.parent=pivot
                ob.matrix_parent_inverse=pivot.matrix_world.inverted()
        for frame,angle in [(1,0),(7,.6),(13,0),(19,-.35),(25,0)]:
            pivot.rotation_euler.z=side*angle
            pivot.keyframe_insert(data_path="rotation_euler",frame=frame)
        action=pivot.animation_data.action
        action.name="flap_"+pivot.name
        track=pivot.animation_data.nla_tracks.new()
        track.name="flap"
        track.strips.new("flap",1,action)
        pivot.animation_data.action=None
    bpy.context.scene.frame_end=25
    bpy.context.scene.render.fps=24
    bpy.context.scene.frame_set(1)
    return {"editableMaterials":["wings"],"clips":["flap"]}


def dragon():
    body=material("body",(.24,.57,.43))
    belly=material("belly",(.78,.63,.35))
    dark=material("eyes",(.055,.029,.018))
    ell("Body",(0,.04,.34),(.23,.3,.22),body)
    ell("Upright neck",(0,-.16,.49),(.17,.14,.23),body)
    ell("Belly",(0,-.265,.39),(.123,.047,.19),belly)
    ell("Head",(0,-.19,.77),(.25,.21,.22),body)
    ell("Rounded muzzle",(0,-.36,.695),(.176,.14,.107),body)
    ell("Chin",(0,-.365,.636),(.132,.093,.036),belly)
    for side in (-1,1):
        for y in (-.18,.21):
            ell("Haunch" if y>0 else "Foreleg",(side*.17,y,.18),(.092,.09,.155),body)
            ell("Paw",(side*.17,y-.038,.055),(.096,.115,.055),body)
        ell("Eye",(side*.179,-.348,.798),(.044,.026,.049),dark)
        ell("Glint",(side*.165,-.368,.821),(.012,.008,.012),belly,12,8)
        ell("Nostril",(side*.078,-.488,.722),(.012,.008,.01),dark,12,8)
        tube("Short rounded horn",[(side*.14,-.145,.915,1),(side*.17,-.105,1.012,.9),(side*.163,-.12,1.075,.24)],.041,belly)
        ell("Ear",(side*.24,-.12,.815),(.065,.049,.044),body)
        # Folded wing: thick sculptural membrane and structural round leading rib.
        outline=[(.14,.48),(.18,.69),(.26,.745),(.32,.68),(.34,.51),(.27,.56),(.22,.51)]
        wing=thick_shape("Folded wing membrane",[(side*x,z) for x,z in outline],.045,body)
        wing.location.y=.085
        tube("Wing leading rib",[(side*.14,.065,.48),(side*.19,.065,.68),(side*.26,.065,.733),(side*.32,.065,.64),(side*.34,.065,.51)],.018,body)
    tube("Complete curled tail",[(0,.26,.31,1),(0,.43,.28,.82),(0,.58,.35,.6),(0,.65,.49,.36),(0,.64,.58,.12)],.09,body)
    for y,z,r in [(.02,.61,.042),(.16,.58,.042),(.29,.51,.037),(.42,.405,.03),(.52,.43,.025),(.60,.50,.02)]:
        ell("Rounded dorsal crest",(0,y,z),(r*.72,r,r*1.6),belly,12,8)
    return {"editableMaterials":["body","belly"],"clips":[]}


def build(asset_id):
    builders={"ST-021":cat,"ST-036":butterfly,"ST-092":dragon}
    if asset_id not in builders:
        raise ValueError("Unsupported organic pilot: "+asset_id)
    return builders[asset_id]()
