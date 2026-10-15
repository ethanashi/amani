"""Author preparation only. Private scratch outside all worker mounts; no plaintext is logged."""
import os, sys, tempfile, subprocess, json, csv
from pathlib import Path
PKG=Path(__file__).resolve().parent.parent
BASE=PKG.parent/'bio-baseline'
root=Path(tempfile.mkdtemp(prefix='k1b-author-', dir=Path.home()/'.omerta-bio/grading'))
Path(__file__).with_name('.staging-location').write_text(str(root))
os.environ['BIO_GRADING_ROOT']=str(root)
os.environ['PYTHONDONTWRITEBYTECODE']='1'
os.environ['VECLIB_MAXIMUM_THREADS']='1'
summary=[]
for task in sorted((PKG/'tasks').iterdir()):
 if not (task/'stage.py').is_file(): continue
 out=root/task.name
 r=subprocess.run([str(BASE/'.pixi/envs/default/bin/python'),str(task/'stage.py'),'--out',str(out),'--truth-out',str(root/(task.name+'.truth.json'))],env=os.environ,capture_output=True)
 if r.returncode: summary.append({'task':task.name,'status':'unavailable','exit':r.returncode});continue
 tables=[]
 for p in sorted((out/'data').iterdir()):
  if p.suffix not in ('.csv','.tsv'):continue
  with p.open() as f:
   reader=csv.reader(f,delimiter='\t' if p.suffix=='.tsv' else ',')
   header=next(reader);n=sum(1 for _ in reader)
  tables.append({'file':p.name,'header':header[:22],'width':len(header),'rows':n})
 summary.append({'task':task.name,'status':'staged','tables':tables})
Path(__file__).with_name('.stage-summary.json').write_text(json.dumps(summary,indent=2))
print(json.dumps({'staged':sum(x['status']=='staged' for x in summary),'unavailable':[x['task'] for x in summary if x['status']!='staged']}))
