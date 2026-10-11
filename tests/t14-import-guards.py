import io, json, sys, tempfile, unittest, zipfile
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools/assets'))
import import_t14_batch as batch
from import_user_packs_v1 import convert,resource
class T14Guards(unittest.TestCase):
 def test_archive_paths_and_symlinks_rejected(self):
  raw=io.BytesIO()
  with zipfile.ZipFile(raw,'w') as z:
   for name in ['../escape','/absolute','C:/drive','dir\\file','ok']: z.writestr(name,b'payload')
   info=zipfile.ZipInfo('link');info.external_attr=0o120777<<16;z.writestr(info,b'../escape')
  with zipfile.ZipFile(raw) as z:
   for name in ['../escape','/absolute','C:/drive','dir\\file','link']:
    with self.subTest(name=name),self.assertRaises(ValueError): batch.member_bytes(z,name)
   self.assertEqual(batch.member_bytes(z,'ok'),b'payload')
 def test_resource_cannot_escape_folder(self):
  with tempfile.TemporaryDirectory(dir=ROOT/'working') as tmp:
   p=Path(tmp)/'inner';p.mkdir();(Path(tmp)/'secret').write_bytes(b'x')
   with self.assertRaises(ValueError):resource('../secret',p/'model.gltf')
 def test_immutable_outputs_reject_changed_bytes(self):
  with tempfile.TemporaryDirectory(dir=ROOT/'working') as tmp:
   p=Path(tmp)/'model.glb';batch.immutable(p,b'one');batch.immutable(p,b'one')
   with self.assertRaises(ValueError):batch.immutable(p,b'two')
   self.assertEqual(p.read_bytes(),b'one')
 def test_rejects_stale_validator_and_manifest_evidence(self):
  for changed in ['validatorSha256','metadataSha256']:
   with self.subTest(changed=changed),tempfile.TemporaryDirectory(dir=ROOT/'working') as tmp:
    target=Path(tmp);meta=(batch.BASE/'metadata.json').read_bytes();report=json.loads((batch.BASE/'validation.json').read_text())
    report[changed]='0'*64
    (target/'metadata.json').write_bytes(meta);(target/'validation.json').write_text(json.dumps(report))
    with patch.object(batch,'BASE',target),self.assertRaises(ValueError):batch.apply_seed()
 def test_existing_270_conversions_keep_exact_hashes(self):
  assets=json.loads((ROOT/'packages/asset-catalog/src/imported-v1.json').read_text(encoding='utf-8'))
  self.assertEqual(len(assets),270)
  for a in assets:
   with self.subTest(asset=a['id']):
    original,doc,output,deps=convert(ROOT/a['source'])
    self.assertEqual(batch.sha(original),a['sourceSha256']);self.assertEqual(batch.sha(output),a['sha256'])
if __name__=='__main__':unittest.main()