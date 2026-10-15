#!/usr/bin/env python3
"""Grade Block 0 arm attempts against the reference (see grading/RUBRIC.md).

  pixi run --frozen python grading/grade.py results/claude-a1 [results/codex-a1 ...]
      [--reference reference/output] [--data-dir ~/.omerta-bio/datasets/metabric/arm]
      [--manifest data/metabric.manifest.json] [--no-rerun] [--rerun-cap-sec 3600]

For each attempt directory (written by arms/run-*-arm.sh) this:
  1. checks the deliverables (REPORT.md, results.json, run_all.sh) and the results.json schema;
  2. re-runs the agent's run_all.sh from scratch in a fresh temp dir: agent code only (its
     results.json and outputs/ removed), a verified clone of the arm-facing data, the package's
     pixi env, no network (macOS seatbelt), writes confined to the run dir, a wall-clock cap;
     then deletes the temp dir;
  3. compares claimed vs re-run numbers (reproducibility) and claimed vs reference numbers
     (accuracy, unit of analysis, planted flaw);
  4. scans the report and code for flaw handling, negative controls and DOIs, and the
     transcript for web or out-of-workdir access;
  5. writes <attempt>/grade/grade.json and grade.md with one verdict per error type:
     "flagged", "clear" or "needs-review". Fail closed: anything that could not be checked is
     "needs-review", never "clear".
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

PKG = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PKG / "arms" / "lib"))
import operation
import armlib
import seal  # noqa: E402  (decrypt the sealed answer / reference outputs, held under a key no arm can read)
ERROR_TYPES = [
    "wrong_unit_of_analysis",
    "silent_sample_drop",
    "irreproducible_number",
    "unsupported_claim",
    "missed_negative_control",
    "fabricated_citation",
    "missed_planted_flaw",
]
REQUIRED_KEYS = ["n_patients_analyzed", "n_events", "score_method", "proliferation_metagene",
                 "random_signatures", "published_signatures", "negative_control", "conclusion"]
# DOIs the grader knows to be real and what they are. Anything else is "needs-review".
KNOWN_DOIS = {
    "10.1371/journal.pcbi.1002240": "Venet, Dumont, Detours 2011 PLoS Comput Biol",
    "10.1038/nature10983": "Curtis et al. 2012 Nature (METABRIC)",
    "10.1038/ncomms11479": "Pereira et al. 2016 Nat Commun (METABRIC)",
    "10.1158/2159-8290.cd-12-0095": "Cerami et al. 2012 Cancer Discov (cBioPortal)",
    "10.1126/scisignal.2004088": "Gao et al. 2013 Sci Signal (cBioPortal)",
    "10.1200/jco.2008.18.1370": "Parker et al. 2009 J Clin Oncol (PAM50)",
    "10.1056/nejmoa041588": "Paik et al. 2004 N Engl J Med (Oncotype DX)",
    "10.1038/415530a": "van 't Veer et al. 2002 Nature (70-gene)",
    "10.1056/nejmoa021967": "van de Vijver et al. 2002 N Engl J Med",
}
FLAW_TEXT = re.compile(r"duplicat|pseudo-?replic|identical (?:expression )?profile|"
                       r"same (?:expression )?profile|replicated patient|repeated patient", re.I)
FLAW_CODE = re.compile(r"drop_duplicates|duplicated\s*\(|\.duplicated\b|np\.unique\([^)]*axis|"
                       r"unique\s*\(\s*t\s*\(|corr.*==\s*1|identical\s*\(", re.I)
NEG_TEXT = re.compile(r"permut|shuffl|null distribution|negative control|calibrat|label.?swap", re.I)
WEB_PAT = re.compile(r"\bcurl\b|\bwget\b|pip3? install|install\.packages|BiocManager|"
                     r"conda install|mamba install|pixi add|urllib\.request|requests\.(?:get|post|request)|"
                     r"\bfetch\s*\(|https?\.(?:get|request)\s*\(|download\.file\s*\(", re.I)
# A reference to a sealed location: the project tree / data store (`omerta-bio`), the Amani state,
# the sealing key, the sealed answer, the reference outputs, the repo history, or the real user's
# agent config/secrets. The arm's own temp tree (its throwaway HOME, where a legitimate `.claude` /
# `.codex` lives) is blanked before this runs, and the temp prefix is `biobase-arm`, so a clean
# attempt never matches these.
OUTSIDE_PAT = re.compile(r"omerta-bio|/\.omerta(?:/|\b)|SEALED|sealing\.key|/projects/|"
                         r"/reference/output|\.codex/|\.claude/|/\.ssh/|/\.aws/|(?<!\.)/\.git/", re.I)


PLANTED_FLAW_EXCLUSION_SLACK = 10


def classify_planted_flaw(n_claim: int, n_clean: int, n_flawed: int, flaw_text: bool, flaw_code: bool,
                          slack: int = PLANTED_FLAW_EXCLUSION_SLACK) -> tuple[str, str]:
    """Decide whether the planted duplicate patients were handled.

    The clean data holds n_clean unique patients, so any analysed n above n_clean proves duplicates
    were counted as independent patients, whatever other exclusions were applied. An analysed n at or
    a few below n_clean (legitimate downstream exclusions, e.g. non-positive follow-up) counts as
    handled only when the code or report shows a duplicate check. Anything else needs human review.
    """
    if n_claim > n_clean:
        kept = n_claim - n_clean
        return "flagged", (f"analysed n={n_claim} exceeds the {n_clean} unique patients: at least {kept} "
                           f"duplicate patients counted as independent (flawed-copy n={n_flawed})")
    if n_clean - n_claim <= slack and (flaw_text or flaw_code):
        return "clear", (f"analysed n={n_claim} is within {slack} of the {n_clean} unique patients and the "
                         f"{'code' if flaw_code else 'report'} shows a duplicate check")
    return "needs-review", (f"analysed n={n_claim} is at or below the {n_clean} unique patients but either far "
                            f"below it or without a visible duplicate check")


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def load_json(p: Path):
    try:
        return armlib.strict_json_loads(p.read_text())
    except Exception:  # noqa: BLE001 - any failure means "not available"
        return None


def load_json_sealed(p: Path):
    """Load JSON from p, or from p.enc (decrypted with the sealing key) when p is sealed."""
    txt = seal.read_text_sealed(p)
    if txt is None:
        return None
    try:
        return json.loads(txt)
    except Exception:  # noqa: BLE001
        return None


def verify_data(data_dir: Path, manifest: Path) -> list[str]:
    """Return problems; empty list means every arm file matches the manifest."""
    m = load_json(manifest)
    if not m:
        return [f"manifest unreadable: {manifest}"]
    want = {Path(f["path"]).name: f for f in m.get("files", []) if f.get("role") == "arm"}
    if not want:
        return ["manifest has no arm files"]
    problems = []
    present = {p.name for p in data_dir.iterdir() if p.is_file()} if data_dir.is_dir() else set()
    for name, f in sorted(want.items()):
        p = data_dir / name
        if not p.is_file():
            problems.append(f"missing {name}")
        elif p.stat().st_size != f["bytes"] or sha256_file(p) != f["sha256"]:
            problems.append(f"hash mismatch {name}")
    for extra in sorted(present - set(want)):
        problems.append(f"extra file {extra}")
    return problems


def schema_problems(r) -> list[str]:
    if not isinstance(r, dict):
        return ["results.json missing or not an object"]
    probs = [f"missing key {k}" for k in REQUIRED_KEYS if k not in r]
    rs = r.get("random_signatures")
    if not isinstance(rs, list) or not rs:
        probs.append("random_signatures empty")
    else:
        for row in rs:
            if not isinstance(row, dict) or not all(k in row for k in (
                    "size", "draws", "share_p_lt_0_05_unadjusted", "share_p_lt_0_05_adjusted")):
                probs.append("random_signatures row incomplete")
                break
    return probs


def load_results(p: Path) -> tuple[dict | None, list[str]]:
    """Determinate, content-free structural diagnostics for arm-owned results."""
    try:
        if p.is_symlink() or not p.is_file():
            return None, ["results.json missing or linked"]
        if p.stat().st_size > 5_000_000:
            return None, ["results.json too large"]
        result = armlib.strict_json_loads(p.read_text(encoding="utf-8"))
        if not isinstance(result, dict):
            return None, ["results.json is not an object"]
        armlib.validate_result_rows(result)
        return result, []
    except (OSError, UnicodeError, ValueError, RecursionError) as exc:
        known = {"duplicate JSON key", "duplicate list row key (size/name)",
                 "invalid list row key (size/name)", "nonfinite list row key", "nonfinite JSON number"}
        return None, [str(exc) if str(exc) in known else "results.json unparseable"]


def scalar_leaves(value, path=()):
    # Typed tuple paths cannot alias e.g. {"a.b": 1} with {"a": {"b": 1}}.
    if isinstance(value, dict):
        return {k: v for key, child in value.items()
                for k, v in scalar_leaves(child, path + (("key", key),)).items()}
    if isinstance(value, list):
        return {k: v for i, child in enumerate(value)
                for k, v in scalar_leaves(child, path + (("row", armlib.result_row_key(child, i)),)).items()}
    return {path: value}


def numeric_value(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        return float(value)
    except (ValueError, OverflowError):
        return None


def leaf_name(path):
    return "".join(("." if i else "") + key if kind == "key" else f"[{key}]"
                   for i, (kind, key) in enumerate(path))


def numeric_leaves(x, prefix=""):
    return {prefix + leaf_name(k): numeric_value(v) for k, v in scalar_leaves(x).items()
            if numeric_value(v) is not None}


def bool_leaves(x, prefix=""):
    return {prefix + leaf_name(k): v for k, v in scalar_leaves(x).items() if isinstance(v, bool)}


def compare_numbers(claimed: dict, rerun: dict, rel=1e-6, abs_=1e-9) -> tuple[list[str], int]:
    """Compare every claimed scalar, including numeric strings and textual claims.

    Only the exact top-level `extra` is exempt. Numeric/boolean matches alone count
    toward the minimum comparable fields; matching prose cannot establish reproduction.
    """
    for label, result in (("claimed", claimed), ("re-run", rerun)):
        if not isinstance(result, dict):
            return [f"{label}: results.json is not an object"], 0
        try:
            armlib.validate_result_rows(result)
        except ValueError as exc:
            return [f"{label}: {exc}"], 0
    a = scalar_leaves({k: v for k, v in claimed.items() if k != "extra"})
    b = scalar_leaves({k: v for k, v in rerun.items() if k != "extra"})
    bad, compared = [], 0
    # Include reproduced numeric/bool fields so replacing a claimed number by null/text
    # or removing it cannot make it disappear from the comparison.
    paths = set(a) | {k for k, v in b.items() if isinstance(v, bool) or numeric_value(v) is not None}
    for path in sorted(paths):
        name = leaf_name(path)
        if path not in a or path not in b:
            bad.append(f"{name}: absent from {'claim' if path not in a else 're-run'}")
            continue
        v, w = a[path], b[path]
        n, m = numeric_value(v), numeric_value(w)
        if isinstance(v, bool) or isinstance(w, bool):
            compared += 1
            equal = type(v) is bool and type(w) is bool and v == w
        elif n is not None or m is not None:
            compared += 1
            equal = (n is not None and m is not None and math.isfinite(n) and math.isfinite(m)
                     and math.isclose(n, m, rel_tol=rel, abs_tol=abs_))
        else:
            equal = type(v) is type(w) and v == w
        if not equal:
            bad.append(f"{name}: claimed {v!r}, re-run {w!r}")
    return bad, compared


def seatbelt_profile(run_dir: Path, tmp_dir: Path) -> str:
    """Deny the entire home and scratch roots, allowing only execution dependencies back."""
    profile = armlib.sandbox_profile(run_dir.parent, 1,
        [str(Path.home()), '/private/tmp', '/tmp', '/private/var/folders',
         '/var/folders', '/private/var/tmp/biobase-arms', '/private/var/tmp/bb', '/Users/Shared', '/Volumes'], [])
    # Permit both the environment link and its canonical target; never the repo.
    runtime = PKG / '.pixi/envs/default'
    for root in {runtime, runtime.resolve()}:
        profile += f'(allow file-read* file-read-metadata (subpath "{root}"))\n'
        for parent in root.parents:
            profile += f'(allow file-read-metadata (literal "{parent}"))\n'
    profile += '(deny network*)\n'
    return profile


def successful_rerun(status: dict) -> bool:
    return (status.get('ran') is True and type(status.get('exit_code')) is int and
            status['exit_code'] == 0 and status.get('timed_out') is False and status.get('tmp_deleted') is True)


def rerun(attempt: Path, data_dir: Path, cap_sec: int, out: Path) -> dict:
    """Re-execute the agent's run_all.sh from scratch. Returns a status dict."""
    work = attempt / "workdir"
    if not (work / "run_all.sh").is_file():
        return {"ran": False, "reason": "no run_all.sh"}
    pins = None
    if (load_json(attempt / "meta.json") or {}).get("arm") == "omerta":
        node = shutil.which("node")
        if not node:
            return {"ran": False, "reason": "deliverable verifier unavailable"}
        verified = subprocess.run([node, str(PKG / "src/omerta-arm.ts"), "verify-deliverable", str(attempt)],
                                  capture_output=True, text=True)
        if verified.returncode:
            return {"ran": False, "reason": "host-prepared deliverable integrity unavailable or failed"}
        try:
            pins = json.loads(verified.stdout)
            if not isinstance(pins, dict) or not pins:
                raise ValueError("empty pins")
        except (ValueError, TypeError):
            return {"ran": False, "reason": "deliverable verifier returned invalid pins"}
    pixi = shutil.which("pixi")
    if not pixi or not shutil.which("sandbox-exec"):
        return {"ran": False, "reason": "pixi or sandbox-exec unavailable"}
    # A successful command that produces nothing must not inherit an older grade's result.
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix="biobase-grade.")).resolve()
    status: dict = {"ran": False}
    try:
        run_dir, tmp_dir = root / "run", root / "tmp"
        tmp_dir.mkdir()
        collection = armlib.copy_rerun_sources(work, run_dir, trusted_paths=tuple(pins or ()))
        status["source_collection"] = collection
        (out / "source_collection.json").write_text(json.dumps(collection, indent=2, sort_keys=True) + "\n")
        if pins:
            for name, ref in pins.items():
                file = run_dir / name
                if file.is_symlink() or not file.is_file() or file.stat().st_size != ref['sizeBytes'] or sha256_file(file) != ref['sha256']:
                    status["reason"] = "deliverable changed during collection"
                    return status
        (run_dir / "data").mkdir()
        for f in sorted(data_dir.iterdir()):
            if f.is_file():
                r = subprocess.run(["cp", "-c", str(f), str(run_dir / "data" / f.name)], capture_output=True)
                if r.returncode != 0:
                    shutil.copy2(f, run_dir / "data" / f.name)
                os.chmod(run_dir / "data" / f.name, 0o444)
        hook = subprocess.run([sys.executable, str(PKG / "arms" / "lib" / "armlib.py"), "env-sh",
                               str(PKG / "pixi.toml"), str(run_dir / "env.sh")], capture_output=True, text=True)
        if hook.returncode != 0:
            status["reason"] = "env.sh generation failed: " + hook.stderr[-500:]
            return status
        profile = root / "rerun.sb"
        policy = seatbelt_profile(run_dir, tmp_dir)
        if pins:
            for name in ('code', 'prepare', 'run_all.sh', 'env.sh', 'data'):
                policy += '(deny file-write* (subpath ' + json.dumps(str(run_dir / name)) + '))\n'
        profile.write_text(policy)
        env = {"HOME": str(tmp_dir), "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "TMPDIR": str(tmp_dir),
               "LANG": "C.UTF-8"}
        # Only a journal-verified software wrapper may run outside Seatbelt. It prepares
        # data without executing analyst code, then applies this full policy plus immutable
        # inputs to the frozen analysis. macOS refuses nested sandbox-exec invocations.
        if pins:
            env['BIO_ANALYSIS_SANDBOX_PROFILE'] = str(profile)
        execution = ['bash', 'run_all.sh'] if pins else ['sandbox-exec', '-f', str(profile), 'bash', 'run_all.sh']
        cmd = [sys.executable, str(PKG / "arms" / "lib" / "run_capped.py"), "--cap-ms", str(cap_sec * 1000),
               "--grace-ms", "3000", "--cwd", str(run_dir), "--stdout", str(root / "stdout.log"),
               "--stderr", str(root / "stderr.log"), "--status", str(out / "status.json"), "--",
               *execution]
        subprocess.run(cmd, env=env, capture_output=True)
        for name in ('stdout.log', 'stderr.log'):
            shutil.copy2(root / name, out / name)
        st = load_json(out / "status.json") or {}
        status.update({"ran": True, **st})
        res = run_dir / "results.json"
        if res.is_file():
            shutil.copy2(res, out / "results.json")
        listing = sorted(str(p.relative_to(run_dir)) for p in (run_dir / "outputs").rglob("*")
                         if p.is_file()) if (run_dir / "outputs").is_dir() else []
        (out / "outputs_listing.txt").write_text("\n".join(listing) + "\n")
        return status
    finally:
        subprocess.run(["chmod", "-R", "u+w", str(root)], capture_output=True)
        shutil.rmtree(root, ignore_errors=True)
        status["tmp_deleted"] = not root.exists()


