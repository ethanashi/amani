import { EventEmitter } from "node:events";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  realpathSync,
  lstatSync,
  readdirSync,
  copyFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
const stages = {
  question: "Literature",
  stage: "Literature",
  plan: "Literature",
  "plan-lock": "Plan locked",
  code: "Practice",
  "dry-run": "Practice",
  freeze: "Practice",
  look: "Real-data look",
  certify: "Certifying",
  replicate: "Certifying",
  interpret: "Paper",
  deliverable: "Paper",
};
const digest = (b) => createHash("sha256").update(b).digest("hex");
const output = (rows, phase) =>
  rows
    .filter((e) => e.type === "phase-completed" && e.payload.phase === phase)
    .at(-1)?.payload.output;
const diagnostic = (s) =>
  typeof s === "string"
    ? s
        .replace(/Bearer\s+\S+|\bsk-[A-Za-z0-9_-]+/gi, "[REDACTED]")
        .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
        .slice(0, 1200)
    : "";
const failure = (p, context = {}) => {
  if (p.outcome === "ok")
    return `${p.provider ?? ""} ${p.model ?? ""}: Attempt completed successfully.`;
  const why =
    {
      "family-violation":
        "The returned model violated the required family separation. Amani rejected this attempt.",
      refusal:
        "The model refused the request. Amani did not rewrite it to bypass the refusal.",
      "non-compliance":
        "The model did not follow the required output contract. Amani rejected its output.",
      auth: "Provider authentication failed.",
      stall: "The provider stopped making progress.",
      timeout: "The provider exceeded its time limit.",
    }[p.outcome] ?? `Provider outcome: ${p.outcome}.`;
  const did =
    {
      failover:
        "Failover requested; a next-provider dispatch has not been confirmed.",
      retry: "A retry was scheduled under the configured policy.",
      repair: "Amani requested a permitted output repair.",
      complete: "The attempt completed.",
    }[p.decision] ??
    "Review the chain and provider configuration in Settings, then resume when ready.";
  const recovery =
    p.outcome === "auth"
      ? p.providerKind?.endsWith("-cli") ||
        ["codex", "claude"].includes(p.provider)
        ? "Repair CLI sign-in for this provider"
        : "Repair API credentials in Settings → Models (Keychain)"
      : p.outcome === "rate-limit"
        ? "Wait for the provider quota/reset time or configure another eligible model in Settings → Models"
        : "Review the provider failure and eligible chain in Settings → Models";
  const reset =
    Number.isFinite(p.resetAt) && Math.abs(p.resetAt) <= 8640000000000000
      ? ` Retry/reset time: ${new Date(p.resetAt).toISOString()}.`
      : "";
  const outcome = context.recovered
    ? `A later provider attempt completed successfully.${context.paused ? " Investigation paused at its current owner gate; review Needs you." : ""}`
    : context.exhausted
      ? "All eligible providers failed. Investigation paused; no partial result was accepted."
      : context.paused
        ? "Investigation paused; no attempt is progressing."
        : context.dispatch
          ? `Next-provider dispatch recorded: ${context.dispatch.provider} ${context.dispatch.model}.`
          : did;
  return `${p.provider ?? ""} ${p.model ?? ""}: ${why} ${diagnostic(p.text)}${reset} ${outcome}${context.recovered ? "" : ` ${recovery}, then explicitly Resume when paused.`}`;
};
export function ledgerEntry(id, e) {
  const p = e.payload ?? {};
  return {
    id: `${id}-${e.seq}`,
    investigationId: id,
    time: new Date(e.at).toISOString(),
    type: e.type,
    payload: JSON.stringify(p, null, 2),
    text:
      e.type === "model-attempt"
        ? failure(p)
        : ["phase-started", "phase-resumed", "phase-completed"].includes(e.type)
          ? `${e.type}: ${p.phase}${p.output?.terminal?.reason ? " · " + p.output.terminal.reason : ""}`
          : `${e.type}: ${p.reason ?? p.message ?? p.action ?? JSON.stringify(p).slice(0, 160)}`,
    role: typeof p.role === "string" ? p.role : undefined,
    provider: typeof p.provider === "string" ? p.provider : undefined,
    model: typeof p.model === "string" ? p.model : undefined,
    outcome: typeof p.outcome === "string" ? p.outcome : undefined,
    decision: typeof p.decision === "string" ? p.decision : undefined,
  };
}
/** Presentation mapping only. All scientific state, controls, configuration and labels belong to EngineService. */
export class StudioProtocol {
  events = new EventEmitter();
  pending = new Set();
  contracts = new Map();
  constructor(engine) {
    this.engine = engine;
    this.root = engine.options.root;
    this.file = path.join(this.root, "studio.json");
    this.settings = {
      concurrency: 2,
      cpuCores: 0,
      memoryGB: 0,
      dataFolders: [],
      notifications: { needsYou: false, done: false },
      author: { name: "", orcid: "" },
      theme: "system",
    };
    try {
      this.settings = {
        ...this.settings,
        ...JSON.parse(readFileSync(this.file, "utf8")),
      };
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    engine.events.on("notification", (n) => {
      const id = n.params.investigationId ?? n.params.id;
      if (n.method === "investigation.updated" && id) {
        this.pending.add(id);
        if (!this.flush)
          this.flush = setImmediate(() => {
            this.flush = null;
            for (const id of this.pending) {
              try {
                this.notify("investigation.updated", {
                  investigation: this.summary(id),
                });
              } catch {
                this.notify("engine.error", {
                  message:
                    "Investigation ledger unavailable; reconnect or inspect engine state.",
                });
              }
            }
            this.pending.clear();
            this.notify("system.changed", {});
            this.notify("inbox.changed", {});
          });
      } else if (n.method === "ledger.tail")
        for (const e of n.params.records)
          this.notify("ledger.entry", { entry: ledgerEntry(id, e) });
      else if (n.method === "model.attempt")
        this.notify("provider.attempt", {
          ...n.params,
          message: failure(n.params),
        });
      else this.notify(n.method, n.params);
    });
  }
  notify(method, params) {
    this.events.emit("notification", { jsonrpc: "2.0", method, params });
  }
  summary(id) {
    const s = this.engine.state(id),
      rows = this.engine.records(id),
      last = rows
        .filter(
          (e) =>
            e.type === "phase-started" ||
            e.type === "phase-resumed" ||
            e.type === "phase-completed",
        )
        .at(-1),
      phase = last?.payload.phase ?? "question";
    const completed = output(rows, "deliverable");
    const state =
      s.status === "cancelled"
        ? "cancelled"
        : s.running
          ? s.status === "pausing"
            ? "pausing"
            : "running"
          : s.status === "created"
            ? "paused"
            : s.status === "needs-you"
              ? "needs-you"
              : s.status === "paused"
                ? "paused"
                : completed
                  ? "done"
                  : "needs-you";
    const claims = completed?.claims ?? s.result?.claims ?? [];
    const labels = claims.length
      ? Object.fromEntries(
          [...new Set(claims.map((c) => c.status))].map((k) => [
            k,
            claims.filter((c) => c.status === k).length,
          ]),
        )
      : null;
    const meta = rows.find((e) => e.type === "studio-created")?.payload;
    return {
      id,
      name: s.spec.question.slice(0, 70),
      question: s.spec.question,
      project: meta?.project ?? s.spec.dataset.datasetId,
      phase,
      stage: completed ? "Done" : (stages[phase] ?? "Literature"),
      state,
      labels,
      elapsed: `${rows.length} events`,
      next:
        state === "paused"
          ? "Paused; resume explicitly when ready"
          : state === "needs-you"
            ? "Review Needs you and Activity"
            : state === "pausing"
              ? "Pausing at the next safe phase boundary"
              : completed
                ? String(completed.status)
                : `Phase: ${phase}`,
      createdAt: new Date(rows[0]?.at ?? 0).toISOString(),
      updatedAt: new Date(rows.at(-1)?.at ?? 0).toISOString(),
    };
  }
  artifact(id, filename) {
    const rows = this.engine.records(id),
      d = output(rows, "deliverable");
    if (!d?.files?.[filename] || path.basename(filename) !== filename)
      throw Error("Artifact has not been published by the engine");
    const root = realpathSync(this.root),
      dir = realpathSync(d.dir),
      file = path.join(dir, filename);
    if (
      !dir.startsWith(root + path.sep) ||
      lstatSync(file).isSymbolicLink() ||
      !lstatSync(file).isFile() ||
      lstatSync(file).size > 30 * 1024 * 1024
    )
      throw Error("Artifact path refused");
    const bytes = readFileSync(file);
    if (digest(bytes) !== d.files[filename])
      throw Error("Artifact integrity check failed");
    return bytes;
  }
  detail(id) {
    const summary = this.summary(id),
      rows = this.engine.records(id),
      s = this.engine.state(id),
      done = output(rows, "deliverable"),
      stage = output(rows, "stage"),
      claims = done?.claims ?? s.result?.claims ?? [];
    let report = null;
    const downloads = Object.keys(done?.files ?? {}).map((filename) => ({
      label: filename,
      filename,
      kind: filename,
    }));
    if (done?.files?.["report.md"])
      report = this.artifact(id, "report.md").toString("utf8");
    const planned = output(rows, "plan"),
      locked = output(rows, "plan-lock");
    const plan = [
      { title: "Research question", text: s.spec.question },
      ...(planned
        ? [
            {
              title: "Plan statement",
              text: planned.plainStatement ?? "No evaluable plan",
            },
            ...(planned.claims ?? []).map((c) => ({
              title: `Claim ${c.id}`,
              text: `${c.kind}: ${c.estimand ?? ""}. Exposure: ${c.exposure ?? "unspecified"}. Outcome: ${c.outcome ?? "unspecified"}. Unit: ${c.unit ?? "unspecified"}. Adjustment: ${(c.adjustment ?? []).join(", ") || "none"}. ${c.exploratory ? "Exploratory" : "Confirmatory"}.`,
            })),
          ]
        : []),
      ...(locked
        ? [
            {
              title: "Plan locked",
              text: `Approved by ${locked.approvalActor}. Plan hash: ${locked.planHash}`,
            },
          ]
        : []),
    ];
    return {
      ...summary,
      resumeToken: (() => {
        if (s.result?.status !== "blocked-by-system-bug") return null;
        try {
          const dir = realpathSync(s.result.dir);
          if (!dir.startsWith(realpathSync(this.root) + path.sep)) return null;
          const f = path.join(dir, "triage-status.json");
          if (lstatSync(f).isSymbolicLink() || lstatSync(f).size > 100000)
            return null;
          return JSON.parse(readFileSync(f, "utf8")).resumeToken ?? null;
        } catch {
          return null;
        }
      })(),
      providerNotice: (() => {
        const e = rows
          .filter(
            (e) => e.type === "model-attempt" && e.payload.outcome !== "ok",
          )
          .at(-1);
        if (!e) return null;
        const following = rows.filter((row) => row.seq > e.seq);
        const exhausted = following.some(
          (row) =>
            row.type === "needs-you" &&
            /All eligible model providers failed/.test(
              row.payload.reason ?? "",
            ),
        );
        const dispatch = following
          .filter((row) => row.type === "turn-dispatch")
          .at(-1)?.payload;
        const recovered = following.some(
          (row) => row.type === "model-attempt" && row.payload.outcome === "ok",
        );
        const paused = ["paused", "needs-you"].includes(s.status);
        return failure(e.payload, {
          exhausted: exhausted && paused && !recovered,
          paused,
          dispatch,
          recovered,
        });
      })(),
      data: [
        {
          id: s.spec.dataset.datasetId,
          name: s.spec.dataset.datasetId,
          rows: stage?.staged?.effectiveUnits ?? null,
          purpose: "Engine-staged dataset",
          contract: stage?.staged
            ? "Staged; see journal for contract/attestation limits"
            : "Pending staging",
        },
      ],
      plan,
      results: claims.map((c) => ({
        id: c.claimId,
        title: c.kind ?? c.claimId,
        label: c.status,
        effect: "See verified report",
        interval: "",
        checks: [...c.reasons, ...c.limitations],
      })),
      metrics: [
        { label: "Phase", value: summary.phase },
        { label: "Journal events", value: String(rows.length) },
        { label: "Claims", value: String(claims.length) },
      ],
      certificate: null,
      paper: {
        title: s.spec.question,
        abstract:
          "Engine report and paper inputs. Rendered manuscripts and endorsement require the paper pipeline, which is not present in this engine build.",
        pdf: done?.files?.["paper.pdf"]
          ? this.artifact(id, "paper.pdf").toString("base64")
          : null,
        report,
        downloads,
        checklist: [],
        endorsed: false,
      },
    };
  }
  inbox() {
    return this.engine
      .inbox()
      .filter((i) => {
        const s = this.engine.state(i.investigationId);
        return (
          (i.type === "amendment-request" || !s.running) &&
          s.status !== "cancelled" &&
          (i.type === "amendment-request" ||
            !output(this.engine.records(i.investigationId), "deliverable"))
        );
      })
      .reverse()
      .map((i) => ({
        id: `${i.investigationId}/${i.sequence}`,
        investigationId: i.investigationId,
        kind: i.type,
        title:
          i.type === "owner-plan-request"
            ? "Approve the locked plan"
            : i.type === "needs-you"
              ? "Investigation needs attention"
              : i.type,
        reason: JSON.stringify(i.payload, null, 2),
        actions:
          i.type === "owner-plan-request" ? ["approve-plan"] : ["acknowledge"],
      }));
  }
  async call(method, p = {}) {
    switch (method) {
      case "investigations.list":
        return this.engine.specs().map((s) => this.summary(s.id));
      case "investigations.get":
        return this.detail(p.investigationId);
      case "investigations.create": {
        if (!p.spec) {
          const checked = this.contracts.get(p.contractToken);
          if (!checked)
            throw Error("Check the selected data files before creating");
          if (!p.question?.trim() || !p.project?.trim())
            throw Error("Question and project are required");
          const id = `inv-${randomUUID()}`,
            dataRoot = path.join(this.root, "datasets", id);
          mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
          for (const f of checked) {
            const bytes = readFileSync(f.path);
            if (digest(bytes) !== f.hash)
              throw Error("Data changed; check the files again");
            writeFileSync(path.join(dataRoot, f.name), bytes, {
              mode: 0o600,
              flag: "wx",
            });
          }
          p = {
            ...p,
            spec: {
              id,
              question: p.question,
              plainStatement: p.question,
              dataset: { datasetId: p.project, dataRoot },
              route: "P",
            },
          };
        }
        await this.engine.call(method, { spec: p.spec });
        this.engine.journal.append(`inv:${p.spec.id}`, "studio-created", {
          project: p.project ?? p.spec.dataset.datasetId,
        });
        return this.summary(p.spec.id);
      }
      case "investigations.pause":
      case "investigations.resume":
      case "investigations.cancel":
        await this.engine.call(method, p);
        return this.summary(p.investigationId);
      case "ledger.tail":
        if (p.unsubscribe) return [];
        return (await this.engine.call(method, p)).records.map((e) =>
          ledgerEntry(p.investigationId, e),
        );
      case "inbox.list":
        return this.inbox();
      case "inbox.act": {
        if (p.action === "draft-amendment") return this.engine.call(method, p);
        const i = this.engine
          .inbox()
          .find((i) => `${i.investigationId}/${i.sequence}` === p.id);
        if (!i)
          throw Error("This action is not supported by the connected engine");
        const result = await this.engine.call(method, {
          investigationId: i.investigationId,
          sequence: i.sequence,
          action: p.action,
          planHash: i.payload.planHash,
          reason: p.note,
          resumeToken: p.resumeToken,
        });
        this.notify("inbox.changed", {});
        return result;
      }
      case "assistant.ask": {
        if (
          typeof p.requestId !== "string" ||
          !p.requestId ||
          p.requestId.length > 200
        )
          throw Error("Assistant request ID required");
        try {
          const r = await this.engine.call(method, p);
          return {
            investigationId: p.investigationId,
            requestId: p.requestId,
            text: r.answer,
            citations: r.citations
              .filter((c) => c.investigationId === p.investigationId)
              .map((c) => ({
                entryId: `${c.investigationId}-${c.sequence}`,
                label: `Ledger ${c.sequence} · ${c.hash.slice(0, 12)}`,
              })),
            amendmentDraft: r.amendmentDraft
              ? JSON.stringify(r.amendmentDraft, null, 2)
              : "",
          };
        } catch {
          throw Error(
            "Assistant chain failed or refused. No answer was accepted. Review the provider attempt shown above and Settings → Models, then try again.",
          );
        }
      }
      case "providers.models":
        return (await this.engine.call(method, p)).models;
      case "providers.set": {
        const r = await this.engine.call(method, p);
        if (!p.validateOnly && r.config) this.notify("system.changed", {});
        return { ...r, ok: r.config !== null };
      }
      case "providers.test": {
        const r = await this.engine.call(method, p);
        return { ...r, message: r.detail ?? r.outcome };
      }
      case "settings.get":
        return this.settings;
      case "settings.set": {
        const s = p.settings;
        if (
          !s ||
          !["light", "dark", "system"].includes(s.theme) ||
          !Array.isArray(s.dataFolders) ||
          s.dataFolders.some(
            (x) => typeof x !== "string" || !path.isAbsolute(x),
          ) ||
          typeof s.author?.name !== "string" ||
          typeof s.author?.orcid !== "string" ||
          typeof s.notifications?.needsYou !== "boolean" ||
          typeof s.notifications?.done !== "boolean"
        )
          throw Error("Invalid workspace settings");
        if (s.concurrency !== 2 || s.cpuCores !== 0 || s.memoryGB !== 0)
          throw Error("Compute limits are controlled by the engine scheduler");
        this.settings = {
          concurrency: 2,
          cpuCores: 0,
          memoryGB: 0,
          theme: s.theme,
          dataFolders: s.dataFolders,
          author: { name: s.author.name, orcid: s.author.orcid },
          notifications: {
            needsYou: s.notifications.needsYou,
            done: s.notifications.done,
          },
        };
        const tmp = this.file + ".tmp";
        writeFileSync(tmp, JSON.stringify(this.settings), { mode: 0o600 });
        renameSync(tmp, this.file);
        return this.settings;
      }
      case "library.list":
        return this.settings.dataFolders.flatMap((dir) => {
          try {
            return readdirSync(dir)
              .filter((n) => /\.(csv|tsv)$/.test(n))
              .map((name) => ({
                id: path.join(dir, name),
                name,
                path: path.join(dir, name),
                rows: null,
                purpose: "Local data file",
                contract: "Check before use",
              }));
          } catch {
            return [];
          }
        });
      case "data.check": {
        if (!Array.isArray(p.files) || !p.files.length)
          throw Error("Select CSV or TSV data files");
        const names = new Set();
        const files = p.files.map((f) => {
          if (
            !f.path ||
            !path.isAbsolute(f.path) ||
            !/\.(csv|tsv)$/.test(f.path) ||
            lstatSync(f.path).isSymbolicLink() ||
            !lstatSync(f.path).isFile() ||
            lstatSync(f.path).size > 32 * 1024 * 1024
          )
            throw Error(
              "Select a regular CSV/TSV file up to 32 MiB using the desktop picker",
            );
          const name = path.basename(f.path);
          if (names.has(name)) throw Error("Duplicate file names");
          names.add(name);
          const bytes = readFileSync(f.path);
          if (!bytes.length) throw Error("Empty data file");
          return { name, path: realpathSync(f.path), hash: digest(bytes) };
        });
        const token = randomUUID();
        this.contracts.set(token, files);
        return {
          ok: true,
          token,
          checks: files.map((f) => ({
            name: f.name,
            status: "Ready for staging",
            detail:
              "File bytes pinned. Scientific contract checks run inside the investigation; this is not certification.",
          })),
        };
      }
      case "paper.download": {
        const bytes = this.artifact(p.investigationId, p.kind);
        return {
          filename: p.kind,
          mime: p.kind.endsWith(".pdf")
            ? "application/pdf"
            : p.kind.endsWith(".json")
              ? "application/json"
              : "text/markdown",
          base64: bytes.toString("base64"),
        };
      }
      case "system.status": {
        const s = await this.engine.call(method, p);
        return {
          fixture: false,
          configErrors: s.configErrors.map(diagnostic),
          engine: `Real investigation engine · ${s.node}`,
          modelsOnline: s.modelsOnline.filter(
            (p) => p.lastProbe?.outcome === "ok",
          ).length,
          active: s.scheduler?.active ?? s.concurrency.running,
          queued: s.scheduler?.queued ?? 0,
          limit: s.scheduler?.limit ?? 2,
          cpu: s.cpu.load[0].toFixed(1),
          memoryGB: ((s.memory.total - s.memory.free) / 2 ** 30).toFixed(1),
          memoryLimitGB: (s.memory.total / 2 ** 30).toFixed(1),
          freeDiskGB: (s.disk.freeBytes / 2 ** 30).toFixed(1),
          launcher: {
            state: s.launcher.attested
              ? "Attested"
              : /not installed/i.test(s.launcher.reason ?? "")
                ? "Not installed"
                : "Unavailable",
            separation: s.launcher.attested
              ? "Launcher attested"
              : "Single user / degraded",
            analystAccess: "Engine controlled",
            lastCheck: s.launcherCheckedAt ?? new Date().toISOString(),
            reason: diagnostic(s.launcher.reason),
          },
          workspace: this.root,
        };
      }
      default:
        return this.engine.call(method, p);
    }
  }
  async handle(v) {
    if (
      !v ||
      v.jsonrpc !== "2.0" ||
      typeof v.method !== "string" ||
      (v.params !== undefined &&
        (!v.params || Array.isArray(v.params) || typeof v.params !== "object"))
    )
      return {
        jsonrpc: "2.0",
        id: v?.id ?? null,
        error: { code: -32600, message: "Invalid request" },
      };
    try {
      const result = await this.call(v.method, v.params);
      return v.id === undefined ? null : { jsonrpc: "2.0", id: v.id, result };
    } catch (e) {
      return v.id === undefined
        ? null
        : {
            jsonrpc: "2.0",
            id: v.id,
            error: {
              code: -32000,
              message: e.errors
                ? `Provider configuration invalid: ${e.errors.join("; ")}`
                : (e.message ?? "Engine request failed"),
            },
          };
    }
  }
}
