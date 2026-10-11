from pathlib import Path
import json
from collections import Counter

root = Path(__file__).resolve().parents[1]
assets = json.loads((root / "specs/002-assets-100/catalog.planned.json").read_text(encoding="utf-8"))
rows = json.loads((root / "specs/001-sandtray/traceability.json").read_text(encoding="utf-8"))
assert len(assets) == 100
assert {a["assetId"] for a in assets} == {f"ST-{n:03d}" for n in range(1, 101)}
assert Counter(a["animationClass"] for a in assets) == {"H": 20, "M": 10, "S": 70}
assert sum(a["batch"] == "PILOT-10" for a in assets) == 10
assert all(a["status"] == "PLANNED" for a in assets)
assert {r["id"] for r in rows} == {f"REQ-{n:03d}" for n in range(1, 16)}
for row in rows:
    assert row["tasks"] and row["acceptance"] and row["contract"]
    assert row["status"] in {"NOT_IMPLEMENTED", "PARTIAL", "VERIFIED"}
    if row["status"] != "NOT_IMPLEMENTED":
        assert row["evidence"]
    for evidence in row["evidence"]:
        assert (root / evidence).is_file(), evidence
print("PASS: 100 planned assets, exact pilot set, 15 mappings and referenced evidence. No release claim.")
