"""Reproducible local import; source files are never changed."""
import base64, hashlib, json, re, shutil, struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'apps/web/public/imported-assets/v1'
PACKS=[('ARENA','kenney_mini-arena','競技場','Kenney'),('DUNGEON','kenney_mini-dungeon','地城','Kenney'),('FURNITURE','kenney_furniture-kit','家具','Kenney'),('MINI','kenney_mini-characters','人物','Kenney'),('ULTIMATE','Ultimate Animated Character Pack - Nov 2019','角色與動物','Quaternius')]
def resource(uri,source):
 if uri.startswith('data:'):return base64.b64decode(uri.split(',',1)[1],validate=True)
 p=(source.parent/uri).resolve()
 if not p.is_relative_to(source.parent.resolve()):raise ValueError('External resource escapes source folder')
 return p.read_bytes()
def convert(source):
 b=source.read_bytes();binary=b''
 if source.suffix=='.glb':
  magic,version,length=struct.unpack_from('<III',b)
  assert magic==0x46546c67 and version==2 and length==len(b)
  size,kind=struct.unpack_from('<II',b,12);assert kind==0x4e4f534a
  d=json.loads(b[20:20+size]);pos=20+size
  if pos<len(b):
   n,k=struct.unpack_from('<II',b,pos);assert k==0x004e4942;binary=b[pos+8:pos+8+n]
 else:d=json.loads(b)
 assert len(d.get('buffers',[]))==1
 if 'uri' in d['buffers'][0]:binary=resource(d['buffers'][0]['uri'],source)
 binary=binary[:d['buffers'][0]['byteLength']]
 assert len(binary)==d['buffers'][0]['byteLength']
 dependencies=[]
 for img in d.get('images',[]):
  if 'uri' not in img:continue
  uri=img.pop('uri');data=resource(uri,source);dependencies.append({'uri':uri[:160],'sha256':hashlib.sha256(data).hexdigest()})
  binary+=b'\0'*((-len(binary))%4);offset=len(binary);binary+=data
  img['bufferView']=len(d.setdefault('bufferViews',[]));d['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(data)})
  img['mimeType']='image/png' if data.startswith(b'\x89PNG') else 'image/jpeg'
 d['buffers']=[{'byteLength':len(binary)}]
 raw=json.dumps(d,separators=(',',':'),ensure_ascii=True).encode();raw+=b' '*((-len(raw))%4);binary+=b'\0'*((-len(binary))%4)
 output=struct.pack('<III',0x46546c67,2,12+8+len(raw)+8+len(binary))+struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(binary),0x004e4942)+binary
 return b,d,output,dependencies
def main():
 OUT.mkdir(parents=True,exist_ok=True)
 rows=[]
 for code,folder,category,author in PACKS:
  base=ROOT/folder;license=(base/'License.txt').read_bytes();assert b'CC0' in license
  shutil.copyfile(base/'License.txt',OUT/(code+'-LICENSE.txt'))
  sources=sorted(base.rglob('*.glb')) or sorted(base.rglob('*.gltf'))
  for source in sources:
   original,d,output,deps=convert(source);assetid='IMP_'+code+'_'+re.sub('[^A-Za-z0-9_-]','_',source.stem)
   digest=hashlib.sha256(output).hexdigest();filename=assetid+'-'+digest[:16]+'.glb';(OUT/filename).write_bytes(output)
   clips=[]
   for i,animation in enumerate(d.get('animations',[])):
    duration=max((d['accessors'][s['input']].get('max',[0])[0] for s in animation['samplers']),default=0)
    clips.append({'id':'clip-'+str(i),'name':animation.get('name','動作 '+str(i+1)),'durationMs':max(1,round(duration*1000))})
   preview=next((f for f in [base/'Previews'/(source.stem+'.png'),base/'Isometric'/(source.stem+'_NE.png')] if f.exists()),None)
   thumbnail='/imported-assets/v1/'+assetid+'.png'
   if preview:shutil.copyfile(preview,OUT/(assetid+'.png'))
   rows.append({'id':assetid,'name':source.stem,'category':category,'symbol':'♧' if code=='ULTIMATE' else '◇','color':'#708672','url':'/imported-assets/v1/'+filename,'version':'import-'+digest[:16],'thumbnail':thumbnail,'clips':clips,'sourcePack':folder,'author':author,'license':'CC0-1.0','status':'IMPORTED_UNREVIEWED','source':source.relative_to(ROOT).as_posix(),'sourceSha256':hashlib.sha256(original).hexdigest(),'sha256':digest,'licenseSha256':hashlib.sha256(license).hexdigest(),'bytes':len(output),'skins':len(d.get('skins',[])),'dependencies':deps})
 assert len(rows)==270 and len({r['id'] for r in rows})==270
 (ROOT/'packages/asset-catalog/src/imported-v1.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'models':len(rows),'animated':sum(bool(r['clips']) for r in rows),'bytes':sum(r['bytes'] for r in rows),'largest':max(r['bytes'] for r in rows)},ensure_ascii=False))

if __name__=='__main__':
 main()
