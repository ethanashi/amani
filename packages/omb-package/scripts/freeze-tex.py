#!/usr/bin/env python3
"""Freeze only fetched, length-verified resources from an immutable Tectonic bundle.
The upstream range-reader can append a failed response to its retry; repair mode
re-fetches such entries with a checked Content-Range and exact indexed length.
"""
import hashlib,json,sys,subprocess,tempfile,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
cache=root/'.cache/tectonic'
manifest=next((cache/'manifests').glob('*.txt'))
index={}
for line in (cache/'indexes'/manifest.name).read_text().splitlines():
 name,offset,size=line.rsplit(' ',2);index[name]=(int(offset),int(size))
url=(cache/'redirects'/manifest.name).read_text().strip()
entries={}
for line in manifest.read_text().splitlines():
 name,size,digest=line.rsplit(' ',2)
 if digest!='-':entries[name]=(int(size),digest)
files={}
for name,(size,digest) in sorted(entries.items()):
 p=cache/'files'/digest[:2]/digest[2:];data=p.read_bytes();offset,expected=index[name]
 if len(data)!=expected:
  assert sys.argv[1]=='repair',f'Corrupt download: {name} {len(data)} != {expected}'
  with tempfile.TemporaryDirectory(dir=cache) as tmp:
   out=Path(tmp)/'resource';headers=Path(tmp)/'headers'
   subprocess.run(['curl','-fsSL','--retry','2','--max-time','120','--max-filesize',str(expected),'--range',f'{offset}-{offset+expected-1}','-D',str(headers),url,'-o',str(out)],check=True)
   assert f'content-range: bytes {offset}-' in headers.read_text().lower()
   data=out.read_bytes()
  assert len(data)==expected
  digest=hashlib.sha256(data).hexdigest();p=cache/'files'/digest[:2]/digest[2:];p.parent.mkdir(exist_ok=True);p.write_bytes(data);entries[name]=(len(data),digest)
  print('Repaired',name,flush=True)
 files[name]=data
if sys.argv[1]=='repair':
 manifest.write_text(''.join(f'{n} {s} {d}\n' for n,(s,d) in sorted(entries.items())))
elif sys.argv[1] in ['freeze','extend']:
 if sys.argv[1]=='extend':
  previous=json.loads((root/'tectonic.lock.json').read_text())
  assert previous['bundle']['upstreamUrl']==url and previous['bundle']['upstreamDigest']==manifest.stem, 'extension must retain the immutable upstream pin'
  old=root/previous['bundle']['path']
  assert hashlib.sha256(old.read_bytes()).hexdigest()==previous['bundle']['sha256']
  with zipfile.ZipFile(old) as z:
   for row in previous['bundle']['resources']:
    data=z.read(row['name']);assert hashlib.sha256(data).hexdigest()==row['sha256']
    assert row['name'] not in files or files[row['name']]==data, 'existing resource changed'
    files[row['name']]=data
 rows=[{'name':n,'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for n,b in sorted(files.items())]
 root_hash=hashlib.sha256(json.dumps(rows,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 files['SHA256SUM']=(root_hash+'\n').encode()
 target=root/'vendor/tex';target.mkdir(exist_ok=True,parents=True)
 with zipfile.ZipFile(target/'pw9-bundle.zip','w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
  for name,data in sorted(files.items()):
   info=zipfile.ZipInfo(name,(2000,1,1,0,0,0));info.external_attr=0o644<<16;info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,data)
 pin={'schema':'omb/tectonic@1','version':subprocess.check_output([str(root/'.pixi/envs/default/bin/tectonic'),'--version'],text=True).strip(),'engineLicense':'MIT (dependencies retain their licenses)','sourceDateEpoch':946684800,'bundle':{'path':'vendor/tex/pw9-bundle.zip','sha256':hashlib.sha256((target/'pw9-bundle.zip').read_bytes()).hexdigest(),'resourceDigest':root_hash,'upstreamUrl':url,'upstreamDigest':manifest.stem,'bytes':(target/'pw9-bundle.zip').stat().st_size,'resources':rows}}
 (root/'tectonic.lock.json').write_text(json.dumps(pin,indent=2)+'\n')
 if 'lmroman10-regular.otf' in files:(root/'vendor/fonts/lmroman10-regular.otf').write_bytes(files['lmroman10-regular.otf'])
 print(f'Frozen {len(rows)} resources, {(target/"pw9-bundle.zip").stat().st_size} bytes')
else:raise ValueError('repair or freeze required')