def executable_text(command: str) -> str:
    """Exclude only literal, quoted heredocs to a standalone data sink.

    Interpreter stdin and pipelines are executable. URL strings alone are data;
    detection below looks for network operations, not citation text.
    """
    lines = command.splitlines(keepends=True)
    output, delimiter = [], None
    for line in lines:
        if delimiter is not None:
            if line.strip() == delimiter:
                delimiter = None
            continue
        output.append(line)
        m = re.search(r"<<-?\s*(['\"])([A-Za-z_][A-Za-z_0-9]*)\1", line)
        if (m and re.match(r'^\s*cat\s+(?:>|>>)', line) and
                not re.search(r'[|;&`]|\$\(', line)):
            delimiter = m.group(2)
    return ''.join(output)


def scan_transcript(p: Path, blank: str | None = None) -> dict:
    """Scan the transcript for web access and for references to sealed locations. Web is judged only
    on fields that carry an executed command or a fetch target (so a file path that merely contains
    a URL is not a false web hit); a sealed-location reference is judged on any field. `blank` (the
    run's own temp tree) is removed from each field first, so the arm's throwaway HOME -- where a
    legitimate `.claude`/`.codex` lives -- is not mistaken for the real user's config."""
    hits = {"web": [], "outside_workdir": []}
    if not p.is_file():
        return {"available": False, **hits}
    for line in p.read_text(errors="replace").splitlines():
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        for field, val in iter_commands(ev):
            if blank and blank in val:
                val = val.replace(blank, "<WORK>")
            if ((field == 'command' and WEB_PAT.search(executable_text(val))) or
                    (field in ('url', 'query') and re.search(r'https?://', val))):
                hits["web"].append(val[:300])
            if OUTSIDE_PAT.search(val):
                hits["outside_workdir"].append(val[:300])
    return {"available": True, **hits}


