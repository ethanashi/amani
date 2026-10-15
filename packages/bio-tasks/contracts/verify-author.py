"""Verify author artifacts against real staged bytes. Decrypted scratch is always removed."""
import os,sys,tempfile,json,shutil,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent
root=Path((HERE/'.staging-location').read_text())
os.environ['BIO_GRADING_ROOT']=str(root)
os.environ['PYTHONDONTWRITEBYTECODE']='1'
sys.path.insert(0,str(HERE.parent.parent/'bio-baseline/arms/lib'))
import seal
outcomes=[]
for task in json.loads((HERE/'index.json').read_text()):
 name=task['task'];source=HERE/name
 if len(sys.argv)>1 and name not in sys.argv[1:]:continue
 with tempfile.TemporaryDirectory(prefix='verify-contract-',dir=root) as td:
  dest=Path(td);(dest/'assets').mkdir()
  private=dest/'private.json';seal.open_to(source/'private.json.enc',private)
  if (source/'public.json').is_file():public=source/'public.json'
  else: public=dest/'public.json';seal.open_to(source/'public.json.enc',public)
  for file in (source/'assets').iterdir():
   if file.name.endswith('.sha256'):continue
   if file.suffix=='.enc':seal.open_to(file,dest/'assets'/file.name[:-4])
   else:shutil.copyfile(file,dest/'assets'/file.name)
  r=subprocess.run(['/opt/homebrew/opt/node@24/bin/node','--max-old-space-size=8000',str(HERE/'verify-author.ts'),name,str(root/name/'data'),str(public),str(private),str(dest/'assets')],capture_output=True,text=True)
  try: result=json.loads(r.stdout)
  except Exception: result={'task':name,'verified':False,'code':'verifier-unavailable'}
  outcomes.append(result);print(json.dumps(result),flush=True)
(HERE/'verification.json').write_text(json.dumps(outcomes,indent=2)+'\n')
if not all(x['verified'] for x in outcomes):sys.exit(1)
