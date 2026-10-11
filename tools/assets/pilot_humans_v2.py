"""Original continuous-surface human candidates. No imported third-party meshes.

Realistic means adult proportions and sculpted clothing, not photorealism.
Kay Lousberg's public catalogue informs the separate chunky low-poly family.
"""
import bpy
import math
from mathutils import Vector


def build(asset_id):
    if asset_id not in {'ST-007', 'ST-008', 'ST-019', 'ST-020'}:
        raise ValueError(asset_id)
    cartoon = asset_id in {'ST-019', 'ST-020'}
    long_hair = asset_id == 'ST-008'
    n = 10 if cartoon else 20
    parts = []
    skin = (.72, .50, .34) if asset_id == 'ST-007' else (.86, .66, .48)
    hair = (.075, .038, .023) if asset_id in {'ST-007', 'ST-020'} else (.42, .29, .16)
    top_name = 'body' if asset_id == 'ST-020' else 'shirt'
    mats = {}
    for name, color in [(top_name, (.13,.32,.32) if asset_id == 'ST-007' else (.63,.25,.105)), ('pants', (.27,.29,.30) if not cartoon else (.76,.71,.57)), ('details', skin)]:
        if asset_id == 'ST-019' and name == top_name:
            color = (.77,.72,.61)
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        m.diffuse_color = (*color, 1)
        bs = m.node_tree.nodes.get('Principled BSDF')
        bs.inputs['Base Color'].default_value = (*color, 1)
        bs.inputs['Roughness'].default_value = .78
        if name == 'details':
            vc = m.node_tree.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Tint'
            m.node_tree.links.new(vc.outputs['Color'], bs.inputs['Base Color'])
        mats[name] = m

    def mesh(name, verts, faces, weights, mat, color=None):
        data = bpy.data.meshes.new(name)
        data.from_pydata(verts, [], faces); data.update()
        obj = bpy.data.objects.new(asset_id + '_' + name, data)
        bpy.context.collection.objects.link(obj)
        data.materials.append(mats[mat])
        for p in data.polygons: p.use_smooth = not cartoon
        if mat == 'details':
            ca = data.color_attributes.new(name='Tint', type='FLOAT_COLOR', domain='CORNER')
            for c in ca.data: c.color = (*(color or skin), 1)
        for i, ws in enumerate(weights):
            for bone, weight in ws.items():
                if weight > 0:
                    group = obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
                    group.add([i], weight, 'REPLACE')
        parts.append(obj)
        return obj

    def loft(name, rings, bone, mat, color=None, sides=None, weight_fn=None):
        # Each ring = centre, width, depth; all rings share one unbroken surface.
        count = sides or n
        verts=[]; weights=[]; faces=[]
        for j,(centre,rx,ry) in enumerate(rings):
            centre=Vector(centre)
            prev=Vector(rings[max(j-1,0)][0]); nex=Vector(rings[min(j+1,len(rings)-1)][0])
            tangent=(nex-prev).normalized()
            axis=Vector((0,1,0)); right=axis.cross(tangent).normalized()
            for k in range(count):
                a=2*math.pi*k/count
                verts.append(centre + right*(math.cos(a)*rx) + axis*(math.sin(a)*ry))
                weights.append(weight_fn(j/(len(rings)-1)) if weight_fn else {bone:1})
            if j:
                for k in range(count):
                    q=(k+1)%count; a=(j-1)*count+k; b=(j-1)*count+q
                    faces.append((a,b,j*count+q,j*count+k))
        faces.append(tuple(reversed(range(count))))
        faces.append(tuple((len(rings)-1)*count+k for k in range(count)))
        return mesh(name, verts, faces, weights, mat, color)

    def oval(name,pos,scale,bone,color=None,mat='details',sides=None):
        # Only anatomical face / shoes / hair detail uses closed oval surfaces.
        rings=[]
        for j in range(9):
            a=-math.pi/2+(j+.05)/8.1*math.pi
            rings.append(((pos[0],pos[1],pos[2]+math.sin(a)*scale[2]), max(.0005,math.cos(a)*scale[0]),max(.0005,math.cos(a)*scale[1])))
        return loft(name,rings,bone,mat,color,sides)

    hip_z=.83 if cartoon else .92
    shoulder_z=1.18 if cartoon else 1.40
    neck_z=1.29 if cartoon else 1.49
    head_bottom=1.30 if cartoon else 1.48
    head_top=1.75 if cartoon else 1.74
    hw=.19 if cartoon else .096
    torso_w=.18 if cartoon else .172
    bones={'root':((0,0,0),(0,0,.15),None),'pelvis':((0,0,hip_z),(0,0,hip_z+.12),'root'),'spine':((0,0,hip_z+.12),(0,0,neck_z),'pelvis'),'head':((0,0,neck_z),(0,0,head_top),'spine')}
    # Keep a broad shoulder shelf beneath each sleeve.  The overlap is
    # intentional: it prevents a V-shaped background slit at the arm roots
    # when the figure is viewed from a three-quarter angle.
    loft('tailored_torso',[((0,0,hip_z),torso_w*.86,.09),((0,0,hip_z+.06),torso_w*.87,.095),((0,0,hip_z+.18),torso_w*.82,.092),((0,0,shoulder_z-.12),torso_w*1.07,.115),((0,0,shoulder_z-.04),torso_w*1.08,.105),((0,0,shoulder_z+.015),torso_w*.90,.092),((0,0,neck_z-.01),.05,.048)],'spine',top_name)
    # A rounded, tapered hip transition reads as one trouser block instead
    # of exposing a rectangular cross-piece between the legs.
    loft('hip_trousers',[((0,0,hip_z-.105),torso_w*.70,.078),((0,0,hip_z-.065),torso_w*.84,.091),((0,0,hip_z+.005),torso_w*.88,.101),((0,0,hip_z+.075),torso_w*.82,.096)],'pelvis','pants')
    loft('neck',[((0,0,neck_z-.04),.043,.042),((0,0,neck_z+.07),.045,.045)],'head','details')
    # Narrow chin, jaw, cheekbone, brow and cranium create a readable adult face.
    levels=[(0,.54,.72),(.09,.75,.84),(.25,.91,.94),(.48,1,1),(.67,.99,.98),(.83,.91,.92),(1,.54,.55)]
    loft('sculpted_face',[((0,-.008,head_bottom+(head_top-head_bottom)*z),hw*x,hw*.86*y) for z,x,y in levels],'head','details')
    eye_z=head_bottom+(head_top-head_bottom)*.55
    for sign in [-1,1]:
        oval('ear'+str(sign),(sign*hw*.99,0,eye_z-.015),(.017 if not cartoon else .026,.02,.030),'head')
        oval('eye_white'+str(sign),(sign*hw*.37,-hw*.838,eye_z),(.018 if not cartoon else .024,.008,.009 if not cartoon else .032),'head',(.86,.84,.77))
        oval('iris'+str(sign),(sign*hw*.37,-hw*.902,eye_z),(.007 if not cartoon else .013,.004,.008 if not cartoon else .025),'head',(.065,.045,.026),sides=12)
        oval('brow'+str(sign),(sign*hw*.37,-hw*.846,eye_z+.025),(.022,.004,.004),'head',hair,sides=12)
    oval('nose',(0,-hw*.88,eye_z-.027),(.013 if not cartoon else .025,.025,.027),'head')
    oval('lips',(0,-hw*.83,eye_z-.067),(.024 if not cartoon else .035,.005,.004),'head',(.39,.20,.14),sides=12)
    oval('hair_crown',(0,.015,head_top-.042),(hw*1.04,hw*.94,.077 if not cartoon else .12),'head',hair)
    # Swept asymmetric fringe, rather than repeated round hair beads.
    loft('swept_fringe',[((-.07,-hw*.64,head_top-.025),.022,.024),((-.035,-hw*.83,head_top-.050),.037,.025),((.007,-hw*.89,head_top-.075),.029,.019)],'head','details',hair,sides=12)
    if long_hair:
        for sign in [-1,1]:
            loft('long_hair'+str(sign),[((sign*.09,.025,head_top-.08),.035,.055),((sign*.104,.03,head_bottom+.08),.037,.052),((sign*.112,.035,neck_z-.085),.038,.048)],'head','details',hair)

    if asset_id == 'ST-019':
        # Short shoulder mantle and a thick curved back drape distinguish this
        # catalogue character from the neutral figure, beyond colour variants.
        loft('cape_mantle',[((0,.008,1.275),.065,.055),((0,.008,1.20),.16,.102),
                           ((0,.008,1.10),.265,.157)],'spine','details',(.56,.24,.075),sides=16)
        verts=[]; faces=[]; weights=[]
        rows=[(1.20,.12,.095),(1.03,.205,.143),(.74,.235,.17),(.46,.25,.19)]
        columns=9
        for layer in range(2):
            for z,width,y in rows:
                for k in range(columns):
                    t=-1+2*k/(columns-1)
                    verts.append((width*t,y+.012*math.cos(t*math.pi*3)+(layer-.5)*.016,z))
                    weights.append({'spine':1})
        side_size=len(rows)*columns
        for layer in range(2):
            for j in range(len(rows)-1):
                for k in range(columns-1):
                    a=layer*side_size+j*columns+k
                    face=(a,a+1,a+columns+1,a+columns)
                    faces.append(face if layer else tuple(reversed(face)))
        perimeter=list(range(columns))+[j*columns+columns-1 for j in range(1,len(rows))]+list(range(side_size-2,side_size-columns-1,-1))+[j*columns for j in range(len(rows)-2,0,-1)]
        for k,a in enumerate(perimeter):
            b=perimeter[(k+1)%len(perimeter)]
            faces.append((a,b,b+side_size,a+side_size))
        mesh('cape_back',verts,faces,weights,'details',(.56,.24,.075))

    def limb(name,a,joint,b,widths,upper,lower,mat):
        rings=[]
        for k in range(13):
            t=k/12
            if t<=.5: c=Vector(a).lerp(Vector(joint),t*2); r=widths[0]*(1-t*2)+widths[1]*t*2
            else: c=Vector(joint).lerp(Vector(b),(t-.5)*2); r=widths[1]*(2-2*t)+widths[2]*(2*t-1)
            rings.append((c,r,r*.88))
        def weights(t):
            mix=max(0,min(1,(t-.35)/.30)); mix=mix*mix*(3-2*mix)
            return {upper:1-mix,lower:mix}
        loft(name,rings,upper,mat,weight_fn=weights)

    for sign,side in [(-1,'L'),(1,'R')]:
        x=.105 if cartoon else .09
        hip=(sign*x,0,hip_z-.03); knee=(sign*x*1.09,-.005,.48 if cartoon else .52); ankle=(sign*x*1.12,0,.13)
        shoulder=(sign*torso_w*.94,0,shoulder_z-.01); elbow=(sign*(.30 if cartoon else .29),0,shoulder_z-.22); wrist=(sign*(.40 if cartoon else .40),0,shoulder_z-.45)
        handend=(sign*.44,-.005,wrist[2]-.09)
        bones.update({'thigh.'+side:(hip,knee,'pelvis'),'shin.'+side:(knee,ankle,'thigh.'+side),'foot.'+side:(ankle,(ankle[0],-.10,.06),'shin.'+side),'upper_arm.'+side:(shoulder,elbow,'spine'),'forearm.'+side:(elbow,wrist,'upper_arm.'+side),'hand.'+side:(wrist,handend,'forearm.'+side)})
        limb('continuous_trouser_leg_'+side,hip,knee,ankle,(.084,.066,.059) if cartoon else (.080,.057,.047),'thigh.'+side,'shin.'+side,'pants')
        limb('continuous_sleeve_'+side,shoulder,elbow,wrist,(.064,.052,.041) if cartoon else (.065,.046,.031),'upper_arm.'+side,'forearm.'+side,top_name)
        # Flattened toe-forward shoe volume; avoid the spherical-foot read.
        oval('shoe_'+side,(ankle[0],-.060,.075),(.078 if cartoon else .055,.145 if cartoon else .125,.052),'foot.'+side,(.15,.09,.055))
        loft('palm_'+side,[(wrist,.027,.019),((sign*.418,-.002,wrist[2]-.05),.031,.018),(handend,.023,.014)],'hand.'+side,'details')
        for k,length in enumerate([.035,.046,.043,.031]):
            fx=sign*(.423+k*.011)
            loft('finger_'+side+str(k),[((fx,-.002,handend[2]+.015),.005,.006),((fx+sign*.005,-.005,handend[2]-length*.5),.005,.005),((fx+sign*.008,-.006,handend[2]-length),.003,.004)],'hand.'+side,'details',sides=8)
        loft('thumb_'+side,[((sign*.401,-.012,wrist[2]-.040),.009,.008),((sign*.383,-.022,wrist[2]-.066),.008,.007),((sign*.384,-.021,wrist[2]-.081),.004,.005)],'hand.'+side,'details',sides=8)

    bpy.ops.object.select_all(action='DESELECT')
    ad=bpy.data.armatures.new(asset_id+'_Skeleton'); rig=bpy.data.objects.new(asset_id+'_Rig',ad)
    bpy.context.collection.objects.link(rig); rig.select_set(True); bpy.context.view_layer.objects.active=rig
    bpy.ops.object.mode_set(mode='EDIT')
    for name,(head,tail,parent) in bones.items():
        b=ad.edit_bones.new(name); b.head=head; b.tail=tail
        if parent: b.parent=ad.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    for obj in parts:
        mod=obj.modifiers.new('Continuous weighted skin','ARMATURE'); mod.object=rig; obj.parent=rig
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts: obj.select_set(True)
    bpy.context.view_layer.objects.active=parts[0]; bpy.ops.object.join(); bpy.context.object.name=asset_id+'_Body'
    rig.animation_data_create()
    for clip in ['idle','walk','wave']:
        action=bpy.data.actions.new(clip); rig.animation_data.action=action
        for f in [1,9,17,25,33]:
            phase=(f-1)/32*2*math.pi
            for pb in rig.pose.bones: pb.rotation_mode='XYZ'; pb.rotation_euler=(0,0,0)
            if clip=='idle':
                rig.pose.bones['spine'].rotation_euler.x=math.sin(phase)*.014
                rig.pose.bones['head'].rotation_euler.y=math.sin(phase)*.02
            elif clip=='walk':
                for side,sign in [('L',1),('R',-1)]:
                    rig.pose.bones['thigh.'+side].rotation_euler.x=math.sin(phase)*.27*sign
                    rig.pose.bones['shin.'+side].rotation_euler.x=max(0,-math.sin(phase)*sign)*.27
                    rig.pose.bones['upper_arm.'+side].rotation_euler.x=-math.sin(phase)*.19*sign
            else:
                # The arm bones lie mostly along X, so Y rotation raises the
                # upper arm in the front view.  Bend the forearm back toward
                # the face and add a small hand roll for a readable wave.
                rig.pose.bones['upper_arm.R'].rotation_euler.y=-1.05
                rig.pose.bones['forearm.R'].rotation_euler.y=.72+math.sin(phase)*.28
                rig.pose.bones['hand.R'].rotation_euler.x=math.sin(phase)*.18
            for pb in rig.pose.bones: pb.keyframe_insert(data_path='rotation_euler',frame=f,group=pb.name)
        slot=rig.animation_data.action_slot
        track=rig.animation_data.nla_tracks.new(); track.name=clip
        strip=track.strips.new(clip,1,action); strip.extrapolation='NOTHING'
        if slot: strip.action_slot=slot
    rig.animation_data.action=None
    for pb in rig.pose.bones: pb.rotation_euler=(0,0,0)
    bpy.context.scene.frame_set(0)
    return {'editableMaterials':[top_name,'pants'],'clips':['idle','walk','wave'],'styleFamily':'STYLIZED' if cartoon else 'REALISTIC','changeNotes':['Continuous lofted sleeves and trouser legs','Blended elbow and knee skin weights','No exposed joint balls or circular rings','Original geometry; style reference only']}


