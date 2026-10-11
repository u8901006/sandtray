"""Reference-informed volumetric pilot candidates; not approved releases.

Z-up modelling contract. Export, LOD and render are owned by the batch pipeline.
ST-084 deliberately follows supplied reference cushions, differing from brief v1.
"""
import math
import random
import bpy
from mathutils import Vector


def mat(name, color):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = .78
    return m


def mesh(name, verts, faces, material):
    d = bpy.data.meshes.new(name)
    d.from_pydata(verts, [], faces)
    d.update()
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    d.materials.append(material)
    return o


def box(name, pos, size, material, bevel=.02):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    o = bpy.context.object
    o.name = name
    o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material)
    if bevel:
        b = o.modifiers.new('Rounded miniature edges', 'BEVEL')
        b.width = bevel
        b.segments = 3
        bpy.ops.object.modifier_apply(modifier=b.name)
    return o


def beam(name, a, b, width, depth, material):
    a, b = Vector(a), Vector(b)
    o = box(name, (a+b)/2, (width, depth, (b-a).length), material, min(width,depth)*.18)
    o.rotation_euler = (b-a).to_track_quat('Z','Y').to_euler()
    return o


def rock():
    stone = mat('stone', (.39,.365,.325))
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=1)
    o = bpy.context.object
    o.name = 'Asymmetric closed boulder'
    rng = random.Random(46)
    for v in o.data.vertices:
        x,y,z = v.co
        r = 1 + .065*math.sin(7*x+3*y) + .035*math.cos(9*y-2*z) + rng.uniform(-.018,.018)
        v.co = (x*.62*r + .045*z, y*.44*r, max(0, (z*.39+.27)*r))
    o.data.materials.append(stone)
    # Flat facets are intentional: round overall silhouette, subtle stone planes.
    return ['stone']


def cave():
    rockmat = mat('rock', (.35,.29,.225))
    rim = mat('rim', (.64,.54,.405))
    # Half-elliptical roof shell with explicit inner wall and rear thickness.
    # Front is y=-.65. Inner cavity is open there and closed at y=.54.
    n, layers = 32, 8
    verts=[]
    for inner in (False, True):
        for j in range(layers):
            t=j/(layers-1)
            y=-.65+t*1.3
            shrink=1-.12*t
            for i in range(n+1):
                a=math.pi*i/n
                ripple=1+.022*math.sin(5*a+3*t)
                rx=(.73 if not inner else .52)*shrink
                rz=(1.5 if not inner else 1.23)*shrink
                verts.append((rx*math.cos(a)*ripple, y if not inner else -.65+t*1.16, .055+rz*math.sin(a)*ripple))
    stride=n+1
    off=layers*stride
    faces=[]
    for side in range(2):
        k=side*off
        for j in range(layers-1):
            for i in range(n):
                a=k+j*stride+i
                f=(a,a+1,a+stride+1,a+stride)
                faces.append(f if side==0 else f[::-1])
    for j in (0,layers-1):
        for i in range(n):
            a=j*stride+i
            f=(a,a+off,a+off+1,a+1)
            faces.append(f if j==0 else f[::-1])
    for i in (0,n):
        for j in range(layers-1):
            a=j*stride+i
            f=(a,a+stride,a+stride+off,a+off)
            faces.append(f if i==0 else f[::-1])
    o=mesh('Thick open cave shell',verts,faces,rockmat)
    o.data.materials.append(rim)
    start=2*(layers-1)*n
    for p in o.data.polygons[start:start+n]:
        p.material_index=1
    for p in o.data.polygons:
        p.use_smooth=True
    box('Cave floor', (0,0,.055), (1.37,1.3,.11), rockmat,.04)
    # Back wall fills the inner half-ellipse with genuine depth.
    v=[(0,.50,.05),(0,.65,.05)]
    for y in (.50,.65):
        for i in range(n+1):
            a=math.pi*i/n
            v.append((.56*math.cos(a),y,.05+1.27*math.sin(a)))
    f=[]
    for i in range(n):
        f.extend([(0,2+i,3+i),(1,3+n+i+1,3+n+i)])
        f.append((2+i,3+i,3+i+n+1,2+i+n+1))
    f.append((0,1,n+3,2))
    f.append((0,n+2,2*n+3,1))
    mesh('Solid cave rear wall',v,f,rockmat)
    return ['rock','rim']


