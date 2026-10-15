#!/usr/bin/env python3
"""Independent verifier for an installed tool pack (standard library only, Python >= 3.9).

  verify_toolpack.py DIR PROFILE [--lock LOCK]

Recomputes the tree hash of DIR -- sha256 over the sorted lines
"<octal mode> <sha256> <relative path>\\n" of every regular file -- and compares it with the
pinned hash for PROFILE in toolpack.lock.json. Prints the hash and exits 0 only on an exact
match. Any symlink, special file, unknown profile or unreadable lock exits 1 (fail closed).
This deliberately shares no code with the Node builder that wrote DIR.
"""
from __future__ import annotations

import hashlib
import json
import os
import stat
import sys
from pathlib import Path

PROFILES = ("checks", "full")
LOCK_SCHEMA = "omerta-bio/toolpack-lock@1"
DEFAULT_LOCK = Path(__file__).resolve().parent.parent / "toolpack.lock.json"


def tree_listing(root: Path) -> dict[str, str]:
    entries: dict[str, str] = {}
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        for name in list(dirnames):
            if (Path(dirpath) / name).is_symlink():
                raise ValueError(f"symlinked directory in tool pack: {Path(dirpath, name).relative_to(root)}")
        for name in filenames:
            p = Path(dirpath) / name
            st = os.lstat(p)
            if not stat.S_ISREG(st.st_mode):
                raise ValueError(f"non-regular file in tool pack: {p.relative_to(root)}")
            digest = hashlib.sha256(p.read_bytes()).hexdigest()
            entries[p.relative_to(root).as_posix()] = f"{st.st_mode & 0o777:o} {digest}"
    return entries


def tree_hash(entries: dict[str, str]) -> str:
    # Sort by UTF-16 code units like the Node builder; identical to byte order for ASCII paths.
    listing = "".join(f"{entries[rel]} {rel}\n" for rel in sorted(entries, key=lambda s: s.encode("utf-16-be")))
    return hashlib.sha256(listing.encode()).hexdigest()


def main(argv: list[str]) -> int:
    args = list(argv[1:])
    lock_path = DEFAULT_LOCK
    if "--lock" in args:
        i = args.index("--lock")
        if i + 1 >= len(args):
            print("--lock needs a value", file=sys.stderr)
            return 1
        lock_path = Path(args[i + 1])
        del args[i:i + 2]
    if len(args) != 2:
        print(__doc__, file=sys.stderr)
        return 1
    root, profile = Path(args[0]), args[1]
    if profile not in PROFILES:
        print(f"unknown tool pack profile {profile!r} (checks|full)", file=sys.stderr)
        return 1
    try:
        lock = json.loads(lock_path.read_text())
        pinned = lock["profiles"][profile]["sha256"]
        pinned_files = lock["profiles"][profile]["files"]
        if lock.get("schema") != LOCK_SCHEMA or not isinstance(pinned, str) or len(pinned) != 64:
            raise ValueError("bad lock")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"unreadable tool pack lock {lock_path}: {exc}", file=sys.stderr)
        return 1
    if root.is_symlink() or not root.is_dir():
        print(f"tool pack directory missing: {root}", file=sys.stderr)
        return 1
    try:
        entries = tree_listing(root)
    except (OSError, ValueError) as exc:
        print(f"refusing tool pack: {exc}", file=sys.stderr)
        return 1
    actual = tree_hash(entries)
    if actual != pinned:
        diff = sorted({rel for rel in set(entries) | set(pinned_files) if entries.get(rel) != pinned_files.get(rel)})
        print(f"refusing tool pack {profile}: hash {actual} != pinned {pinned}; differing: {', '.join(diff[:20])}",
              file=sys.stderr)
        return 1
    print(actual)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
