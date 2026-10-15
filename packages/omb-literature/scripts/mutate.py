"""Targeted guard mutants. Runs only package tests, restores every exact file in finally."""
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[3]
os.chdir(root)
node = '/opt/homebrew/opt/node@24/bin/node'
command = [node, 'node_modules/vitest/vitest.mjs', 'run', 'packages/omb-literature', 'packages/omb-investigate/test/literature.test.ts', 'packages/omb-paper/test/literature.test.ts', '--maxWorkers=1']
mutants = [
 ('analysis-egress', 'packages/omb-literature/src/network.ts', "if (policy.role === 'analysis') throw new Error('non-model-egress: analysis has no network');", "if (policy.role === 'analysis') return new URL(raw);"),
 ('off-list-host', 'packages/omb-literature/src/network.ts', 'if (!ACADEMIC_HOSTS.includes(u.hostname))', 'if (false)'),
 ('one-shot-search', 'packages/omb-literature/src/network.ts', "mode === 'discovery' || mode === 'als'", 'true'),
 ('redirect-follow', 'packages/omb-literature/src/network.ts', "redirect: 'error'", "redirect: 'follow'"),
 ('injection-scan', 'packages/omb-literature/src/network.ts', "if (this.#policy.role === 'literature') scanSource(body);", ''),
 ('brief-hash', 'packages/omb-literature/src/brief.ts', 'canonicalSha256(body) !== sha256', 'false'),
 ('freeze-after-look', 'packages/omb-literature/src/brief.ts', "this.assertBeforePlan(); this.append('literature-frozen'", "this.append('literature-frozen'"),
 ('look-without-binding', 'packages/omb-literature/src/brief.ts', "throw new Error('look requires plan-bound frozen literature');", 'return;'),
 ('breadth', 'packages/omb-literature/src/ideas.ts', 'i.candidates.length < 6', 'i.candidates.length < 2'),
 ('angles', 'packages/omb-literature/src/ideas.ts', '.size < 4', '.size < 1'),
 ('held-out-export', 'packages/omb-literature/src/ideas.ts', "c.scope === 'public' && c.rung === 'exploratory'", "c.rung === 'exploratory'"),
 ('unjudged-novelty', 'packages/omb-literature/src/ideas.ts', "throw new Error('every returned novelty hit needs a judgment');", 'void 0;'),
 ('paper-brief-binding', 'packages/omb-paper/src/literature.ts', 'lockRequest.literatureBriefHash !== brief.sha256', 'false'),
]
baseline = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
if baseline.returncode:
 print(baseline.stdout); raise SystemExit('baseline failed; no mutants applied')
killed = []
for name, relative, before, after in mutants:
 file = root / relative
 original = file.read_bytes()
 source = original.decode()
 if source.count(before) != 1:
  raise SystemExit(f'{name}: expected exactly one mutation site')
 try:
  file.write_text(source.replace(before, after, 1))
  result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
  # Syntax/compiler failures are not guard kills. Each mutant must reach a failed assertion.
  caught = result.returncode != 0 and ('AssertionError' in result.stdout or 'FAIL ' in result.stdout) and 'Transform failed' not in result.stdout
  print(f'{name}: {"KILLED" if caught else "SURVIVED"}', flush=True)
  if caught: killed.append(name)
  else: print(result.stdout)
 finally:
  file.write_bytes(original)
print(f'{len(killed)}/{len(mutants)} guard mutants killed', flush=True)
raise SystemExit(0 if len(killed) == len(mutants) else 1)
