"""Headless Blender 5.2 garden build; original project assets remain untouched."""
import bpy, math, random, json, hashlib, struct, zlib, wave
from pathlib import Path
from mathutils import Vector
import numpy as np
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'apps/web/public/environments/garden-v1';OUT.mkdir(parents=True,exist_ok=True)
WORK=ROOT/'working/garden-v1';WORK.mkdir(parents=True,exist_ok=True)
EVIDENCE=ROOT/'docs/evidence/2026-09-11';EVIDENCE.mkdir(parents=True,exist_ok=True)
random.seed(911);rng=np.random.default_rng(911)
bpy.ops.wm.read_factory_settings(use_empty=True)
def png(path,arr):
 h,w,c=arr.shape;data=b''.join(b'\0'+row.tobytes() for row in arr.astype(np.uint8))
 def chunk(t,d):return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
 path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(data,6))+chunk(b'IEND',b''))
def noise(n=512):
 field=np.zeros((n,n))
 for scale,amp in [(4,.42),(12,.26),(36,.15),(110,.10),(512,.07)]:
  a=rng.random((scale+1,scale+1));x=np.linspace(0,scale-.001,n);i=x.astype(int);f=x-i;f=f*f*(3-2*f)
  layer=(a[i[:,None],i[None,:]]*(1-f[:,None])*(1-f[None,:])+a[(i+1)[:,None],i[None,:]]*f[:,None]*(1-f[None,:])+a[i[:,None],(i+1)[None,:]]*(1-f[:,None])*f[None,:]+a[(i+1)[:,None],(i+1)[None,:]]*f[:,None]*f[None,:]);field+=layer*amp
 return field
materials={};buffers={}
def material(name,color,rough=.8,kind=None,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 if kind:
  f=noise();yy,xx=np.mgrid[:512,:512]/512
  if kind=='wood':f=.3*f+.35+.15*np.sin(xx*210+np.sin(yy*8)*2+f*5)+.08*np.sin(xx*780+f*4)
  if kind=='stone':f=.65*f+.16+np.minimum(.15,np.abs(np.sin(f*40))*.2)
  if kind=='fabric':f=.45+.14*np.sin(xx*1600)*np.sin(yy*1600)+.15*f
  if kind=='water':f=.5+.16*np.sin(xx*48+np.sin(yy*24)*1.5)+.13*np.sin(yy*85+xx*20)
  rgb=np.clip(np.asarray(color)[None,None,:]*(.58+f[:,:,None]*.9),0,1);png(OUT/(name+'-color.png'),rgb*255)
  gy,gx=np.gradient(f);normal=np.dstack((-gx*8,-gy*8,np.ones_like(f)));normal/=np.linalg.norm(normal,axis=2)[:,:,None];png(OUT/(name+'-normal.png'),(normal*.5+.5)*255)
  for suffix,target in [('color','Base Color'),('normal','Normal')]:
   tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(OUT/(name+'-'+suffix+'.png')))
   if suffix=='normal':tex.image.colorspace_settings.name='Non-Color';n=m.node_tree.nodes.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=.45;m.node_tree.links.new(tex.outputs['Color'],n.inputs['Color']);m.node_tree.links.new(n.outputs['Normal'],p.inputs[target])
   else:m.node_tree.links.new(tex.outputs['Color'],p.inputs[target])
 materials[name]=m;buffers[name]=[[],[]];return name
wood=material('Weathered_Cedar',(.38,.22,.10),.78,'wood');deck=material('Oiled_Timber',(.52,.32,.17),.64,'wood');stone=material('Granite',(.43,.46,.43),.94,'stone');soil=material('Forest_Floor',(.26,.29,.12),1,'soil');pathmat=material('Garden_Gravel',(.57,.52,.40),1,'stone');plaster=material('Lime_Plaster',(.75,.70,.57),.9,'stone');linen=material('Woven_Linen',(.65,.59,.43),.98,'fabric');roof=material('Slate_Roof',(.12,.19,.19),.83,'stone');water=material('Pond_Water',(.10,.31,.30),.16,'water',.2);leaf=[material('Foliage_'+str(i),c,.9) for i,c in enumerate([(.12,.24,.085),(.18,.31,.11),(.27,.38,.12),(.09,.20,.13)])];brass=material('Aged_Brass',(.34,.24,.10),.38,None,.7);ceramic=material('Glazed_Ceramic',(.50,.60,.57),.23);glass=material('Warm_Lantern',(.85,.59,.24),.4);p=materials[glass].node_tree.nodes.get('Principled BSDF');p.inputs['Emission Color'].default_value=(1,.48,.12,1);p.inputs['Emission Strength'].default_value=.8

