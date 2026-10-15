"""Analyst-tree metadata is part of the public protocol, never a free host channel."""
import os
import shutil
import stat
from pathlib import Path
from . import xattrs
from ..paths import PKG

FILES = frozenset({'TASK.md', 'DATA-CONTRACT.json', 'manifest.json', 'data/summary.tsv', 'data/ld.tsv', 'data/gene-aliases.tsv', 'data/variant-aliases.tsv'})
# Kernel-owned provenance is not portable across checkouts/processes. Ignore it on
# both sides; all user-settable xattrs are removed and refused.
_PROVENANCE = 'com.apple.provenance'
FIXED_XATTRS = {}


def attributes(path):
    return {name: xattrs.get(path, name) for name in xattrs.names(path) if name != _PROVENANCE}


MTIME_NS = 946684800000000000  # 2000-01-01 UTC, independent of key, truth and wall time.


def entries(root, files=FILES):
    """lstat before descending or opening: no follow-symlinks and no FIFO reads."""
    root = Path(root)
    directories = {'.', *{str(p) for f in files for p in Path(f).parents if str(p) != '.'}}
    expected = directories | set(files)
    found = set()
    pending = [root]
    while pending:
        path = pending.pop()
        name = path.relative_to(root).as_posix()
        s = path.lstat()
        found.add(name)
        directory = name in directories
        if name not in expected or not (stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)):
            raise ValueError('analyst entry allowlist')
        if not directory and s.st_nlink != 1:
            raise ValueError('analyst hardlink refused')
        yield path, s, directory
        if directory:
            pending.extend(path.iterdir())
    if found != expected:
        raise ValueError('analyst entries missing')


def normalize(root, files=FILES):
    paths = list(entries(root, files))
    for path, _, directory in paths:
        if hasattr(os, "chflags"):
            os.chflags(path, 0, follow_symlinks=False)
        for name in xattrs.names(path):
            if name != _PROVENANCE:
                xattrs.remove(path, name)
        path.chmod(0o755 if directory else 0o644)
        os.utime(path, ns=(MTIME_NS, MTIME_NS), follow_symlinks=False)


def verify_metadata(root, files=FILES):
    for path, s, directory in entries(root, files):
        if (stat.S_IMODE(s.st_mode) != (0o755 if directory else 0o644) or s.st_mtime_ns != MTIME_NS or
                getattr(s, "st_flags", 0) != 0 or attributes(path) != FIXED_XATTRS):
            raise ValueError('analyst metadata changed')


def copy_analyst(source, dest, files=FILES):
    verify_metadata(source, files)
    # Never copystat directories: BSD flags are a data channel too.
    dest = Path(dest)
    dest.mkdir()
    for path, _, directory in entries(source, files):
        target = dest / path.relative_to(source)
        if directory:
            target.mkdir(exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
    normalize(dest, files)
    verify_metadata(dest, files)
