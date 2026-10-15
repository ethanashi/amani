"""Shared implementation of the IAD PSA tasks (iad1-brady-audit, iad2-brady-twin, iad3-browning-count).

Private authoring source: like every file under packages/bio-tasks/tasks/, it must be excluded from any
open-source release (it regenerates the answer keys).

Data handling (owner decision 2026-10-10, binding; see packages/bio-tasks/BUILD-NOTES.md):
- The only input is the Brady-Nicholls et al. 2020 code archive (D1), cached privately at
  ~/.omerta-bio/datasets/iad/raw/Archive.zip with a manifest. It is verified against the pinned SHA-256 below
  and against that manifest, read in memory, never extracted, never copied into the repository.
- Staged arm data are derived: subjects get pseudonymous IDs (HMAC of task id and card seed), days are
  re-based to each subject's first record (D1 already uses relative days; no calendar date exists in it),
  and no trial name, drug, dose, site or author appears. D2 (which has real visit dates) is never read here.
- Nothing in this module prints key values or patient-level data; failures name a guard or a file, never a
  value.
"""
from __future__ import annotations

import csv
import hashlib
import hmac
import io
import json
import math
import re
import zipfile
from pathlib import Path

import numpy as np

import result_format

CACHE = Path.home() / ".omerta-bio" / "datasets" / "iad"
ARCHIVE_ID = "D1"
ARCHIVE_SHA256 = "cfa7320d207fdd43edf7ff92f6deac91c7cc76467f30aa9f09d186a56d35290a"
ARCHIVE_BYTES = 8865294
ROC_MEMBER = "5_LeaveOneOut/b_ROCAnalysis/ROC.mat"
SERIES_DIR = "5_LeaveOneOut/a_LeaveOneOut/CyclebyCycleOpt/patientdata-all/"
CYCLES = (2, 3, 4)
RESISTANT, RESPONSIVE = "resistant", "responsive"
STATUSES = ("confirmed", "tentative", "refuted", "insufficient-evidence")


# ----------------------------------------------------------------------------------------------- source
def archive() -> zipfile.ZipFile:
    """The pinned D1 archive from the private cache, verified (size, sha256, manifest entry) in memory."""
    try:
        manifest = json.loads((CACHE / "manifest.json").read_text())
        entry = next(f for f in manifest["files"] if f.get("id") == ARCHIVE_ID)
        path = CACHE / entry["path"]
    except (OSError, ValueError, KeyError, StopIteration):
        raise SystemExit("IAD private dataset manifest missing or unreadable (~/.omerta-bio/datasets/iad)") from None
    if path.is_symlink() or not path.is_file():
        raise SystemExit("IAD source archive missing from the private cache")
    data = path.read_bytes()
    if (len(data) != ARCHIVE_BYTES or hashlib.sha256(data).hexdigest() != ARCHIVE_SHA256
            or entry.get("sha256") != ARCHIVE_SHA256):
        raise SystemExit("IAD source archive checksum mismatch; refusing to stage")
    return zipfile.ZipFile(io.BytesIO(data))


def series_ids(z: zipfile.ZipFile) -> list[int]:
    ids = []
    for n in z.namelist():
        if n.startswith(SERIES_DIR + "p") and n.endswith(".txt") and "/" not in n[len(SERIES_DIR):]:
            ids.append(int(n[len(SERIES_DIR) + 1:-4]))
    return sorted(ids)


def series(z: zipfile.ZipFile, pid: int) -> list[dict]:
    """One subject's visits in file order. Values of PSA and testosterone are the exported tokens (stripped),
    blank where the source is blank; trailing all-blank padding rows are dropped. Day/cycle/treatment are
    integer codes in the source ('1.00' or '1') and are normalised to integers."""
    text = z.read(f"{SERIES_DIR}p{pid}.txt").decode("utf-8")
    rows = list(csv.reader(io.StringIO(text, newline="")))
    head = [h.strip() for h in rows[0]]
    if head != ["Patient", "Day", "PSA", "Ts", "Cycle", "Treatment"]:
        raise SystemExit(f"unexpected series header in source file p{pid}")
    out = []
    for r in rows[1:]:
        if not r or not any(v.strip() for v in r):
            continue
        if len(r) != 6 or any(r[j].strip() == "" for j in (1, 4, 5)):
            raise SystemExit(f"unexpected row shape in source file p{pid}")
        day, cyc, trt = float(r[1]), float(r[4]), float(r[5])
        if day != int(day) or cyc != int(cyc) or trt not in (0.0, 1.0):
            raise SystemExit(f"non-integer code in source file p{pid}")
        out.append({"day": int(day), "psa": r[2].strip(), "ts": r[3].strip(), "cycle": int(cyc), "on": int(trt)})
    if not out:
        raise SystemExit(f"empty source file p{pid}")
    first = out[0]["day"]
    for o in out:
        o["day"] -= first
    return out


def loo_outputs(z: zipfile.ZipFile):
    """(rows, folds): rows = the study's leave-one-out predictions in file order, as dicts
    {cycle, pid, kappa, code, p} (None where the source is NaN); folds = {(cycle, pid): training ROC matrix
    [threshold, #responsive >= thr, #resistant >= thr, fpr, tpr]} for every non-empty fold."""
    import scipy.io as sio
    m = sio.loadmat(io.BytesIO(z.read(ROC_MEMBER)))
    rows, folds = [], {}
    for c, k, a in ((2, "k1", "A1"), (3, "k2", "A2"), (4, "k3", "A3")):
        K = m[k]
        if K.shape[1] != 5 or not np.array_equal(K[:, 0], np.arange(1, len(K) + 1)):
            raise SystemExit("unexpected leave-one-out output layout")
        for r in K:
            nan = lambda v: None if math.isnan(v) else float(v)
            rows.append({"cycle": c, "pid": int(r[1]), "kappa": nan(r[2]), "code": nan(r[3]), "p": nan(r[4])})
        for i in range(m[a].shape[1]):
            x = m[a][0, i]
            if x.size:
                if x.shape[1] != 5:
                    raise SystemExit("unexpected training ROC layout")
                folds[(c, i + 1)] = np.asarray(x, dtype=float)
    return rows, folds


def pseudo_ids(task: str, seed: int, pids, width: int) -> dict[int, str]:
    """Original ID -> S-<n>, numbered in the order of HMAC-SHA256(task:seed, original ID)."""
    k = f"{task}:{seed}".encode()
    order = sorted(set(pids), key=lambda p: hmac.new(k, str(p).encode(), hashlib.sha256).hexdigest())
    return {p: f"S-{i + 1:0{width}d}" for i, p in enumerate(order)}


def fmt(x) -> str:
    """Byte-deterministic float token: shortest round-trip repr (empty for None)."""
    return "" if x is None else repr(float(x))


def write_csv(path: Path, header: list[str], rows) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(",".join(header) + "\n")
        for r in rows:
            fh.write(",".join(r) + "\n")


