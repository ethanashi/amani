#!/usr/bin/env python3
"""Deterministic source archive. No dynamic mtime, owner, host paths or intermediates."""
import gzip,hashlib,io,json,sys,tarfile,zipfile
from pathlib import Path
EPOCH=946684800
if sys.argv[1]=='archive':
 source,out=map(Path,sys.argv[2:]);raw=io.BytesIO()
 assert (source/'00README.json').is_file() and (source/'paper.tex').is_file() and (source/'paper.bbl').is_file(), 'incomplete arXiv source archive'
 with tarfile.open(fileobj=raw,mode='w',format=tarfile.USTAR_FORMAT) as tar:
  for p in sorted(source.rglob('*')):
   if not p.is_file():continue
   assert not p.is_symlink()
   name=p.relative_to(source).as_posix();assert p.suffix in ['.tex','.bbl','.bib','.pdf','.cls'] or name=='00README.json' or name in ['fonts/AmaniJournalSerif-Regular.ttf','fonts/AmaniJournalSerif-Bold.ttf','fonts/AmaniJournalSerif-Italic.ttf','fonts/lmsans10-regular.otf','fonts/lmsans10-bold.otf','fonts/OFL.txt','fonts/GUST-FONT-LICENSE.txt']
   if name=='00README.json':
    config=json.loads(p.read_text());assert config=={'spec_version':1,'process':{'compiler':'xelatex'},'sources':[{'filename':'paper.tex','usage':'toplevel'}],'texlive_version':2025,'stamp':False}
   data=p.read_bytes();info=tarfile.TarInfo(name);info.size=len(data);info.mtime=EPOCH;info.mode=0o644;info.uid=info.gid=0;info.uname=info.gname='';tar.addfile(info,io.BytesIO(data))
 with out.open('wb') as f:
  with gzip.GzipFile(filename='',mode='wb',fileobj=f,mtime=EPOCH,compresslevel=9) as z:z.write(raw.getvalue())
else:raise ValueError('unknown command')
