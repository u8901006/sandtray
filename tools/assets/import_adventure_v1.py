"""adventure-v1 catalogue import (2026-10-10, Claude Opus 5.5). Source folders are never changed.

Selection, names, categories and display sizes live in adventure_v1_plan.py. Each selected model becomes ONE
self-contained GLB:
  - KayKit .gltf: external .bin and the pack's small palette PNG (<= 40 KB) are embedded unchanged; the palette is a
    colour atlas, so it is not resized or JPEG-encoded (either would bleed neighbouring swatches).
  - KayKit .glb figures (Adventurers / Skeletons): the free packs ship them in bind (T) pose with no animation. Three clips
    from the pack's own Rig_Medium files are merged in (待機 / 行走 / 倒下, matched by joint name), and every joint's rest
    TRS is set to the 待機 clip at t = 0, so a figure on the shelf or in the tray stands naturally when nothing plays.
    The inverse bind matrices are untouched, so skinning stays exact.
  - Ruins: GLBs produced from the pack FBX by build_ruins_v1.py (source/adventure-v1/ruins/).
  - Materials: metallicFactor <= 0.1 and roughnessFactor >= 0.5 (without an environment map metal renders black);
    emissive (skeleton eyes) kept.
Writes apps/web/public/imported-assets/adventure-v1/<ID>-<sha16>.glb, one licence copy per pack, and
packages/asset-catalog/src/adventure-v1.json (thumbnails: node tools/assets/render_megakits_thumbs.mjs adventure-v1).
Re-running with unchanged inputs is byte-identical.
Usage: python tools/assets/import_adventure_v1.py [--source ./asset-packs] [--dry-run]
"""
import argparse, base64, hashlib, json, struct, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from adventure_v1_plan import PACKS, ITEMS, CLIPS, CATEGORY_LOOK  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'apps/web/public/imported-assets/adventure-v1'
CATALOG = ROOT / 'packages/asset-catalog/src/adventure-v1.json'
RUINS = ROOT / 'source/adventure-v1/ruins'
REPORT = ROOT / 'docs/evidence/2026-10-10/opus/adventure-v1-report.json'
MAX_BYTES, MAX_TRIANGLES = 3_000_000, 30_000
sha = lambda b: hashlib.sha256(b).hexdigest()
COMPONENTS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
WIDTH = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}


def resolve_inside(path, uri):
    """T14 contract 1: an external buffer / image URI must stay inside the folder of the file that names it
    (no ../, absolute or drive paths, URL schemes, or symlinks leading out). data: URIs are handled by the caller."""
    if not uri or '://' in uri or uri.startswith(('/', '\\')):
        raise ValueError(f'External resource is not a relative path: {uri!r} in {path.name}')
    return inside(path.parent, uri, f'External resource {uri!r} in {path.name}')


def inside(folder, rel, label):
    """folder / rel, refusing anything that resolves (after symlinks) outside folder."""
    folder = folder.resolve()
    file = (folder / rel).resolve()
    if not file.is_relative_to(folder):
        raise ValueError(f'{label} escapes source folder {folder}')
    return file


def read_any(path):
    """(doc, binary, dependencies) with every buffer merged into one and every image embedded as a bufferView."""
    data = path.read_bytes()
    deps = [{'uri': path.name, 'sha256': sha(data)}]
    if path.suffix == '.glb':
        n = struct.unpack_from('<I', data, 12)[0]
        doc = json.loads(data[20:20 + n])
        binary = bytearray(data[20 + n + 8:]) if len(data) > 20 + n else bytearray()
        buffers = [binary[:doc['buffers'][0]['byteLength']]] if doc.get('buffers') else []
    else:
        doc = json.loads(data.decode('utf-8'))
        buffers = []
        for buf in doc.get('buffers', []):
            if buf['uri'].startswith('data:'):
                buffers.append(bytearray(base64.b64decode(buf['uri'].split(',', 1)[1])))
            else:
                blob = resolve_inside(path, buf['uri']).read_bytes()
                deps.append({'uri': buf['uri'], 'sha256': sha(blob)})
                buffers.append(bytearray(blob[:buf['byteLength']]))
    binary, offsets = bytearray(), []
    for buf in buffers:
        binary += b'\0' * ((-len(binary)) % 4)
        offsets.append(len(binary))
        binary += buf
    for view in doc.get('bufferViews', []):
        view['byteOffset'] = view.get('byteOffset', 0) + offsets[view.get('buffer', 0)]
        view['buffer'] = 0
    for image in doc.get('images', []):
        if 'uri' not in image:
            continue
        uri = image.pop('uri')
        if uri.startswith('data:'):
            blob = base64.b64decode(uri.split(',', 1)[1])
        else:
            blob = resolve_inside(path, uri).read_bytes()
            deps.append({'uri': uri, 'sha256': sha(blob)})
        image.setdefault('mimeType', 'image/png' if blob[:4] == b'\x89PNG' else 'image/jpeg')
        image['bufferView'] = add_view(doc, binary, blob)
    return doc, binary, deps


