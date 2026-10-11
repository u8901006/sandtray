"""T14 batch 01: reuse v1 conversion; immutable artifacts stay outside public/.
Run conversion, then validate_t14_batch.mjs, then --apply-seed.
"""
import argparse, hashlib, json, re, struct, tempfile, zipfile
from pathlib import Path, PurePosixPath
import yaml
from import_user_packs_v1 import convert
from migrate_seed_1_2 import dump_yaml
from t14_material_policy import apply_material_policy
ROOT=Path(__file__).resolve().parents[2]
PLAN=ROOT/'tools/assets/t14-batch01.json'
BASE=ROOT/'source/t14-batch01'
def sha(data): return hashlib.sha256(data).hexdigest()
def load(p): return json.loads(p.read_text(encoding='utf-8'))
def immutable(path,data):
 path.parent.mkdir(parents=True,exist_ok=True)
 if path.exists():
  if path.read_bytes()!=data: raise ValueError(f'Immutable output differs: {path.name}')
 else:
  with path.open('xb') as f: f.write(data)
def local(path):
 p=(ROOT/path).resolve()
 if not p.is_relative_to(ROOT): raise ValueError('Path outside project')
 return p
def member_bytes(z,name):
 p=PurePosixPath(name)
 if p.is_absolute() or '..' in p.parts or '\\' in name or ':' in name: raise ValueError('Unsafe archive path')
 info=z.getinfo(name)
 if info.file_size>50000000 or (info.external_attr>>16)&0o170000==0o120000: raise ValueError('Unsafe archive entry')
 return z.read(info)
