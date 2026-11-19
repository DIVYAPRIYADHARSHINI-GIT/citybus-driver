"""Audit staged bytes without printing matched credentials. Does not read .env files.
Known synthetic test fixtures are not credentials for deployed accounts.
"""
from pathlib import Path
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = [
    ('private-key', re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')),
    ('github-token', re.compile(rb'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})')),
    ('vercel-token', re.compile(rb'vcp_[A-Za-z0-9_]{30,}')),
    ('aws-access-key', re.compile(rb'AKIA[0-9A-Z]{16}')),
    ('literal-jwt', re.compile(rb'eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{24,}')),
]

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

paths = [p.decode() for p in git('ls-files', '-z').split(b'\0') if p]
findings = []
large = []
for name in paths:
    path = Path(name)
    if any(p.startswith('.env') or p in ('node_modules', '.venv', '__pycache__', '.vercel', '.local') for p in path.parts) or name.endswith(('.db', '.sqlite', '.sqlite3', '.log', '.pem', '.key')):
        findings.append({'path': name, 'reason': 'forbidden tracked/staged path'})
        continue
    data = git('show', ':' + name)
    if len(data) > 50_000_000:
        large.append({'path': name, 'bytes': len(data)})
    if path.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp', '.pdf'):
        for label, pattern in PATTERNS:
            if pattern.search(data):
                findings.append({'path': name, 'reason': label})
        if path.name == 'environment.example':
            for line in data.decode('utf-8').splitlines():
                if re.match(r'\s*(JWT_SECRET|SECRET_KEY|ACCESS_TOKEN|REFRESH_TOKEN|API_KEY)\s*=\s*\S+', line):
                    findings.append({'path': name, 'reason': 'nonempty secret assignment in template'})

result = {'tracked_and_staged_files': len(paths), 'dotenv_files': sum(any(p.startswith('.env') for p in Path(n).parts) for n in paths), 'credential_pattern_findings': findings, 'files_over_50_MB': large, 'screenshots': sum(n.startswith('screenshots/') and n.endswith('.png') for n in paths), 'preserved_bug_images': sum(n.startswith('bugs/') and n.endswith('.png') for n in paths)}
print(json.dumps(result, indent=2))
sys.exit(1 if findings or large else 0)
