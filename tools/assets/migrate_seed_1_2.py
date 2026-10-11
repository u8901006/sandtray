#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""T15: assets_seed.yaml schema 1.1 -> 1.2 增量遷移（選項 B）。

Spec: specs/001-sandtray/tasks/T15-seed-schema-1.2-migration-2026-09-19.md
Usage:
  python tools/assets/migrate_seed_1_2.py                    # in-place：assets_seed.yaml 1.1 -> 1.2（遷移後自動展平驗證）
  python tools/assets/migrate_seed_1_2.py --input A --output B
  python tools/assets/migrate_seed_1_2.py --verify OLD NEW   # 獨立展平比對（C45 重跑用）
  python tools/assets/migrate_seed_1_2.py --check            # 輸入已 1.2 -> 輸出必須逐位元組相同（idempotency 驗證）

固定契約（T15，違反即 exit non-zero）：
  1. id 不變：asset_id ST-101..226 維持頂層鍵；identity.id 同值；identity.slug 僅人讀別名（非鍵）。
  2. 1.1 每個非 null 葉節點在 1.2 可找到（展平逐鍵比對，遺失必須為 0）。
  3. 授權清單沿 2026-09-16 16:0x 裁定：preferred=[CC0-1.0, CC-BY-4.0]；reject 必含
     CC-BY-SA/CC-BY-NC/CC-BY-ND/editorial_only/non_commercial_only；V2 的 commercial_royalty_free
     不進 preferred；QAL 僅以 restricted_no_public_path 列出。
  4. preferred_sources 僅 Kenney/Poly Haven/Quaternius/Sketchfab；Fab/CGTrader/TurboSquid/DAZ3D/Moyu
     移 paid_sources_pending_user_approval（DAZ 加註禁散布未渲染網格）；每筆 fallback_sources 原封。
  5. 預算沿 T14 契約 6 三檔，不用 V2 的 8MB/15K/50K；texture 2048/1024 與 optimization 採 V2。
  6. 輸入已 1.2 且無需修正 -> 輸出逐位元組相同（冪等）；G50 起 1.2 輸入會重推導
     status.download 與 collection_rules.historical_note，有差異就更新寫入。
  7. 只產 seed + 本腳本 + 報告；不碰 apps/packages/tests。
  8. status 語意不變：1.1 status -> status.overall 原值；不得產生 'ready'；四欄推導規則：
       procurement = 'done' 若 local_candidate 為 dict（G36 Phase 0 對映有事實），否則 'todo'
       download    = 'done' 若 (a) 該 ST 以 result=='hit' 出現於任一 source/<pack>/metadata.json
                     的 coverage_of_request_table 且該包 original/ 有 ≥1 非 README 檔案（該 ST 的
                     候選檔確實已在磁碟；publictransport 有 hit 無檔即排除），或 (b) G50：local_candidate
                     為 dict 且其 source_sha256 與 packages/asset-catalog/src/imported-v1.json 中任一
                     sourceSha256 相同（sha 對上才算；GLB 實存於 apps/web/public/imported-assets/v1/），
                     或 (c) G51（C47-F1）：source/sketchfab/<uid>/metadata.json 的 st_ref==該 asset_id
                     且 download_status=='downloaded' 且 original_files[] 全部存在於該 uid 的 original/
                     （st_ref 重複以先者為準；ST-215 以 (a) Farm Buildings Well.fbx 為準）
       optimization/integration = 'todo'（無事實可推導；GLB 存在≠過 T14 契約 6 預算 gate）
