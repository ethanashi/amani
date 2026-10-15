#!/usr/bin/env python3
"""Clone ignored dependencies into an existing fresh macOS worktree, without installs.

Both pinned Python environments are required. An alternate codec source may be
used when the main checkout has not provisioned it; its pins must match exactly.
"""
import argparse
from pathlib import Path
import shutil
import subprocess

GIB = 2**30
NODE_DEPS = ('node_modules', 'apps/amani-studio/node_modules', 'packages/omb-figures/node_modules')
RUNTIMES = (
    ('packages/bio-baseline', 'import numpy,scipy,pandas,statsmodels,lifelines'),
    ('packages/omb-investigate/format-runtime', 'import openpyxl,defusedxml,zipfile'),
)


def provision(source, target, *, codec_source=None, run=subprocess.run,
              free_bytes=lambda root: shutil.disk_usage(root).free):
    source, target = Path(source).resolve(), Path(target).resolve()
    codec_source = Path(codec_source).resolve() if codec_source else source
    if not target.is_dir() or source == target:
        raise RuntimeError('source and existing target worktrees must be distinct')

    def target_path(relative):
        candidate = target / relative
        if not candidate.resolve().is_relative_to(target):
            raise RuntimeError(f'target path escapes worktree: {candidate}')
        return candidate

    def pins(origin, relative):
        a, b = origin / relative, target_path(relative)
        if not a.is_file() or not b.is_file() or a.read_bytes() != b.read_bytes():
            raise RuntimeError(f'pinned dependency mismatch or missing file: {relative}')

    copies = []
    pins(source, 'pnpm-lock.yaml')
    pins(source, 'package.json')
    for relative in NODE_DEPS:
        directory = str(Path(relative).parent)
        if directory != '.':
            pins(source, f'{directory}/package.json')
        copies.append(((source / relative).resolve(), target_path(relative)))
    for relative, _ in RUNTIMES:
        origin = codec_source if relative.endswith('format-runtime') else source
        for filename in ('pixi.toml', 'pixi.lock'):
            pins(origin, f'{relative}/{filename}')
        runtime = origin / relative / '.pixi'
        binaries = ('python', 'R', 'Rscript') if relative.endswith('bio-baseline') else ('python',)
        for binary in binaries:
            if not (runtime / 'envs/default/bin' / binary).is_file():
                raise RuntimeError(f'pinned runtime executable is missing: {runtime / 'envs/default/bin' / binary}')
        copies.append((runtime.resolve(), target_path(f'{relative}/.pixi')))
    # Complete all validation before the first copy. Never overwrite a runtime
    # that an existing run may be using, including a dangling destination link.
    for origin, destination in copies:
        resolved = destination.resolve()
        if origin.is_relative_to(resolved) or resolved.is_relative_to(origin):
            raise RuntimeError(f'dependency source and destination overlap: {origin}; {destination}')
        if not origin.is_dir():
            raise RuntimeError(f'dependency source is missing: {origin}')
        if destination.exists() or destination.is_symlink():
            raise RuntimeError(f'fresh dependency destination required: {destination}')

    def disk():
        if free_bytes(target) < 40 * GIB:
            raise RuntimeError('dependency clone refused: less than 40 GiB free')

    for origin, destination in copies:
        disk()
        destination.parent.mkdir(parents=True, exist_ok=True)
        run(['/bin/cp', '-cR', str(origin), str(destination)], check=True, timeout=300)
    disk()
    for relative, imports in RUNTIMES:
        python = target / relative / '.pixi/envs/default/bin/python'
        run([str(python), '-I', '-c', imports], check=True, timeout=60)
    analysis = target / 'packages/bio-baseline/.pixi/envs/default/bin'
    run([str(analysis / 'R'), '--version'], check=True, timeout=60)
    run([str(analysis / 'Rscript'), '--vanilla', '-e', 'library(survival); library(data.table); stopifnot(1+1==2)'], check=True, timeout=60)
    return [str(destination) for _, destination in copies]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--target', type=Path, required=True)
    parser.add_argument('--codec-source', type=Path)
    options = parser.parse_args()
    for destination in provision(options.source, options.target, codec_source=options.codec_source):
        print(f'provisioned: {destination}')


if __name__ == '__main__':
    main()