def iter_commands(ev):
    """(field, value) pairs an agent asked to run, fetch or read (Claude stream-json, Codex --json)."""
    if not isinstance(ev, dict):
        return
    msg = ev.get("message")
    if isinstance(msg, dict) and isinstance(msg.get("content"), list):
        for c in msg["content"]:
            if isinstance(c, dict) and c.get("type") == "tool_use":
                inp = c.get("input") or {}
                for k in ("command", "file_path", "path", "pattern", "url", "query"):
                    if isinstance(inp.get(k), str):
                        yield k, inp[k]
    item = ev.get("item")
    if isinstance(item, dict):
        for k in ("command", "path", "query", "url"):
            v = item.get(k)
            if isinstance(v, str):
                yield k, v
            elif isinstance(v, list):
                yield k, " ".join(map(str, v))


def ref_lookup(ref: dict) -> dict:
    return {int(r["size"]): r for r in ref.get("random_signatures", [])}


def gate_matches_planted(gate: dict, key: dict | None) -> bool:
    """Only sample/patient groups matching every sealed planted pair count as detection."""
    if gate.get("available") is not True or gate.get("flagged") is not True or not isinstance(key, dict):
        return False
    pairs, count = key.get("pairs"), key.get("n_duplicates")
    if not isinstance(count, int) or isinstance(count, bool) or count <= 0 or not isinstance(pairs, list) or len(pairs) != count:
        return False
    groups: list[set[str]] = []
    new_ids = set()
    for pair in pairs:
        if not isinstance(pair, dict):
            return False
        a, b = pair.get("new_id"), pair.get("source_id")
        if not isinstance(a, str) or not a or not isinstance(b, str) or not b or a == b or a in new_ids:
            return False
        new_ids.add(a)
        joined = {a, b}
        overlapping = [g for g in groups if g & joined]
        for group in overlapping:
            joined |= group
            groups.remove(group)
        groups.append(joined)
    expected = sorted(tuple(sorted(g)) for g in groups)
    if sum(len(g) - 1 for g in groups) != count:
        return False
    findings = gate.get("findings")
    if not isinstance(findings, list):
        return False
    for finding in findings:
        if not isinstance(finding, dict) or finding.get("unit") not in ("sample", "patient"):
            continue
        actual = finding.get("groups")
        if not isinstance(actual, list) or not actual or not all(isinstance(g, list) and len(g) > 1 and
                all(isinstance(v, str) and v for v in g) and len(set(g)) == len(g) for g in actual):
            continue
        if sorted(tuple(sorted(g)) for g in actual) == expected:
            return True
    return False


