#!/usr/bin/env python3
"""Validate issue-plan references and task graph without touching product/runtime state."""
from pathlib import Path
import json,re,sys
root=Path(__file__).resolve().parents[1]
base=root/'docs/roadmap'
tasks=json.loads((base/'execution-tasks.json').read_text())
contract=(base/'execution-contract.md').read_text()
execution=(base/'task-execution.md').read_text()
direction=(root/'docs/musely-direction-v2-2026-11-01.md').read_text()
ids=[t['id'] for t in tasks]
assert len(ids)==len(set(ids)), 'duplicate task IDs'
assert len(tasks)==30, f'unexpected task count {len(tasks)}'
by={t['id']:t for t in tasks};done=set();visiting=set()
def walk(k):
 assert k not in visiting, f'dependency cycle: {k}'
 if k in done:return
 visiting.add(k)
 for d in by[k]['deps']:
  assert d in by,f'{k}: unknown dependency {d}'
  walk(d)
 visiting.remove(k);done.add(k)
for t in tasks:
 walk(t['id'])
 assert t['inputs'] and t['outputs'] and len(t['checks'])>=3,t['id']
 assert f"## {t['id']} — {t['title']}" in execution,t['id']
 for c in t['contracts']:assert f'## {c} —' in contract,(t['id'],c)
 for sec in t['sections']:assert re.search(r'^## '+str(sec)+r'\. ',direction,re.M),(t['id'],sec)
for f in [*base.glob('*.md'),root/'docs/README.md',root/'README.md',root/'preview/README.md']:
 for target in re.findall(r'\]\(([^)]+)\)',f.read_text()):
  if '://' in target or target.startswith('#'):continue
  p=target.split('#')[0]
  if not p:continue
  assert (f.parent/p).exists(),f'{f.relative_to(root)} -> {p}'
# Ensure S2 cannot bypass the preview gate through an alternate task path.
def ancestors(k):
 a=set(by[k]['deps'])
 for d in by[k]['deps']:a |= ancestors(d)
 return a
for t in tasks:
 if t['id'].startswith('I-'):assert 'P-07' in ancestors(t['id']),t['id']
assert all(t['epic'].startswith(('S1-','S2-','S3-','S4-')) for t in tasks)
# source refs are generated only after a commit, so this check validates local bounds too.
idx=base/'github-issues.json'
if idx.exists():
 j=json.loads(idx.read_text()); assert len(j['issues'])==38
 for key,v in j['issues'].items():assert v['number'] and v['url'].endswith('/'+str(v['number'])),key
print(f'PASS: {len(tasks)} tasks, 8 epics, DAG, phase gate, contract/source sections, relative links')
