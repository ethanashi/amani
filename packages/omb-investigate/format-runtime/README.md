Host format codecs use Python, openpyxl (MIT) and defusedxml (PSF). Install with:

    pixi install --frozen --manifest-path packages/omb-investigate/format-runtime/pixi.toml

This environment is intentionally separate from packages/bio-baseline. Adding a
file codec must not invalidate numerical calibration records or alter a worker's
statistical libraries. Worker analyses retain their declared analysis runtime;
they can read ZIP/XLSX members with Python's zipfile and XML standard libraries.

The codec refuses formula workbooks (no trusted recalculation policy), duplicate
ZIP members, non-table ZIP members, and archives exceeding its expansion caps.
It never extracts archive paths. Format descriptors and source templates stay on
the host; only the transformed physical files enter practice mounts.

Fresh worktrees need both Python environments. To clone existing dependencies
without downloads on macOS, first create a new worktree, then run:

    python3 scripts/provision-worktree.py --source /path/to/main --target /path/to/new-worktree --codec-source /path/to/provisioned-codec-worktree

The codec source is optional when the main checkout already has that environment.
The helper requires identical lockfiles and manifests, fresh dependency destinations,
and at least 40 GiB free before each APFS clone. It then probes analysis and codec
imports using the target's pinned Python paths, plus R and its survival/data.table libraries.
Target paths must stay inside the new worktree; dependency sources and destinations must not overlap. It never changes an existing runtime.

## Local engine packaging

The source checkout uses this directory's pinned `.pixi` environment. Local app
and engine packaging may select an equivalent durable installation with
`AMANI_CODEC_RUNTIME=/absolute/path/to/.pixi/envs/default`. The installation root
must retain matching `pixi.lock` and `pixi.toml` files. Packaging ships those pins
and the notices, records the canonical external path and Python hash, and never
bundles the environment. Runtime verification refuses changed pins or Python
bytes; it does not search PATH or silently select another environment.