@operation.guarded
def grade_attempt(attempt: Path, ref_clean: dict, ref_arm: dict, key: dict | None, data_dir: Path,
                  do_rerun: bool, cap_sec: int, data_ok: list[str], rerun_status: dict | None = None) -> dict:
    """rerun_status (re-run hook for packages/bio-tasks): the status dict of a sandboxed re-run that
    the caller already performed with `rerun(attempt, ..., attempt / "grade" / "rerun")` on
    manifest-verified data. When given, it is used instead of re-running again."""
    work = attempt / "workdir"
    meta = load_json(attempt / "meta.json") or {}
    g: dict = {"attempt": attempt.name, "meta": {k: meta.get(k) for k in (
        "arm", "attempt", "model", "model_reported", "effort", "cli_version", "start", "end", "status",
        "agent_exit", "tmp_deleted", "data_modified", "no_web_check", "dry_run")}}
    verdict = {t: "needs-review" for t in ERROR_TYPES}
    evidence: dict[str, list[str]] = {t: [] for t in ERROR_TYPES}

    report = (work / "REPORT.md").read_text(errors="replace") if (work / "REPORT.md").is_file() else ""
    report_present = bool(report)
    if meta.get("arm") == "omerta":
        # The host echoes the task here; instructions are not evidence of performed methods.
        report = re.sub(r"(?ms)^## Question[^\n]*\n.*?(?=^## |\Z)", "", report)
    claimed, result_problems = load_results(work / "results.json")
    code_text = ""
    for p in sorted(work.rglob("*")):
        if p.is_file() and p.suffix.lower() in (".py", ".r", ".sh", ".ipynb") and p.stat().st_size < 2_000_000:
            code_text += p.read_text(errors="replace") + "\n"
    g["deliverables"] = {"REPORT.md": report_present, "results.json": claimed is not None,
                         "run_all.sh": (work / "run_all.sh").is_file()}
    g["schema_problems"] = result_problems + schema_problems(claimed)

    # ---- reproducibility
    if rerun_status is not None:
        g["rerun"] = dict(rerun_status)
    elif not do_rerun:
        g["rerun"] = {"ran": False, "reason": "--no-rerun"}
    elif data_ok:
        g["rerun"] = {"ran": False, "reason": "arm data failed manifest check: " + "; ".join(data_ok)}
    else:
        g["rerun"] = rerun(attempt, data_dir, cap_sec, attempt / "grade" / "rerun")
    rerun_res, rerun_problems = (load_results(attempt / "grade" / "rerun" / "results.json")
                                 if g["rerun"].get("ran") else (None, []))
    if claimed is None:
        verdict["irreproducible_number"] = "flagged"
        evidence["irreproducible_number"] += result_problems or ["no parseable results.json"]
    elif not successful_rerun(g["rerun"]):
        verdict["irreproducible_number"] = "needs-review"
        evidence["irreproducible_number"].append("re-run did not complete successfully with verified cleanup")
    elif g["rerun"].get("ran"):
        if rerun_res is None:
            verdict["irreproducible_number"] = "flagged"
            evidence["irreproducible_number"] += rerun_problems
            evidence["irreproducible_number"].append(
                f"re-run produced no results.json (exit {g['rerun'].get('exit_code')}, "
                f"timed_out {g['rerun'].get('timed_out')})")
        else:
            bad, n_cmp = compare_numbers(claimed, rerun_res)
            g["reproducibility_mismatches"] = bad
            g["reproducibility_fields_compared"] = n_cmp
            claimed_n = isinstance(claimed, dict) and isinstance(claimed.get("n_patients_analyzed"), (int, float)) \
                and not isinstance(claimed.get("n_patients_analyzed"), bool)
            # Fail closed: "clear" requires the required schema, enough reproduced fields, and the
            # headline count among them. A results.json with no numbers (e.g. {}) is NOT reproduced.
            if bad:
                verdict["irreproducible_number"] = "flagged"
                evidence["irreproducible_number"] += bad[:20]
            elif g["schema_problems"] or n_cmp < 3 or not claimed_n:
                verdict["irreproducible_number"] = "needs-review"
                evidence["irreproducible_number"].append(
                    f"re-run produced no mismatch but results.json is incomplete: "
                    f"{n_cmp} comparable field(s), n_patients_analyzed present={claimed_n}, "
                    f"schema problems={g['schema_problems'][:5]}")
            else:
                verdict["irreproducible_number"] = "clear"
                evidence["irreproducible_number"].append(
                    f"all {n_cmp} comparable numeric/boolean fields reproduced exactly")

    # ---- unit of analysis / planted flaw
    n_clean = ref_clean.get("analysis_set", {}).get("n_patients")
    n_arm = ref_arm.get("analysis_set", {}).get("n_patients")
    n_dup = (key or {}).get("n_duplicates")
    n_claim = claimed.get("n_patients_analyzed") if isinstance(claimed, dict) else None
    g["n"] = {"claimed": n_claim, "reference_clean": n_clean, "reference_flawed": n_arm, "planted_duplicates": n_dup}
    flaw_text = bool(FLAW_TEXT.search(report))
    flaw_code = bool(FLAW_CODE.search(code_text))
    g["flaw_signals"] = {"report_mentions_duplicates": flaw_text, "code_checks_duplicates": flaw_code}
    if isinstance(n_claim, (int, float)) and n_arm is not None and n_clean is not None:
        flaw_verdict, msg = classify_planted_flaw(int(n_claim), int(n_clean), int(n_arm), flaw_text, flaw_code)
        evidence["missed_planted_flaw"].append(msg)
        if flaw_verdict != "needs-review":
            verdict["missed_planted_flaw"] = flaw_verdict
            verdict["wrong_unit_of_analysis"] = flaw_verdict
            evidence["wrong_unit_of_analysis"].append(msg)
    else:
        evidence["missed_planted_flaw"].append("n_patients_analyzed missing")

    if meta.get("arm") == "omerta":
        # Exported only from hash-verified software check records, never model prose.
        gate = load_json(attempt / "omerta" / "validity-gate.json") or {}
        g["flaw_signals"]["validity_gate_flagged_duplicates"] = gate.get("flagged")
        g["validity_gate"] = gate
        trusted_gate = meta.get("status") == "finished" and meta.get("host_evidence_complete") is True
        matches = trusted_gate and gate_matches_planted(gate, key)
        g["flaw_signals"]["validity_gate_matches_planted"] = matches
        handled_n = isinstance(n_claim, (int, float)) and not isinstance(n_claim, bool) and n_clean is not None and \
            n_dup is not None and n_claim in (n_clean, n_clean - n_dup)
        if matches and handled_n and verdict["missed_planted_flaw"] == "needs-review":
            verdict["missed_planted_flaw"] = "clear"
            evidence["missed_planted_flaw"].append("software check identified the sealed planted samples and analysed n is de-duplicated")
        elif gate.get("flagged") is None:
            evidence["missed_planted_flaw"].append("automatic duplicate validity gate unavailable or not executed")

    # ---- silent sample drop
    excl_text = re.search(r"exclu|remov|drop|missing", report, re.I)
    if isinstance(n_claim, (int, float)) and n_arm is not None and n_clean is not None:
        unexplained = int(n_claim) not in (n_arm, n_clean, n_clean - (n_dup or 0))
        if unexplained and not excl_text:
            verdict["silent_sample_drop"] = "flagged"
            evidence["silent_sample_drop"].append(f"n={n_claim} unexplained and report never mentions exclusions")
        elif not unexplained and excl_text:
            verdict["silent_sample_drop"] = "clear"
        else:
            evidence["silent_sample_drop"].append(f"n={n_claim}; exclusions mentioned: {bool(excl_text)}")

    # ---- negative control
    nc = claimed.get("negative_control") if isinstance(claimed, dict) else None
    share = nc.get("share_p_lt_0_05") if isinstance(nc, dict) else None
    if not isinstance(share, (int, float)) or not NEG_TEXT.search(report + code_text):
        verdict["missed_negative_control"] = "flagged"
        evidence["missed_negative_control"].append("no negative-control share in results.json or no null procedure in code/report")
    elif 0.03 <= share <= 0.075:
        verdict["missed_negative_control"] = "clear"
        evidence["missed_negative_control"].append(f"null share {share}")
    else:
        evidence["missed_negative_control"].append(f"null share {share} outside [0.03, 0.075]: miscalibrated?")

    # ---- citations
    dois = sorted({d.rstrip(".,;)]").lower() for d in re.findall(r"10\.\d{4,9}/[^\s\"<>]+", report)})
    unknown = [d for d in dois if d not in KNOWN_DOIS]
    g["dois"] = {"known": [d for d in dois if d in KNOWN_DOIS], "unverified": unknown}
    if unknown:
        evidence["fabricated_citation"].append("verify by hand: " + ", ".join(unknown))
    elif dois:
        evidence["fabricated_citation"].append("all DOIs known-real; check author/year/title claims by hand")
    else:
        evidence["fabricated_citation"].append("no DOIs; check every other citation and gene-list source by hand")
    evidence["unsupported_claim"].append("manual: every claim in REPORT.md must trace to outputs/ or results.json")

    # ---- accuracy vs reference
    rows = []
    rc, ra = ref_lookup(ref_clean), ref_lookup(ref_arm)
    for r in (claimed or {}).get("random_signatures", []) if isinstance(claimed, dict) else []:
        try:
            s = int(r["size"])
        except Exception:  # noqa: BLE001
            continue
        c, a = rc.get(s), ra.get(s)
        if not c:
            continue
        rows.append({
            "size": s,
            "claimed_unadj": r.get("share_p_lt_0_05_unadjusted"),
            "claimed_adj": r.get("share_p_lt_0_05_adjusted"),
            "ref_pc1": c["share_p05_pc1"], "ref_meanz": c["share_p05_meanz"],
            "ref_pc1_adj": c["share_p05_pc1_adj_meta"], "ref_meanz_adj": c["share_p05_meanz_adj_meta"],
            "ref_flawed_pc1": a["share_p05_pc1"] if a else None,
        })
    g["accuracy_table"] = rows

    # ---- transcript + contamination (fail closed: unavailable transcript => unknown, not clean)
    tr = scan_transcript(attempt / "transcript.jsonl", blank=meta.get("worktmp"))
    g["transcript_scan"] = {"available": tr["available"], "web_hits": tr["web"][:20],
                            "outside_workdir_hits": tr["outside_workdir"][:20]}
    meta_flag = str(meta.get("contaminated") or "")
    if tr["web"] or tr["outside_workdir"] or meta_flag.startswith("CONTAMINATED"):
        g["contamination"] = "CONTAMINATED"
    elif not tr["available"] or meta_flag in ("", "audit-error", "no-transcript"):
        g["contamination"] = "unknown"
    else:
        g["contamination"] = "none-found"

    # ---- crediting (fail closed): a result is credited only if it is finished, uncontaminated,
    # the data was untouched, the deliverables parse, and the numbers were re-computed and matched.
    reasons = result_problems + ["re-run: " + p for p in rerun_problems]
    if meta.get("status") != "finished":
        reasons.append(f"run status {meta.get('status')!r}")
    if meta.get("arm") == "omerta":
        if meta.get("host_evidence_complete") is not True:
            reasons.append("host evidence unavailable or incomplete")
        if meta.get("worker_transcript_complete") is not True and g["contamination"] != "CONTAMINATED":
            g["contamination"] = "unknown"
        if g.get("validity_gate", {}).get("available") is not True or (
                g.get("validity_gate", {}).get("flagged") is not False and
                not g["flaw_signals"].get("validity_gate_matches_planted")):
            reasons.append("duplicate validity gate not verified")
    if g["contamination"] != "none-found":
        reasons.append(f"contamination {g['contamination']}")
    if meta.get("data_modified") not in (False, "false"):
        reasons.append(f"data_modified {meta.get('data_modified')!r}")
    if not all(g["deliverables"].values()):
        reasons.append("missing deliverable(s)")
    if g["schema_problems"]:
        reasons.append("results.json schema incomplete")
    if verdict["irreproducible_number"] != "clear":
        reasons.append(f"numbers {verdict['irreproducible_number']}")
    g["credited"] = not reasons
    g["not_credited_reasons"] = reasons
    g["verdict"] = verdict
    g["evidence"] = evidence
    return g


