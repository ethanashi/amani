import { createHash } from "node:crypto";
import { closeSync, fsyncSync, openSync, existsSync, lstatSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson, canonicalSha256, HostSandbox, type SandboxInvocation, type SandboxRequest } from "../../bio-core/src/index.ts";
import { verifyManifest, type DatasetManifest } from "../../bio-guard/src/index.ts";
import { safeDirectory } from "./validation.ts";
import { readRows, type TabularDeclaration, type ValidityEvidence } from "./validity.ts";

function durableWrite(file: string, bytes: string): void {
  const fd = openSync(file, "wx", 0o400);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function syncDirectory(dir: string): void {
  const fd = openSync(dir, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
}

export interface EffectiveInput {
  directory: string;
  manifestHash: string;
  sourceManifestHash: string;
  evidenceHash: string;
  declarations: TabularDeclaration[];
  schemas: { file: string; fields: string[]; rows: number; representatives: string[] }[];
  /** Raw layout transform per file, so a deliverable can recreate these bytes from raw data. */
  layouts?: EffectiveLayout[];
}
export interface EffectiveLayout {
  file: string; format: TabularDeclaration["format"]; sampleAxis: TabularDeclaration["sampleAxis"]; idField: string;
  featureFields?: string[]; rawSha256: string; rawBytes: number;
}

/** A fixed, approval-visible representative policy, never model-produced bytes. */
export function materializeEffectiveInput(raw: string, destination: string, declarations: TabularDeclaration[], evidence: ValidityEvidence): EffectiveInput {
  if (!evidence.allowed) throw new Error("cannot materialize blocked validity evidence");
  const source = JSON.parse(readFileSync(path.join(raw, "manifest.json"), "utf8")) as DatasetManifest;
  const sourceManifestHash = canonicalSha256(source);
  if (!verifyManifest(raw, sourceManifestHash).ok) throw new Error("source manifest invalid");
  const pending = `${destination}.pending`;
  // Only this deterministic, host-owned staging directory is disposable on recovery.
  rmSync(pending, { recursive: true, force: true }); safeDirectory(pending);
  try {
    const schemas: EffectiveInput["schemas"] = [];
    const files = declarations.map(d => {
      const gate = evidence.datasets.find(g => g.file === d.file);
      if (!gate?.allowed || !gate.effectiveN || gate.effectiveN !== gate.units.length) throw new Error("effective units unavailable");
      // Original cell text: the effective input is a pure selection/transposition of raw cells.
      const rows = readRows(raw, d, true), byId = new Map(rows.map(r => [r[d.idField], r]));
      const representatives = gate.units.map(unit => unit[0]!);
      const selected = representatives.map(id => { const row = byId.get(id); if (!row) throw new Error("unknown representative"); return row; });
      const fields = Object.keys(rows[0]!);
      if (rows.some(r => canonicalJson(Object.keys(r).sort()) !== canonicalJson([...fields].sort()))) throw new Error("inconsistent record schema");
      const delimiter = d.format === "csv" ? "," : "\t";
      const cell = (x: unknown) => {
        if (typeof x === "object") throw new Error("non-scalar delimited field");
        const s = String(x); return /["\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replaceAll('"', '""')}"` : s;
      };
      const bytes = d.format === "json" ? canonicalJson(selected) : [fields, ...selected.map(r => fields.map(k => r[k]))].map(r => r.map(cell).join(delimiter)).join("\n") + "\n";
      const target = path.join(pending, d.file); safeDirectory(path.dirname(target));
      durableWrite(target, bytes); syncDirectory(path.dirname(target));
      schemas.push({ file: d.file, fields, rows: selected.length, representatives });
      const original = source.files.find(f => f.path === d.file);
      if (!original) throw new Error("missing source manifest entry");
      return { ...original, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: Buffer.byteLength(bytes) };
    });
    const manifest: DatasetManifest = { version: 1, files: files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
    durableWrite(path.join(pending, "manifest.json"), canonicalJson(manifest)); syncDirectory(pending);
    const layouts: EffectiveLayout[] = declarations.map(d => {
      const original = source.files.find(f => f.path === d.file)!;
      return { file: d.file, format: d.format, sampleAxis: d.sampleAxis, idField: d.idField,
        ...(d.featureFields ? { featureFields: [...d.featureFields] } : {}), rawSha256: original.sha256, rawBytes: original.bytes };
    });
    const receipt: EffectiveInput = { directory: destination, manifestHash: canonicalSha256(manifest), sourceManifestHash,
      evidenceHash: canonicalSha256(evidence), declarations: declarations.map(({ featureFields: _annotations, ...d }) => ({ ...d, sampleAxis: "rows" })), schemas, layouts };
    // An existing directory is immutable evidence. Never repair tampering by overwriting it.
    if (!existsSync(destination)) { renameSync(pending, destination); syncDirectory(path.dirname(destination)); }
    verifyEffectiveInput(receipt, evidence);
    return receipt;
  } finally { rmSync(pending, { recursive: true, force: true }); }
}

export function verifyEffectiveInput(input: EffectiveInput, evidence: ValidityEvidence): void {
  if (!evidence.allowed || input.evidenceHash !== canonicalSha256(evidence)) throw new Error("effective input evidence mismatch");
  const check = verifyManifest(input.directory, input.manifestHash);
  if (!check.ok) throw new Error(`effective input manifest: ${check.reasons.join("; ")}`);
  if (input.declarations.length !== evidence.datasets.length || input.schemas.length !== evidence.datasets.length) throw new Error("effective input coverage mismatch");
  for (const d of input.declarations) {
    const gate = evidence.datasets.find(g => g.file === d.file), schema = input.schemas.find(s => s.file === d.file);
    const rows = readRows(input.directory, d);
    if (!gate?.allowed || !schema || d.sampleAxis !== "rows" || rows.length !== gate.effectiveN || schema.rows !== rows.length ||
      canonicalJson(rows.map(r => r[d.idField])) !== canonicalJson(gate.units.map(u => u[0])) ||
      canonicalJson(schema.representatives) !== canonicalJson(gate.units.map(u => u[0]))) throw new Error("analysis input row count or representatives differ from effective n");
  }
  const readOnly = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const file = path.join(dir, entry), stat = lstatSync(file);
      if (stat.isDirectory()) readOnly(file);
      else if ((stat.mode & 0o222) !== 0) throw new Error("analysis input is writable");
    }
  };
  readOnly(input.directory);
}

/** Guard validates the raw layout, tool roots and scratch. Narrow its data grant
 * to the verified derived table before preparing the OS policy; explicitly deny
 * raw reads as defense against implicit runtime grants. */
export class EffectiveInputSandbox extends HostSandbox {
  constructor(private readonly delegate: HostSandbox, private readonly raw: string, private readonly input: string) { super(); }
  override prepare(request: SandboxRequest): SandboxInvocation {
    if (!request.readableRoots.includes(this.raw)) throw new Error("raw input grant missing");
    const invocation = this.delegate.prepare({ ...request, cwd: this.input,
      readableRoots: request.readableRoots.map(root => root === this.raw ? this.input : root) });
    if (!invocation.spec) return invocation;
    const args = [...invocation.spec.args], index = args.indexOf("-p") + 1;
    if (invocation.sandboxClass !== "seatbelt" || index === 0 || !args[index]) throw new Error("effective input sandbox requires explicit raw-read denial");
    args[index] += `\n(deny file-read* (subpath ${JSON.stringify(this.raw)}))\n`;
    return { ...invocation, spec: { ...invocation.spec, args } };
  }
}