if __name__ == '__main__':
    import json
    import os
    import struct
    out=os.path.abspath('working/style-v2-human-smoke'); os.makedirs(out,exist_ok=True)
    report=[]
    for aid in ['ST-007','ST-008','ST-019','ST-020']:
        bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
        meta=build(aid)
        meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
        triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
        path=os.path.join(out,aid+'.glb')
        bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',export_animation_mode='NLA_TRACKS',export_current_frame=True)
        with open(path,'rb') as f:
            raw=f.read(); size=struct.unpack_from('<I',raw,12)[0]; gltf=json.loads(raw[20:20+size])
        clips=[a['name'] for a in gltf.get('animations',[])]
        assert sorted(clips)==['idle','walk','wave'], clips
        assert gltf.get('skins') and triangles<=15000
        report.append(dict(assetId=aid,triangles=triangles,clips=clips,skins=len(gltf['skins']),bytes=len(raw),**{k:v for k,v in meta.items() if k!='clips'}))
        scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=16
        scene.render.resolution_x=480; scene.render.resolution_y=640; scene.render.resolution_percentage=100
        scene.world.color=(.55,.55,.55)
        bpy.ops.object.camera_add(location=(0,-4,1.05)); camera=bpy.context.object
        camera.rotation_euler=(Vector((0,0,.88))-camera.location).to_track_quat('-Z','Y').to_euler()
        camera.data.type='ORTHO'; camera.data.ortho_scale=2.1; scene.camera=camera
        for pos,power,size in [((-3,-4,5),500,4),((3,-2,3),350,3)]:
            bpy.ops.object.light_add(type='AREA',location=pos); light=bpy.context.object; light.data.energy=power; light.data.shape='DISK'; light.data.size=size
            light.rotation_euler=(Vector((0,0,1))-light.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=os.path.join(out,aid+'-front.png'); bpy.ops.render.render(write_still=True)
        rig=next(o for o in scene.objects if o.type=='ARMATURE')
        action=bpy.data.actions.get('wave')
        rig.animation_data.action=action
        rig.animation_data.action_slot=action.slots[0] if action and len(action.slots) else None
        scene.frame_set(9); scene.render.filepath=os.path.join(out,aid+'-wave.png'); bpy.ops.render.render(write_still=True)
    with open(os.path.join(out,'report.json'),'w',encoding='utf-8') as f: json.dump(report,f,indent=2)