def cottage():
    walls=mat('walls',(.82,.77,.62))
    roof=mat('roof',(.56,.16,.10))
    wood=mat('wood',(.37,.20,.095))
    box('Four complete walls',(0,0,.55),(1.18,1.22,1.1),walls)
    # Triangular gable prism with closed base and both gable faces.
    v=[(-.59,-.61,1.05),(.59,-.61,1.05),(0,-.61,1.57),(-.59,.61,1.05),(.59,.61,1.05),(0,.61,1.57)]
    mesh('Solid gable',v,[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],walls)
    slope=math.atan2(.52,.64)
    for side in (-1,1):
        o=box('Thick terracotta roof', (side*.33,0,1.33),(.86,1.48,.10),roof,.025)
        o.rotation_euler[1]=side*slope
        b=box('Dark fascia',(side*.33,-.72,1.28),(.86,.065,.095),wood,.012)
        b.rotation_euler[1]=side*slope
        b=box('Rear fascia',(side*.33,.72,1.28),(.86,.065,.095),wood,.012)
        b.rotation_euler[1]=side*slope
    box('Chimney',(-.33,.32,1.43),(.15,.16,.32),roof,.012)
    box('Chimney cap',(-.33,.32,1.605),(.21,.21,.065),roof,.012)
    box('Foundation',(0,0,.035),(1.23,1.27,.07),wood,.012)
    box('Door',(0,-.624,.39),(.34,.045,.76),wood,.012)
    for x in (-.195,.195):
        box('Door jamb',(x,-.66,.4),(.04,.06,.80),wood,.009)
    box('Door lintel',(0,-.66,.79),(.43,.06,.05),wood,.01)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=.024,location=(.115,-.70,.38))
    bpy.context.object.name='Door knob'
    bpy.context.object.data.materials.append(wood)
    # Side reference window is complete with inset panel, frame and mullions.
    box('Window inset',(.598,0,.66),(.03,.42,.43),wood,.008)
    for y in (-.115,.115):
        for z in (.55,.77):
            box('Window pane',(.62,y,z),(.025,.17,.16),walls,.006)
    for y in (-.24,.24):
        box('Window vertical frame',(.64,y,.66),(.05,.04,.50),wood,.008)
    for z in (.40,.92):
        box('Window horizontal frame',(.64,0,z),(.065,.54,.05),wood,.008)
    return ['walls','roof','wood']


def arch_beam(name,y,width,base,thickness,material):
    count=32
    v=[]
    for i in range(count+1):
        x=-1.1+2.2*i/count
        z=base+.32*(1-(x/1.1)**2)
        v.extend([(x,y-width/2,z),(x,y+width/2,z),(x,y+width/2,z+thickness),(x,y-width/2,z+thickness)])
    f=[(3,2,1,0)]
    for i in range(count):
        for j in range(4):
            a=i*4+j;b=i*4+(j+1)%4
            f.append((a,b,b+4,a+4))
    k=count*4
    f.append((k,k+1,k+2,k+3))
    return mesh(name,v,f,material)


def bridge():
    wood=mat('wood',(.43,.235,.12))
    rail=mat('rail',(.26,.115,.062))
    stone=mat('stone',(.55,.53,.43))
    for y in (-.38,.38):
        arch_beam('Arched structural stringer',y,.09,.065,.13,wood)
        arch_beam('Curving top rail',y,.055,.49,.065,rail)
        arch_beam('Curving mid rail',y,.038,.30,.035,rail)
    for i in range(22):
        x=-1.05+i*.10
        z=.19+.32*(1-(x/1.1)**2)
        o=box('Individual thick deck plank',(x,0,z),(.097,.77,.065),wood,.008)
        o.rotation_euler[1]=math.atan(.64*x/1.21)
    for x in (-1,-.6,-.2,.2,.6,1):
        base=.19+.32*(1-(x/1.1)**2)
        for y in (-.39,.39):
            box('Railing post',(x,y,base+.20),(.072,.075,.44),rail,.017)
    for x in (-1.05,1.05):
        for y in (-.49,.49):
            box('Stone foot',(x,y,.09),(.24,.25,.18),stone,.035)
    return ['wood','rail','stone']


def chair():
    wood=mat('wood',(.43,.235,.105))
    cushion=mat('cushion',(.20,.43,.34))
    feet=mat('feet',(.13,.062,.035))
    box('Thick wooden seat',(0,0,.405),(.49,.48,.085),wood,.025)
    box('Green seat cushion',(0,-.015,.465),(.46,.435,.085),cushion,.04)
    for x in (-.19,.19):
        for y in (-.18,.18):
            box('Independent wooden leg',(x,y,.205),(.072,.078,.41),wood,.015)
            box('Dark foot',(x,y,.035),(.077,.083,.07),feet,.014)
    for x in (-.19,.19):
        box('Back upright',(x,.18,.655),(.075,.075,.48),wood,.025)
    box('Rounded back top',(0,.18,.862),(.455,.085,.11),wood,.037)
    box('Green back cushion',(0,.135,.742),(.35,.11,.265),cushion,.047)
    return ['wood','cushion','feet']


def build(asset_id):
    makers={'ST-046':rock,'ST-048':cave,'ST-056':cottage,'ST-064':bridge,'ST-084':chair}
    names=makers[asset_id]()
    # Recalculate outward normals on all mesh components, including custom shells.
    for o in list(bpy.context.scene.objects):
        if o.type=='MESH':
            bpy.ops.object.select_all(action='DESELECT')
            o.select_set(True)
            bpy.context.view_layer.objects.active=o
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.mesh.normals_make_consistent(inside=False)
            bpy.ops.object.mode_set(mode='OBJECT')
    return {'editableMaterials':names,'clips':[]}