def add(mat,verts,faces):
 v,f=buffers[mat];offset=len(v);v.extend(verts);f.extend(tuple(i+offset for i in face) for face in faces)
def box(name,loc,size,mat,bevel=.03):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(materials[mat])
 if bevel:mod=o.modifiers.new('Soft worn edges','BEVEL');mod.width=bevel;mod.segments=2
 return o
def rod(a,b,r1,r2,mat,sides=8):
 a,b=Vector(a),Vector(b);axis=(b-a).normalized();u=axis.cross(Vector((0,0,1)))
 if u.length<.01:u=axis.cross(Vector((1,0,0)))
 u.normalize();v=axis.cross(u);verts=[]
 for pt,r in [(a,r1),(b,r2)]:
  for i in range(sides):verts.append(tuple(pt+r*(u*math.cos(i*math.tau/sides)+v*math.sin(i*math.tau/sides))))
 faces=[tuple(reversed(range(sides))),tuple(range(sides,2*sides))]+[(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)];add(mat,verts,faces)
def ellipsoid(loc,scale,mat,n=12,rings=7):
 verts=[]
 for j in range(rings+1):
  phi=j*math.pi/rings
  for i in range(n):theta=i*math.tau/n;verts.append((loc[0]+scale[0]*math.sin(phi)*math.cos(theta),loc[1]+scale[1]*math.sin(phi)*math.sin(theta),loc[2]+scale[2]*math.cos(phi)))
 add(mat,verts,[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(rings) for i in range(n)])
def height(x,y):
 r=math.hypot(x,y);h=-.48+max(0,r-24)*.019+max(0,r-43)**1.25*.065*(1+.35*math.sin(x*.13)*math.cos(y*.11))
 h+=min(1,max(0,r-13)/16)*(.35*math.sin(x*.17)*math.cos(y*.14))
 d=((x+23)/12)**2+((y+10)/9)**2
 if d<1.2:h-=1.6*max(0,1-d/1.2)
 return h
# Uneven continuous terrain, shoreline and distant hill ring.
n=160;verts=[(x,y,height(x,y)) for y in np.linspace(-76,76,n) for x in np.linspace(-76,76,n)];add(soil,verts,[(j*n+i,j*n+i+1,(j+1)*n+i+1,(j+1)*n+i) for j in range(n-1) for i in range(n-1)])
verts=[(-23,-10,-.70)]+[(-23+11.5*math.cos(i*math.tau/128),-10+8.5*math.sin(i*math.tau/128),-.70) for i in range(128)];add(water,verts,[(0,i+1,(i+1)%128+1) for i in range(128)])
# Central timber platform surrounds the unchanged 10x7 sandbox.
for i in range(44):box('Pavilion_deck_plank',(0,-6.2+i*.285,-.43),(15.8,.273,.16),deck,.016)
for x in [-7.5,7.5]:
 for y in [-5.8,0,5.8]:box('Pavilion_column',(x,y,1.9),(.23,.23,4.6),wood,.035)
for y in [-5.8,5.8]:box('Pavilion_crossbeam',(0,y,4),(15.7,.25,.32),wood)
for x in [-7.5,7.5]:box('Pavilion_beam',(x,0,4),(.27,12.3,.35),wood)
# Pergola rather than an opaque roof keeps the sandbox camera clear.
for y in np.linspace(-5.7,5.7,16):box('Pavilion_louver',(0,float(y),4.17),(15.9,.11,.18),deck,.02)
# Pond bridge, small stone lantern landmarks and stepping stones.
for i in range(68):
 x=-35+i*.36;z=-.33+1.1*math.sin(i/67*math.pi);box('Arched_bridge_board',(x,-10,z),(.345,2.6,.13),deck,.015)
