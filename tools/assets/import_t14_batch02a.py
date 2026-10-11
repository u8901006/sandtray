"""T14 batch 02a: the ten user-flagged Ultimate characters, reusing the v1 converter.
convert() must byte-reproduce the imported-v1 GLB before the skin policy applies;
run validate_t14_batch.mjs t14-batch02a, then --apply-seed.
"""
import argparse, json, re, sys
from pathlib import Path
import yaml
sys.path.insert(0, str(Path(__file__).resolve().parent))
from import_t14_batch import sha, load, immutable, local
from import_user_packs_v1 import convert
from migrate_seed_1_2 import dump_yaml
from t14_material_policy import apply_material_policy
ROOT=Path(__file__).resolve().parents[2]
PLAN=ROOT/'tools/assets/t14-batch02a.json'
BASE=ROOT/'source/t14-batch02a'
PACK=ROOT/'Ultimate Animated Character Pack - Nov 2019'
V1=json.loads((ROOT/'packages/asset-catalog/src/imported-v1.json').read_text(encoding='utf-8'))
BY_IMP={a['id']:a for a in (V1 if isinstance(V1,list) else V1['assets'])}
PROVENANCE={'author':'Quaternius','license':'CC0-1.0',
 'licenseUrl':'https://creativecommons.org/publicdomain/zero/1.0/',
 'sourceUrl':'https://quaternius.com/packs/ultimatedanimatedcharacter.html',
 'sourcePack':'Quaternius Ultimate Animated Character Pack'}
