#!/usr/bin/env python3
"""Upload a commit's objects in small pieces, for links where one large push times out (HTTP 408).

    push-chunked.py upload CLONE     # push HEAD's subtrees as temporary tags refs/tags/_upload-NNN
    push-chunked.py cleanup CLONE    # delete every remote tag named _upload-*

`upload` walks HEAD's tree and pushes each subtree of about 3.5 MB (compressed) or less as a lightweight
tag that points at the tree object. The remote then already has those objects, so the single push of the
branch that follows is small. `cleanup` removes exactly the temporary tags; the objects stay because the
branch now reaches them. Nothing here rewrites history, and it never touches a ref outside refs/tags/_upload-*.
"""
import subprocess
import sys

LIMIT = 3.5 * 1048576
PREFIX = 'refs/tags/_upload-'


def git(clone, *args):
    return subprocess.run(['git', '-C', clone, *args], capture_output=True)


def size(clone, path):
    archive = subprocess.Popen(['git', '-C', clone, 'archive', 'HEAD', path], stdout=subprocess.PIPE)
    gz = subprocess.run(['gzip', '-1'], stdin=archive.stdout, capture_output=True)
    archive.wait()
    return len(gz.stdout)


def children(clone, path):
    args = ['ls-tree', 'HEAD'] + ([path + '/'] if path else [])
    for line in git(clone, *args).stdout.decode().splitlines():
        meta, name = line.split('\t', 1)
        _mode, kind, sha = meta.split()
        yield kind, sha, name


def collect(clone, path, chunks):
    for kind, sha, name in children(clone, path):
        if kind != 'tree':
            continue
        total = size(clone, name)
        has_subtrees = any(k == 'tree' for k, _s, _n in children(clone, name))
        if total > LIMIT and has_subtrees:
            collect(clone, name, chunks)
        else:
            chunks.append((name, sha, total))


def upload(clone):
    chunks = []
    collect(clone, '', chunks)
    print(f'{len(chunks)} chunks, {sum(c[2] for c in chunks) / 1048576:.1f} MB', flush=True)
    for i, (name, sha, total) in enumerate(chunks):
        tag = f'{PREFIX}{i:03d}'
        for _attempt in range(4):
            result = git(clone, '-c', 'http.version=HTTP/1.1', 'push', 'origin', f'{sha}:{tag}')
            if result.returncode == 0:
                break
        print(f'{tag} {name} {total / 1048576:.1f}MB rc={result.returncode}', flush=True)
        if result.returncode != 0:
            sys.stderr.write(result.stderr.decode()[-300:])
            return 1
    return 0


def cleanup(clone):
    listing = git(clone, 'ls-remote', '--tags', 'origin').stdout.decode().splitlines()
    refs = [line.split('\t')[1] for line in listing if line.split('\t')[1].startswith(PREFIX)]
    for ref in refs:
        result = git(clone, '-c', 'http.version=HTTP/1.1', 'push', 'origin', f':{ref}')
        if result.returncode != 0:
            sys.stderr.write(result.stderr.decode()[-300:])
            return 1
    print(f'{len(refs)} temporary tag(s) removed')
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('upload', 'cleanup'):
        sys.exit(__doc__)
    sys.exit((upload if sys.argv[1] == 'upload' else cleanup)(sys.argv[2]))