for y in [-11.25,-8.75]:
 for i in range(9):
  x=-35+i*3;z=-.33+1.1*math.sin(i/8*math.pi);rod((x,y,z),(x,y,z+1.1),.065,.05,wood)
 for i in range(32):
  x=-35+i*.75;x2=x+.75;z=.78+1.1*math.sin(i/32*math.pi);z2=.78+1.1*math.sin((i+1)/32*math.pi);rod((x,y,z),(x2,y,z2),.045,.045,wood)
def lantern(x,y):
 z=height(x,y);box('Lantern_stone_base',(x,y,z+.12),(.7,.7,.24),stone,.05);rod((x,y,z+.23),(x,y,z+1.15),.16,.12,stone,10);box('Lantern_light',(x,y,z+1.4),(.38,.38,.42),glass,.02);box('Lantern_cap',(x,y,z+1.68),(.75,.75,.14),stone,.06)
for x,y in [(-12,-8),(-35,-8),(11,5),(16,9),(25,9),(-10,8),(5,12)]:lantern(x,y)
for i in range(48):
 t=i/47;x=7+16*t;y=6+5*math.sin(t*1.3);z=height(x,y);ellipsoid((x,y,z+.02),(.42,.30,.085),pathmat,8,3)
for i in range(45):
 t=i/44;x=-8-5*t;y=-4-8*t;ellipsoid((x,y,height(x,y)+.025),(.37,.3,.07),stone,8,3)
# Enterable cedar tea house with interior furniture and detailed structural members.
cx,cy=21,16
for i in range(32):box('Teahouse_floor',(cx-5+i*.32,cy,-.30),(.308,8,.18),deck,.015)
box('Teahouse_back_wall',(cx,cy+4,1.25),(10.2,.18,3.2),plaster)
for x in [cx-5,cx+5]:
 box('Teahouse_side_wall',(x,cy+1.2,1.25),(.18,5.6,3.2),plaster)
 for y in [cy-4,cy,cy+4]:box('Teahouse_post',(x,y,1.4),(.25,.25,3.5),wood)
for x in np.linspace(cx-5,cx+5,11):
 rod((float(x),cy-4.5,3.0),(float(x),cy,4.8),.095,.095,wood);rod((float(x),cy,4.8),(float(x),cy+4.5,3.0),.095,.095,wood)
for side in [-1,1]:
 for j in range(14):
  y=cy+side*(j*.335+.1);z=4.82-j*.134;tile=box('Overlapping_roof_course',(cx,y,z),(11.2,.4,.08),roof,.015);tile.rotation_euler.x=-side*math.atan(.4)