# --------------------------------------------------------------------------------------------- analysis
def auc(scores, labels) -> float | None:
    """Mann-Whitney AUC (ties count one half) over rows with a finite score; None if undefined."""
    s = np.asarray(scores, dtype=float)
    y = np.asarray(labels, dtype=bool)
    keep = np.isfinite(s)
    s, y = s[keep], y[keep]
    pos, neg = s[y], s[~y]
    if len(pos) == 0 or len(neg) == 0:
        return None
    gt = (pos[:, None] > neg[None, :]).sum()
    eq = (pos[:, None] == neg[None, :]).sum()
    return float((gt + 0.5 * eq) / (len(pos) * len(neg)))


def confusion(obs, call) -> dict:
    obs, call = np.asarray(obs, bool), np.asarray(call, bool)
    return {"tp": int((obs & call).sum()), "fn": int((obs & ~call).sum()),
            "fp": int((~obs & call).sum()), "tn": int((~obs & ~call).sum())}


def rates(c: dict) -> dict:
    n = c["tp"] + c["fn"] + c["fp"] + c["tn"]
    sens = c["tp"] / (c["tp"] + c["fn"])
    spec = c["tn"] / (c["tn"] + c["fp"])
    return {"sensitivity": sens, "specificity": spec, "accuracy": (c["tp"] + c["tn"]) / n,
            "balanced_accuracy": (sens + spec) / 2}


def prior_cycle_features(history: list[dict], cycle: int) -> dict:
    """PSA summaries of cycle c-1's on-treatment visits (PSA blank or <= 0 treated as missing; the 0.00
    values are export placeholders), plus the zeros-kept variants and the last off-treatment PSA."""
    def num(s):
        try:
            return float(s)
        except ValueError:
            return None
    on = [num(h["psa"]) for h in history if h["cycle"] == cycle - 1 and h["on"] == 1]
    off = [num(h["psa"]) for h in history if h["cycle"] == cycle - 1 and h["on"] == 0]
    pos_on = [v for v in on if v is not None and v > 0]
    any_on = [v for v in on if v is not None]
    pos_off = [v for v in off if v is not None and v > 0]
    return {"nadir": min(pos_on) if pos_on else None, "end_psa": pos_on[-1] if pos_on else None,
            "nadir_zeros_kept": min(any_on) if any_on else None, "end_psa_zeros_kept": any_on[-1] if any_on else None,
            "restart_psa": pos_off[-1] if pos_off else None}


def cluster_bootstrap(score_a, score_b, labels, subjects, resamples: int = 4000, seed: int = 0) -> tuple[float, float, int]:
    """Percentile 95% CI of AUC(a) - AUC(b), resampling subjects with replacement. Subjects are taken in
    sorted order; each draw is rng.integers(0, n_subjects, n_subjects) with numpy.random.default_rng(seed);
    draws with fewer than 2 positives or fewer than 2 negatives are skipped. Returns (low, high, n_used)."""
    a = np.asarray(score_a, float); b = np.asarray(score_b, float); y = np.asarray(labels, bool)
    subj = np.asarray(subjects)
    pats, inverse = np.unique(subj, return_inverse=True)
    rng = np.random.default_rng(seed)
    # The same RNG draws, represented as subject multiplicities instead of copied rows.
    # Each positive/negative pair contributes its tie-adjusted win times both multiplicities.
    # This preserves the estimand and seed while avoiding thousands of Python/array allocations.
    draws = rng.integers(0, len(pats), (resamples, len(pats)))
    multiplicity = np.zeros((resamples, len(pats)))
    np.add.at(multiplicity, (np.arange(resamples)[:, None], draws), 1)
    weights = multiplicity[:, inverse]
    enough = (weights[:, y].sum(axis=1) >= 2) & (weights[:, ~y].sum(axis=1) >= 2)

    def weighted_auc(score):
        finite = np.isfinite(score)
        pos, neg = y & finite, ~y & finite
        wins = (score[pos, None] > score[neg]).astype(float) + 0.5 * (score[pos, None] == score[neg])
        denominator = weights[:, pos].sum(axis=1) * weights[:, neg].sum(axis=1)
        numerator = ((weights[:, pos] @ wins) * weights[:, neg]).sum(axis=1)
        return np.divide(numerator, denominator, out=np.full(resamples, np.nan), where=denominator > 0)

    diffs = weighted_auc(a) - weighted_auc(b)
    diffs = diffs[enough & np.isfinite(diffs)]
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    return float(lo), float(hi), len(diffs)


def trapezoid_auc(fpr, tpr) -> float:
    """The study code's own training-fold AUC: trapezoid integral of tpr over fpr in stored row order."""
    return float(np.trapezoid(np.asarray(tpr, float), np.asarray(fpr, float)))


def spearman(a, b) -> float | None:
    from scipy import stats
    a = np.asarray(a, float); b = np.asarray(b, float)
    k = np.isfinite(a) & np.isfinite(b)
    if k.sum() < 3 or np.ptp(a[k]) == 0 or np.ptp(b[k]) == 0:
        return None
    r = stats.spearmanr(a[k], b[k]).statistic
    return None if not np.isfinite(r) else float(r)


def r10(x):
    return None if x is None else float(f"{x:.10g}")


def r6(x):
    """Six significant digits: used for arm-visible per-row values stored in a key, so that the leakage scan's
    high-precision tokens never coincide with staged bytes."""
    return None if x is None else float(f"{x:.6g}")


