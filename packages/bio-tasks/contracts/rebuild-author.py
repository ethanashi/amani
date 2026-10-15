"""Offline, author-only regeneration. Requires the pinned pilot caches and existing seal key.
Run with bio-baseline's pinned Python. Never mount this source tree into an analyst.
"""
import os,subprocess,sys,shutil
from pathlib import Path
HERE=Path(__file__).resolve().parent
location=HERE/'.staging-location'
if location.exists():raise SystemExit('An author staging lease already exists; finish or clean it first.')
env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'}
try:
 for args in ([sys.executable,str(HERE/'stage-author.py')],
              [sys.executable,str(HERE/'seal-author.py'),'prepare-w0'],
              ['/opt/homebrew/opt/node@24/bin/node','--max-old-space-size=12000',str(HERE/'build-author.ts')],
              [sys.executable,str(HERE/'seal-author.py')],
              [sys.executable,str(HERE/'verify-author.py')]):
  subprocess.run(args,env=env,check=True)
finally:
 if location.exists():
  root=Path(location.read_text()).resolve()
  allowed=(Path.home()/'.omerta-bio/grading').resolve()
  if root.parent==allowed and root.name.startswith('k1b-author-'):shutil.rmtree(root,ignore_errors=True)
  else:raise RuntimeError('unexpected author scratch path; refusing cleanup')
  location.unlink()
 (HERE/'.stage-summary.json').unlink(missing_ok=True)
