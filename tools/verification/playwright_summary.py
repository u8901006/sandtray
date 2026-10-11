"""Read Playwright terminal summary lines, never test names or expected error logs."""
import re

def parse_summary(text, expected):
    text=re.sub(r'\x1b\[[0-9;]*m','',text)
    counts={name:0 for name in ['passed','failed','skipped','flaky','interrupted']}
    for line in text.splitlines():
        match=re.fullmatch(r'\s*(\d+)\s+(passed|failed|skipped|flaky|interrupted)(?:\s+\([^\r\n]*\))?\s*',line)
        if match:counts[match[2]]=int(match[1])
    return {'status':'PASS' if counts['passed']==expected and not any(counts[k] for k in ['failed','flaky','interrupted']) else 'NEEDS_REVIEW',**counts}