# ---------------------------------------------------------------------------------------- staged reading
def read_csv(path: Path) -> list[dict]:
    with open(path, encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def read_loo_stage(stage: Path) -> dict:
    """Parse a staged iad1/iad2 bundle into analysis arrays (the reference reads only what the arm sees)."""
    d = Path(stage) / "data"
    preds = read_csv(d / "predictions.csv")
    hist_rows = read_csv(d / "psa_history.csv")
    hist: dict[str, list[dict]] = {}
    for h in hist_rows:
        hist.setdefault(h["subject"], []).append({"day": int(h["day"]), "psa": h["psa"], "ts": h["testosterone"],
                                                 "cycle": int(h["cycle"]), "on": int(h["on_treatment"])})
    scored, missing = [], []
    for r in preds:
        rec = {"subject": r["subject"], "cycle": int(r["cycle"])}
        if r["p_resistant"] == "":
            missing.append(rec)
            continue
        rec.update(p=float(r["p_resistant"]), kappa=float(r["threshold"]), call=r["authors_call"] == RESISTANT,
                   obs=r["observed"] == RESISTANT)
        scored.append(rec)
    keys = {(r["subject"], r["cycle"]) for r in scored}
    for r in scored:
        r["has_later"] = any((r["subject"], c) in keys for c in CYCLES if c > r["cycle"])
        r.update(prior_cycle_features(hist[r["subject"]], r["cycle"]))
    folds = None
    if (d / "training_roc.csv").is_file():
        folds = {}
        for f in read_csv(d / "training_roc.csv"):
            folds.setdefault((f["held_out_subject"], int(f["cycle"])), []).append((float(f["fpr"]), float(f["tpr"])))
    return {"scored": scored, "missing": missing, "folds": folds}


# --------------------------------------------------------------------------------- iad1 / iad2 staging
PRED_HEADER = ["subject", "cycle", "threshold", "p_resistant", "authors_call", "observed"]
HIST_HEADER = ["subject", "day", "psa", "testosterone", "cycle", "on_treatment"]
ROC_HEADER = ["held_out_subject", "cycle", "threshold", "n_responsive_at_or_above", "n_resistant_at_or_above", "fpr", "tpr"]

README_LOO = """# Data dictionary

All files are UTF-8 CSV with a header row. `subject` is a pseudonymous patient identifier, consistent
across files. Values are as exported by the study's code and data files.

## predictions.csv

One row per patient and predicted treatment cycle.

| Column | Meaning |
|---|---|
| `subject` | patient |
| `cycle` | the treatment cycle whose outcome was predicted (2, 3 or 4) |
| `threshold` | the decision threshold of this row's leave-one-out fold |
| `p_resistant` | the model's predicted probability that the patient becomes resistant during `cycle` |
| `authors_call` | the authors' recorded prediction: `resistant` or `responsive` |
| `observed` | the observed outcome of `cycle`: `resistant` or `responsive` |

## psa_history.csv

Each patient's visits, from his first record up to the start of his last predicted cycle.

| Column | Meaning |
|---|---|
| `subject` | patient |
| `day` | days since the patient's first record |
| `psa` | serum PSA, ug/L (ng/mL); empty if not recorded |
| `testosterone` | serum testosterone, nmol/L; empty if not recorded |
| `cycle` | treatment cycle (1 = first) |
| `on_treatment` | 1 during the treatment period of the cycle, 0 during its pause |
"""

README_ROC = """
## training_roc.csv

For every leave-one-out fold (identified by its held-out patient and predicted cycle), the ROC curve that
the study's code computed on the fold's training patients when choosing the fold's threshold, one row
per candidate threshold, in the order the code stored them.

| Column | Meaning |
|---|---|
| `held_out_subject` | the patient left out of this fold |
| `cycle` | predicted cycle |
| `threshold` | candidate threshold |
| `n_responsive_at_or_above` | number of responsive training instances scoring at or above the threshold |
| `n_resistant_at_or_above` | number of resistant training instances scoring at or above the threshold |
| `fpr` | false-positive rate at the threshold |
| `tpr` | true-positive rate at the threshold |
"""


def base_world(z: zipfile.ZipFile) -> dict:
    """The real leave-one-out world from the archive (original IDs; used by staging only)."""
    rows, folds = loo_outputs(z)
    pids = sorted({r["pid"] for r in rows})
    hist = {p: series(z, p) for p in pids}
    for r in rows:
        r["call"] = None if r["code"] is None else r["code"] in (2.0, -1.0)
        r["obs"] = None if r["code"] is None else r["code"] in (2.0, 1.0)
        if r["p"] is None and (r["kappa"] is not None or r["code"] is not None):
            raise SystemExit("partially missing prediction row in source")
    for r in rows:
        if r["p"] is not None and (r["cycle"], r["pid"]) not in folds:
            raise SystemExit("scored prediction without a training fold")
    return {"rows": rows, "folds": folds, "hist": hist}


def stage_loo(out: Path, task: str, seed: int, world: dict, include_roc: bool) -> dict:
    """Write predictions.csv, psa_history.csv, (training_roc.csv) and README.md; return the ID map."""
    rows = world["rows"]
    ids = pseudo_ids(task, seed, [r["pid"] for r in rows], 2)
    last = {}
    for r in rows:
        last[r["pid"]] = max(last.get(r["pid"], 0), r["cycle"])
    data = Path(out) / "data"
    pred = sorted(rows, key=lambda r: (ids[r["pid"]], r["cycle"]))
    lab = lambda v: "" if v is None else (RESISTANT if v else RESPONSIVE)
    write_csv(data / "predictions.csv", PRED_HEADER,
              ([ids[r["pid"]], str(r["cycle"]), fmt(r["kappa"]), fmt(r["p"]), lab(r["call"]), lab(r["obs"])] for r in pred))
    hist_rows = []
    for pid in sorted(last, key=lambda p: ids[p]):
        for h in world["hist"][pid]:
            if h["cycle"] <= last[pid] - 1:
                hist_rows.append([ids[pid], str(h["day"]), h["psa"], h["ts"], str(h["cycle"]), str(h["on"])])
    write_csv(data / "psa_history.csv", HIST_HEADER, hist_rows)
    readme = README_LOO
    if include_roc:
        roc_rows = []
        for (c, pid) in sorted(world["folds"], key=lambda k: (ids[k[1]], k[0])):
            for x in world["folds"][(c, pid)]:
                roc_rows.append([ids[pid], str(c), fmt(x[0]), str(int(x[1])), str(int(x[2])), fmt(x[3]), fmt(x[4])])
        write_csv(data / "training_roc.csv", ROC_HEADER, roc_rows)
        readme += README_ROC
    (data / "README.md").write_text(readme, encoding="utf-8")
    return ids


# --------------------------------------------------------------------------------- iad2 counterfactual
def twin_candidate(world: dict, seed: int, attempt: int) -> dict:
    """One counterfactual realisation (deterministic in seed and attempt):
    - per-fold thresholds are permuted within each cycle (the real thresholds separate the held-out label
      in cycles 2 and 3, so they would leak the real outcomes);
    - 12-20 patients receive a resistant outcome, drawn with weights favouring a high predicted probability
      relative to the row's threshold (no PSA term, so the PSA summaries keep their natural direction and
      relate to the outcome only through their correlation with the model); everyone else is responsive;
    - a resistant outcome ends that patient's predictions: his later prediction rows (and the history after
      the predicted cycle's start) are removed, as the trial withdrew resistant patients;
    - the authors' calls are p_resistant > threshold, except one planted record near its threshold that is
      called resistant although its probability is below the threshold."""
    rng = np.random.default_rng([seed, attempt])
    rows = [dict(r) for r in world["rows"]]
    scored = [r for r in rows if r["p"] is not None]
    for c in CYCLES:
        sel = [r for r in scored if r["cycle"] == c]
        perm = rng.permutation(len(sel))
        ks = [sel[j]["kappa"] for j in perm]
        for r, k in zip(sel, ks):
            r["kappa"] = k
    alpha = rng.uniform(12.0, 30.0)
    w = np.array([math.exp(alpha * (r["p"] - r["kappa"])) for r in scored])
    w = w * rng.uniform(0.5, 1.5, len(w))
    k = int(rng.integers(12, 21))
    chosen: dict[int, int] = {}
    avail = np.ones(len(scored), bool)
    while len(chosen) < k and avail.any():
        pw = np.where(avail, w, 0.0)
        i = int(rng.choice(len(scored), p=pw / pw.sum()))
        r = scored[i]
        chosen[r["pid"]] = r["cycle"]
        for j, s in enumerate(scored):
            if s["pid"] == r["pid"]:
                avail[j] = False
    kept = []
    for r in rows:
        stop = chosen.get(r["pid"])
        if stop is not None and r["cycle"] > stop:
            continue
        if r["p"] is not None:
            r["obs"] = stop == r["cycle"]
            r["call"] = r["p"] > r["kappa"]
        kept.append(r)
    near = sorted((r for r in kept if r["p"] is not None and r["p"] < r["kappa"]), key=lambda r: (r["kappa"] - r["p"], r["pid"], r["cycle"]))
    planted = near[int(rng.integers(0, min(5, len(near))))]
    planted["call"] = True
    return {"rows": kept, "folds": None, "hist": world["hist"], "planted": (planted["pid"], planted["cycle"]),
            "alpha": alpha, "k": k}


# ------------------------------------------------------------------------------------- results checks
def _text(v):
    return isinstance(v, str) and bool(v.strip())


def _num(v):
    return not isinstance(v, bool) and isinstance(v, (int, float)) and math.isfinite(v)


def _int(v):
    return _num(v) and v >= 0 and v == int(v)


def _prob(v):
    return _num(v) and 0 <= v <= 1


def _interval(v):
    return isinstance(v, list) and len(v) == 2 and all(_num(x) for x in v) and v[0] <= v[1]


RECOMPUTED = {"unit": lambda v: v in ("patient", "patient_cycle"), "n_scored": _int, "n_patients": _int,
              "tp": _int, "fn": _int, "fp": _int, "tn": _int,
              "sensitivity": _prob, "specificity": _prob, "accuracy": _prob, "auc": _prob,
              "auc_by_cycle": lambda v: isinstance(v, dict) and set(v) == {"2", "3", "4"}
              and all(x is None or _prob(x) for x in v.values())}
REPORTED_KEYS = ("accuracy", "sensitivity", "specificity", "auc")
REPORTED_ENTRY = {"reproduced": lambda v: type(v) is bool, "value": lambda v: v is None or _num(v), "how": lambda v: isinstance(v, str)}
FLAG_ENTRY = {"subject": _text, "cycle": _int, "reason": _text}
COMPARATOR_ENTRY = {"id": _text, "definition": _text, "auc": _prob,
                    "auc_model_minus_comparator": lambda v: v is None or (_num(v) and -1 <= v <= 1),
                    "ci95": lambda v: v is None or _interval(v), "scores_file": _text}
TOP = {"claims", "recomputed", "reported_numbers", "flagged_records", "comparators", "adopt_model", "extra"}


def _exact(obj, schema) -> bool:
    return isinstance(obj, dict) and set(obj) == set(schema) and all(test(obj[k]) for k, test in schema.items())


def loo_results_problems(res: dict) -> list[str]:
    """Validate the projected public contract: missing or mistyped defined fields fail closed."""
    if set(res) != TOP or not isinstance(res.get("extra"), dict):
        return ["results fields missing, unknown, or wrongly typed"]
    if not _exact(res["recomputed"], RECOMPUTED):
        return ["recomputed section malformed"]
    rep = res["reported_numbers"]
    if not isinstance(rep, dict) or set(rep) != set(REPORTED_KEYS) or not all(
            v is None or _exact(v, REPORTED_ENTRY) for v in rep.values()) or any(rep[k] is None for k in REPORTED_KEYS[:3]):
        return ["reported_numbers section malformed"]
    if not isinstance(res["flagged_records"], list) or not all(_exact(f, FLAG_ENTRY) for f in res["flagged_records"]):
        return ["flagged_records malformed"]
    comps = res["comparators"]
    if not isinstance(comps, list) or not all(_exact(c, COMPARATOR_ENTRY) for c in comps):
        return ["comparators malformed"]
    if len({c["id"] for c in comps}) != len(comps):
        return ["duplicate comparator ids"]
    if type(res["adopt_model"]) is not bool:
        return ["adopt_model must be a boolean"]
    return []


def load_loo_results(workdir: Path, warnings: list[str] | None = None):
    from biotasks import checks
    res, problems = result_format.load_results(workdir, result_format.LOO, warnings)
    if res is None:
        return None, problems
    problems = loo_results_problems(res)
    if problems:
        return None, problems
    fit = checks.find_claim(res, "fit_for_use")
    if fit is None:
        return None, ["claim 'fit_for_use' missing"]
    return res, []


def read_scores(workdir: Path, rel: str, scored_keys: list[tuple[str, int]], unscored: set = frozenset()):
    """(scores aligned to scored_keys with NaN where missing, problem or None). Strict: the file must be a
    regular file under outputs/, CSV with subject,cycle,score; every line names a prediction row at most once
    (lines for the unscored prediction rows are ignored)."""
    if not isinstance(rel, str) or rel.startswith("/") or "\\" in rel or ".." in Path(rel).parts or not rel.startswith("outputs/"):
        return None, "scores_file must be a relative path under outputs/"
    root = Path(workdir).resolve()
    p = Path(workdir) / rel
    if (any(Path(workdir).joinpath(*Path(rel).parts[:i]).is_symlink() for i in range(1, len(Path(rel).parts) + 1))
            or not p.is_file() or not p.resolve().is_relative_to(root / "outputs")):
        return None, "scores_file missing or not a regular file"
    if p.stat().st_size > 2_000_000:
        return None, "scores_file too large"
    try:
        with open(p, encoding="utf-8", newline="") as fh:
            rd = csv.DictReader(fh)
            if (rd.fieldnames is None or len({f.strip() for f in rd.fieldnames}) != len(rd.fieldnames)
                    or not {"subject", "cycle", "score"} <= {f.strip() for f in rd.fieldnames}):
                return None, "scores_file needs columns subject,cycle,score"
            index = {k: i for i, k in enumerate(scored_keys)}
            vals = np.full(len(scored_keys), np.nan)
            seen = set()
            for row in rd:
                if None in row:
                    return None, "scores_file has a line with more fields than its header"
                row = {k.strip(): (v or "").strip() for k, v in row.items()}
                try:
                    cycle = float(row["cycle"])
                    if not math.isfinite(cycle) or cycle != int(cycle):
                        return None, "scores_file cycle must be an integer"
                    key = (row["subject"], int(cycle))
                except (ValueError, OverflowError):
                    return None, "scores_file has an unparseable cycle"
                if key in seen:
                    return None, "scores_file lists a row twice"
                seen.add(key)
                if key in unscored:
                    continue
                if key not in index:
                    return None, "scores_file lists a row that is not a scored prediction"
                s = row["score"]
                if s.lower() in ("", "na", "nan", "none", "null"):
                    continue
                try:
                    v = float(s)
                except ValueError:
                    return None, "scores_file has an unparseable score"
                if math.isfinite(v):
                    vals[index[key]] = v
                else:
                    return None, "scores_file has a nonfinite score"
    except (OSError, UnicodeDecodeError, csv.Error):
        return None, "scores_file unreadable"
    return vals, None


_S = r"[^a-z0-9]+"
MAJORITY_WORDS = re.compile(
    rf"always{_S}(?:[a-z']+{_S}){{0,2}}?(responsive|non{_S}?resistant|negative|majority)|"
    rf"majority{_S}(class|classifier|rule|outcome|baseline|vote|prediction|predictor|accuracy|rate)|"
    rf"(most|more){_S}(frequent|common){_S}(class|outcome|label|category)|no{_S}?information{_S}(rate|classifier|rule|baseline)|"
    rf"base{_S}?rate|trivial{_S}(classifier|rule|baseline|predictor|model)|null{_S}(model|classifier|rule|predictor)|"
    rf"constant{_S}(classifier|prediction|predictor)|(all|every|each){_S}(?:[a-z']+{_S}){{0,2}}?(as{_S})?(responsive|non{_S}?resistant)|"
    rf"predict[a-z]*{_S}(everyone|everybody|no{_S}?one)", re.I)


def _numbers_with_context(obj, ctx: str = ""):
    """(context string, number) for every number in obj; context = key path plus any sibling statement/id."""
    if isinstance(obj, dict):
        local = " ".join(str(obj.get(k, "")) for k in ("id", "statement", "definition", "description", "name", "how"))
        for k, v in obj.items():
            yield from _numbers_with_context(v, f"{ctx} {k} {local}")
    elif isinstance(obj, list):
        for v in obj:
            yield from _numbers_with_context(v, ctx)
    elif _num(obj):
        yield ctx, float(obj)


def evaluate_loo(workdir: Path, key: dict, task: str, warnings: list[str] | None = None) -> list[dict]:
    """Items for iad1/iad2. Every expected value, tolerance and accepted status comes from the key."""
    from biotasks import checks
    items_all = key["items"]
    pd_items = set(key["prompt_derivable_items"])
    required = set(key["gating_items"])

    def item(i, verdict, evidence):
        it = checks.item(i, verdict, evidence[:400], required=i in required)
        it["prompt_derivable"] = i in pd_items
        return it

    res, problems = load_loo_results(workdir, warnings)
    if res is None:
        return [item(i, "incorrect", "; ".join(problems)) for i in items_all]
    tol = key["tolerance"]
    rec = res["recomputed"]
    rows = key["rows"]
    keys = [(r["subject"], r["cycle"]) for r in rows]
    obs = np.array([r["observed"] for r in rows], bool)
    flagged = {(f["subject"], int(f["cycle"])) for f in res["flagged_records"]}
    nan_rows = {tuple(x) for x in key["nan_rows"]}
    out = []

    # n_and_unit
    ok = (rec["unit"] == key["unit"] and rec["n_scored"] == key["n_scored"] and rec["n_patients"] == key["n_patients"]
          and nan_rows <= flagged)
    out.append(item("n_and_unit", "correct" if ok else "incorrect",
                    f"unit {rec['unit']!r} n_scored {rec['n_scored']} n_patients {rec['n_patients']}; "
                    f"unscored rows flagged: {nan_rows <= flagged}"))
    # counts (authors' calls) and the rates derived from them
    c = {k: rec[k] for k in ("tp", "fn", "fp", "tn")}
    ok = c == key["counts"] and sum(c.values()) == rec["n_scored"] and all(
        abs(rec[k] - key["rates"][k]) <= tol["rate"] for k in ("sensitivity", "specificity", "accuracy"))
    out.append(item("counts", "correct" if ok else "incorrect", f"counts {c}; rates within tolerance: {ok}"))
    # held-out AUC (pooled estimand, defined in TASK.md)
    ok = abs(rec["auc"] - key["auc"]) <= tol["auc"]
    out.append(item("heldout_auc", "correct" if ok else "incorrect", f"pooled auc {rec['auc']!r}; within tolerance: {ok}"))

    # comparators: recompute every AUC from its scores file against the key's outcomes
    feats = {name: np.array([np.nan if r[name] is None else r[name] for r in rows], float)
             for name in ("p", "kappa", "nadir", "end_psa")}
    later = np.array([r["has_later"] for r in rows], float)
    parsed, bad = [], []
    for comp in res["comparators"]:
        vals, prob = read_scores(workdir, comp["scores_file"], keys, nan_rows)
        if prob:
            bad.append(f"{comp['id'][:40]}: {prob}")
            continue
        a = auc(vals, obs)
        cover = float(np.isfinite(vals).mean())
        if a is None or abs(a - comp["auc"]) > tol["comparator_auc"]:
            bad.append(f"{comp['id'][:40]}: reported auc does not match its scores file")
            continue
        parsed.append((comp, vals, a, cover))
    ok = bool(res["comparators"]) and not bad
    out.append(item("comparators_recomputed", "correct" if ok else "incorrect",
                    f"{len(res['comparators'])} comparator(s); problems: {bad[:3]}" if res["comparators"] else "no comparator listed"))

    # strong_comparator: a prior-cycle PSA summary at least as strong as the key's (lazy-skeptic guard)
    g = key["guards"]
    best, review = None, None
    for comp, vals, a, cover in parsed:
        if cover < g["coverage"] or a < key["strong_threshold"]:
            continue
        match = [n for n in ("nadir", "end_psa") if (spearman(vals, feats[n]) or 0) >= g["rank_match"]]
        if match:
            best = f"{comp['id'][:40]} rank-matches the key's {match[0]}"
            break
        rho = {n: spearman(vals, v) for n, v in (("p", feats["p"]), ("kappa", feats["kappa"]),
                                                  ("p_minus_kappa", feats["p"] - feats["kappa"]), ("has_later", later))}
        leaky = [n for n, r in rho.items() if r is not None and abs(r) >= (g["structure_rho"] if n == "has_later" else g["model_rho"])]
        if leaky:
            review = f"{comp['id'][:40]} is strong but tracks {leaky}"
        else:
            best = f"{comp['id'][:40]} is a strong comparator (not model- or structure-derived)"
            break
    out.append(item("strong_comparator", "correct" if best else ("needs-review" if review else "incorrect"),
                    best or review or "no listed comparator reaches the key's strength threshold"))

    # fit_verdict: the bottom-line claim (and no adopt-while-not-fit contradiction)
    st = checks.find_claim(res, "fit_for_use")["status"]
    contradiction = res["adopt_model"] is True and st in ("refuted", "insufficient-evidence")
    ok = st in key["fit_status_allowed"] and not contradiction
    out.append(item("fit_verdict", "correct" if ok else "incorrect",
                    f"fit_for_use status {st!r}; adopt_model {res['adopt_model']}; allowed {key['fit_status_allowed']}"))

    # inconsistency: the record whose call contradicts its own threshold rule (critic #18 leniency)
    want = {tuple(x) for x in key["inconsistent_rows"]}
    extra = flagged - want - nan_rows
    ok = want <= flagged and len(extra) <= key["guards"]["max_extra_flags"]
    out.append(item("inconsistency", "correct" if ok else "incorrect",
                    f"flagged {len(flagged)} row(s); key record present: {want <= flagged}; other flags {len(extra)}"))

    # auc_by_cycle
    bc = rec["auc_by_cycle"]
    ok = all(bc[k] is not None and key["auc_by_cycle"][k] is not None and abs(bc[k] - key["auc_by_cycle"][k]) <= tol["auc"]
             for k in ("2", "3", "4"))
    out.append(item("auc_by_cycle", "correct" if ok else "incorrect", f"per-cycle AUCs within tolerance: {ok}"))

    # difference_ci: model minus the matched co-primary comparator, with an interval of the key's direction
    verdict, why = "incorrect", "no comparator matching a co-primary PSA summary reports a difference and interval"
    for comp, vals, a, cover in parsed:
        for n in ("nadir", "end_psa"):
            if (spearman(vals, feats[n]) or 0) >= g["rank_match"] and comp["auc_model_minus_comparator"] is not None and comp["ci95"]:
                ref = key["comparators"][n]
                lo, hi = comp["ci95"]
                direction = (lo <= 0 <= hi) if key["difference_direction"] == "includes_zero" else (lo > 0)
                est_ok = abs(comp["auc_model_minus_comparator"] - ref["auc_model_minus"]) <= tol["auc"]
                if est_ok and direction:
                    verdict, why = "correct", f"{comp['id'][:40]}: estimate and interval direction agree with the key"
                    break
                why = f"{comp['id'][:40]}: estimate ok {est_ok}, interval direction ok {direction}"
        if verdict == "correct":
            break
    out.append(item("difference_ci", verdict, why))

    # majority_comparison: the headline accuracy set against always predicting the majority outcome
    targets = (key["majority_accuracy"], key["accuracy_minus_majority"])
    hit = any(MAJORITY_WORDS.search(ctx) and any(abs(v - t) <= tol["rate"] for t in targets)
              for ctx, v in _numbers_with_context({k: res[k] for k in ("claims",)}))
    report = Path(workdir) / "REPORT.md"
    mention = False
    if not hit and report.is_file() and not report.is_symlink() and report.stat().st_size < 2_000_000:
        mention = bool(MAJORITY_WORDS.search(report.read_text(encoding="utf-8", errors="ignore")))
    out.append(item("majority_comparison", "correct" if hit else ("needs-review" if mention else "incorrect"),
                    "structured comparison with the majority-outcome accuracy found" if hit else
                    ("REPORT.md mentions a majority-outcome comparison" if mention else "no majority-outcome comparison found")))

    # auc_source (iad1 only): the reported 'mean AUC' traced to the training folds
    if "auc_source" in items_all:
        ra = res["reported_numbers"]["auc"]
        if ra is None or ra["value"] is None:
            verdict, why = "incorrect", "reported AUC not traced"
        else:
            near = abs(ra["value"] - key["training_auc"]["mean"]) <= tol["training_auc"]
            train = re.search(r"train", ra["how"], re.I) is not None
            verdict = "correct" if near and train else ("needs-review" if near else "incorrect")
            why = f"value matches the training-fold mean: {near}; how names training: {train}"
        out.append(item("auc_source", verdict, why))
    return out


def annotate_scores(out_path: Path) -> None:
    """Add score views to a checker output: all items, and the analysis-attributable score that excludes
    items derivable from the prompt alone (flagged per item by the checker)."""
    res = json.loads(Path(out_path).read_text())
    items = res.get("items", [])
    correct = lambda xs: round(sum(1 for i in xs if i["verdict"] == "correct") / len(xs), 6) if xs else 0.0
    attributable = [i for i in items if not i.get("prompt_derivable")]
    res["scores"] = {"gated": res.get("score"), "all_items": correct(items),
                     "analysis_attributable": correct(attributable),
                     "analysis_attributable_items": sorted(i["id"] for i in attributable)}
    Path(out_path).write_text(json.dumps(res, indent=2, sort_keys=True) + "\n")


def run_loo_check(task: str, items: list[str]) -> int:
    import argparse
    import sys
    from biotasks import checks
    warnings: list[str] = []
    rc = checks.run_check(task, items, lambda w, k, _r: evaluate_loo(w, k, task, warnings))
    if rc == 0:
        ap = argparse.ArgumentParser(add_help=False)
        ap.add_argument("--out", type=Path)
        a, _ = ap.parse_known_args(sys.argv[1:])
        annotate_scores(a.out)
        result_format.record_warnings(a.out, warnings)
    return rc


# ------------------------------------------------------------------------------------ reference (arm D)
LOO_ITEMS = ["n_and_unit", "counts", "heldout_auc", "comparators_recomputed", "strong_comparator", "fit_verdict",
             "inconsistency", "auc_by_cycle", "difference_ci", "majority_comparison", "auc_source"]
LOO_GATING = ["n_and_unit", "counts", "heldout_auc", "comparators_recomputed", "strong_comparator", "fit_verdict"]
# Items a closed-book reader can get from the prompt alone (critic review #5): the majority comparison follows
# from the quoted sensitivity/specificity/accuracy, the quoted 0.80 lands on the training-fold mean, and a
# two-of-four status verdict can be guessed. They stay reported but never count as analysis-attributable.
LOO_PROMPT_DERIVABLE = ["fit_verdict", "majority_comparison", "auc_source"]
COPRIMARY = ("nadir", "end_psa")


def scored_from_world(world: dict, ids: dict) -> dict:
    """The same structure read_loo_stage builds from staged files, built in memory (twin seed search)."""
    rows = sorted(world["rows"], key=lambda r: (ids[r["pid"]], r["cycle"]))
    keys = {(ids[r["pid"]], r["cycle"]) for r in rows if r["p"] is not None}
    scored, missing = [], []
    for r in rows:
        rec = {"subject": ids[r["pid"]], "cycle": r["cycle"]}
        if r["p"] is None:
            missing.append(rec)
            continue
        rec.update(p=r["p"], kappa=r["kappa"], call=bool(r["call"]), obs=bool(r["obs"]))
        rec["has_later"] = any((rec["subject"], c) in keys for c in CYCLES if c > r["cycle"])
        rec.update(prior_cycle_features(world["hist"][r["pid"]], r["cycle"]))
        scored.append(rec)
    return {"scored": scored, "missing": missing, "folds": None}


def loo_stats(st: dict, resamples: int = 4000) -> dict:
    S = st["scored"]
    obs = np.array([r["obs"] for r in S], bool)
    call = np.array([r["call"] for r in S], bool)
    p = np.array([r["p"] for r in S], float)
    kappa = np.array([r["kappa"] for r in S], float)
    cyc = np.array([r["cycle"] for r in S])
    subj = [r["subject"] for r in S]
    counts = confusion(obs, call)
    rule = confusion(obs, p > kappa)
    rt, rr = rates(counts), rates(rule)
    majority = float(max(obs.mean(), 1 - obs.mean()))
    a = auc(p, obs)
    by = {str(c): auc(p[cyc == c], obs[cyc == c]) for c in CYCLES}
    feats = {n: np.array([np.nan if r[n] is None else r[n] for r in S], float)
             for n in ("nadir", "end_psa", "nadir_zeros_kept", "end_psa_zeros_kept", "restart_psa")}
    comps = {n: {"auc": auc(v, obs), "coverage": float(np.isfinite(v).mean())} for n, v in feats.items()}
    for n in COPRIMARY:
        # resamples=0 is a screening mode for the twin seed search only (no interval computed)
        lo, hi, used = cluster_bootstrap(p, feats[n], obs, subj, resamples, 0) if resamples else (math.nan, math.nan, 0)
        comps[n].update(auc_model_minus=a - comps[n]["auc"], ci95=[lo, hi], draws_used=used)
    training = None
    if st.get("folds"):
        per = {k: trapezoid_auc([x[0] for x in v], [x[1] for x in v]) for k, v in st["folds"].items()}
        vals = np.array(list(per.values()))
        training = {"mean": float(vals.mean()), "sd": float(vals.std(ddof=1)), "n_folds": int(len(vals)), "by_cycle": {}}
        for c in CYCLES:
            v = np.array([x for (s, cc), x in per.items() if cc == c])
            training["by_cycle"][str(c)] = {"mean": float(v.mean()), "sd": float(v.std(ddof=1)), "n": int(len(v))}
    defined = [by[str(c)] for c in CYCLES if by[str(c)] is not None]
    n_c = {str(c): int((cyc == c).sum()) for c in CYCLES}
    return {
        "n_scored": len(S), "n_patients": len(set(subj)), "nan_rows": [[m["subject"], m["cycle"]] for m in st["missing"]],
        "counts": counts, "counts_threshold_rule": rule, "rates": rt, "rates_threshold_rule": rr,
        "majority_accuracy": majority, "accuracy_minus_majority": rt["accuracy"] - majority,
        "accuracy_minus_majority_threshold_rule": rr["accuracy"] - majority,
        "auc": a, "auc_by_cycle": by,
        "auc_alternatives": {"mean_of_cycles": float(np.mean(defined)),
                             "n_weighted_cycles": float(sum(by[k] * n_c[k] for k in by if by[k] is not None) /
                                                        sum(n_c[k] for k in by if by[k] is not None))},
        "positives_by_cycle": {str(c): int(obs[cyc == c].sum()) for c in CYCLES}, "rows_by_cycle": n_c,
        "comparators": comps, "training": training,
        "inconsistent_rows": [[r["subject"], r["cycle"]] for r in S if r["call"] != (r["p"] > r["kappa"])],
        "in_sample_trap_nadir_gt_2_accuracy": float(((feats["nadir"] > 2) == obs).mean()),
        "strong_threshold": min(a, max(comps[n]["auc"] for n in COPRIMARY)) - 0.05,
        "kappa_by_cycle": {str(c): {"mean": float(kappa[cyc == c].mean()), "sd": float(kappa[cyc == c].std(ddof=1)),
                                    "n": int((cyc == c).sum())} for c in CYCLES},
        "_arrays": {"obs": obs, "p": p, "kappa": kappa, "feats": feats, "subj": subj, "cyc": cyc},
    }


def twin_acceptance(s: dict, min_gain: float = 0.05, real: dict | None = None) -> dict:
    """Named acceptance conditions for the counterfactual twin (design 5.5 with the critic's fixes). `real` holds
    the real audit's pooled AUC, n and counts: a recalled answer must not pass the twin by coincidence."""
    comps = s["comparators"]
    npos = s["counts"]["tp"] + s["counts"]["fn"]
    per_cycle_ok = all(s["positives_by_cycle"][c] >= 2 and s["rows_by_cycle"][c] - s["positives_by_cycle"][c] >= 2 for c in s["rows_by_cycle"])
    return {
        "positives_12_to_20": 12 <= npos <= 20,
        "every_cycle_has_two_of_each_outcome": per_cycle_ok,
        "accuracy_beats_majority_by_margin": s["accuracy_minus_majority"] >= min_gain,
        "model_beats_coprimary_comparators_with_ci": all(comps[n]["auc_model_minus"] > 0 and comps[n]["ci95"][0] > 0 for n in COPRIMARY),
        "realistic_errors": s["counts"]["fp"] >= 3 and s["counts"]["fn"] >= 1,
        "realistic_discrimination": s["auc"] <= 0.95 and comps["nadir"]["auc"] >= 0.60,
        "claim_echo_auc_not_accepted": abs(s["auc"] - 0.80) > 0.02,
        "weak_comparators_stay_weak": all(comps[n]["auc"] < s["strong_threshold"] for n in ("restart_psa", "nadir_zeros_kept")),
        "single_planted_inconsistency": len(s["inconsistent_rows"]) == 1,
        "recall_answers_rejected": real is not None and abs(s["auc"] - real["auc"]) > 0.01
        and s["n_scored"] != real["n_scored"] and s["counts"] != real["counts"],
    }


def recall_guard(world: dict) -> dict:
    """The real audit's pooled AUC, n and counts (kept only in generator truth, inside the grading root)."""
    ids = pseudo_ids("recall-guard", 0, [r["pid"] for r in world["rows"]], 2)
    s = loo_stats(scored_from_world(world, ids), resamples=0)
    return {"auc": s["auc"], "n_scored": s["n_scored"], "counts": s["counts"]}


def protocol_consistent(st: dict) -> bool:
    """No resistant row is followed by a later prediction row for the same patient (the trial withdrew
    resistant patients); a twin that violated this would be visibly counterfactual."""
    return not any(r["obs"] and r["has_later"] for r in st["scored"])


def loo_key(task: str, s: dict, twin: bool, extra: dict) -> dict:
    rows = []
    for r_obs, r_p, r_k, r_s, r_c, i in zip(s["_arrays"]["obs"], s["_arrays"]["p"], s["_arrays"]["kappa"],
                                            s["_arrays"]["subj"], s["_arrays"]["cyc"], range(len(s["_arrays"]["obs"]))):
        f = s["_arrays"]["feats"]
        rows.append({"subject": r_s, "cycle": int(r_c), "observed": bool(r_obs), "p": r6(r_p), "kappa": r6(r_k),
                     "nadir": None if not np.isfinite(f["nadir"][i]) else float(f["nadir"][i]),
                     "end_psa": None if not np.isfinite(f["end_psa"][i]) else float(f["end_psa"][i]),
                     "has_later": None})
    later = {(r["subject"], r["cycle"]) for r in rows}
    for r in rows:
        r["has_later"] = any((r["subject"], c) in later for c in CYCLES if c > r["cycle"])
    comps = {n: {k: (r10(v) if isinstance(v, float) else ([r10(x) for x in v] if isinstance(v, list) else v))
                 for k, v in d.items()} for n, d in s["comparators"].items()}
    items = [i for i in LOO_ITEMS if not (twin and i == "auc_source")]
    key = {
        "schema": "bio-tasks/key@1", "task": task, "card_kind": "counterfactual-twin" if twin else "audit",
        "unit": "patient_cycle", "n_scored": s["n_scored"], "n_patients": s["n_patients"], "nan_rows": s["nan_rows"],
        "counts": s["counts"], "counts_threshold_rule": s["counts_threshold_rule"],
        # rates and the majority accuracy are fractions of small counts that can coincide with fractions in the staged
        # ROC table; six significant digits keep them out of the leakage scan's high-precision tokens (tolerance 0.005)
        "rates": {k: r6(v) for k, v in s["rates"].items()},
        "rates_threshold_rule": {k: r6(v) for k, v in s["rates_threshold_rule"].items()},
        "majority_accuracy": r6(s["majority_accuracy"]), "accuracy_minus_majority": r10(s["accuracy_minus_majority"]),
        "accuracy_minus_majority_threshold_rule": r10(s["accuracy_minus_majority_threshold_rule"]),
        "auc": r10(s["auc"]), "auc_by_cycle": {k: r10(v) for k, v in s["auc_by_cycle"].items()},
        "auc_alternatives_not_accepted": {k: r10(v) for k, v in s["auc_alternatives"].items()},
        "comparators": comps, "coprimary_comparators": list(COPRIMARY),
        "strong_threshold": r10(s["strong_threshold"]),
        "inconsistent_rows": s["inconsistent_rows"],
        "training_auc": None if s["training"] is None else {
            "mean": r10(s["training"]["mean"]), "sd": r10(s["training"]["sd"]), "n_folds": s["training"]["n_folds"],
            "by_cycle": {c: {k: (r10(v) if isinstance(v, float) else v) for k, v in d.items()}
                         for c, d in s["training"]["by_cycle"].items()}},
        "reported_auc_is_heldout": None if twin else False,
        "in_sample_trap_nadir_gt_2_accuracy": r10(s["in_sample_trap_nadir_gt_2_accuracy"]),
        "fit_status_allowed": ["tentative", "insufficient-evidence"] if twin else ["refuted", "insufficient-evidence"],
        "difference_direction": "excludes_zero_positive" if twin else "includes_zero",
        "majority_relation": "exceeds" if twin else "does_not_exceed",
        "items": items, "gating_items": LOO_GATING, "prompt_derivable_items": [i for i in LOO_PROMPT_DERIVABLE if i in items],
        "tolerance": {"auc": 0.005, "rate": 0.005, "training_auc": 0.003, "comparator_auc": 0.005},
        "guards": {"coverage": 0.95, "rank_match": 0.99, "model_rho": 0.9, "structure_rho": 0.6, "max_extra_flags": 2},
        "bootstrap": {"resamples": 4000, "rng": "numpy.random.default_rng(0)", "draw": "rng.integers(0, n_subjects, n_subjects)",
                      "subjects": "sorted pseudonymous ids", "skip": "draws with < 2 positives or < 2 negatives",
                      "interval": "numpy.percentile [2.5, 97.5]", "sign": "AUC(model) - AUC(comparator)"},
        "rows": rows,
    }
    key.update(extra)
    return key


def write_reference_answer(work: Path, s: dict, twin: bool) -> None:
    """The arm-D answer in the public schema (used by calibration as the reference answer)."""
    work.mkdir(parents=True, exist_ok=True)
    (work / "outputs").mkdir(exist_ok=True)
    A = s["_arrays"]
    keys = list(zip(A["subj"], [int(c) for c in A["cyc"]]))
    comps = []
    for n, label in (("nadir", "previous-cycle on-treatment PSA nadir"), ("end_psa", "previous-cycle end-of-treatment PSA")):
        path = f"outputs/comparator_{n}.csv"
        write_csv(work / path, ["subject", "cycle", "score"],
                  ([sj, str(c), "" if not np.isfinite(v) else repr(float(v))] for (sj, c), v in zip(keys, A["feats"][n])))
        d = s["comparators"][n]
        comps.append({"id": n, "definition": f"{label}: minimum/last PSA > 0 among cycle c-1 visits with on_treatment = 1 "
                                             "(PSA values of 0.00 treated as missing)",
                      "auc": r10(d["auc"]), "auc_model_minus_comparator": r10(d["auc_model_minus"]),
                      "ci95": [r10(x) for x in d["ci95"]], "scores_file": path})
    rt = s["rates"]
    flagged = [{"subject": sj, "cycle": c, "reason": "no prediction (probability, threshold and outcome missing)"} for sj, c in s["nan_rows"]]
    flagged += [{"subject": sj, "cycle": c, "reason": "authors_call contradicts p_resistant > threshold"} for sj, c in s["inconsistent_rows"]]
    better = s["accuracy_minus_majority"] > 0
    claims = [
        {"id": "fit_for_use",
         "statement": ("The held-out predictions beat always predicting 'responsive' and the previous-cycle PSA summaries, "
                       "which supports the intended use, pending external validation") if twin else
                      ("The held-out predictions do not support the intended use: accuracy is no better than always predicting "
                       "'responsive' and a previous-cycle PSA summary discriminates as well as the model"),
         "status": "tentative" if twin else "refuted"},
        {"id": "accuracy_vs_always_responsive",
         "statement": "Held-out accuracy minus the accuracy of always predicting 'responsive' "
                      + ("is positive" if better else "is not positive"),
         "status": "confirmed", "estimate": r10(s["accuracy_minus_majority"])},
        {"id": "heldout_auc", "statement": "Pooled held-out AUC of p_resistant over the scored patient-cycles",
         "status": "confirmed", "estimate": r10(s["auc"]), "n_units": s["n_scored"], "unit": "patient-cycle"},
    ]
    how = "authors_call against observed over the scored patient-cycles"
    res = {
        "claims": claims,
        "recomputed": {"unit": "patient_cycle", "n_scored": s["n_scored"], "n_patients": s["n_patients"], **s["counts"],
                       "sensitivity": r10(rt["sensitivity"]), "specificity": r10(rt["specificity"]),
                       "accuracy": r10(rt["accuracy"]), "auc": r10(s["auc"]),
                       "auc_by_cycle": {k: r10(v) for k, v in s["auc_by_cycle"].items()}},
        "reported_numbers": {
            "accuracy": {"reproduced": True, "value": r10(rt["accuracy"]), "how": how},
            "sensitivity": {"reproduced": True, "value": r10(rt["sensitivity"]), "how": how},
            "specificity": {"reproduced": True, "value": r10(rt["specificity"]), "how": how},
            "auc": None if twin else {"reproduced": True, "value": r10(s["training"]["mean"]),
                                      "how": "mean of the per-fold training ROC AUCs (training_roc.csv, trapezoid rule), "
                                             "not the held-out predictions"}},
        "flagged_records": flagged, "comparators": comps, "adopt_model": False,
        "extra": {"always_responsive_accuracy": r10(s["majority_accuracy"])},
    }
    (work / "results.json").write_text(json.dumps(res, indent=2) + "\n")
    (work / "REPORT.md").write_text(
        "# Reference analysis (arm D)\n\nRecomputed from the staged leave-one-out output: confusion matrix of the authors' calls "
        "over the scored patient-cycles, pooled and per-cycle held-out AUC, the previous-cycle PSA nadir and end-of-treatment PSA "
        "as comparators with a patient-cluster bootstrap interval for the AUC difference, the majority-outcome accuracy, "
        "and the records whose call contradicts their own threshold. The values are in results.json.\n")
