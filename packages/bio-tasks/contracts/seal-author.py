"""Seal drafts using the existing pilot v2 key. Never log or commit plaintext truth."""
import os,sys,json,shutil
from pathlib import Path
HERE=Path(__file__).resolve().parent
BASE=HERE.parent.parent/'bio-baseline'
root=Path((HERE/'.staging-location').read_text())
os.environ['BIO_GRADING_ROOT']=str(root)
os.environ['PYTHONDONTWRITEBYTECODE']='1'
sys.path[:0]=[str(BASE/'arms/lib'),str(BASE/'grading'),str(HERE.parent/'lib')]
import seal,grade
if len(sys.argv)>1 and sys.argv[1]=='prepare-w0':
 key=grade.read_key(BASE/'task/SEALED-ANSWER.md')
 if not key or not key.get('pairs'):raise SystemExit('warm-up truth unavailable')
 (root/'w0-venet.truth.json').write_text(json.dumps({'task':'w0-venet','pairs':key['pairs']}))
else:
 if not seal.require_key().is_file():raise SystemExit('existing pilot key required')
 for item in json.loads((HERE/'index.json').read_text()):
  task=item['task'];dest=HERE/task
  source=root/(task+'.private-contract.json')
  enc=seal.seal_file(source)
  shutil.move(enc,dest/'private.json.enc');shutil.move(str(enc)+'.sha256',dest/'private.json.enc.sha256')
  seal.sidecar(dest/'private.json.enc')
  if task=='w0-venet':
   # Source-visible IDs are protected at rest by the existing leakage policy.
   for file in [dest/'public.json',*[p for p in sorted((dest/'assets').iterdir()) if not p.name.endswith(('.enc','.sha256'))]]:
    scratch=root/('public-'+file.name)
    shutil.copyfile(file,scratch)
    enc=seal.seal_file(scratch);target=file.with_name(file.name+'.enc')
    shutil.move(enc,target);Path(str(enc)+'.sha256').unlink();seal.sidecar(target);file.unlink()
 print('19 private contracts sealed with the existing v2 pilot key; w0 public bundle encrypted separately.')
