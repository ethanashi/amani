"""Offline IAD contract repair. Regenerate from pinned caches, verify and reseal.
All plaintext scratch lives inside this package and is removed on every exit.
No original task bytes, task keys, other contracts or home directories are written.
"""
import json, os, shutil, subprocess, sys, tempfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
BASE=HERE.parent.parent/'bio-baseline'
TASKS=('iad1-brady-audit','iad2-brady-twin','iad3-browning-count')
location=HERE/'.staging-location'
summary_path=HERE/'.stage-summary.json'
if location.exists() or summary_path.exists():raise SystemExit('Existing author lease; refusing')
with tempfile.TemporaryDirectory(prefix='.iad-repair-',dir=HERE) as td:
 root=Path(td)
 env={**os.environ,'BIO_GRADING_ROOT':str(root),'PYTHONDONTWRITEBYTECODE':'1','VECLIB_MAXIMUM_THREADS':'1','AUTHOR_CONTRACT_OUTPUT':str(root/'contracts')}
 os.environ.update({k:env[k] for k in ('BIO_GRADING_ROOT','PYTHONDONTWRITEBYTECODE')})
 sys.path.insert(0,str(BASE/'arms/lib'))
 import seal
 seal.require_key()  # never create/replace a home key
 try:
  location.write_text(str(root));summary_path.write_text(json.dumps([{'task':t,'status':'staged'} for t in TASKS]))
  outcomes=[]
  for task in TASKS:
   subprocess.run([sys.executable,str(HERE.parent/'tasks'/task/'stage.py'),'--out',str(root/task),'--truth-out',str(root/(task+'.truth.json'))],env=env,check=True,capture_output=True)
   built=subprocess.run(['/opt/homebrew/opt/node@24/bin/node',str(HERE/'build-author.ts')],env={**env,'ONLY_TASK':task},capture_output=True,text=True)
   if built.returncode:
    errors=[line for line in built.stderr.splitlines() if line.startswith(('Error:', 'TypeError:', 'SyntaxError:'))]
    raise RuntimeError('Author build refused: '+('; '.join(errors) or 'unavailable'))
   dest=root/'contracts'/task;plain=root/(task+'.private-contract.json')
   result=subprocess.run(['/opt/homebrew/opt/node@24/bin/node',str(HERE/'verify-author.ts'),task,str(root/task/'data'),str(dest/'public.json'),str(plain),str(dest/'assets')],env=env,check=True,capture_output=True,text=True)
   outcomes.append(json.loads(result.stdout))
   encrypted=seal.seal_file(plain)
   shutil.move(encrypted,dest/'private.json.enc');Path(str(encrypted)+'.sha256').unlink();seal.sidecar(dest/'private.json.enc')
   # Authenticate the resealed envelope and compare its public binding before publishing.
   opened=json.loads(seal.open_bytes(dest/'private.json.enc'))
   if opened['content']['public_hash']!=json.loads((dest/'public.json').read_text())['hash']:raise RuntimeError('reseal binding mismatch')
  # Publish only after all three byte checks and seal round trips succeeded.
  index=json.loads((HERE/'index.json').read_text());verification=json.loads((HERE/'verification.json').read_text())
  for task in TASKS:
   dest=root/'contracts'/task
   for name in ('public.json','private.json.enc','private.json.enc.sha256'):shutil.copyfile(dest/name,HERE/task/name)
   for asset in (dest/'assets').iterdir():shutil.copyfile(asset,HERE/task/'assets'/asset.name)
   pub=json.loads((dest/'public.json').read_text())
   next(x for x in index if x['task']==task)['publicHash']=pub['hash']
   previous=next(x for x in verification if x['task']==task);previous.update(next(x for x in outcomes if x['task']==task))
  (HERE/'index.json').write_text(json.dumps(index,indent=2)+'\n');(HERE/'verification.json').write_text(json.dumps(verification,indent=2)+'\n')
  print('IAD contracts: 3 byte verified, 3 resealed and authenticated; source bytes unchanged.')
 finally:
  location.unlink(missing_ok=True);summary_path.unlink(missing_ok=True)