"""

import argparse
import copy
import datetime
import glob
import io
import json
import os
import re
import sys

import yaml

PRIORITY_MAP = {"P0": "critical", "P1": "high", "P2": "medium", "P3": "low"}
PHASE_MAP = {"phase1": 1, "phase2": 2}

# 1.1 欄位 -> 1.2 路徑（T15 欄位對映表）。DUAL 欄位會寫入多個位置、驗證時逐一檢查。
SIMPLE_MAP = {
    "name_zh": "identity.name_zh",
    "name_en": "identity.name_en",
    "category_primary": "identity.category",
    "category_secondary": "identity.subcategory",
    "search_query": "source.discovery.search_query",
    "preferred_sources": "source.discovery.preferred_sources",
    "fallback_sources": "source.discovery.fallback_sources",
    "license_policy": "license.policy_notes",
    "target_format": "output.format",
    "target_path": "output.final_glb",
    "thumbnail_path": "output.thumbnail",
    "local_candidate": "files.local_candidate",
    "status": "status.overall",
    "source_url": "source.asset_page_url",
    "source_platform": "source.provider",
    "source_asset_name": "source.asset_name",
    "author": "source.creator",
    "license": "license.name",
    "license_url": "license.license_url",
    "original_format": "files.original_format",
    "original_file_size_bytes": "files.original_file_size_bytes",
    "triangles": "geometry.triangles",
    "textures": "materials.textures",
    "optimized_file_size_bytes": "output.performance.final_file_bytes",
    "checksum_sha256": "output.checksum_sha256",
    "notes": "qa.notes",
}
DUAL_MAP = {
    "clinical_tags": ["sandtray.symbolic_roles", "identity.tags"],
    "phase": ["sandtray.phase"],            # 變換：phase1 -> 1
    "priority": ["sandtray.priority"],      # 變換：P0 -> critical（原字串存 priority_legacy）
    "asset_id": ["asset_id", "identity.id"],
}
# 驗證時排除的 1.1 變換欄（以轉換後形式比對，見 compare_leaf）
TRANSFORMED = {"phase", "priority", "optimized_file_size_bytes"}

PROCESSING_TASK_KEYS = [
    "remove_unwanted_objects", "remove_weapons", "simplify_geometry", "decimate",
    "merge_materials", "texture_atlas", "resize_textures", "bake_textures",
    "fix_normals", "fix_origin", "normalize_scale", "generate_lod",
    "convert_to_glb", "compress_glb",
]


def build_asset_policy():
    """契約 3/4/5：授權、來源、預算沿既有裁定，不採 V2 的放寬值。"""
    return {
        "preferred_licenses": ["CC0-1.0", "CC-BY-4.0"],
        "reject_licenses": [
            "CC-BY-SA", "CC-BY-NC", "CC-BY-ND", "editorial_only", "non_commercial_only",
        ],
        "preferred_sources": ["Kenney", "Poly Haven", "Quaternius", "Sketchfab"],
        "paid_sources_pending_user_approval": ["Fab", "CGTrader", "TurboSquid", "DAZ3D", "Moyu"],
        "paid_sources_note": (
            "DAZ 3D 標準授權禁散布未渲染網格；付費來源須使用者逐案明確核准後始得接觸"
            "（AGENTS.md §12）。本清單是『待核准』標記，非核准。"
        ),
        "restricted_no_public_path": ["QAL-1.0"],
        "default_performance_targets": {
            "prop": {"max_glb_mb": 1, "max_triangles": 10000},
            "people_animals": {"max_glb_mb": 3, "max_triangles": 30000},
            "structures": {"max_glb_mb": 4, "max_triangles": 40000},
            "preferred_texture_size": 1024,
            "max_texture_size": 2048,
            "note": (
                "T14 契約 6 三檔：prop <1MB/≤10K tris；people/animals <3MB/≤30K；"
                "structures <4MB/≤40K。category_primary 其餘值（vehicles/nature/furniture/"
                "objects/fantasy/symbolic/medical/effects/buildings）歸哪一檔留 T14 D 點裁定，"
                "本遷移不擴大。"
            ),
        },
        "optimization": {
            "draco": True,
            "meshopt": True,
            "texture_format": "webp",
            "use_ktx2_when_possible": True,
            "generate_lod": True,
        },
    }


def downloaded_hit_sts(source_root="source"):
    """掃 source/<pack>/metadata.json 的 coverage_of_request_table，
    回傳 {st_id: pack} 條件：result=='hit' 且該包 original/ 有 >=1 非 README 檔。"""
    hits = {}
    for meta_path in sorted(glob.glob(os.path.join(source_root, "*", "metadata.json"))):
        pack = os.path.basename(os.path.dirname(meta_path))
        orig_dir = os.path.join(source_root, pack, "original")
        real_files = []
        if os.path.isdir(orig_dir):
            real_files = [f for f in sorted(os.listdir(orig_dir)) if not f.startswith("README")]
        if not real_files:
            continue
        with io.open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
        for st, entry in (meta.get("coverage_of_request_table") or {}).items():
            if isinstance(entry, dict) and entry.get("result") == "hit":
                hits.setdefault(st, pack)
    return hits


COLLECTION_RULES_NOTE_KEY = "historical_note"
COLLECTION_RULES_NOTE = (
    "歷史搜尋策略，授權與來源核准以 project.asset_policy 為準。"
)


def imported_v1_sha_set(path="packages/asset-catalog/src/imported-v1.json"):
    """G50：imported-v1 匯入 catalog 的 sourceSha256 集合（Phase 0 已匯入素材的原始檔指紋）。"""
    with io.open(path, encoding="utf-8") as f:
        items = json.load(f)
    return {it["sourceSha256"] for it in items if isinstance(it, dict) and it.get("sourceSha256")}


def sketchfab_downloaded_sts(source_root="source"):
    """G51（C47-F1）：掃 source/sketchfab/<uid>/metadata.json，回傳 {st_ref: uid}。
    條件：download_status=='downloaded' 且 original_files[] 非空且全部檔案存在於
    該 uid 的 original/（st_ref 重複以排序先者為準）。"""
    done = {}
    for meta_path in sorted(glob.glob(os.path.join(source_root, "sketchfab", "*", "metadata.json"))):
        uid_dir = os.path.dirname(meta_path)
        with io.open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
        if meta.get("download_status") != "downloaded":
            continue
        st = meta.get("st_ref")
        files = meta.get("original_files") or []
        if not st or not files:
            continue
        orig_dir = os.path.join(uid_dir, "original")
        if all(os.path.isfile(os.path.join(orig_dir, fo.get("filename", ""))) for fo in files):
            done.setdefault(st, os.path.basename(uid_dir))
    return done


def ensure_collection_rules_note(rules):
    """C45：collection_rules 頂端加歷史註記（授權與來源核准的權威在 asset_policy）。
    原地改寫並保持 note 為第一鍵；已正確則回傳 False（冪等）。"""
    if rules.get(COLLECTION_RULES_NOTE_KEY) == COLLECTION_RULES_NOTE and list(rules)[0] == COLLECTION_RULES_NOTE_KEY:
        return False
    rebuilt = {COLLECTION_RULES_NOTE_KEY: COLLECTION_RULES_NOTE}
    rebuilt.update({k: v for k, v in rules.items() if k != COLLECTION_RULES_NOTE_KEY})
    rules.clear()
    rules.update(rebuilt)
    return True


def derived_download(item, hits, v1_shas, sf_done):
    """契約 8 download 欄：(a) coverage hit、(b) local_candidate.source_sha256 命中 imported-v1、
    (c) G51：sketchfab metadata downloaded 且檔在磁碟（見 sketchfab_downloaded_sts）。"""
    if item["asset_id"] in hits:
        return "done"
    cand = item["files"]["local_candidate"] if "files" in item else item["local_candidate"]
    if isinstance(cand, dict) and cand.get("source_sha256") in v1_shas:
        return "done"
    if item["asset_id"] in sf_done:
        return "done"
    return "todo"


def rederive_status_1_2(doc, hits, v1_shas, sf_done):
    """G50：對已遷移的 1.2 文件重推導 status.download 並確保 collection_rules 註記。
    回傳變更的 asset_id 清單（collection_rules 變更以 'collection_rules' 表示）。"""
    changed = []
    for a in doc.get("assets", []):
        new_dl = derived_download(a, hits, v1_shas, sf_done)
        if a["status"]["download"] != new_dl:
            a["status"]["download"] = new_dl
            changed.append(a["asset_id"])
    if ensure_collection_rules_note(doc["collection_rules"]):
        changed.append("collection_rules")
    return changed


def slugify(name_en):
    return re.sub(r"[^a-z0-9]+", "-", name_en.lower()).strip("-")


def migrate_asset(item, hits, v1_shas, sf_done):
    """1.1 平面物件 -> 1.2 巢狀物件（欄位對映表；新欄 null/false；output.threejs 採 V2 預設）。"""
    status_old = item["status"]
    out = {
        "asset_id": item["asset_id"],
        "identity": {
            "id": item["asset_id"],
            "slug": slugify(item["name_en"]),
            "name_zh": item["name_zh"],
            "name_en": item["name_en"],
            "aliases": [],
            "category": item["category_primary"],
            "subcategory": item["category_secondary"],
            "tags": list(item["clinical_tags"]),
        },
        "sandtray": {
            "phase": PHASE_MAP[item["phase"]],
            "priority": PRIORITY_MAP[item["priority"]],
            "priority_legacy": item["priority"],
            "symbolic_roles": list(item["clinical_tags"]),
            "therapeutic_contexts": [],
            "age_relevance": ["child", "adolescent", "adult"],
            "interaction": {
                "movable": None,
                "rotatable": None,
                "scalable": None,
                "color_variant": None,
                "pose_variant": None,
                "animation_required": None,
            },
        },
        "source": {
            "provider": item["source_platform"],
            "creator": item["author"],
            "asset_page_url": item["source_url"],
            "asset_name": item["source_asset_name"],
            "discovery": {
                "search_query": item["search_query"],
                "preferred_sources": list(item["preferred_sources"]),
                "fallback_sources": list(item["fallback_sources"]),
            },
        },
        "license": {
            "name": item["license"],
            "license_url": item["license_url"],
            "policy_notes": list(item["license_policy"]),
            "commercial_use": None,
            "modification_allowed": None,
            "attribution_required": None,
            "redistribution_allowed": None,
            "browser_delivery_safe": None,
            "standalone_file_risk": None,
            "verified": False,
            "verified_date": None,
        },
        "files": {
            "original_format": item["original_format"],
            "original_file_size_bytes": item["original_file_size_bytes"],
            "local_candidate": copy.deepcopy(item["local_candidate"]),
        },
        "geometry": {"triangles": item["triangles"]},
        "materials": {"textures": item["textures"]},
        "animation": {"animated": False, "clips": []},
        "visual": {
            "style": None,
            "preferred_style_match": None,
            "realism_level": None,
            "human_character": {
                "enabled": None,
                "apparent_age": None,
                "gender_presentation": None,
                "skin_tone_variants": None,
                "clothing_variants": None,
            },
        },
        "processing": {
            "needs_blender": None,
            "tasks": {k: None for k in PROCESSING_TASK_KEYS},
            "status": None,
            "assigned_agent": None,
        },
        "output": {
            "format": item["target_format"],
            "final_glb": item["target_path"],
            "thumbnail": item["thumbnail_path"],
            "checksum_sha256": item["checksum_sha256"],
            "performance": {
                "final_file_mb": (
                    round(item["optimized_file_size_bytes"] / 1048576.0, 2)
                    if item["optimized_file_size_bytes"] is not None else None
                ),
                "final_file_bytes": item["optimized_file_size_bytes"],
            },
            "threejs": {
                "scale": 1,
                "rotation": {"x": 0, "y": 0, "z": 0},
                "ground_offset": 0,
                "cast_shadow": True,
                "receive_shadow": True,
            },
        },
        "qa": {
            "license_pass": False,
            "visual_pass": False,
            "geometry_pass": False,
            "performance_pass": False,
            "threejs_pass": False,
            "mobile_pass": False,
            "reviewed_by": None,
            "notes": item["notes"],
        },
        "status": {
            "overall": status_old,
            "procurement": "done" if isinstance(item["local_candidate"], dict) else "todo",
            "download": derived_download(item, hits, v1_shas, sf_done),
            "optimization": "todo",
            "integration": "todo",
        },
    }
    if out["status"]["overall"] == "ready":
        raise ValueError(
            f"{item['asset_id']}: 遷移不得產生 ready（契約 8，ready 只能由非寫入者改）"
        )
    return out


def migrate(data, hits, v1_shas, sf_done):
    """回傳 (遷移/修正後文件, 是否有變更需寫入, 變更說明清單)。"""
    if data.get("schema_version") == "1.2":
        out = copy.deepcopy(data)
        changed = rederive_status_1_2(out, hits, v1_shas, sf_done)
        return out, bool(changed), changed
    if str(data.get("schema_version")) != "1.1":
        raise ValueError(f"預期 schema_version 1.1，得到 {data.get('schema_version')!r}")
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    out = {
        "schema_version": "1.2",
        "migration_note": (
            f"2026-09-19 T15 選項 B 由 tools/assets/migrate_seed_1_2.py 自 schema 1.1 遷移"
            f"（{now} Asia/Taipei）；id/裁定不變，1.1 可由 git 歷史回溯。"
        ),
        "id_namespace_note": data["id_namespace_note"],
        "project": {
            "name": data["project"],
            "asset_policy": build_asset_policy(),
        },
        "target_runtime": data["target_runtime"],
        "storage_target": data["storage_target"],
        "collection_rules": copy.deepcopy(data["collection_rules"]),
        "assets": [migrate_asset(it, hits, v1_shas, sf_done) for it in data["assets"]],
    }
    ensure_collection_rules_note(out["collection_rules"])
    return out, True, ["1.1->1.2 migration"]


# ---------------- 展平驗證（契約 2） ----------------

def flatten(obj, prefix=""):
    """把巢狀 dict/list 展平成 {路徑: 純量}（跳過 null）。list 以 [] 索引。"""
    leaves = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            leaves.update(flatten(v, f"{prefix}.{k}" if prefix else str(k)))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            leaves.update(flatten(v, f"{prefix}[{i}]"))
    elif obj is not None:
        leaves[prefix] = obj
    return leaves


def get_path(obj, path):
    cur = obj
    for part in re.findall(r"[^..\[\]]+|\[\d+\]", path):
        if part.startswith("["):
            cur = cur[int(part[1:-1])]
        else:
            cur = cur[part]
    return cur


def compare_item(old, new, idx):
    """回傳 (檢查數, [錯誤訊息])。以 1.1 非 null 葉為基準逐一對位。"""
    errors, checked = [], 0
    if old["asset_id"] != new["asset_id"]:
        errors.append(f"[{idx}] id 變更 {old['asset_id']} -> {new['asset_id']}")
        return 0, errors
    for key, value in old.items():
        if value is None:
            continue  # 只保證非 null 葉（契約 2）
        if key == "phase":
            checked += 1
            if new["sandtray"]["phase"] != PHASE_MAP[value]:
                errors.append(f"[{old['asset_id']}] phase 對位不符")
        elif key == "priority":
            checked += 1
            if new["sandtray"]["priority"] != PRIORITY_MAP[value]:
                errors.append(f"[{old['asset_id']}] priority 對位不符")
            elif new["sandtray"].get("priority_legacy") != value:
                errors.append(f"[{old['asset_id']}] priority_legacy 未保留原字串")
        elif key == "optimized_file_size_bytes":
            checked += 1
            perf = new["output"]["performance"]
            if perf.get("final_file_bytes") != value:
                errors.append(f"[{old['asset_id']}] final_file_bytes 對位不符")
        elif key in DUAL_MAP:
            for path in DUAL_MAP[key]:
                checked += 1
                if get_path(new, path) != value:
                    errors.append(f"[{old['asset_id']}] {key} -> {path} 對位不符")
        elif key in SIMPLE_MAP:
            checked += 1
            if get_path(new, SIMPLE_MAP[key]) != value:
                errors.append(f"[{old['asset_id']}] {key} -> {SIMPLE_MAP[key]} 對位不符")
        else:
            errors.append(f"[{old['asset_id']}] 未知 1.1 欄位 {key}（對映表缺項）")
    return checked, errors


def verify(old_doc, new_doc):
    old_assets = old_doc["assets"]
    new_assets = new_doc["assets"]
    old_ids = [a["asset_id"] for a in old_assets]
    new_ids = [a["asset_id"] for a in new_assets]
    errors = []
    if old_ids != new_ids:
        errors.append(f"asset_id 序列不一致：遺失 {set(old_ids)-set(new_ids)}、新增 {set(new_ids)-set(old_ids)}")
    checked_total = 0
    for i, (o, n) in enumerate(zip(old_assets, new_assets)):
        c, e = compare_item(o, n, i)
        checked_total += c
        errors.extend(e)
    # 1.2 不得把任何筆變 ready
    for n in new_assets:
        if n["status"]["overall"] == "ready":
            errors.append(f"[{n['asset_id']}] 違反契約 8：status.overall=ready")
    return checked_total, errors


def dump_yaml(data):
    return yaml.safe_dump(
        data, allow_unicode=True, sort_keys=False, default_flow_style=False, width=1000
    )


def main():
    ap = argparse.ArgumentParser(description="T15 seed 1.1 -> 1.2 migration")
    ap.add_argument("--input", default="assets_seed.yaml")
    ap.add_argument("--output", default=None, help="預設與 --input 相同（in-place）")
    ap.add_argument("--verify", nargs=2, metavar=("OLD", "NEW"))
    ap.add_argument("--check", action="store_true",
                    help="輸入為 1.2 時輸出必須逐位元組相同")
    args = ap.parse_args()

    if args.verify:
        with io.open(args.verify[0], encoding="utf-8") as f:
            old_doc = yaml.safe_load(f)
        with io.open(args.verify[1], encoding="utf-8") as f:
            new_doc = yaml.safe_load(f)
        checked, errors = verify(old_doc, new_doc)
        print(f"flatten-verify: 1.1 非 null 葉檢查 {checked} 項，遺失/不符 {len(errors)} 項")
        for e in errors[:20]:
            print("  " + e)
        sys.exit(1 if errors else 0)

    out_path = args.output or args.input
    with io.open(args.input, encoding="utf-8") as f:
        data = yaml.safe_load(f)

    migrated, did, changed = migrate(
        data, downloaded_hit_sts(), imported_v1_sha_set(), sketchfab_downloaded_sts()
    )
    serialized = dump_yaml(migrated)

    if args.check:
        with io.open(out_path, encoding="utf-8", newline="") as f:
            current = f.read()
        same = current == serialized
        print(f"idempotency-check: input schema={data.get('schema_version')!r}, "
              f"byte-identical={same}")
        sys.exit(0 if same else 1)

    if not did:
        print("input 已是 1.2 且 status/collection_rules 無需修正（無寫入）")
        sys.exit(0)

    if data.get("schema_version") == "1.2":
        # G50：1.2 in-place 修正（只動 status.download 與 collection_rules 註記），
        # 不適用 1.1 展平驗證；直接寫入並列出變更。
        with io.open(out_path, "w", encoding="utf-8", newline="") as f:
            f.write(serialized)
        n_done = sum(1 for a in migrated["assets"] if a["status"]["download"] == "done")
        n_proc = sum(1 for a in migrated["assets"] if a["status"]["procurement"] == "done")
        print(f"re-derived status: {len(changed)} entries changed {changed} "
              f"-> {out_path} (procurement=done {n_proc}, download=done {n_done})")
        sys.exit(0)

    # 寫輸出前先以「舊資料 vs 新資料」做展平驗證（不依賴磁碟上的舊檔）
    checked, errors = verify(data, migrated)
    print(f"flatten-verify: 1.1 非 null 葉檢查 {checked} 項，遺失/不符 {len(errors)} 項")
    for e in errors[:20]:
        print("  " + e)
    if errors:
        sys.exit(1)

    with io.open(out_path, "w", encoding="utf-8", newline="") as f:
        f.write(serialized)
    n_done = sum(1 for a in migrated["assets"] if a["status"]["download"] == "done")
    n_proc = sum(1 for a in migrated["assets"] if a["status"]["procurement"] == "done")
    print(f"migrated: {len(migrated['assets'])} assets -> {out_path} "
          f"(procurement=done {n_proc}, download=done {n_done})")


if __name__ == "__main__":
    main()
