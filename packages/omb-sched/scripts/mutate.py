#!/usr/bin/env python3
"""Mutation check for omb-sched: apply each mutation alone, run the package suite, restore the file.

A mutation is KILLED when the suite fails with it applied. Every source file is restored in a finally
block even if the run is interrupted. Usage (from the repo root, Node 24 on PATH):
    nice -n 15 python3 packages/omb-sched/scripts/mutate.py [--out packages/omb-sched/MUTATIONS.json]
"""
import json
import pathlib
import subprocess
import sys

PKG = pathlib.Path(__file__).resolve().parent.parent
ROOT = PKG.parent.parent
SRC = PKG / "src"

MUTATIONS = [
    ("M1", "reservation uses declared instead of measured memory", "scheduler.ts",
     'reserveMem: r.reason === "memory-floor" ? demand.memBytes : 0', 'reserveMem: r.reason === "memory-floor" ? job.spec.demand.memBytes : 0'),
    ("M2", "prework refusal consumes an attempt", "scheduler.ts",
     '    job.preferred = isFamily(hintTo) && hintTo !== fam ? hintTo : null;',
     '    if (status === "refused-prework") job.attemptsUsed += 1;\n    job.preferred = isFamily(hintTo) && hintTo !== fam ? hintTo : null;'),
    ("M3", "cross-family filter dropped", "families.ts", 'order.filter((f) => f !== req.producer)', 'order'),
    ("M4", "refusing family not excluded", "scheduler.ts",
     'job.excluded = sortFamilies([...job.excluded, fam]);', 'job.excluded = sortFamilies([...job.excluded]);'),
    ("M5", "rate limit pauses both pools", "scheduler.ts",
     '    if (p.parkedUntil === null || p.parkedUntil < until) {\n      p.parkedUntil = until;\n      p.parkReason = "rate-limited";',
     '    for (const o of FAMILIES) { tx.provider(o).parkedUntil = until; tx.provider(o).parkReason = "rate-limited"; tx.touchProvider(o); }\n'
     '    if (p.parkedUntil === null || p.parkedUntil < until) {\n      p.parkedUntil = until;\n      p.parkReason = "rate-limited";'),
    ("M6", "window reset ignored", "quota.ts", '  if (w.resetsAt !== null && now >= w.resetsAt) return 0;\n', ''),
    ("M7", "G8 lane not serialized", "admission.ts", 'if (kind === "look" && active.some((x) => x.kind === "look"))', 'if (false)'),
    ("M8", "quiet mode does not drain", "scheduler.ts",
     'if (tx.running().some((j) => j.spec.quietGroup !== q.group)) return "quiet-draining";', ''),
    ("M9", "interrupted G8 look re-run automatically", "scheduler.ts", 'if (job.spec.kind === "look") {', 'if (false) {'),
    ("M10", "no id tie-break (insertion order decides)", "types.ts",
     'return a.spec.id < b.spec.id ? -1 : a.spec.id > b.spec.id ? 1 : 0;', 'return 0;'),
    ("M11", "memory floor boundary off by one", "admission.ts",
     '- demand.memBytes < a.memFloorBytes)', '- demand.memBytes <= a.memFloorBytes)'),
    ("M12", "maxShare not enforced", "quota.ts",
     '  if (omertaSpentNow(p, now) + load.inflightCost + cost > q.maxShare * 100) return no("max-share");\n', ''),
    ("M13", "weekly band ignored", "quota.ts", 'if (!bandAllows(band, kind, carryOver)) return no(`band:${band}`);', ''),
    ("M14", "crash recovery leaves jobs running", "scheduler.ts",
     '      if (job.state !== "running" || !job.running) continue;', '      continue;'),
    ("M15", "stale outcome applied to the new dispatch", "scheduler.ts",
     'const job = tx.ordered().find((j) => j.state === "running" && j.running?.dispatchId === dispatchId);\n    if (!job) {\n      tx.emit("stale-outcome"',
     'const job = tx.ordered().find((j) => j.state === "running" && j.running?.dispatchId.split("#")[0] === dispatchId.split("#")[0]);\n    if (!job) {\n      tx.emit("stale-outcome"'),
    # Cross-family review findings (review-v9.last.md).
    ("R1", "F1: a quiet-blocked outsider look holds the G8 FIFO barrier", "scheduler.ts",
     'if (job.spec.kind === "look" && blocked.reason !== "quiet") lookWaiting = true;', 'if (job.spec.kind === "look") lookWaiting = true;'),
    ("R2a", "F2: a reading without a 5-hour window erases spend and window identity", "quota.ts",
     '  if (r.weekly) p.weekly =', '  if (!next) { p.omertaSpent5h = 0; p.windowKey = null; p.fiveHour = null; }\n  if (r.weekly) p.weekly ='),
    ("R2b", "F2: maxShare skipped in probe mode", "quota.ts",
     '  if (omertaSpentNow(p, now) + load.inflightCost + cost > q.maxShare * 100) return no("max-share");',
     '  if (!quotaUnknown(p) && omertaSpentNow(p, now) + load.inflightCost + cost > q.maxShare * 100) return no("max-share");'),
    ("R3", "F3: a failed reader keeps full concurrency on the old reading", "scheduler.ts",
     'const ok = reading !== null && reading !== undefined && this.#observe(tx, f, reading, busyNow, busyAfter);',
     'const ok = (reading !== null && reading !== undefined && this.#observe(tx, f, reading, busyNow, busyAfter)) || tx.provider(f).reading !== null;'),
    ("R4a", "F4: an unchanged snapshot counts as a cost sample", "scheduler.ts",
     'const fresh = end !== null && run.quotaObservedAt !== null && end.observedAt > run.quotaObservedAt\n'
     '          && end.observedAt >= run.startedAt && end.observedAt >= now - this.policy.quota.sampleFreshnessMs;',
     'const fresh = true;'),
    ("R4b", "F4: seeding ends on unmeasured runs", "quota.ts", '(p.costs["*"]?.n ?? 0) < q.seedJobs', 'p.completedRuns < q.seedJobs'),
    ("R5", "F5: a refusal consumes an attempt and can exhaust before the reroute", "scheduler.ts",
     '    job.preferred = isFamily(hintTo) && hintTo !== fam ? hintTo : null;',
     '    job.attemptsUsed += 1;\n    if (job.attemptsUsed >= job.spec.maxAttempts) { this.#end(tx, job, "exhausted", "cap", fam); return "exhausted"; }\n'
     '    job.preferred = isFamily(hintTo) && hintTo !== fam ? hintTo : null;'),
    ("R6", "F6: the first occurrence of a conflicting proposal id wins", "multiverse.ts",
     '    if (new Set(group.map((c) => c.key)).size > 1) {', '    if (false) {'),
    ("R7", "retained 5-hour window never expires without a reset time", "quota.ts",
     '  if (w.resetsAt === null && now >= w.observedAt + windowMs) return 0;\n', ''),
]


def main() -> int:
    results = []
    for mid, name, file, before, after in MUTATIONS:
        path = SRC / file
        original = path.read_text()
        if before not in original:
            results.append({"id": mid, "name": name, "result": "PATTERN-MISSING", "failing": []})
            continue
        path.write_text(original.replace(before, after, 1))
        try:
            run = subprocess.run(["npx", "vitest", "run", "packages/omb-sched"], cwd=ROOT, capture_output=True, text=True, timeout=180)
            out = run.stdout + run.stderr
            failing = sorted({line.strip()[2:].split(" > ")[-1].rsplit(" ", 1)[0] for line in out.splitlines() if line.strip().startswith("× ")})
            results.append({"id": mid, "name": name, "result": "KILLED" if run.returncode != 0 else "SURVIVED", "failing": failing})
        finally:
            path.write_text(original)
        print(f"{mid:4} {results[-1]['result']:8} {name}", flush=True)
    if "--out" in sys.argv:
        out_path = pathlib.Path(sys.argv[sys.argv.index("--out") + 1])
        out_path.write_text(json.dumps(results, indent=2) + "\n")
    return 0 if all(r["result"] == "KILLED" for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