def add_view(doc, binary, blob):
    binary += b'\0' * ((-len(binary)) % 4)
    doc.setdefault('bufferViews', []).append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(blob)})
    binary += blob
    return len(doc['bufferViews']) - 1


def accessor_bytes(doc, binary, index):
    acc = doc['accessors'][index]
    view = doc['bufferViews'][acc['bufferView']]
    size = COMPONENTS[acc['type']] * WIDTH[acc['componentType']]
    start, stride = view['byteOffset'] + acc.get('byteOffset', 0), view.get('byteStride') or size
    return acc, b''.join(binary[start + i * stride:start + i * stride + size] for i in range(acc['count']))


def first_value(doc, binary, sampler):
    acc, raw = accessor_bytes(doc, binary, sampler['output'])
    assert acc['componentType'] == 5126 and not acc.get('normalized'), 'float animation output expected'
    n = COMPONENTS[acc['type']]
    element = 1 if sampler.get('interpolation') == 'CUBICSPLINE' else 0  # cubic spline stores in-tangent, value, out-tangent
    return list(struct.unpack_from('<%df' % n, raw, element * n * 4))


def merge_clips(doc, binary, anim_dir):
    """Append the CLIPS animations (by joint name) and set every joint's rest TRS to the first clip at t = 0."""
    names = {node.get('name'): i for i, node in enumerate(doc['nodes'])}
    clips, sources = [], {}
    for file, anim_name, label in CLIPS:
        if file not in sources:
            sources[file] = read_any(anim_dir / file)
        src, src_bin, _ = sources[file]
        anim = next(a for a in src['animations'] if a['name'] == anim_name)
        samplers, channels, missing = [], [], set()
        for channel in anim['channels']:
            target = src['nodes'][channel['target']['node']].get('name')
            if target not in names:
                missing.add(target)
                continue
            sampler = anim['samplers'][channel['sampler']]
            new = {'interpolation': sampler.get('interpolation', 'LINEAR')}
            for key in ('input', 'output'):
                acc, raw = accessor_bytes(src, src_bin, sampler[key])
                meta = {k: v for k, v in acc.items() if k not in ('bufferView', 'byteOffset', 'sparse')}
                meta['bufferView'] = add_view(doc, binary, raw)
                doc['accessors'].append(meta)
                new[key] = len(doc['accessors']) - 1
            samplers.append(new)
            channels.append({'sampler': len(samplers) - 1, 'target': {'node': names[target], 'path': channel['target']['path']}})
            if not clips:  # default pose from the first clip (待機) at t = 0
                path = channel['target']['path']
                if path in ('translation', 'rotation', 'scale'):
                    doc['nodes'][names[target]].pop('matrix', None)
                    doc['nodes'][names[target]][path] = [round(v, 7) for v in first_value(src, src_bin, sampler)]
        assert channels, f'{anim_name}: no joint names match the figure'
        doc.setdefault('animations', []).append({'name': label, 'samplers': samplers, 'channels': channels})
        duration = max(doc['accessors'][s['input']]['max'][0] for s in samplers)
        clips.append({'id': f'clip-{len(clips)}', 'name': label, 'durationMs': max(1, round(duration * 1000)), 'unmatchedJoints': sorted(missing)})
    return clips


def tune_materials(doc):
    for material in doc.get('materials', []):
        pbr = material.setdefault('pbrMetallicRoughness', {})
        pbr.pop('metallicRoughnessTexture', None)
        material.pop('occlusionTexture', None)
        pbr['metallicFactor'] = min(pbr.get('metallicFactor', 1.0), 0.1)
        pbr['roughnessFactor'] = max(pbr.get('roughnessFactor', 1.0), 0.5)


def triangles(doc):
    total = 0
    for mesh in doc.get('meshes', []):
        for prim in mesh['primitives']:
            if prim.get('mode', 4) == 4:
                total += (doc['accessors'][prim['indices']]['count'] if 'indices' in prim else doc['accessors'][prim['attributes']['POSITION']]['count']) // 3
    return total