def build():
 plan=load(PLAN); seed=yaml.safe_load((ROOT/'assets_seed.yaml').read_text(encoding='utf-8'))
 by_id={a['asset_id']:a for a in seed['assets']}; rows=[]
 if len({x['seedId'] for x in plan['items']})!=len(plan['items']): raise ValueError('Duplicate seed ids')
 for item in plan['items']:
  sid,pack=item['seedId'],item['pack']; asset=by_id[sid]; meta=load(ROOT/f'source/{pack}/metadata.json')
  if meta['license']!='CC0-1.0' or meta['standalone_redistribution_allowed'] is not True: raise ValueError('Not a reviewed CC0 pack')
  if meta['coverage_of_request_table'][sid]['result']!='hit': raise ValueError('No filename-level coverage')
  archives=list((ROOT/f'source/{pack}/original').glob('*.zip'))
  if len(archives)!=1: raise ValueError('Ambiguous archive')
  archive=archives[0]; raw=archive.read_bytes()
  if sha(raw)!=meta['archive']['sha256'] or len(raw)!=meta['archive']['bytes']: raise ValueError('Archive mismatch')
  with zipfile.ZipFile(archive) as z:
   license_bytes=member_bytes(z,meta['license_file_in_archive'])
   if sha(license_bytes)!=meta['license_file_sha256'] or b'CC0' not in license_bytes: raise ValueError('License mismatch')
   source_bytes=member_bytes(z,item['member'])
   json_size,json_kind=struct.unpack_from('<II',source_bytes,12)
   if json_kind!=0x4e4f534a: raise ValueError('Missing glTF JSON chunk')
   source_doc=json.loads(source_bytes[20:20+json_size]); resources={}
   for resource in source_doc.get('buffers',[])+source_doc.get('images',[]):
    uri=resource.get('uri','')
    if not uri or uri.startswith('data:'): continue
    relative=PurePosixPath(uri)
    if relative.is_absolute() or '..' in relative.parts or any(c in uri for c in ['\\',':','%','?','#']): raise ValueError('External resource escapes source folder')
    resources[uri]=member_bytes(z,str(PurePosixPath(item['member']).parent/relative))
  with tempfile.TemporaryDirectory(prefix='t14-',dir=ROOT/'working') as tmp:
   source=Path(tmp)/PurePosixPath(item['member']).name;source.write_bytes(source_bytes)
   for uri,data in resources.items():
    target=Path(tmp)/uri;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
   original,doc,output,deps=convert(source)
  if any('uri' in b for b in doc.get('buffers',[])+doc.get('images',[])): raise ValueError('Not embedded')
  policy=item.get('materialPolicy','preserve')
  output=apply_material_policy(output,policy)
  digest=sha(output); code=pack.upper().replace('-','_'); stem=source.stem
  aid=f'IMP_{code}_{stem}'; name=f'{aid}-{digest[:16]}.glb'
  model=BASE/'processed'/name; immutable(model,output)
  license_file=BASE/'license'/f'{pack}-LICENSE.txt'; immutable(license_file,license_bytes)
  rows.append({'seedId':sid,'id':aid,'name':asset['identity']['name_zh'],'category':asset['identity']['category'],
   'version':'import-'+digest[:16],'file':model.relative_to(ROOT).as_posix(),'thumbnail':f'source/t14-batch01/thumbnails/{aid}-{digest[:16]}.webp',
   'source':archive.relative_to(ROOT).as_posix(),'sourceMember':item['member'],'archiveSha256':sha(raw),
   'sourceSha256':sha(original),'sha256':digest,'licenseSha256':sha(license_bytes),'licenseFile':license_file.relative_to(ROOT).as_posix(),
   'bytes':len(output),'dependencies':deps,'clips':len(doc.get('animations',[])),
   'provenance':{'author':meta['author'],'license':meta['license'],'licenseUrl':meta['license_url'],'sourceUrl':meta['source_url'],
    'sourcePack':pack,'requiresAttribution':False,'attributionText':'','standaloneRedistributionAllowed':True,'releasable':True,'licenseSnapshotSha256':sha(license_bytes)},
   'materialPolicy':policy,'reviewStatus':'needs_review','delivery':'private-draft'})
 result={'batch':plan['batch'],'planSha256':sha(PLAN.read_bytes()),'converterSha256':sha((ROOT/'tools/assets/import_user_packs_v1.py').read_bytes()),'materialPolicySha256':sha((ROOT/'tools/assets/t14_material_policy.py').read_bytes()),'batchImporterSha256':sha(Path(__file__).read_bytes()),'placementPolicy':'runtime-bounds-normalization-v1','budget':{'maxBytes':plan['maxBytes'],'maxTriangles':plan['maxTriangles']},'assets':rows}
 BASE.mkdir(parents=True,exist_ok=True)
 (BASE/'metadata.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'converted':len(rows),'bytes':sum(x['bytes'] for x in rows),'publicWrites':0,'ready':0}))
def apply_seed():
 meta=load(BASE/'metadata.json');report_path=BASE/'validation.json';report=load(report_path)
 if report.get('validatorSha256')!=sha((ROOT/'tools/assets/validate_t14_batch.mjs').read_bytes()): raise ValueError('Stale validator evidence')
 if report['metadataSha256']!=sha((BASE/'metadata.json').read_bytes()) or report['errors'] or len(report['results'])!=len(meta['assets']): raise ValueError('Validation not bound to this manifest')
 results={r['id']:r for r in report['results']}
 if len(results)!=len(meta['assets']): raise ValueError('Duplicate validation result')
 seed_path=ROOT/'assets_seed.yaml'; seed_bytes=seed_path.read_bytes(); newline='\r\n' if b'\r\n' in seed_bytes else '\n'; text=seed_bytes.decode('utf-8').replace('\r\n','\n');seed=yaml.safe_load(text)
 if seed['schema_version']!='1.2': raise ValueError('Expected seed 1.2')
 changes={};by_id={a['asset_id']:a for a in seed['assets']}
 for row in meta['assets']:
  r=results[row['id']];a=by_id[row['seedId']]
  if a['status']['overall']=='ready': raise ValueError('Cannot overwrite independent approval')
  if sha(local(row['file']).read_bytes())!=row['sha256'] or r['sha256']!=row['sha256']: raise ValueError('Model changed after validation')
  if sha(local(row['thumbnail']).read_bytes())!=r['thumbnailSha256']: raise ValueError('Thumbnail changed after validation')
  if r['meshes']<1 or r['triangles']<=0 or not r['rendered'] or r['missingTextures']: raise ValueError('Incomplete load validation')
  within=row['bytes']<meta['budget']['maxBytes'] and r['triangles']<=meta['budget']['maxTriangles']
  a['geometry']['triangles']=r['triangles'];a['materials']['textures']=r['textures']
  a['output']['final_glb']=row['file'];a['output']['thumbnail']=row['thumbnail'];a['output']['checksum_sha256']=row['sha256']
  a['output']['performance'].update(final_file_bytes=row['bytes'],final_file_mb=round(row['bytes']/1000000,6))
  a['output']['threejs']['scale']=r['placement']['scale'];a['output']['threejs']['ground_offset']=r['placement']['groundOffset']
  a['output']['threejs']['center_offset']=r['placement']['centerOffset']
  a['status']['overall']='needs_review' if within else 'needs_optimization'
  # Review flags and integration remain untouched: this is a private draft, not a product release.
  a['processing']['status']='converted_private_draft';a['processing']['assigned_agent']='GPT-6'
  a['processing']['tasks']['convert_to_glb']=True
  note='T14 batch01: private GLB and 512x512 WebP validated; product integration and independent visual/mobile gate pending.'
  if note not in (a['qa']['notes'] or ''): a['qa']['notes']=(a['qa']['notes'] or '')+'\n'+note
  changes[row['seedId']]=a
 # Preserve every unselected entry and the header byte-for-byte apart from original line-ending encoding.
 blocks=re.split(r'(?m)(?=^- asset_id: )',text)
 for i,b in enumerate(blocks):
  match=re.match(r'- asset_id: (ST-\d+)',b)
  if match and match[1] in changes: blocks[i]=dump_yaml([changes[match[1]]])
 updated=''.join(blocks);parsed=yaml.safe_load(updated)
 if len(parsed['assets'])!=len(seed['assets']): raise ValueError('Seed record count changed')
 if updated!=text: seed_path.write_bytes(updated.replace('\n',newline).encode('utf-8'))
 print(json.dumps({'updated':len(changes),'needs_review':sum(a['status']['overall']=='needs_review' for a in changes.values()),'ready':sum(a['status']['overall']=='ready' for a in parsed['assets']),'seedSha256':sha(seed_path.read_bytes())}))
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--apply-seed',action='store_true');args=parser.parse_args()
 apply_seed() if args.apply_seed else build()