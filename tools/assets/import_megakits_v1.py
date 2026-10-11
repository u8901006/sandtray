"""Quaternius MegaKit (Standard, CC0 1.0) catalog import. Source folders are never changed.

Each source .gltf (+ external .bin + shared 2K/4K PNG trim sheets) becomes ONE self-contained GLB:
  - only the base-colour, normal (2026-10-06 user decision: keep) and emissive textures are kept, re-encoded at <= 512 px
    (JPEG q82 when opaque, PNG when the material really uses alpha). ORM / roughness / occlusion maps are
    dropped to stay inside the 3 MB-per-model budget; the material gets explicit metallic/roughness factors
    (glTF's default metallicFactor 1 would render dropped-ORM metal black without an environment map).
  - geometry, node hierarchy, skins and animations are copied unchanged.
Writes apps/web/public/imported-assets/megakits-v1/<ID>-<sha16>.glb, the pack licence, and
packages/asset-catalog/src/megakits-v1.json (thumbnails are added by render_megakits_thumbs.mjs).
Re-running with unchanged inputs is byte-identical (no timestamps; Pillow encoder is deterministic).
Usage: python tools/assets/import_megakits_v1.py [--source ./asset-packs] [--dry-run]
"""
import argparse, functools, hashlib, io, json, shutil, struct, sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from megakits_names import PACKS, category_for, display_name  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'apps/web/public/imported-assets/megakits-v1'
CATALOG = ROOT / 'packages/asset-catalog/src/megakits-v1.json'
REPORT = ROOT / 'docs/evidence/2026-10-06/opus/megakits-v1-report.json'
MAX_BYTES, MAX_TRIANGLES, TEXTURE_PX = 3_000_000, 30_000, 512
sha = lambda b: hashlib.sha256(b).hexdigest()


@functools.lru_cache(maxsize=None)
def encode_texture(path, wants_alpha):
    im = Image.open(path)
    im.load()
    has_alpha = im.mode in ('RGBA', 'LA') and im.getchannel('A').getextrema()[0] < 255
    keep_alpha = wants_alpha and has_alpha
    side = min(TEXTURE_PX, max(im.size))
    if max(im.size) > side:
        scale = side / max(im.size)
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    buf = io.BytesIO()
    if keep_alpha:
        im.convert('RGBA').save(buf, 'PNG', optimize=True)
        return buf.getvalue(), 'image/png'
    im.convert('RGB').save(buf, 'JPEG', quality=82, optimize=True, progressive=False, subsampling=2)
    return buf.getvalue(), 'image/jpeg'


def triangles(doc):
    total = 0
    for mesh in doc.get('meshes', []):
        for prim in mesh['primitives']:
            if prim.get('mode', 4) != 4:
                continue
            total += (doc['accessors'][prim['indices']]['count'] if 'indices' in prim else doc['accessors'][prim['attributes']['POSITION']]['count']) // 3
    return total


