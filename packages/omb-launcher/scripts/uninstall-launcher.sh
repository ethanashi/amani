#!/bin/sh
set -eu
[ "$(/usr/bin/id -u)" = 0 ] || exit 77
[ "$#" = 0 ] || exit 64
# Deliberately preserve authority, users and stage/scratch for owner inspection.
exec /usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin HOME=/var/empty LANG=C /usr/bin/python3 -I -S - <<'PY'
import os,pathlib,shutil,subprocess
p=pathlib.Path('/etc/sudoers.d/omb-launcher')
if p.exists() or p.is_symlink(): p.unlink()
subprocess.run(['/usr/sbin/visudo','-c'],check=True)
p=pathlib.Path('/usr/local/libexec/omb')
if p.is_symlink(): raise RuntimeError('Unexpected installation symlink; inspect manually')
if p.exists():
 for parent in [p,*p.parents]:
  s=parent.lstat()
  if s.st_uid!=0 or s.st_mode & 0o022 or parent.is_symlink(): raise RuntimeError('Unsafe installation parent')
 shutil.rmtree(p)
print('Delegation and launcher removed. Authority data and service users were not changed.')
PY
