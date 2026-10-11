import copy
import json
import struct
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools/assets'))
from t14_material_policy import apply_material_policy


class MaterialPolicyTests(unittest.TestCase):
    def fixture(self):
        doc = {'materials': [{'doubleSided': False}, {'name': 'leaf'}],
               'nodes': [{'translation': [1, 2, 3]}], 'meshes': [{'primitives': []}]}
        raw = json.dumps(doc).encode()
        raw += b' ' * (-len(raw) % 4)
        tail = struct.pack('<II', 8, 0x004e4942) + b'abcdefgh'
        return doc, struct.pack('<IIIII', 0x46546c67, 2, 20 + len(raw) + len(tail), len(raw), 0x4e4f534a) + raw + tail

    def pbr_fixture(self):
        # Mirrors Kenney nature-kit exports: metallicFactor 1 / roughnessFactor 1, no MR texture.
        doc = {'materials': [
                   {'name': 'metal', 'doubleSided': False,
                    'pbrMetallicRoughness': {'baseColorFactor': [0.4, 0.6, 0.2, 1], 'metallicFactor': 1, 'roughnessFactor': 1}},
                   {'name': 'nopbr'}],
               'nodes': [], 'meshes': []}
        raw = json.dumps(doc).encode()
        raw += b' ' * (-len(raw) % 4)
        tail = struct.pack('<II', 8, 0x004e4942) + b'abcdefgh'
        return doc, struct.pack('<IIIII', 0x46546c67, 2, 20 + len(raw) + len(tail), len(raw), 0x4e4f534a) + raw + tail

    def test_only_material_flags_change_and_binary_is_identical(self):
        doc, before = self.fixture()
        after = apply_material_policy(before, 'double-sided-thin-surfaces')
        n = struct.unpack_from('<I', after, 12)[0]
        expected = copy.deepcopy(doc)
        for material in expected['materials']:
            material['doubleSided'] = True
        self.assertEqual(json.loads(after[20:20+n]), expected)
        old_n = struct.unpack_from('<I', before, 12)[0]
        self.assertEqual(after[20+n:], before[20+old_n:])
        self.assertEqual(struct.unpack_from('<I', after, 8)[0], len(after))
        self.assertEqual(len(after) % 4, 0)
        self.assertEqual(apply_material_policy(after, 'double-sided-thin-surfaces'), after)

    def test_non_metallic_policy_zeroes_metallic_factor_only(self):
        doc, before = self.pbr_fixture()
        after = apply_material_policy(before, 'non-metallic-flat-color')
        n = struct.unpack_from('<I', after, 12)[0]
        out = json.loads(after[20:20+n])
        metal, nopbr = out['materials']
        self.assertEqual(metal['pbrMetallicRoughness']['metallicFactor'], 0)
        self.assertEqual(metal['pbrMetallicRoughness']['roughnessFactor'], 1)
        self.assertEqual(metal['pbrMetallicRoughness']['baseColorFactor'], [0.4, 0.6, 0.2, 1])
        self.assertFalse(metal['doubleSided'])
        self.assertEqual(nopbr.get('pbrMetallicRoughness', {}).get('metallicFactor'), 0)
        old_n = struct.unpack_from('<I', before, 12)[0]
        self.assertEqual(after[20+n:], before[20+old_n:])
        self.assertEqual(len(after) % 4, 0)
        self.assertEqual(apply_material_policy(after, 'non-metallic-flat-color'), after)

    def test_combined_policy_list_applies_both_rules_idempotently(self):
        doc, before = self.pbr_fixture()
        combined = apply_material_policy(before, ['double-sided-thin-surfaces', 'non-metallic-flat-color'])
        single = apply_material_policy(
            apply_material_policy(before, 'double-sided-thin-surfaces'), 'non-metallic-flat-color')
        self.assertEqual(combined, single)
        out = json.loads(combined[20:20+struct.unpack_from('<I', combined, 12)[0]])
        for material in out['materials']:
            self.assertTrue(material['doubleSided'])
            self.assertEqual(material.get('pbrMetallicRoughness', {}).get('metallicFactor'), 0)
        self.assertEqual(apply_material_policy(combined, ['double-sided-thin-surfaces', 'non-metallic-flat-color']), combined)

    def skin_fixture(self):
        # Mirrors Quaternius Ultimate characters: dark Skin material (linear 0.0134), no texture.
        doc = {'materials': [
                   {'name': 'Skin', 'doubleSided': False,
                    'pbrMetallicRoughness': {'baseColorFactor': [0.0134, 0.0134, 0.0134, 1], 'metallicFactor': 0}},
                   {'name': 'Shirt', 'doubleSided': False,
                    'pbrMetallicRoughness': {'baseColorFactor': [0.4, 0.6, 0.2, 1], 'metallicFactor': 0}}],
               'nodes': [], 'meshes': []}
        raw = json.dumps(doc).encode()
        raw += b' ' * (-len(raw) % 4)
        tail = struct.pack('<II', 8, 0x004e4942) + b'abcdefgh'
        return doc, struct.pack('<IIIII', 0x46546c67, 2, 20 + len(raw) + len(tail), len(raw), 0x4e4f534a) + raw + tail

    def test_skin_tone_policy_recolors_only_named_skin_material(self):
        doc, before = self.skin_fixture()
        after = apply_material_policy(before, 'skin-tone-override')
        n = struct.unpack_from('<I', after, 12)[0]
        out = json.loads(after[20:20+n])
        skin, shirt = out['materials']
        self.assertEqual(skin['pbrMetallicRoughness']['baseColorFactor'], [0.806952, 0.514918, 0.323143, 1])
        self.assertEqual(skin['pbrMetallicRoughness']['metallicFactor'], 0)
        self.assertEqual(shirt['pbrMetallicRoughness']['baseColorFactor'], [0.4, 0.6, 0.2, 1])
        self.assertEqual(shirt['pbrMetallicRoughness']['metallicFactor'], 0)
        self.assertFalse(shirt['doubleSided'])
        old_n = struct.unpack_from('<I', before, 12)[0]
        self.assertEqual(after[20+n:], before[20+old_n:])
        self.assertEqual(len(after) % 4, 0)
        self.assertEqual(apply_material_policy(after, 'skin-tone-override'), after)

    def test_skin_tone_policy_requires_a_skin_material(self):
        _, before = self.fixture()
        with self.assertRaises(ValueError):
            apply_material_policy(before, 'skin-tone-override')

    def test_skin_tone_combines_with_other_policies_order_independently(self):
        doc, before = self.skin_fixture()
        combined = apply_material_policy(before, ['skin-tone-override', 'non-metallic-flat-color'])
        reverse = apply_material_policy(before, ['non-metallic-flat-color', 'skin-tone-override'])
        self.assertEqual(combined, reverse)
        out = json.loads(combined[20:20+struct.unpack_from('<I', combined, 12)[0]])
        self.assertEqual(out['materials'][0]['pbrMetallicRoughness']['baseColorFactor'], [0.806952, 0.514918, 0.323143, 1])
        self.assertEqual(out['materials'][0]['pbrMetallicRoughness']['metallicFactor'], 0)
        self.assertEqual(out['materials'][1]['pbrMetallicRoughness']['metallicFactor'], 0)
        self.assertEqual(apply_material_policy(combined, ['skin-tone-override', 'non-metallic-flat-color']), combined)

    def test_preserve_and_reject_unknown_policy(self):
        _, before = self.fixture()
        self.assertEqual(apply_material_policy(before, 'preserve'), before)
        with self.assertRaises(ValueError):
            apply_material_policy(before, 'nature')
        with self.assertRaises(ValueError):
            apply_material_policy(before, ['double-sided-thin-surfaces', 'metal-look'])
        with self.assertRaises(ValueError):
            apply_material_policy(before, [])

    def test_batch_artifacts_match_explicit_policy_without_geometry_changes(self):
        old = json.loads((ROOT/'docs/evidence/2026-09-20/gpt6/t14-d3/before-metadata.json').read_text(encoding='utf-8'))
        new = json.loads((ROOT/'source/t14-batch01/metadata.json').read_text(encoding='utf-8'))
        self.assertEqual(len(new['assets']), 10)
        nature = {'ST-157', 'ST-158', 'ST-159', 'ST-160', 'ST-167', 'ST-168', 'ST-183'}
        thin = {'ST-158', 'ST-159', 'ST-160'}
        for a, b in zip(old['assets'], new['assets']):
            self.assertEqual(a['seedId'], b['seedId'])
            before, after = (ROOT/a['file']).read_bytes(), (ROOT/b['file']).read_bytes()
            if a['seedId'] in thin:
                policy = ['double-sided-thin-surfaces', 'non-metallic-flat-color']
            elif a['seedId'] in nature:
                policy = 'non-metallic-flat-color'
            else:
                policy = 'preserve'
            self.assertEqual(apply_material_policy(before, policy), after)
            self.assertEqual(a['sourceSha256'], b['sourceSha256'])
            if a['seedId'] in nature:
                self.assertNotEqual(a['sha256'], b['sha256'])
            else:
                self.assertEqual(a['sha256'], b['sha256'])


if __name__ == '__main__':
    unittest.main()
