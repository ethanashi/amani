# External reference environment — not a product renderer

The task requested adjustText and marsilea in pinned matplotlib. They are installed and
exercised here, but the wheels failed the owner's strict product licence rule: NumPy's
libdivide is Zlib, and SciPy bundles GPL-runtime-exception/LGPL native libraries. The strict
gate deliberately refuses these; nothing under product `src/` invokes Python. All requested
product figures have fixed TypeScript implementations.

Recreate locally in this worktree only:

```sh
python3.14 -m venv packages/omb-figures/python/.venv
packages/omb-figures/python/.venv/bin/pip --cache-dir .bio-scratch/pip-cache install -r packages/omb-figures/python/requirements.lock
PW3B_REFERENCE=1 node node_modules/vitest/vitest.mjs run packages/omb-figures/test/matplotlib-reference.test.ts --maxWorkers=1
packages/omb-figures/python/.venv/bin/python packages/omb-figures/python/license_gate.py
```

The last command must exit 1 for this reference environment. It is not a product acceptance
waiver. No wheels or runtime binaries are committed. Python version used: 3.14.5, macOS arm64.
The lock pins every Python distribution. `LICENSES/python-dependencies.json` records licences;
`reports/python-license-audit.json` records native runtime findings as well as package metadata.

Determinism: fixed `svg.hashsalt`, text-preserving `svg.fonttype='none'`, and no Date metadata.
adjustText additionally gets NumPy seed 0 and iter_lim=100; no wall-clock stopping criterion.
Marsilea consumes the certified matrix order directly and does not add a dendrogram.
UMAP points are rasterized; labels remain text. Fonts use vendored Liberation files.
