"""Reference-informed, locally modelled humanoid candidates; not release approved."""
import bpy
import math
from mathutils import Vector


def build(asset_id):
    if asset_id not in {"ST-007", "ST-020"}:
        raise ValueError(asset_id)
    simple = asset_id == "ST-020"
    parts = []
    materials = {}
    def material(name, color):
        m = bpy.data.materials.new(name)
        m.diffuse_color = (*color, 1)
        m.use_nodes = True
        bs = m.node_tree.nodes.get("Principled BSDF")
        bs.inputs["Base Color"].default_value = (*color, 1)
        bs.inputs["Roughness"].default_value = .78
        # Per-corner color supports skin, hair and shoes in one detail draw material.
        if name == "details":
            vc = m.node_tree.nodes.new("ShaderNodeVertexColor")
            vc.layer_name = "Tint"
            m.node_tree.links.new(vc.outputs["Color"], bs.inputs["Base Color"])
        materials[name] = m
        return m
    top = "body" if simple else "shirt"
    material(top, (.62, .24, .085) if simple else (.12, .31, .32))
    if not simple:
        material("pants", (.29, .27, .24))
    material("details", (.75, .58, .39))
    skin = (.78, .64, .45) if not simple else (.86, .77, .60)
    hair = (.13, .075, .045)
    shoe = (.22, .105, .04)
    def ell(name, pos, scale, bone, mat="details", tint=None, seg=12, rings=8):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, location=pos)
        obj = bpy.context.object
        obj.name = asset_id + "_" + name
        obj.scale = scale
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.data.materials.append(materials[mat])
        if mat == "details":
            ca = obj.data.color_attributes.new(name="Tint", type="FLOAT_COLOR", domain="CORNER")
            for c in ca.data:
                c.color = (*(tint or skin), 1)
        for poly in obj.data.polygons:
            poly.use_smooth = True
        parts.append((obj, bone))
        return obj
    def limb(name, a, b, radius, bone, mat, tint=None):
        a,b = Vector(a),Vector(b)
        obj = ell(name, (a+b)/2, (radius, radius*.88, (b-a).length*.5+radius*.28), bone, mat, tint)
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = Vector((0,0,1)).rotation_difference(b-a)
        return obj
    # Front faces -Y, standing height 1.70 m. Origin remains at contact centre.
    bones = {
        "root": ((0,0,0),(0,0,.18),None),
        "pelvis": ((0,0,.82),(0,0,.98),"root"),
        "spine": ((0,0,.98),(0,0,1.37),"pelvis"),
        "head": ((0,0,1.37),(0,0,1.67),"spine"),
    }
    ell("torso",(0,0,1.185),(.155,.093,.225),"spine",top)
    ell("waist",(0,0,.96),(.137,.087,.10),"pelvis",top if simple else "pants")
    ell("neck",(0,0,1.405),(.045,.044,.065),"head")
    ell("face",(0,-.007,1.53),(.099,.084,.135),"head")
    ell("hair_cap",(0,.014,1.608),(.102,.081,.092),"head",tint=hair)
    for i in range(4):
        ell("fringe"+str(i),(-.061+i*.037,-.066,1.61-abs(i-1)*.012),
            (.030,.025,.058),"head",tint=hair,seg=12,rings=8)
    ell("nose",(0,-.09,1.526),(.014,.021,.025),"head",seg=12,rings=8)
    for sign in [-1,1]:
        ell("ear", (sign*.098,0,1.53),(.019,.018,.035),"head",seg=12,rings=8)
        ell("eye", (sign*.035,-.084,1.552),(.009,.005,.011),"head",tint=(.055,.039,.025),seg=10,rings=6)
        ell("brow", (sign*.035,-.081,1.579),(.022,.005,.005),"head",tint=hair,seg=10,rings=6)
    ell("mouth",(0,-.088,1.483),(.025,.003,.0035),"head",tint=(.32,.18,.11),seg=12,rings=6)
    for sign, side in [(-1,"L"),(1,"R")]:
        hip=(sign*.085,0,.94); knee=(sign*.105,0,.53); ankle=(sign*.115,0,.12)
        shoulder=(sign*.13,0,1.33); elbow=(sign*.275,0,1.13); wrist=(sign*.395,0,.94)
        bones.update({
            "thigh."+side:(hip,knee,"pelvis"), "shin."+side:(knee,ankle,"thigh."+side),
            "foot."+side:(ankle,(sign*.115,-.09,.065),"shin."+side),
            "upper_arm."+side:(shoulder,elbow,"spine"),
            "forearm."+side:(elbow,wrist,"upper_arm."+side),
            "hand."+side:(wrist,(sign*.43,0,.85),"forearm."+side)})
        pant = top if simple else "pants"
        limb("thigh"+side, hip,knee,.068,"thigh."+side,pant)
        limb("shin"+side, knee,ankle,.057,"shin."+side,pant)
        ell("knee"+side,knee,(.045,.043,.046),"shin."+side,pant)
        ell("shoe"+side,(sign*.115,-.030,.057),(.060,.103,.057),"foot."+side,tint=shoe)
        limb("upper_arm"+side,shoulder,elbow,.047,"upper_arm."+side,top)
        limb("forearm"+side,elbow,wrist,.039,"forearm."+side,top)
        ell("elbow"+side,elbow,(.031,.031,.031),"forearm."+side,top)
        palm=(sign*.418,-.002,.898)
        ell("palm"+side,palm,(.026,.017,.044),"hand."+side)
        for j in range(4):
            x=sign*(.401+j*.012)
            length=[.052,.065,.060,.045][j]
            limb("finger"+side+str(j),(x,-.001,.872),(x+sign*.012,-.005,.872-length),
                 .0055,"hand."+side,"details")
        limb("thumb"+side,(sign*.398,-.008,.91),(sign*.38,-.018,.871),
             .008,"hand."+side,"details")
    bpy.ops.object.select_all(action="DESELECT")
    arm_data=bpy.data.armatures.new(asset_id+"_Skeleton")
    rig=bpy.data.objects.new(asset_id+"_Rig",arm_data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active=rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for name,(head,tail,parent) in bones.items():
        bone=arm_data.edit_bones.new(name); bone.head=head; bone.tail=tail
        if parent: bone.parent=arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    for obj,bone in parts:
        group=obj.vertex_groups.new(name=bone)
        group.add(list(range(len(obj.data.vertices))),1.0,"REPLACE")
        modifier=obj.modifiers.new("Skin","ARMATURE"); modifier.object=rig
        obj.parent=rig
    bpy.ops.object.select_all(action="DESELECT")
    for obj,_ in parts: obj.select_set(True)
    bpy.context.view_layer.objects.active=parts[0][0]
    bpy.ops.object.join()
    bpy.context.object.name=asset_id+"_Body"
    # Exportable NLA clips. Negative preview frame is outside all clip ranges.
    rig.animation_data_create()
    for clip in ["idle","walk","wave"]:
        action=bpy.data.actions.new(clip)
        rig.animation_data.action=action
        for f in [1,9,17,25,33]:
            phase=(f-1)/32*2*math.pi
            for pb in rig.pose.bones:
                pb.rotation_mode="XYZ"; pb.rotation_euler=(0,0,0)
            if clip=="idle":
                rig.pose.bones["spine"].rotation_euler.x=math.sin(phase)*.015
                rig.pose.bones["head"].rotation_euler.y=math.sin(phase)*.02
            elif clip=="walk":
                for side,sign in [("L",1),("R",-1)]:
                    rig.pose.bones["thigh."+side].rotation_euler.x=math.sin(phase)*.32*sign
                    rig.pose.bones["shin."+side].rotation_euler.x=max(0,-math.sin(phase)*sign)*.30
                    rig.pose.bones["upper_arm."+side].rotation_euler.x=-math.sin(phase)*.22*sign
            else:
                rig.pose.bones["upper_arm.R"].rotation_euler.z=-1.65
                rig.pose.bones["forearm.R"].rotation_euler.z=-.45+math.sin(phase)*.25
                rig.pose.bones["hand.R"].rotation_euler.x=math.sin(phase)*.15
            for pb in rig.pose.bones:
                pb.keyframe_insert(data_path="rotation_euler",frame=f,group=pb.name)
        slot=rig.animation_data.action_slot
        track=rig.animation_data.nla_tracks.new(); track.name=clip
        strip=track.strips.new(clip,1,action)
        strip.extrapolation="NOTHING"
        if slot: strip.action_slot=slot
    rig.animation_data.action=None
    for pb in rig.pose.bones: pb.rotation_euler=(0,0,0)
    bpy.context.scene.frame_set(0)
    return {"editableMaterials":[top] if simple else ["shirt","pants"],"clips":["idle","walk","wave"]}