box('Teahouse_ridge',(cx,cy,4.9),(11.4,.15,.15),wood)
# Interior shelves, joinery, cushions, book spines, ceramic pots and tea service.
for x in [cx-3.8,cx-2.2]:box('Shelf_upright',(x,cy+3.5,1),(.09,.7,2.6),deck,.015)
for z in [0, .65,1.3,1.95,2.3]:box('Shelf_board',(cx-3,cy+3.5,z),(1.8,.8,.075),deck,.015)
for i in range(18):box('Book_spine',(cx-3.7+(i%8)*.16,cy+3.2,.32+(i//8)*.66),(.115,.28,.48),[linen,plaster,wood,leaf[2]][i%4],.008)
for x in [cx-2,cx+2]:
 box('Sofa_frame',(x,cy+1,.25),(2.8,1.25,.35),wood,.065);box('Sofa_cushion',(x,cy+1,.51),(2.68,1.12,.27),linen,.12);box('Sofa_back',(x,cy+1.55,.9),(2.8,.22,1.0),linen,.10)
 for dx in [-1.25,1.25]:box('Sofa_arm',(x+dx,cy+1,.68),(.18,1.2,.45),wood,.04)
box('Low_tea_table',(cx,cy-1.2,.40),(3.1,1.25,.13),deck,.06)
for x in [cx-1.3,cx+1.3]:
 for y in [cy-1.65,cy-.75]:rod((x,y,-.2),(x,y,.36),.055,.055,wood)
for x in [cx-.65,cx+.65]:
 ellipsoid((x,cy-1.2,.53),(.16,.16,.035),ceramic);rod((x,cy-1.2,.54),(x,cy-1.2,.69),.07,.08,ceramic,16)
ellipsoid((cx,cy-1.2,.68),(.19,.17,.19),ceramic,16,10);rod((cx+.13,cy-1.2,.70),(cx+.36,cy-1.2,.78),.065,.035,ceramic,12)
# Carved stone garden circle and boulders create recognisable original landmarks.
for i in range(36):
 a=i*math.tau/36;x=8+4.4*math.cos(a);y=18+4.4*math.sin(a);box('Meditation_circle',(x,y,height(x,y)+.02),(.7,.5,.12),stone,.07)
for _ in range(110):
 a=random.random()*math.tau;r=random.uniform(12,66);x=math.cos(a)*r;y=math.sin(a)*r
 if abs(x-21)<8 and abs(y-16)<7:continue
 ellipsoid((x,y,height(x,y)+random.uniform(.1,.5)),(random.uniform(.3,1.6),random.uniform(.3,1),random.uniform(.2,.9)),stone,9,5)
# Three-dimensional trunks, branches and thousands of individually bent leaves.
def tree(x,y,h,seed):
 rr=random.Random(seed);z=height(x,y);lean=rr.uniform(-.5,.5);rod((x,y,z),(x+lean,y+.2,z+h),h*.038,.025,wood,10)
 for j in range(11):
  az=j*2.4;at=z+h*(.34+j*.048);reach=h*(.30-j*.013);end=(x+math.cos(az)*reach,y+math.sin(az)*reach,at+h*.15);rod((x+lean*.5,y,at),end,.065,.012,wood,6)
  ex,ey,ez=end
  for k in range(75):
   theta=rr.random()*math.tau;phi=rr.random()*math.pi;rad=rr.random()**.33;px=ex+math.cos(theta)*math.sin(phi)*rad*h*.17;py=ey+math.sin(theta)*math.sin(phi)*rad*h*.17;pz=ez+math.cos(phi)*rad*h*.10;s=rr.uniform(.12,.27);a=rr.random()*math.tau;ux,uy=math.cos(a)*s,math.sin(a)*s;vx,vy=-uy*.4,ux*.4
   add(leaf[(j+k)%4],[(px-ux,py-uy,pz),(px+vx,py+vy,pz+.035),(px+ux,py+uy,pz+.015),(px-vx,py-vy,pz+.035)],[(0,1,2),(0,2,3)])
for i in range(78):
 a=i*2.39996;r=random.uniform(22,68);x=math.cos(a)*r;y=math.sin(a)*r
 if ((x+23)/15)**2+((y+10)/12)**2<1 or (abs(x-21)<8 and abs(y-16)<7):continue
 tree(x,y,random.uniform(5,11),i+150)
tree(-11,12,13,48)
# Reeds, meadow blades and perennial ground cover.
for i in range(2600):
 x=random.uniform(-55,55);y=random.uniform(-55,55)
 if abs(x)<9 and abs(y)<8 or abs(x-21)<6 and abs(y-16)<5 or ((x+23)/12)**2+((y+10)/9)**2<1.05:continue
 z=height(x,y)
 for j in range(3):
  a=random.random()*math.tau;h=random.uniform(.15,.52);w=.035;add(leaf[(i+j)%4],[(x-w*math.cos(a),y-w*math.sin(a),z),(x+w*math.cos(a),y+w*math.sin(a),z),(x+.12*math.sin(a),y+.12*math.cos(a),z+h)],[(0,1,2)])
for mat,(verts,faces) in buffers.items():
 if not verts:continue
 mesh=bpy.data.meshes.new(mat+'_mesh');mesh.from_pydata(verts,[],faces);mesh.update();obj=bpy.data.objects.new(mat,mesh);bpy.context.collection.objects.link(obj);mesh.materials.append(materials[mat])
# UV projection in world scale, exported texture maps work in both Blender and browsers.
for o in list(bpy.context.scene.objects):
 if o.type!='MESH':continue
 uv=o.data.uv_layers.new(name='GardenUV') if not o.data.uv_layers else o.data.uv_layers.active
 for face in o.data.polygons:
  axis=max(range(3),key=lambda a:abs(face.normal[a]));axes=[a for a in range(3) if a!=axis]
  for li in face.loop_indices:
   v=o.matrix_world@o.data.vertices[o.data.loops[li].vertex_index].co;uv.data[li].uv=(v[axes[0]]*.35,v[axes[1]]*.35)
 for poly in o.data.polygons:poly.use_smooth=o.name.startswith(('Foliage','Granite','Forest'))
# Headless cinematic overview, with real sun shadows and a large sky.
world=bpy.data.worlds.new('Garden sky');world.use_nodes=True;sky=world.node_tree.nodes.new('ShaderNodeTexSky');sky.sky_type='MULTIPLE_SCATTERING';sky.sun_elevation=math.radians(24);sky.sun_rotation=math.radians(130);world.node_tree.links.new(sky.outputs['Color'],world.node_tree.nodes.get('Background').inputs['Color']);world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.35;bpy.context.scene.world=world
bpy.ops.object.light_add(type='SUN',location=(0,0,20));sun=bpy.context.object;sun.rotation_euler=(math.radians(27),math.radians(-25),math.radians(-35));sun.data.energy=2.6;sun.data.angle=math.radians(7)
bpy.ops.object.camera_add(location=(38,-49,32));camera=bpy.context.object;camera.rotation_euler=(Vector((-5,3,0))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=40;bpy.context.scene.camera=camera
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True;scene.render.resolution_x=1600;scene.render.resolution_y=1000;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX'
bpy.ops.wm.save_as_mainfile(filepath=str(WORK/'garden-source.blend'))
# Join by material after retaining the editable authored source, reducing browser draw calls.
bpy.ops.object.select_all(action='DESELECT')
for o in list(scene.objects):
 if o.type=='MESH':
  bpy.context.view_layer.objects.active=o;o.select_set(True)
  for mod in list(o.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
  o.select_set(False)
for mat in materials.values():
 objects=[o for o in scene.objects if o.type=='MESH' and len(o.data.materials)==1 and o.data.materials[0]==mat and not o.name.startswith(('Pavilion_louver','Pavilion_beam','Pavilion_crossbeam'))]
 if not objects:continue
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();objects[0].name='Garden_'+mat.name
bpy.ops.export_scene.gltf(filepath=str(OUT/'garden-high.glb'),export_format='GLB',export_cameras=False,export_lights=False,export_animations=False)
scene.render.filepath=str(EVIDENCE/'garden-blender-overview.png');bpy.ops.render.render(write_still=True)
camera.location=(21,8,1.65);camera.rotation_euler=(Vector((21,17,1.1))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=22;scene.render.filepath=str(EVIDENCE/'garden-blender-interior.png');bpy.ops.render.render(write_still=True)
for o in list(scene.objects):
 if o.type=='MESH' and len(o.data.polygons)>300:
  mod=o.modifiers.new('Lightweight browser mesh','DECIMATE');mod.ratio=.4;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.ops.export_scene.gltf(filepath=str(OUT/'garden-low.glb'),export_format='GLB',export_cameras=False,export_lights=False,export_animations=False)
# Original, synthesised stereo water/wind/birds. Off by default in the app.
sr=24000;seconds=24;n=sr*seconds;t=np.arange(n)/sr;freq=np.fft.rfftfreq(n,1/sr);spec=(rng.normal(size=len(freq))+1j*rng.normal(size=len(freq)))/np.maximum(freq,60)**.48;spec[freq>6500]=0;base=np.fft.irfft(spec,n);base=base/max(abs(base))*.18;wind=base*(.55+.25*np.sin(t*math.tau/12));birds=np.zeros(n)
for at in [3,3.4,8,8.25,15,15.35,20.5]:
 mask=(t>=at)&(t<at+.22);u=t[mask]-at;birds[mask]+=.028*np.sin(math.tau*(1700*u+450*u*u))*np.sin(math.pi*u/.22)**2
mix=wind+birds;stereo=np.stack((mix,np.roll(wind,130)+birds*.75),axis=1);pcm=(np.clip(stereo,-1,1)*32767).astype('<i2')
with wave.open(str(OUT/'garden-ambience.wav'),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(sr);f.writeframes(pcm.tobytes())
report={'generator':'Headless Blender '+bpy.app.version_string,'scene':'Natural retreat garden','extentMeters':[152,152],'files':{f.name:{'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in OUT.iterdir() if f.suffix in ['.glb','.wav']},'source':'working/garden-v1/garden-source.blend','originalAudio':'Synthesised water, wind and bird calls; not field recordings','landmarks':['Central pergola','Arched pond bridge','Cedar tea house interior','Meditation circle','Old tree','Stone lanterns']}
(OUT/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print('GARDEN_COMPLETE',json.dumps(report))
