"""bits-v1 catalogue import (2026-10-10, Claude Opus 5.5): five KayKit "Bits" packs. Source folders are never changed.

Selection, names, categories and display sizes live in bits_v1_plan.py. The conversion is the adventure-v1 one
(import_adventure_v1.py): each .gltf becomes ONE self-contained GLB with its .bin and the pack's small palette PNG embedded
unchanged (a colour atlas: no resizing, no JPEG), metallicFactor <= 0.1 and roughnessFactor >= 0.5. None of these packs
has a rig or animation.
Writes apps/web/public/imported-assets/bits-v1/<ID>-<sha16>.glb, one licence text per pack (HOL: the page snapshot from
the plan, since the FREE folder ships none) and packages/asset-catalog/src/bits-v1.json
(thumbnails: node tools/assets/render_megakits_thumbs.mjs bits-v1). Re-running with unchanged inputs is byte-identical.
Usage: python tools/assets/import_bits_v1.py [--source ./asset-packs] [--dry-run]
"""
import argparse, json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bits_v1_plan import PACKS, ITEMS, CATEGORY_LOOK, HOLIDAY_LICENSE  # noqa: E402
from import_adventure_v1 import read_any, inside, tune_materials, triangles, pack_glb, sha, MAX_BYTES, MAX_TRIANGLES  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'apps/web/public/imported-assets/bits-v1'
CATALOG = ROOT / 'packages/asset-catalog/src/bits-v1.json'
REPORT = ROOT / 'docs/evidence/2026-10-10/opus/bits-v1-report.json'


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
    licence_sha = {}
    for code, pack in PACKS.items():
        if pack['license']:
            licence = inside(base / pack['folder'], pack['license'], 'Licence').read_bytes()
            assert b'CC0' in licence or b'Creative Commons Zero' in licence, pack['folder'] + ' licence is not CC0'
        else:
            assert not list((base / pack['folder']).glob('*icen*')), pack['folder'] + ' now ships a licence file: use it'
            licence = HOLIDAY_LICENSE.encode('utf-8')
        licence_sha[code] = sha(licence)  # T14 licenseSha256: the exact text shipped as <code>-LICENSE.txt (HOL: the page snapshot)
        if not args.dry_run:
            (OUT / f'{code}-LICENSE.txt').write_bytes(licence)
    rows, rejected = [], []
    for code, rel, stem, name, category, display_size in ITEMS:
        pack = PACKS[code]
        doc, binary, deps = read_any(inside(base / pack['folder'], rel, 'Source model'))
        assert not doc.get('skins') and not doc.get('animations'), f'{rel}: unexpected rig'
        tune_materials(doc)
        glb = pack_glb(doc, binary, 'sandtray import_bits_v1')
        tris = triangles(doc)
        if len(glb) > MAX_BYTES or tris > MAX_TRIANGLES:
            rejected.append({'id': stem, 'reason': f'budget: {len(glb)} B / {tris} tris'})
            continue
        asset_id = f'KB_{code}_{stem}'
        digest = sha(glb)
        filename = f'{asset_id}-{digest[:16]}.glb'
        if not args.dry_run:
            (OUT / filename).write_bytes(glb)
        symbol, color = CATEGORY_LOOK[category]
        rows.append({
            'id': asset_id, 'name': name, 'category': category, 'symbol': symbol, 'color': color,
            'version': f'kb-{digest[:16]}-s{round(display_size * 10)}',  # displaySize is part of the version (see adventure-v1)
            'thumbnail': f'/imported-assets/bits-v1/{asset_id}.png', 'clips': [], 'displaySize': display_size,
            'sourcePack': pack['provenancePack'], 'origin': f"{pack['folder']}/{rel}", 'sourceSha256': deps[0]['sha256'], 'sha256': digest,
            'licenseSha256': licence_sha[code],
            'bytes': len(glb), 'triangles': tris, 'materials': len(doc.get('materials', [])), 'skins': 0,
            # status ready: 2026-10-10 user decision (formal assets, T13 amendment); re-running keeps it.
            'url': f'/imported-assets/bits-v1/{filename}', 'license': 'CC0-1.0', 'author': 'Kay Lousberg', 'status': 'ready',
            '_deps': deps,
        })
    assert len({r['id'] for r in rows}) == len(rows) and len({r['name'] for r in rows}) == len(rows)
    summary = {'models': len(rows), 'rejected': len(rejected), 'bytes': sum(r['bytes'] for r in rows), 'largest': max(r['bytes'] for r in rows),
               'maxTriangles': max(r['triangles'] for r in rows), 'byPack': {code: sum(1 for r in rows if r['id'].startswith(f'KB_{code}_')) for code in PACKS}}
    print(json.dumps(summary, ensure_ascii=False))
    for item in rejected:
        print('REJECTED', json.dumps(item, ensure_ascii=False))
    if args.dry_run:
        return
    CATALOG.write_text(json.dumps([{k: v for k, v in r.items() if not k.startswith('_')} for r in rows], ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps({'summary': summary, 'rejected': rejected, 'dependencies': {r['id']: r['_deps'] for r in rows}},
                                 ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
