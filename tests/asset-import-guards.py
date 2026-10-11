"""adventure-v1 / bits-v1 importer guards (GPT-6 review 2026-10-10 F1, T14 contract 1).
read_any must refuse external buffer / image URIs that leave the folder of the .gltf naming them, while
data: URIs and sibling files keep working. Run: python tests/asset-import-guards.py"""
import base64, json, os, sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools/assets'))
from import_adventure_v1 import read_any, inside  # noqa: E402

PNG = b'\x89PNG\r\n\x1a\n' + b'0' * 8


def gltf(folder, doc, name='model.gltf'):
    path = folder / name
    path.write_text(json.dumps({'asset': {'version': '2.0'}, **doc}), encoding='utf-8')
    return path


class ImportGuards(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='import-guard-', dir=ROOT / 'working')
        self.root = Path(self.tmp.name)
        self.pack = self.root / 'pack'
        self.pack.mkdir()
        (self.root / 'outside.bin').write_bytes(b'REVIEW_MARKER')

    def tearDown(self):
        self.tmp.cleanup()

    def escapes(self):
        absolute = str((self.root / 'outside.bin').resolve())
        return ['../outside.bin', 'sub/../../outside.bin', absolute, absolute.replace(os.sep, '/'), '/etc/passwd', 'https://example.invalid/x.bin', '']

    def test_buffer_uri_cannot_escape(self):
        for uri in self.escapes():
            with self.subTest(uri=uri), self.assertRaises(ValueError):
                read_any(gltf(self.pack, {'buffers': [{'uri': uri, 'byteLength': 13}]}))

    def test_image_uri_cannot_escape(self):
        for uri in self.escapes():
            with self.subTest(uri=uri), self.assertRaises(ValueError):
                read_any(gltf(self.pack, {'images': [{'uri': uri}]}))

    def test_symlink_out_of_folder_rejected(self):
        link = self.pack / 'link.bin'
        try:
            os.symlink(self.root / 'outside.bin', link)
        except (OSError, NotImplementedError) as error:
            self.skipTest(f'symlinks unavailable here: {error}')
        with self.assertRaises(ValueError):
            read_any(gltf(self.pack, {'buffers': [{'uri': 'link.bin', 'byteLength': 13}]}))

    def test_sibling_and_data_uris_still_embed(self):
        (self.pack / 'tex').mkdir()
        (self.pack / 'tex/palette.png').write_bytes(PNG)
        (self.pack / 'model.bin').write_bytes(b'ABCD')
        data = 'data:application/octet-stream;base64,' + base64.b64encode(b'EFGH').decode()
        doc, binary, deps = read_any(gltf(self.pack, {
            'buffers': [{'uri': 'model.bin', 'byteLength': 4}, {'uri': data, 'byteLength': 4}],
            'bufferViews': [{'buffer': 0, 'byteLength': 4}, {'buffer': 1, 'byteLength': 4}],
            'images': [{'uri': 'tex/palette.png'}]}))
        self.assertEqual(bytes(binary[:8]), b'ABCDEFGH')
        self.assertEqual(doc['images'][0]['mimeType'], 'image/png')
        self.assertNotIn('uri', doc['images'][0])
        self.assertEqual([d['uri'] for d in deps], ['model.gltf', 'model.bin', 'tex/palette.png'])

    def test_plan_paths_stay_inside_pack(self):
        self.assertEqual(inside(self.pack, 'a/b.gltf', 'Source model'), (self.pack / 'a/b.gltf').resolve())
        for rel in ['../outside.bin', str(self.root / 'outside.bin')]:
            with self.subTest(rel=rel), self.assertRaises(ValueError):
                inside(self.pack, rel, 'Source model')


if __name__ == '__main__':
    unittest.main()