def convert(source, pack_root):
    doc = json.loads(source.read_text(encoding='utf-8'))
    assert len(doc['buffers']) == 1, 'single buffer expected'
    binary = (source.parent / doc['buffers'][0]['uri']).read_bytes()[:doc['buffers'][0]['byteLength']]
    assert len(binary) == doc['buffers'][0]['byteLength']
    keep_slots = []  # (material, slot) pairs we keep
    for material in doc.get('materials', []):
        pbr = material.setdefault('pbrMetallicRoughness', {})
        material.pop('occlusionTexture', None)
        pbr.pop('metallicRoughnessTexture', None)
        pbr['metallicFactor'] = 0.1
        pbr['roughnessFactor'] = 0.75
        if 'baseColorTexture' in pbr:
            keep_slots.append((pbr, 'baseColorTexture', material.get('alphaMode', 'OPAQUE') != 'OPAQUE'))
        if 'normalTexture' in material:
            keep_slots.append((material, 'normalTexture', False))
        if 'emissiveTexture' in material:
            keep_slots.append((material, 'emissiveTexture', False))
    new_images, new_textures, cache, dependencies = [], [], {}, []
    samplers = doc.get('samplers', [])
    for holder, slot, wants_alpha in keep_slots:
        texture = doc['textures'][holder[slot]['index']]
        image = doc['images'][texture['source']]
        key = (texture['source'], texture.get('sampler'), wants_alpha)
        if key not in cache:
            image_path = (source.parent / image['uri']).resolve()
            if not image_path.exists():  # Modular SciFi references bare names; the sheets live in <pack>/Textures
                image_path = (pack_root / 'Textures' / Path(image['uri']).name).resolve()
            if not image_path.is_relative_to(pack_root.resolve()):
                raise ValueError('texture escapes the pack folder: ' + image['uri'])
            data, mime = encode_texture(image_path, wants_alpha)
            binary += b'\0' * ((-len(binary)) % 4)
            doc.setdefault('bufferViews', []).append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(data)})
            binary += data
            new_images.append({'bufferView': len(doc['bufferViews']) - 1, 'mimeType': mime, 'name': image.get('name', Path(image['uri']).stem)})
            entry = {'source': len(new_images) - 1}
            if texture.get('sampler') is not None:
                entry['sampler'] = texture['sampler']
            new_textures.append(entry)
            cache[key] = len(new_textures) - 1
            dependencies.append({'uri': image['uri'], 'sha256': sha(image_path.read_bytes())})
        holder[slot]['index'] = cache[key]
    doc['images'], doc['textures'] = new_images, new_textures
    if not new_images:
        doc.pop('images'), doc.pop('textures')
    if not samplers:
        doc.pop('samplers', None)
    doc['buffers'] = [{'byteLength': len(binary)}]
    raw = json.dumps(doc, separators=(',', ':'), ensure_ascii=True).encode()
    raw += b' ' * ((-len(raw)) % 4)
    binary += b'\0' * ((-len(binary)) % 4)
    glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(raw) + 8 + len(binary)) + struct.pack('<II', len(raw), 0x4E4F534A) + raw + struct.pack('<II', len(binary), 0x004E4942) + binary
    return doc, glb, dependencies


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default='./asset-packs')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    base = Path(args.source)
    rows, rejected, ids = [], [], set()
    if not args.dry_run:
        if OUT.exists():
            for old in OUT.glob('*.glb'):
                old.unlink()
        OUT.mkdir(parents=True, exist_ok=True)
    for pack in PACKS:
        pack_root = base / pack['folder']
        license_bytes = (pack_root / 'License_Standard.txt').read_bytes()
        assert b'CC0 1.0' in license_bytes, pack['folder'] + ' licence is not CC0'
        if not args.dry_run:
            (OUT / (pack['code'] + '-LICENSE.txt')).write_bytes(license_bytes)
        for source in sorted(pack_root.rglob(pack['glob'])):
            rel = source.relative_to(pack_root).as_posix()
            try:
                doc, glb, deps = convert(source, pack_root)
            except FileNotFoundError as error:  # source defect, e.g. Decal_Line_90.gltf names a .bin that is not in the pack
                rejected.append({'source': rel, 'pack': pack['code'], 'reason': 'source file missing: ' + Path(error.filename).name})
                continue
            tris = triangles(doc)
            if len(glb) > MAX_BYTES or tris > MAX_TRIANGLES:
                rejected.append({'source': rel, 'pack': pack['code'], 'reason': f'budget: {len(glb)} B / {tris} tris'})
                continue
            stem = source.stem
            asset_id = f"MK_{pack['code']}_{stem}"
            assert asset_id not in ids, 'duplicate id ' + asset_id
            ids.add(asset_id)
            digest = sha(glb)
            filename = f'{asset_id}-{digest[:16]}.glb'
            if not args.dry_run:
                (OUT / filename).write_bytes(glb)
            clips = []
            for index, animation in enumerate(doc.get('animations', [])):
                duration = max((doc['accessors'][s['input']].get('max', [0])[0] for s in animation['samplers']), default=0)
                clips.append({'id': f'clip-{index}', 'name': animation.get('name', f'動作 {index + 1}'), 'durationMs': max(1, round(duration * 1000))})
            rows.append({
                'id': asset_id, 'name': display_name(pack['code'], source, stem), 'category': category_for(pack['code'], source, stem, pack['category']), 'symbol': pack['symbol'], 'color': pack['color'],
                'version': 'mk-' + digest[:16], 'thumbnail': f'/imported-assets/megakits-v1/{asset_id}.png', 'clips': clips,
                'sourcePack': pack['provenancePack'], 'origin': f"{pack['folder']}/{rel}", 'sourceSha256': sha(source.read_bytes()), 'sha256': digest,
                'bytes': len(glb), 'triangles': tris, 'materials': len(doc.get('materials', [])), 'skins': len(doc.get('skins', [])),
                'url': f'/imported-assets/megakits-v1/{filename}', 'license': 'CC0-1.0', 'author': 'Quaternius', 'status': 'IMPORTED_UNREVIEWED', 'dependencies': deps,
            })
    summary = {'models': len(rows), 'rejected': len(rejected), 'bytes': sum(r['bytes'] for r in rows), 'largest': max(r['bytes'] for r in rows), 'maxTriangles': max(r['triangles'] for r in rows),
               'byPack': {p['code']: sum(1 for r in rows if r['id'].startswith(f"MK_{p['code']}_")) for p in PACKS}}
    print(json.dumps(summary, ensure_ascii=False))
    for item in rejected:
        print('REJECTED', json.dumps(item, ensure_ascii=False))
    if args.dry_run:
        return
    CATALOG.write_text(json.dumps([{k: v for k, v in r.items() if k != 'dependencies'} for r in rows], ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps({'summary': summary, 'rejected': rejected, 'dependencies': {r['id']: r['dependencies'] for r in rows}}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