NOTE='T14 batch02a: skin-tone-override (t2 #E8BE9A) private GLB and 512x512 WebP validated; product integration, user visual verdict and independent gate pending.'
def build():
 plan=load(PLAN);seed=yaml.safe_load((ROOT/'assets_seed.yaml').read_text(encoding='utf-8'))
 by_id={a['asset_id']:a for a in seed['assets']};rows=[]
 if len({x['seedId'] for x in plan['items']})!=len(plan['items']): raise ValueError('Duplicate seed ids')
 license_bytes=(PACK/'License.txt').read_bytes()
 for item in plan['items']:
  sid,imp=item['seedId'],item['impId'];asset=by_id[sid];v1=BY_IMP.get(imp)
  if v1 is None: raise ValueError('Not in imported-v1: '+imp)
  if asset['status']['overall']!='candidate_local': raise ValueError(f'{sid} is {asset["status"]["overall"]}, expected candidate_local')
  source=local(item['source'])
  if sha(source.read_bytes())!=v1['sourceSha256']: raise ValueError(f'{sid} source drift vs imported-v1')
  if sha(license_bytes)!=v1['licenseSha256']: raise ValueError(f'{sid} license drift vs imported-v1')
  original,doc,output,deps=convert(source)
  if sha(output)!=v1['sha256']: raise ValueError(f'{sid} converter drift: pre-policy GLB differs from imported-v1 baseline')
  if any('uri' in b for b in doc.get('buffers',[])+doc.get('images',[])): raise ValueError('Not embedded')
  if [c.get('name') for c in doc.get('animations',[])]!=[c.get('name') for c in v1.get('clips',[])]: raise ValueError(f'{sid} clip names changed vs imported-v1')
  policy=item.get('materialPolicy','preserve')
  output=apply_material_policy(output,policy)
  digest=sha(output);name=f'{imp}-{digest[:16]}.glb'
  model=BASE/'processed'/name;immutable(model,output)
  license_file=BASE/'license'/'ULTIMATE-LICENSE.txt';immutable(license_file,license_bytes)
  rows.append({'seedId':sid,'id':imp,'name':asset['identity']['name_zh'],'category':asset['identity']['category'],
   'version':'import-'+digest[:16],'file':model.relative_to(ROOT).as_posix(),'thumbnail':f'source/t14-batch02a/thumbnails/{imp}-{digest[:16]}.webp',
   'source':source.relative_to(ROOT).as_posix(),'sourceSha256':sha(original),'sha256':digest,
   'licenseSha256':sha(license_bytes),'licenseFile':license_file.relative_to(ROOT).as_posix(),
   'bytes':len(output),'dependencies':deps,'clips':len(doc.get('animations',[])),'skins':len(doc.get('skins',[])),
   'provenance':{**PROVENANCE,'requiresAttribution':False,'attributionText':'','standaloneRedistributionAllowed':True,'releasable':True,'licenseSnapshotSha256':sha(license_bytes)},
   'materialPolicy':policy,'reviewStatus':'needs_review','delivery':'private-draft'})
 result={'batch':plan['batch'],'planSha256':sha(PLAN.read_bytes()),'converterSha256':sha((ROOT/'tools/assets/import_user_packs_v1.py').read_bytes()),'materialPolicySha256':sha((ROOT/'tools/assets/t14_material_policy.py').read_bytes()),'batchImporterSha256':sha(Path(__file__).read_bytes()),'importedV1Sha256':sha((ROOT/'packages/asset-catalog/src/imported-v1.json').read_bytes()),'placementPolicy':'runtime-bounds-normalization-v1','budget':{'maxBytes':plan['maxBytes'],'maxTriangles':plan['maxTriangles']},'assets':rows}
 BASE.mkdir(parents=True,exist_ok=True)
 (BASE/'metadata.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'converted':len(rows),'bytes':sum(x['bytes'] for x in rows),'clips':sum(x['clips'] for x in rows),'publicWrites':0,'ready':0}))
def apply_seed():
 meta=load(BASE/'metadata.json');report=load(BASE/'validation.json')
 if report.get('validatorSha256')!=sha((ROOT/'tools/assets/validate_t14_batch.mjs').read_bytes()): raise ValueError('Stale validator evidence')
 if report['metadataSha256']!=sha((BASE/'metadata.json').read_bytes()) or report['errors'] or len(report['results'])!=len(meta['assets']): raise ValueError('Validation not bound to this manifest')
 results={r['id']:r for r in report['results']}
 if len(results)!=len(meta['assets']): raise ValueError('Duplicate validation result')
 seed_path=ROOT/'assets_seed.yaml';seed_bytes=seed_path.read_bytes();newline='\r\n' if b'\r\n' in seed_bytes else '\n';text=seed_bytes.decode('utf-8').replace('\r\n','\n');seed=yaml.safe_load(text)
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
  a['processing']['status']='converted_private_draft';a['processing']['assigned_agent']='GLM-5.3-flash'
  a['processing']['tasks']['convert_to_glb']=True
  if NOTE not in (a['qa']['notes'] or ''): a['qa']['notes']=(a['qa']['notes'] or '')+'\n'+NOTE
  changes[row['seedId']]=a
 # Preserve every unselected entry and the header byte-for-byte apart from original line-ending encoding.
 blocks=re.split(r'(?m)(?=^- asset_id: )',text)
 for i,b in enumerate(blocks):
  match=re.match(r'- asset_id: (ST-\d+)',b)
  if match and match[1] in changes: blocks[i]=dump_yaml([changes[match[1]]])
 updated=''.join(blocks);parsed=yaml.safe_load(updated)
 if len(parsed['assets'])!=len(seed['assets']): raise ValueError('Seed record count changed')
 if updated!=text: seed_path.write_bytes(updated.replace('\n',newline).encode('utf-8'))
 print(json.dumps({'updated':len(changes),'needs_review':sum(a['status']['overall']=='needs_review' for a in changes.values()),'needs_optimization':sum(a['status']['overall']=='needs_optimization' for a in changes.values()),'ready':sum(a['status']['overall']=='ready' for a in parsed['assets']),'seedSha256':sha(seed_path.read_bytes())}))
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--apply-seed',action='store_true');args=parser.parse_args()
 apply_seed() if args.apply_seed else build()
