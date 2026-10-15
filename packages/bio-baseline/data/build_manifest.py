#!/usr/bin/env python3
"""Write data/metabric.manifest.json: one entry per file under the dataset root.

Per file: {path, role, source, accession, url, retrievedAt, sha256, bytes, terms, derivedFrom?}
(the Block 2 manifest fields, plus path/role/derivation). Every regular file under raw/,
clean/ and arm/ is listed; any other file under the root makes this script refuse, so a
verifier that rejects extra files can be pointed at the root. Standard library only.

  python data/build_manifest.py [--root ~/.omerta-bio/datasets/metabric] [--out data/metabric.manifest.json]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

API = "https://www.cbioportal.org/api"
STUDY = "brca_metabric"
EXPR_URL = f"{API}/molecular-profiles/brca_metabric_mrna/molecular-data/fetch?projection=SUMMARY"
TERMS = ("Public cBioPortal study (no login, no click-through or data access agreement). "
         "De-identified data publicly released by the METABRIC consortium (Curtis et al. 2012, Nature; "
         "Pereira et al. 2016, Nat Commun; Rueda et al. 2019, Nature). cBioPortal asks users to cite the "
         "study publications and cBioPortal itself. Matches the Block 2 terms-registry allowed example "
         "'cBioPortal public studies'. Not controlled access. Stored outside git; not redistributed.")
SOURCE = "cBioPortal public REST API (https://www.cbioportal.org/api)"
DERIVED = {
    "clinical_patient.tsv": ["raw/clinical_patient.json", "raw/clinical_attributes.json"],
    "clinical_sample.tsv": ["raw/clinical_sample.json", "raw/clinical_attributes.json"],
    "clinical_attributes.tsv": ["raw/clinical_attributes.json"],
    "expression_mrna.tsv": ["raw/expression_requests.jsonl", "raw/sample_list_mrna.json", "raw/genes.json"],
}


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(Path.home() / ".omerta-bio" / "datasets" / "metabric"))
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent / "metabric.manifest.json"))
    a = ap.parse_args()
    root = Path(a.root)
    log = json.loads((root / "raw" / "staging_log.json").read_text())
    info = json.loads((root / "raw" / "api_info.json").read_text())
    by_file = {e["file"]: e for e in log["smallResponses"]}
    chunks = [json.loads(x) for x in (root / "raw" / "expression_requests.jsonl").read_text().splitlines()]
    expr_retrieved = max(c["retrievedAt"] for c in chunks)

    files = []
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        top = rel.split("/", 1)[0]
        if top not in ("raw", "clean", "arm") or p.name.startswith("."):
            raise SystemExit(f"unexpected file under dataset root: {rel}")
        e = {"path": rel, "role": top, "source": SOURCE, "accession": STUDY,
             "sha256": sha256_file(p), "bytes": p.stat().st_size, "terms": TERMS}
        if top == "raw":
            if p.name in by_file:
                e["url"] = by_file[p.name]["url"]
                e["retrievedAt"] = by_file[p.name]["retrievedAt"]
            elif p.name == "expression_requests.jsonl":
                e["url"] = EXPR_URL
                e["retrievedAt"] = expr_retrieved
                e["note"] = ("log of every expression request: request body hash, decoded-response sha256 "
                             "and bytes; responses converted to clean/expression_mrna.tsv, not kept")
            elif p.name == "staging_log.json":
                e["url"] = API
                e["retrievedAt"] = log["finished"]
                e["note"] = "staging summary written by data/stage_metabric.py"
            else:
                raise SystemExit(f"raw file without a logged request: {rel}")
        elif top == "clean":
            e["url"] = EXPR_URL if p.name == "expression_mrna.tsv" else by_file.get(
                {"clinical_patient.tsv": "clinical_patient.json", "clinical_sample.tsv": "clinical_sample.json",
                 "clinical_attributes.tsv": "clinical_attributes.json"}[p.name], {}).get("url", API)
            e["retrievedAt"] = expr_retrieved if p.name == "expression_mrna.tsv" else log["started"]
            e["derivedFrom"] = DERIVED[p.name]
            e["derivation"] = "data/stage_metabric.py (deterministic conversion, values as served)"
        else:
            e["url"] = EXPR_URL if p.name == "expression_mrna.tsv" else API
            e["retrievedAt"] = log["finished"]
            e["derivedFrom"] = [f"clean/{p.name}"]
            e["derivation"] = ("data/build_task_data.py --seed 20111020 --fraction 0.05 "
                               "(arm-facing copy; contents described only in task/SEALED-ANSWER.md)")
        files.append(e)

    manifest = {
        "schema": "omerta-bio dataset manifest v1",
        "dataset": "metabric",
        "source": SOURCE,
        "study_id": STUDY,
        "study_import_date": log.get("studyImportDate"),
        "portal_version": info.get("portalVersion"),
        "endpoints": sorted({e["url"] for e in log["smallResponses"]} | {EXPR_URL}),
        "retrievedAt": {"started": log["started"], "finished": log["finished"]},
        "download_wire_bytes": log["wireBytesTotal"],
        "expression": {"profile": "brca_metabric_mrna", "sample_list": "brca_metabric_mrna",
                       "genes": log["expressionGenes"], "samples": log["expressionSamples"],
                       "requests": log["expressionChunks"]},
        "storage_root": "~/.omerta-bio/datasets/metabric (outside git)",
        "terms": TERMS,
        "total_bytes_on_disk": sum(f["bytes"] for f in files),
        "files": files,
    }
    Path(a.out).write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(f"{len(files)} files, {manifest['total_bytes_on_disk']} bytes -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