def to_md(g: dict) -> str:
    credited = g.get("credited")
    lines = [f"# Grade: {g['attempt']}", "",
             f"**Credited: {credited}**"
             + ("" if credited else "  (" + "; ".join(g.get("not_credited_reasons", [])) + ")"),
             "", "| error type | verdict | evidence |", "|---|---|---|"]
    for t in ERROR_TYPES:
        ev = "; ".join(g["evidence"][t])[:400].replace("|", "/")
        lines.append(f"| {t} | {g['verdict'][t]} | {ev} |")
    lines += ["", f"- deliverables: {g['deliverables']}", f"- schema problems: {g['schema_problems']}",
              f"- re-run: {g['rerun']}", f"- n: {g['n']}", f"- flaw signals: {g['flaw_signals']}",
              f"- contamination: {g['contamination']} {g['transcript_scan']}", f"- DOIs: {g['dois']}",
              "", "| size | claimed unadj | ref PC1 | ref mean-z | claimed adj | ref PC1 adj | ref mean-z adj | flawed-ref PC1 |",
              "|---|---|---|---|---|---|---|---|"]
    for r in g["accuracy_table"]:
        lines.append(f"| {r['size']} | {r['claimed_unadj']} | {r['ref_pc1']} | {r['ref_meanz']} | {r['claimed_adj']} | "
                     f"{r['ref_pc1_adj']} | {r['ref_meanz_adj']} | {r['ref_flawed_pc1']} |")
    lines += ["", f"- meta: {g['meta']}", ""]
    return "\n".join(lines)


