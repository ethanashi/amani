#!/usr/bin/env python3
"""Stage METABRIC (cBioPortal study brca_metabric) from the public cBioPortal REST API.

Writes, under --out (default ~/.omerta-bio/datasets/metabric):

  raw/       small API responses exactly as decoded (JSON), plus a JSONL log of every
             expression request (request body, sha256 + bytes of the decoded response).
  clean/     clinical_patient.tsv, clinical_sample.tsv, clinical_attributes.tsv,
             expression_mrna.tsv (genes x samples, log2 Illumina HT-12 v3 intensities
             as served by cBioPortal profile brca_metabric_mrna).

Expression responses are converted chunk by chunk and NOT kept raw (decoded JSON for all
genes would be ~12 GB); their sha256 and byte counts are logged so a re-download can be
compared. Re-running resumes: finished chunks under .parts/ are reused.

Standard library only. No login, no API key, no identifying headers.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://www.cbioportal.org/api"
STUDY = "brca_metabric"
PROFILE = "brca_metabric_mrna"
SAMPLE_LIST = "brca_metabric_mrna"
CHUNK = 250
UA = "omerta-bio-baseline-stager/1 (python-urllib)"


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def http(method: str, url: str, body: bytes | None = None, tries: int = 5) -> tuple[bytes, int]:
    """Return (decoded body, wire bytes). Retries transient failures with backoff."""
    last: Exception | None = None
    for attempt in range(tries):
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("Accept", "application/json")
        req.add_header("Accept-Encoding", "gzip")
        req.add_header("User-Agent", UA)
        if body is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                wire = resp.read()
                if resp.headers.get("Content-Encoding", "") == "gzip":
                    data = gzip.decompress(wire)
                else:
                    data = wire
                return data, len(wire)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:  # noqa: PERF203
            last = exc
            code = getattr(exc, "code", None)
            if code is not None and 400 <= int(code) < 500 and int(code) != 429:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError(f"{method} {url} failed after {tries} tries: {last}")


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def get_json(url: str, dest: Path, log: list[dict]) -> object:
    data, wire = http("GET", url)
    dest.write_bytes(data)
    log.append({"file": str(dest.name), "method": "GET", "url": url, "retrievedAt": utc_now(),
                "sha256": sha256(data), "bytes": len(data), "wireBytes": wire})
    return json.loads(data)


def tsv_escape(v: str) -> str:
    return v.replace("\t", " ").replace("\r", " ").replace("\n", " ")


def write_wide(path: Path, id_cols: list[str], rows: dict[tuple, dict[str, str]], attrs: list[str]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write("\t".join(id_cols + attrs) + "\n")
        for key in sorted(rows):
            vals = rows[key]
            fh.write("\t".join([*key, *[tsv_escape(vals.get(a, "NA")) for a in attrs]]) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path.home() / ".omerta-bio" / "datasets" / "metabric"))
    ap.add_argument("--max-wire-mb", type=float, default=1000.0, help="abort if download exceeds this")
    args = ap.parse_args()

    out = Path(args.out)
    raw = out / "raw"
    clean = out / "clean"
    parts = out / ".parts"
    for d in (raw, clean, parts):
        d.mkdir(parents=True, exist_ok=True)

    log: list[dict] = []
    started = utc_now()
    get_json(f"{API}/info", raw / "api_info.json", log)
    study = get_json(f"{API}/studies/{STUDY}", raw / "study.json", log)
    profiles = get_json(f"{API}/studies/{STUDY}/molecular-profiles", raw / "molecular_profiles.json", log)
    assert any(p["molecularProfileId"] == PROFILE for p in profiles), "expected mRNA profile missing"
    get_json(f"{API}/studies/{STUDY}/sample-lists", raw / "sample_lists.json", log)
    slist = get_json(f"{API}/sample-lists/{SAMPLE_LIST}", raw / "sample_list_mrna.json", log)
    attrs = get_json(f"{API}/studies/{STUDY}/clinical-attributes", raw / "clinical_attributes.json", log)
    pat = get_json(f"{API}/studies/{STUDY}/clinical-data?clinicalDataType=PATIENT&projection=SUMMARY&pageSize=10000000",
                   raw / "clinical_patient.json", log)
    smp = get_json(f"{API}/studies/{STUDY}/clinical-data?clinicalDataType=SAMPLE&projection=SUMMARY&pageSize=10000000",
                   raw / "clinical_sample.json", log)
    get_json(f"{API}/studies/{STUDY}/samples?projection=SUMMARY&pageSize=10000000", raw / "samples.json", log)
    genes = get_json(f"{API}/genes?projection=SUMMARY&pageSize=10000000", raw / "genes.json", log)

    # ---- clinical, wide format -------------------------------------------------------
    pat_attrs = sorted(a["clinicalAttributeId"] for a in attrs if a["patientAttribute"])
    smp_attrs = sorted(a["clinicalAttributeId"] for a in attrs if not a["patientAttribute"])
    prow: dict[tuple, dict[str, str]] = {}
    for r in pat:
        prow.setdefault((r["patientId"],), {})[r["clinicalAttributeId"]] = str(r["value"])
    srow: dict[tuple, dict[str, str]] = {}
    for r in smp:
        srow.setdefault((r["sampleId"], r["patientId"]), {})[r["clinicalAttributeId"]] = str(r["value"])
    write_wide(clean / "clinical_patient.tsv", ["PATIENT_ID"], prow, pat_attrs)
    write_wide(clean / "clinical_sample.tsv", ["SAMPLE_ID", "PATIENT_ID"], srow, smp_attrs)
    with (clean / "clinical_attributes.tsv").open("w", encoding="utf-8", newline="\n") as fh:
        fh.write("ATTRIBUTE_ID\tLEVEL\tDATATYPE\tDISPLAY_NAME\tDESCRIPTION\n")
        for a in sorted(attrs, key=lambda a: a["clinicalAttributeId"]):
            fh.write("\t".join([a["clinicalAttributeId"], "PATIENT" if a["patientAttribute"] else "SAMPLE",
                                a["datatype"], tsv_escape(a["displayName"]), tsv_escape(a.get("description", ""))]) + "\n")

    # ---- expression, chunked ---------------------------------------------------------
    sample_ids: list[str] = sorted(slist["sampleIds"])
    sidx = {s: i for i, s in enumerate(sample_ids)}
    gene_ids = sorted({int(g["entrezGeneId"]) for g in genes if int(g["entrezGeneId"]) > 0})
    symbol = {int(g["entrezGeneId"]): g["hugoGeneSymbol"] for g in genes}
    chunks = [gene_ids[i:i + CHUNK] for i in range(0, len(gene_ids), CHUNK)]
    url = f"{API}/molecular-profiles/{PROFILE}/molecular-data/fetch?projection=SUMMARY"
    chunk_log_path = raw / "expression_requests.jsonl"
    done: dict[int, dict] = {}
    if chunk_log_path.exists():
        for line in chunk_log_path.read_text().splitlines():
            rec = json.loads(line)
            if (parts / f"{rec['chunk']:04d}.tsv").exists():
                done[rec["chunk"]] = rec
    wire_total = sum(r["wireBytes"] for r in done.values())
    for ci, chunk in enumerate(chunks):
        if ci in done:
            continue
        body = json.dumps({"sampleListId": SAMPLE_LIST, "entrezGeneIds": chunk}, separators=(",", ":")).encode()
        data, wire = http("POST", url, body)
        wire_total += wire
        if wire_total > args.max_wire_mb * 1e6:
            raise SystemExit(f"download budget exceeded: {wire_total} bytes")
        recs = json.loads(data)
        byg: dict[int, list[str]] = {}
        for r in recs:
            if r["molecularProfileId"] != PROFILE or r["studyId"] != STUDY:
                raise SystemExit(f"unexpected record {r}")
            row = byg.setdefault(int(r["entrezGeneId"]), ["NA"] * len(sample_ids))
            j = sidx.get(r["sampleId"])
            if j is None:
                raise SystemExit(f"sample {r['sampleId']} not in sample list")
            v = r["value"]
            row[j] = "NA" if v is None else repr(float(v))
        tmp = parts / f"{ci:04d}.tsv.tmp"
        with tmp.open("w", encoding="utf-8", newline="\n") as fh:
            for gid in sorted(byg):
                fh.write("\t".join([symbol.get(gid, str(gid)), str(gid), *byg[gid]]) + "\n")
        os.replace(tmp, parts / f"{ci:04d}.tsv")
        rec = {"chunk": ci, "method": "POST", "url": url, "requestBodySha256": sha256(body),
               "firstEntrez": chunk[0], "lastEntrez": chunk[-1], "genesRequested": len(chunk),
               "genesReturned": len(byg), "records": len(recs), "retrievedAt": utc_now(),
               "sha256": sha256(data), "bytes": len(data), "wireBytes": wire}
        with chunk_log_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, sort_keys=True) + "\n")
        done[ci] = rec
        print(f"chunk {ci + 1}/{len(chunks)} genes={len(byg)} wire={wire_total / 1e6:.1f}MB", flush=True)

    expr = clean / "expression_mrna.tsv"
    tmp = expr.with_suffix(".tsv.tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write("\t".join(["Hugo_Symbol", "Entrez_Gene_Id", *sample_ids]) + "\n")
        for ci in range(len(chunks)):
            fh.write((parts / f"{ci:04d}.tsv").read_text(encoding="utf-8"))
    os.replace(tmp, expr)
    for p in parts.iterdir():
        p.unlink()
    parts.rmdir()

    summary = {"started": started, "finished": utc_now(), "studyImportDate": study.get("importDate"),
               "smallResponses": log, "expressionChunks": len(chunks),
               "expressionGenes": sum(r["genesReturned"] for r in done.values()),
               "expressionSamples": len(sample_ids), "wireBytesTotal": wire_total + sum(x["wireBytes"] for x in log)}
    (raw / "staging_log.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "smallResponses"}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
