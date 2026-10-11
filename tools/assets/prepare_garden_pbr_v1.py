"""Fetch selected CC0 PBR maps from cached official API metadata, with integrity checks."""
from pathlib import Path
import hashlib,json,urllib.request
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'assets/garden-pbr-v1';OUT.mkdir(parents=True,exist_ok=True)
records=[]
for asset in ['forest_ground_04','wood_floor']:
 metadata=json.loads((ROOT/f'assets/garden-pbr-v1/metadata/{asset}-files.json').read_text(encoding='utf-8'))
 info=json.loads((ROOT/f'assets/garden-pbr-v1/metadata/{asset}-info.json').read_text(encoding='utf-8'))
 for channel in ['Diffuse','nor_gl','Rough']:
  entry=metadata[channel]['1k']['jpg'];target=OUT/f'{asset}-{channel}-1k.jpg'
  if not target.exists():
   request=urllib.request.Request(entry['url'],headers={'User-Agent':'SandtrayCloudflare/0.1 (local asset preparation)'})
   with urllib.request.urlopen(request,timeout=60) as response:data=response.read()
   if len(data)!=entry['size'] or hashlib.md5(data).hexdigest()!=entry['md5']:raise ValueError('Source integrity mismatch')
   target.write_bytes(data)
  data=target.read_bytes()
  if len(data)!=entry['size'] or hashlib.md5(data).hexdigest()!=entry['md5']:raise ValueError('Cached integrity mismatch')
  records.append({'asset':asset,'channel':channel,'path':str(target.relative_to(ROOT)).replace('\\','/'),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'source':entry['url'],'assetPage':f'https://polyhaven.com/a/{asset}','authors':info['authors'],'license':'CC0-1.0','licenseURL':'https://polyhaven.com/license'})
(OUT/'manifest.json').write_text(json.dumps({'date':'2026-09-12','files':records},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Verified maps:',len(records),'bytes:',sum(x['bytes'] for x in records))
