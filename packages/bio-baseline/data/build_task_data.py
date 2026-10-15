#!/usr/bin/env python3
"""Build the arm-facing copy of METABRIC with ONE planted flaw.

Reads   <root>/clean/{clinical_patient,clinical_sample,clinical_attributes,expression_mrna}.tsv
Writes  <root>/arm/   same four files, flawed
        --key-out     JSON key of the flaw (goes into task/SEALED-ANSWER.md, never to arms)

What the flaw is, and why, is documented only in task/SEALED-ANSWER.md.

Deterministic: same clean input + same --seed/--fraction -> byte-identical output.
Fails closed: after writing, it checks that deleting the planted rows/columns from the arm
copy gives back the clean files byte for byte.
Standard library only.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import re
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "arms" / "lib"))
import operation
import seal  # noqa: E402  (decrypt the clean data if it has been sealed at rest)

FILES = ("clinical_patient.tsv", "clinical_sample.tsv", "clinical_attributes.tsv", "expression_mrna.tsv")
VALID_STATUS = {"0:LIVING", "1:DECEASED"}


def materialize_clean(root: Path) -> tuple[Path, Path | None]:
    """Return a directory holding plaintext clean/*.tsv. If clean is plaintext, that's clean/ itself
    (no temp). If it is sealed (clean/*.tsv.enc), decrypt into a throwaway dir the caller must remove."""
    clean = root / "clean"
    if (clean / "clinical_patient.tsv").exists():
        return clean, None
    tmp = Path(tempfile.mkdtemp(prefix="biobase-clean.", dir=operation.root()))
    try:
        for name in FILES:
            if seal.materialize(clean / name, tmp / name) is None:
                raise SystemExit(f"clean data missing (neither plaintext nor sealed): {clean / name}")
        return tmp, tmp
    except BaseException:
        shutil.rmtree(tmp)
        raise


def read_table(path: Path) -> tuple[list[str], list[list[str]]]:
    with path.open(encoding="utf-8", newline="\n") as fh:
        header = fh.readline().rstrip("\n").split("\t")
        rows = [line.rstrip("\n").split("\t") for line in fh if line.strip()]
    return header, rows


def write_lines(path: Path, lines: list[str]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as fh:
        for line in lines:
            fh.write(line + "\n")
    os.replace(tmp, path)


def eligible_samples(clean: Path) -> tuple[list[str], set[str]]:
    """Expression samples whose patient has usable overall-survival data; plus all used ids."""
    ph, prows = read_table(clean / "clinical_patient.tsv")
    sh, srows = read_table(clean / "clinical_sample.tsv")
    with (clean / "expression_mrna.tsv").open(encoding="utf-8") as fh:
        expr_samples = fh.readline().rstrip("\n").split("\t")[2:]
    pid, om, ost = ph.index("PATIENT_ID"), ph.index("OS_MONTHS"), ph.index("OS_STATUS")
    usable = set()
    for r in prows:
        try:
            ok = float(r[om]) >= 0 and r[ost] in VALID_STATUS
        except ValueError:
            ok = False
        if ok:
            usable.add(r[pid])
    sid, spid = sh.index("SAMPLE_ID"), sh.index("PATIENT_ID")
    s2p = {r[sid]: r[spid] for r in srows}
    elig = [s for s in expr_samples if s2p.get(s) in usable and s2p.get(s) == s]
    used = {r[pid] for r in prows} | set(s2p) | set(s2p.values()) | set(expr_samples)
    return elig, used


def choose(elig: list[str], used: set[str], fraction: float, seed: int) -> list[tuple[str, str]]:
    """Pick k source ids and, for each, an unused new id that blends in: in the SAME thousand-block
    as its source and WITHIN that block's observed id range. Because a copy keeps the source's whole
    clinical row (including COHORT) and MB blocks map to cohorts, a same-block new id keeps the
    id<->cohort relationship intact and never falls outside the real id range -- so the flaw cannot
    be spotted by id/cohort inspection, only by checking for duplicate profiles (as designed)."""
    rng = random.Random(seed)
    k = round(fraction * len(elig))
    sources = sorted(rng.sample(sorted(elig), k))
    used_nums = {int(m.group(1)) for u in used if (m := re.fullmatch(r"MB-(\d{4})", u))}
    by_block: dict[int, list[int]] = {}
    for x in used_nums:
        by_block.setdefault(x // 1000, []).append(x)
    # Per block, the free ids strictly inside the observed [min, max] of real ids in that block.
    free_in_block: dict[int, list[str]] = {}
    for b, xs in by_block.items():
        lo, hi = min(xs), max(xs)
        free_in_block[b] = [f"MB-{i:04d}" for i in range(lo, hi + 1) if i not in used_nums]
    taken: set[str] = set()
    pairs: list[tuple[str, str]] = []
    for s in sources:
        m = re.fullmatch(r"MB-(\d{4})", s)
        if not m:
            raise SystemExit(f"source id not in MB-#### form: {s}")
        b = int(m.group(1)) // 1000
        pool = [x for x in free_in_block.get(b, []) if x not in taken]
        if not pool:
            raise SystemExit(f"no free in-range id in block {b} for source {s}")
        nid = rng.choice(pool)
        taken.add(nid)
        pairs.append((nid, s))
    return pairs  # (new_id, source_id)


@operation.guarded
def build(root: Path, seed: int, fraction: float) -> dict:
    clean, cleanup = materialize_clean(root)   # clean/ itself, or a temp decrypt of the sealed data
    try:
        return _build(root, clean, seed, fraction)
    finally:
        if cleanup is not None:
            shutil.rmtree(cleanup)


def _build(root: Path, clean: Path, seed: int, fraction: float) -> dict:
    arm = root / "arm"
    arm.mkdir(parents=True, exist_ok=True)
    elig, used = eligible_samples(clean)
    pairs = choose(elig, used, fraction, seed)
    src_of = dict(pairs)

    # clinical_patient: copy source rows under the new id, sort by id
    ph, prows = read_table(clean / "clinical_patient.tsv")
    pid = ph.index("PATIENT_ID")
    by_id = {r[pid]: r for r in prows}
    out = list(prows)
    for new, src in pairs:
        r = list(by_id[src]); r[pid] = new; out.append(r)
    out.sort(key=lambda r: r[pid])
    write_lines(arm / "clinical_patient.tsv", ["\t".join(ph)] + ["\t".join(r) for r in out])

    sh, srows = read_table(clean / "clinical_sample.tsv")
    sid, spid = sh.index("SAMPLE_ID"), sh.index("PATIENT_ID")
    by_s = {r[sid]: r for r in srows}
    out = list(srows)
    for new, src in pairs:
        r = list(by_s[src]); r[sid] = new; r[spid] = new; out.append(r)
    out.sort(key=lambda r: (r[sid], r[spid]))
    write_lines(arm / "clinical_sample.tsv", ["\t".join(sh)] + ["\t".join(r) for r in out])

    (arm / "clinical_attributes.tsv").write_bytes((clean / "clinical_attributes.tsv").read_bytes())

    # expression: add identical columns under the new ids, columns sorted by id
    src_expr, dst_expr = clean / "expression_mrna.tsv", arm / "expression_mrna.tsv"
    tmp = dst_expr.with_suffix(".tsv.tmp")
    with src_expr.open(encoding="utf-8") as fin, tmp.open("w", encoding="utf-8", newline="\n") as fout:
        header = fin.readline().rstrip("\n").split("\t")
        samples = header[2:]
        col = {s: i for i, s in enumerate(samples)}
        final = sorted(samples + [n for n, _ in pairs])
        take = [col[src_of.get(s, s)] for s in final]
        fout.write("\t".join(header[:2] + final) + "\n")
        for line in fin:
            f = line.rstrip("\n").split("\t")
            vals = f[2:]
            fout.write("\t".join(f[:2] + [vals[j] for j in take]) + "\n")
    os.replace(tmp, dst_expr)

    verify_recoverable(clean, arm, {n for n, _ in pairs})
    return {
        "flaw": "duplicated-patients",
        "seed": seed,
        "fraction": fraction,
        "eligible_samples": len(elig),
        "n_duplicates": len(pairs),
        "pairs": [{"new_id": n, "source_id": s} for n, s in sorted(pairs)],
    }


def verify_recoverable(clean: Path, arm: Path, planted: set[str]) -> None:
    """Deleting the planted ids from arm/ must reproduce clean/ byte for byte."""
    for name in ("clinical_patient.tsv", "clinical_sample.tsv"):
        with (arm / name).open(encoding="utf-8") as fh:
            lines = fh.read().split("\n")
        kept = [ln for ln in lines if ln.split("\t", 1)[0] not in planted]
        if "\n".join(kept).encode() != (clean / name).read_bytes():
            raise SystemExit(f"verify failed: {name}")
    with (arm / "expression_mrna.tsv").open(encoding="utf-8") as fa, \
            (clean / "expression_mrna.tsv").open(encoding="utf-8") as fc:
        ha = fa.readline().rstrip("\n").split("\t")
        keep = [i for i, s in enumerate(ha) if s not in planted]
        if "\t".join(ha[i] for i in keep) != fc.readline().rstrip("\n"):
            raise SystemExit("verify failed: expression header")
        for la, lc in zip(fa, fc, strict=True):
            f = la.rstrip("\n").split("\t")
            if "\t".join(f[i] for i in keep) != lc.rstrip("\n"):
                raise SystemExit("verify failed: expression row")
    if (arm / "clinical_attributes.tsv").read_bytes() != (clean / "clinical_attributes.tsv").read_bytes():
        raise SystemExit("verify failed: clinical_attributes.tsv")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(Path.home() / ".omerta-bio" / "datasets" / "metabric"))
    ap.add_argument("--seed", type=int, default=20111020)
    ap.add_argument("--fraction", type=float, default=0.05)
    ap.add_argument("--key-out", required=True)
    a = ap.parse_args()
    key = build(Path(a.root), a.seed, a.fraction)
    Path(a.key_out).write_text(json.dumps(key, indent=2, sort_keys=True) + "\n")
    print(json.dumps({k: v for k, v in key.items() if k != "pairs"}, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