def pack_glb(doc, binary, generator='sandtray import_adventure_v1'):  # bits-v1 reuses this with its own generator name
    doc.pop('extras', None)
    doc['asset'] = {'version': '2.0', 'generator': generator}
    binary = bytes(binary) + b'\0' * ((-len(binary)) % 4)
    doc['buffers'] = [{'byteLength': len(binary)}]
    raw = json.dumps(doc, separators=(',', ':'), ensure_ascii=True).encode()
    raw += b' ' * ((-len(raw)) % 4)
    return struct.pack('<III', 0x46546C67, 2, 28 + len(raw) + len(binary)) + struct.pack('<II', len(raw), 0x4E4F534A) + raw + struct.pack('<II', len(binary), 0x004E4942) + binary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default='./asset-packs')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    base = Path(args.source)
    if not args.dry_run:
        OUT.mkdir(parents=True, exist_ok=True)
        for old in [*OUT.glob('*.glb'), *OUT.glob('*.png')]:  # thumbnails are re-rendered after every import
            old.unlink()
    rows, rejected, licence_sha = [], [], {}
    for code, pack in PACKS.items():
        licence = inside(base / pack['folder'], pack['license'], 'Licence').read_bytes()
        assert b'CC0' in licence or b'Creative Commons Zero' in licence, pack['folder'] + ' licence is not CC0'
        licence_sha[code] = sha(licence)  # T14: the licence text checked at import time is pinned per asset (licenseSha256)
        if not args.dry_run:
            (OUT / f'{code}-LICENSE.txt').write_bytes(licence)
    for code, rel, stem, name, category, display_size in ITEMS:
        pack = PACKS[code]
        source = (RUINS / f'{stem}.glb') if code == 'RUN' else inside(base / pack['folder'], rel, 'Source model')
        doc, binary, deps = read_any(source)
        if code == 'RUN':
            fbx = inside(base / pack['folder'], rel, 'Source model')
            deps = [{'uri': rel, 'sha256': sha(fbx.read_bytes())}, {'uri': 'build_ruins_v1.py output', 'sha256': deps[0]['sha256']}]
        clips = merge_clips(doc, binary, base / pack['folder'] / pack['anim']) if doc.get('skins') and 'anim' in pack else []
        tune_materials(doc)
        glb = pack_glb(doc, binary)
        tris = triangles(doc)
        if len(glb) > MAX_BYTES or tris > MAX_TRIANGLES:
            rejected.append({'id': stem, 'reason': f'budget: {len(glb)} B / {tris} tris'})
            continue
        asset_id = f'AV_{code}_{stem}'
        digest = sha(glb)
        filename = f'{asset_id}-{digest[:16]}.glb'
        if not args.dry_run:
            (OUT / filename).write_bytes(glb)
        symbol, color = CATEGORY_LOOK[category]
        # displaySize is part of the version: the same GLB at another size must not silently restore at a different scale.
        version = f'av-{digest[:16]}-s{round(display_size * 10)}'
        rows.append({
            'id': asset_id, 'name': name, 'category': category, 'symbol': symbol, 'color': color, 'version': version,
            'thumbnail': f'/imported-assets/adventure-v1/{asset_id}.png', 'clips': [{k: c[k] for k in ('id', 'name', 'durationMs')} for c in clips],
            'displaySize': display_size, 'sourcePack': pack['provenancePack'], 'origin': f"{pack['folder']}/{rel}", 'sourceSha256': deps[0]['sha256'], 'sha256': digest,
            'licenseSha256': licence_sha[code],
            'bytes': len(glb), 'triangles': tris, 'materials': len(doc.get('materials', [])), 'skins': len(doc.get('skins', [])),
            # status ready: 2026-10-10 user decision (formal assets, T13 amendment); re-running keeps it.
            'url': f'/imported-assets/adventure-v1/{filename}', 'license': 'CC0-1.0', 'author': pack['author'], 'status': 'ready',
            '_deps': deps, '_unmatched': {c['name']: c['unmatchedJoints'] for c in clips if c['unmatchedJoints']},
        })
    assert len({r['id'] for r in rows}) == len(rows) and len({r['name'] for r in rows}) == len(rows)
    summary = {'models': len(rows), 'rejected': len(rejected), 'bytes': sum(r['bytes'] for r in rows), 'largest': max(r['bytes'] for r in rows),
               'maxTriangles': max(r['triangles'] for r in rows), 'animated': sum(1 for r in rows if r['clips']),
               'byPack': {code: sum(1 for r in rows if r['id'].startswith(f'AV_{code}_')) for code in PACKS}}
    print(json.dumps(summary, ensure_ascii=False))
    for item in rejected:
        print('REJECTED', json.dumps(item, ensure_ascii=False))
    for r in rows:
        if r['_unmatched']:
            print('UNMATCHED', r['id'], json.dumps(r['_unmatched'], ensure_ascii=False))
    if args.dry_run:
        return
    CATALOG.write_text(json.dumps([{k: v for k, v in r.items() if not k.startswith('_')} for r in rows], ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps({'summary': summary, 'rejected': rejected, 'dependencies': {r['id']: r['_deps'] for r in rows},
                                  'unmatchedJoints': {r['id']: r['_unmatched'] for r in rows if r['_unmatched']}}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
