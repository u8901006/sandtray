from pathlib import Path
import json
from collections import Counter
root=Path(__file__).resolve().parents[1]
a=json.loads((root/'specs/002-assets-100/catalog.planned.json').read_text(encoding='utf-8'))
r=json.loads((root/'specs/001-sandtray/traceability.json').read_text(encoding='utf-8'))
assert len(a)==100
assert {x['assetId'] for x in a}=={f'ST-{n:03d}' for n in range(1,101)}
assert Counter(x['animationClass'] for x in a)=={'H':20,'M':10,'S':70}
assert sum(x['batch']=='PILOT-10' for x in a)==10
assert all(x['status']=='PLANNED' for x in a)
assert {x['id'] for x in r}=={f'REQ-{n:03d}' for n in range(1,16)}
assert all(x['acceptance'] and x['tasks'] and x['status']=='NOT_IMPLEMENTED' for x in r)
for f in ['AGENTS.md','START-IN-CODEX.md','STATUS.md','specs/master-plan.md']:
 assert (root/f).is_file(),f
print('PASS: handoff documents; 100 planned assets (20H/10M/70S), 10 pilot assets, 15 mapped requirements. Application tests have NOT run.')
