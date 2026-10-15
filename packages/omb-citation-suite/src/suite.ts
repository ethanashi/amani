// Suite files: public rows in plaintext, private rows sealed (seal v2), a manifest with counts and
// hashes, and the keyless leak-scan fingerprints.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openSealed, PACKAGE_DIR, type SealEnv } from "./seal.ts";
import type { FingerprintFile } from "./leak.ts";
import type { FailureClass, Split, SuiteRow, VerifierInput } from "./types.ts";

export const SUITE_DIR = join(PACKAGE_DIR, "suite");
export const PUBLIC_FILE = join(SUITE_DIR, "public.jsonl");
export const SYNTHETIC_FILE = join(SUITE_DIR, "synthetic.jsonl");
/** The small published fixture is for software checks, not benchmark coverage or admission. */
export function publicInputFile(full = PUBLIC_FILE, synthetic = SYNTHETIC_FILE): string {
  return existsSync(full) ? full : synthetic;
}
export const PRIVATE_ENC = join(SUITE_DIR, "private.jsonl.enc");
export const MANIFEST_FILE = join(SUITE_DIR, "manifest.json");
export const FINGERPRINT_FILE = join(SUITE_DIR, "private-fingerprints.json");

export interface Manifest {
  version: 2;
  suite: "pw4s-citation";
  builtAt: string;
  seed: string;
  privateFraction: number;
  rows: { total: number; public: number; private: number };
  byClass: Record<string, { public: number; private: number }>;
  byDomain: Record<string, { public: number; private: number }>;
  /** Work clusters per split (rows touching the same work are one cluster); `invalid` = clusters with an invalid row. */
  clusters: { public: { all: number; invalid: number }; private: { all: number; invalid: number } };
  publicSha256: string;
  privateEncSha256: string;
  /** sha256 of the canonical private plaintext (unguessable: it contains unpublished sentences). */
  privatePlainSha256: string;
  fingerprintsSha256: string;
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function parseJsonl<T = unknown>(text: string): T[] {
  return text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l, i) => {
      try {
        return JSON.parse(l) as T;
      } catch {
        throw new Error(`JSONL line ${i + 1} is not valid JSON`);
      }
    });
}

export function toJsonl(rows: unknown[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

export function readManifest(file = MANIFEST_FILE): Manifest {
  return JSON.parse(readFileSync(file, "utf8")) as Manifest;
}

export function readFingerprints(file = FINGERPRINT_FILE): FingerprintFile {
  return JSON.parse(readFileSync(file, "utf8")) as FingerprintFile;
}

export function loadPublicRows(file = publicInputFile()): SuiteRow[] {
  return parseJsonl<SuiteRow>(readFileSync(file, "utf8"));
}

/** Decrypt and parse the private split; refuses when the plaintext hash disagrees with the manifest. */
export function loadPrivateRows(env: SealEnv, encFile = PRIVATE_ENC, manifest: Manifest | null = existsSync(MANIFEST_FILE) ? readManifest() : null): SuiteRow[] {
  const plain = openSealed(env, encFile);
  if (manifest && sha256(plain) !== manifest.privatePlainSha256) throw new Error("private split plaintext hash does not match the manifest");
  return parseJsonl<SuiteRow>(plain.toString("utf8"));
}

/** What the verifier under test receives: id, sentence, anchor quote and the citation as written. */
export function verifierInputs(rows: SuiteRow[]): VerifierInput[] {
  return rows.map((r) => ({ id: r.id, sentence: r.input.sentence, quote: r.input.quote, citation: r.input.citation }));
}

export function countBy(rows: SuiteRow[], key: (r: SuiteRow) => string): Record<string, { public: number; private: number }> {
  const out: Record<string, { public: number; private: number }> = {};
  for (const r of rows) {
    const k = key(r);
    out[k] ??= { public: 0, private: 0 };
    out[k][r.split as Split]++;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export type ClassCounts = Partial<Record<FailureClass, number>>;
