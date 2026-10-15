#!/usr/bin/env python3
"""Guard mutations: apply each mutant alone, run the package suite, restore the file.
A mutant is killed when the suite fails. Writes MUTATIONS.json next to this script's package.
    python3 packages/omb-investigate/scripts/mutate.py   (from the repo root, Node 24 on PATH)"""
import json, os, subprocess, sys, time
PKG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = os.path.join(PKG, "src")
MUTANTS = [
    ("M1 transitions not enforced", "machine.ts", "    if (phase !== due) {\n      const skipped", "    if (false) {\n      const skipped"),
    ("M2 plan turn may mount scrambled data", "mounts.ts", '  plan: ["task", "schema", "runtime"],', '  plan: ["task", "schema", "scrambled", "dev", "runtime"],'),
    ("M3 overlap with real data not refused", "mounts.ts", "      if (inside(m.path, f) || inside(f, m.path)) throw", "      if (false) throw"),
    ("M4 data canary scan disabled", "investigation.ts", "const leaked = lead ? scanForCanaries(lead.workdir, staged.canaries) : [];", "const leaked: string[] = [];"),
    ("M5 scrambled-run outputs carried into the bundle", "bundle.ts", 'const CODE_ENTRIES = ["code", "run_all.sh", "run_primary.sh"] as const;', 'const CODE_ENTRIES = ["code", "run_all.sh", "run_primary.sh", "outputs", "results.json"] as const;'),
    ("M6 worker plan edits survive freeze", "bundle.ts", '  copyFileSync(lockedPlan, path.join(dest, "plan.json"));', '  if (existsSync(path.join(workdir, "plan.json"))) copyFileSync(path.join(workdir, "plan.json"), path.join(dest, "plan.json")); else copyFileSync(lockedPlan, path.join(dest, "plan.json"));'),
    ("M7 look repair sees stderr", "prompts.ts", "    `The frozen code failed on the confirming data. Error category: ${category}.`,", "    `The frozen code failed on the confirming data. Error category: ${category}.`, String((globalThis as { __lastError?: string }).__lastError ?? ''),"),
    ("M8 interrupted look re-run as a first look", "investigation.ts", '    if (ctx.notes("look-started").some((n) => n.recordHash === record.hash)) {', "    if (false) {"),
    ("M9 crash channel ignored (repair offered)", "investigation.ts", "          if (twin.status === \"ok\") {", "          if (false) {"),
    ("M10 G8 always reports look 1", "replication.ts", "  const first = look.number === 1;", "  const first = true; void look.number;"),
    ("M11 degraded cap removed", "labels.ts", "    if (top && ctx.degraded) reasons.push(DEGRADED_REASON);", "    void DEGRADED_REASON;"),
    ("M12 replicator may run on the lead's family", "investigation.ts", 'family: { mode: "cross-family", producer: leadFamily }', 'family: { mode: "any" }'),
    ("M13 same-family G7 counts", "replication.ts", "  const sameFamily = input.families[0] === input.families[1];", "  const sameFamily = false;"),
    ("M14 registry not idempotent (double counting)", "stores.ts", "      if (existing) return { kind: \"done\", result: { ordinal: Number((existing.payload as JsonObject).ordinal), first: false } };", "      void existing;"),
    ("M15 dry cycles never counted", "boss.ts", "      cycle: c, newCount: reg.newCount, dry: reg.newCount === 0,", "      cycle: c, newCount: reg.newCount, dry: false,"),
    ("M16 novelty labels kept", "boss.ts", '  const dropped = Object.keys(root).filter((k) => k !== "annotations").map((k) => `$.${k}`);', "  const dropped: string[] = [];"),
    ("M17 boss may see scrambled data", "mounts.ts", '  boss: ["digest", "schema"],', '  boss: ["digest", "schema", "scrambled", "dev"],'),
    ("M18 stale scheduler jobs not retired", "investigation.ts", "    if (job && !isTerminal(job.state)) this.#d.fleet.sched.cancel(jobId, reason);", "    void job; void reason;"),
    ("M19 scramble leaves outcomes real", "tabular.ts", "  const outIdx = o.outcomes.map((c) => t.header.indexOf(c)).filter((j) => j >= 0);", "  const outIdx: number[] = [];"),
    ("M20 locked plan context not carried into the kernel plan", "investigation.ts", "        const text = kernelPlanText(readFileSync(path.join(lead!.workdir, \"plan.json\"), \"utf8\"), { plainStatement, paperSet });", "        const text: string | null = readFileSync(path.join(lead!.workdir, \"plan.json\"), \"utf8\"); void kernelPlanText;"),
    ("M21 completed phase rerun with new inputs", "machine.ts", "      if (done.inputHash !== inputHash) throw new PhaseInputChanged(phase, null);", "      void inputHash;"),
    ("M23 SQLite journal pins the per-stream count (the live-smoke bug)", "journal.ts", "    const lastGlobal = stored.at(-1)?.sequence ?? 0;", "    const lastGlobal = stored.length;"),
    ("M24 machine appends without its view of the stream", "machine.ts", "        const event = this.journal.append(this.stream, type, payload, this.#seen);", "        const event = this.journal.append(this.stream, type, payload);"),
    ("M25 conflicting phase completion re-applied blindly", "machine.ts", "        return { done: now.output };\n      }\n      this.assertCanRun(phase);", "        return \"retry\";\n      }\n      this.assertCanRun(phase);"),
    ("M26 ledger/registry append without the read view", "stores.ts", "      return d.result(journal.append(stream, d.type, d.payload, events.length));", "      return d.result(journal.append(stream, d.type, d.payload));"),
    ("M27 blinding strata/unit taken from the lead's plan (review 1)", "investigation.ts", "        const { unit, strata } = trustedBlinding(st.contract);", "        const unit = confirmatory.find((c) => c.unit)?.unit ?? null; const strata = [...new Set(confirmatory.flatMap((c) => c.strata))].sort(); void trustedBlinding;"),
    ("M28 unsafe strata not refused (review 1)", "tabular.ts", "  const problem = strataProblem(t, o, unitRows);", "  const problem = null as string | null; void strataProblem;"),
    ("M29 permutation may keep a unit's own outcome (review 1)", "tabular.ts", "  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * i);", "  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1));"),
    ("M30 no synthetic fallback for unpermutable units (review 1)", "tabular.ts", "      for (const u of units) for (const ri of unitRows.get(u)!) put(rows[ri]!, outIdx.map((j, k) => syntheticValue(types[k]!, [], rand, t.header[j]!, ri)));", "      void types;"),
    ("M31 unknown files copied into dev data (review 2)", "tabular.ts", "    if (skipped.length) warnings.push(`left out of the development data", "    for (const f of skipped) copyFileSync(path.join(req.staged.realDataDir, f), path.join(dir, f));\n    if (skipped.length) warnings.push(`left out of the development data"),
    ("M32 synthetic values from real samples (review 3)", "tabular.ts", "    const out = synthesizeTables(published.tables, [...tables, ...big.map((b) => b.table)]", "    const out = synthesizeTables([...tables, ...big.map((b) => b.table)].map(viewTable), [...tables, ...big.map((b) => b.table)]"),
    ("M33 keys not pseudonymised across tables (review 7)", "tabular.ts", "  if (c.type === \"string\") return true;", "  if (c.type === \"string\") return false;"),
    ("M34 program-wide LORD++ state not supplied to the kernel (review 4, V7-wire item 3)", "investigation.ts", "programMultiplicity: program.datasets,", "programMultiplicity: program.datasets.slice(0, 0),"),
    ("M45 earlier rejections earn no wealth (V7-wire item 3)", "multiplicity.ts", "  const prior = [...new Set(rejectedBelow)].filter((o) => allowed === null || allowed.has(o)).sort((a, b) => a - b);", "  const prior: number[] = []; void rejectedBelow; void allowed;"),
    ("M46 a re-test after a non-rejection gets fresh alpha (V7-wire item 3)", "multiplicity.ts", "    if (decided && !decided.rejected) {", "    if (decided && !decided.rejected && false) {"),
    ("M47 kernel decisions never recorded in the registry (V7-wire item 3)", "investigation.ts", "async () => recordDecisions(this.#d.registry, result.multiplicity ?? [], program, manifest, this.#id));", "async () => { void recordDecisions; return []; });"),
    ("M35 selection not persisted before registration (review 5)", "boss.ts", "    const sel = await ctx.step(\"select\", { c }, async () => this.#select(boss.text, boss.family));", "    const sel = this.#select(boss.text, boss.family);"),
    ("M36 route H certified against the full-data hash (review 6)", "investigation.ts", "    return st.route === \"H\" ? staged.partition!.heldOutManifestHash : staged.manifestHash;", "    return staged.manifestHash;"),
    ("M37 reproduction targets dropped (review 8)", "investigation.ts", "reproductionTargets: this.#reproductionTargets(), executionId:", "reproductionTargets: {}, executionId:"),
    ("M38 infrastructure failures reported as worker outcomes (live attempt 1)", "turns.ts", "  if (!INFRA_STATUSES.has(status)) return null;", "  if (INFRA_STATUSES.size > 0) return null;"),
    ("M39 live preflight ignores missing Codex credentials (live attempt 1)", "live.ts", "        if (!token && !key) failing.add(\"cli-unauthenticated\");", "        void token; void key;"),
    ("M40 provenance_unverified re-runs the turn (live attempt 2)", "turns.ts", "    if (status === \"provenance_unverified\" && env.provenanceIsWarning !== false && !adapterNetworkFailure((r.payload as WorkerPayload).result)) {", "    if (false) {"),
    ("M41 files on disk discarded after a failed job (live attempt 2)", "turns.ts", "  if (turn.ok || turn.hardStop || turn.job.endReason?.startsWith(\"network-down:\") || !turn.filesPresent) return false;", "  if (turn.ok || turn.hardStop || !turn.filesPresent || true) return false;"),
    ("M42 infrastructure terminal not retried (network outages)", "live.ts", "    if (out.status !== \"infrastructure\" || attempt > o.retries) return { out, attempts };", "    return { out, attempts };"),
    ("M43 plan lock records no registered procedure (V7-wire item 2)", "investigation.ts", "async () => procedurePort.resolve({ claim: c }));", "async () => ({ procedureId: null, registryVersion: null, registryHash: null, design: null, reason: String(procedurePort && 'unwired') }));"),
    ("M44 procedure selected without the locked design (V7-wire item 2)", "procedures.ts", "  const registered = resolveRegisteredProcedure(canonicalClaim(claim), DESIGN_ONLY);", "  const registered = resolveRegisteredProcedure(canonicalClaim({ ...claim, knobs: { ...claim.knobs, design: \"two-group\" } }), DESIGN_ONLY);"),
    ("M48 certification never receives the pinned contract (V7-wire item 1)", "investigation.ts", "      contract: ci ? st.contract : null,", "      contract: null,"),
    ("M49 contract bytes not verified before any model turn (V7-wire item 1)", "investigation.ts", "        if (!check.ok) return fail(`the pinned data contract does not verify", "        if (false) return fail(`the pinned data contract does not verify"),
    ("M50 plan check ignores the contract hierarchy (V7-wire item 1)", "investigation.ts", "checkPlan(lead ? readSmall(path.join(lead.workdir, \"plan.json\")) : null, st.contract ? contractRules(st.contract.design) : null);", "checkPlan(lead ? readSmall(path.join(lead.workdir, \"plan.json\")) : null, null);"),
    ("M51 unapproved contracts get a host receipt (V7-wire item 1)", "kernel.ts", "  const authority = req.contract.approval ? contractAuthority : undefined;", "  const authority = contractAuthority;"),
    ("M52 contract pin not checked against the host index (V7-wire item 1)", "contracts.ts", "    if (envelope.hash !== pinned || canonicalSha256(envelope.content) !== pinned)", "    if (false)"),
    ("M53 the host flag alone establishes separation (V7-wire item 5)", "investigation.ts", "    if (!this.#d.attestation) return { separated: false, attested: false, attestation: null,", "    if (!this.#d.attestation) return { separated: this.#d.host.osUserSeparation, attested: false, attestation: null,"),
    ("M54 attestation not checked against the OS (V7-wire item 5)", "os-attestation.ts", "  if (cert !== a.certUid || run !== a.runUid) return", "  if (false) return"),
    ("M55 an attested launcher alone separates route P (V7-wire item 5)", "investigation.ts", "    if (!this.#d.host.osUserSeparation) {", "    if (false) {"),
    ("M56 a concurrent re-test overturns a recorded non-rejection (V7-wire item 3)", "multiplicity.ts", "    if (!r.first && d.rejected && !r.decision.rejected", "    if (false && !r.first && d.rejected && !r.decision.rejected"),
    ("M22 journal chain not verified", "machine.ts", "    if (!check.valid) throw new TransitionRefused(\"*\", `journal chain of ${this.stream} is broken at event ${check.brokenAt}`);", "    void check;"),
]
ONLY = sys.argv[1:]  # optional name prefixes (e.g. M14): run a subset and leave MUTATIONS.json untouched
results = []
for name, file, old, new in MUTANTS:
    if ONLY and not any(name.startswith(o + " ") for o in ONLY):
        continue
    path = os.path.join(SRC, file)
    original = open(path).read()
    if original.count(old) != 1:
        results.append({"mutant": name, "file": file, "status": "not-applied", "detail": f"needle found {original.count(old)} times"}); print("NOT APPLIED", name); continue
    open(path, "w").write(original.replace(old, new))
    t0 = time.time()
    try:
        r = subprocess.run(["npx", "vitest", "run", "packages/omb-investigate", "--reporter=dot", "--bail=1"], capture_output=True, text=True, timeout=600)
        failed = [l.strip() for l in (r.stdout + r.stderr).splitlines() if l.strip().startswith(("FAIL", "×"))][:3]
        status = "killed" if r.returncode != 0 else "survived"
    finally:
        open(path, "w").write(original)
    results.append({"mutant": name, "file": file, "status": status, "killedBy": failed, "seconds": round(time.time() - t0, 1)})
    print(status.upper(), name, failed[:1])
if not ONLY: json.dump({"package": "omb-investigate", "killed": sum(r["status"] == "killed" for r in results), "total": len(results), "results": results}, open(os.path.join(PKG, "MUTATIONS.json"), "w"), indent=2)
print(f"{sum(r['status'] == 'killed' for r in results)}/{len(results)} killed")
sys.exit(0 if all(r["status"] == "killed" for r in results) else 1)