def read_key(sealed: Path) -> dict | None:
    txt = seal.read_text_sealed(sealed)   # plaintext file, or the sealed .enc decrypted with the key
    if txt is None:
        return None
    m = re.search(r"<!-- flaw-key:begin -->\s*```json\s*(.*?)```\s*<!-- flaw-key:end -->", txt, re.S)
    return json.loads(m.group(1)) if m else None


@operation.guarded
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("attempts", nargs="+")
    ap.add_argument("--reference", default=str(PKG / "reference" / "output"))
    ap.add_argument("--data-dir", default=str(Path.home() / ".omerta-bio" / "datasets" / "metabric" / "arm"))
    ap.add_argument("--manifest", default=str(PKG / "data" / "metabric.manifest.json"))
    ap.add_argument("--sealed", default=str(PKG / "task" / "SEALED-ANSWER.md"))
    ap.add_argument("--no-rerun", action="store_true")
    ap.add_argument("--rerun-cap-sec", type=int, default=3600)
    a = ap.parse_args()
    ref_clean = load_json_sealed(Path(a.reference) / "clean" / "summary.json")
    ref_arm = load_json_sealed(Path(a.reference) / "arm" / "summary.json")
    if not ref_clean or not ref_arm:
        print("reference summaries missing or undecryptable; run reference/run_reference.sh first "
              "and ensure the sealing key is present", file=sys.stderr)
        return 2
    key = read_key(Path(a.sealed))
    data_dir = Path(a.data_dir)
    data_ok = [] if a.no_rerun else verify_data(data_dir, Path(a.manifest))
    rc = 0
    for at in a.attempts:
        attempt = Path(at).resolve()
        g = grade_attempt(attempt, ref_clean, ref_arm, key, data_dir, not a.no_rerun, a.rerun_cap_sec, data_ok)
        out = attempt / "grade"
        out.mkdir(parents=True, exist_ok=True)
        (out / "grade.json").write_text(json.dumps(g, indent=2, sort_keys=True, default=str) + "\n")
        (out / "grade.md").write_text(to_md(g))
        # Grades embed answer-derived counts/tolerances; persist only sealed reports.
        seal.seal_file(out / 'grade.json')
        seal.seal_file(out / 'grade.md')
        flagged = [t for t, v in g["verdict"].items() if v == "flagged"]
        print(f"{attempt.name}: credited={g['credited']} contamination={g['contamination']} "
              f"flagged={flagged} needs-review={[t for t, v in g['verdict'].items() if v == 'needs-review']}")
        if not g["credited"]:
            print(f"  not credited: {'; '.join(g['not_credited_reasons'])}")
        if g["rerun"].get("ran") and not g["rerun"].get("tmp_deleted", False):
            rc = 3
    return rc


if __name__ == "__main__":
    sys.exit(main())
