import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initKey, openSealed, sealTo, type SealEnv } from "../src/seal.ts";
import { tempDir } from "./helpers.ts";

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
});

function env(): { env: SealEnv; dir: string } {
  const t = tempDir();
  cleanups.push(t.cleanup);
  return { env: { keyPath: join(t.dir, "keys", "test.key"), gradingRoot: join(t.dir, "grading") }, dir: t.dir };
}

describe("seal v2 wrapper (packages/bio-baseline/arms/lib/seal.py)", () => {
  it("round-trips, keeps the caller's file, hashes the envelope (not the plaintext) and creates a 0400 key", () => {
    const { env: e, dir } = env();
    const plain = join(dir, "rows.jsonl");
    const payload = '{"id":"pw4s-000001","sentence":"synthetic hidden row"}\n'.repeat(50);
    writeFileSync(plain, payload);
    const enc = join(dir, "out", "rows.jsonl.enc");
    sealTo(e, plain, enc);
    expect(existsSync(plain)).toBe(true);
    expect(statSync(e.keyPath).mode & 0o777).toBe(0o400);
    const envelope = readFileSync(enc);
    expect(envelope.subarray(0, 19).toString()).toBe("OMERTA-BIO-SEAL-v2\n");
    expect(envelope.includes(Buffer.from("synthetic hidden row"))).toBe(false);
    const side = readFileSync(enc + ".sha256", "utf8").split(/\s+/)[0];
    expect(side).toBe(sha(envelope));
    expect(side).not.toBe(sha(payload));
    expect(openSealed(e, enc).toString()).toBe(payload);
    expect(initKey(e)).toContain("test.key"); // never overwrites
    expect(openSealed(e, enc).toString()).toBe(payload);
  });

  it("fails closed on a wrong key, a tampered envelope and a missing sidecar", () => {
    const { env: e, dir } = env();
    const plain = join(dir, "p.txt");
    writeFileSync(plain, "hold-out content");
    const enc = join(dir, "p.txt.enc");
    sealTo(e, plain, enc);
    const other: SealEnv = { ...e, keyPath: join(dir, "keys", "other.key") };
    initKey(other);
    expect(() => openSealed(other, enc)).toThrow(/MAC mismatch/);
    const bytes = readFileSync(enc);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    writeFileSync(join(dir, "t.enc"), bytes);
    writeFileSync(join(dir, "t.enc.sha256"), sha(bytes) + "  t.enc\n");
    expect(() => openSealed(e, join(dir, "t.enc"))).toThrow(/MAC mismatch/);
    writeFileSync(join(dir, "u.enc"), readFileSync(enc));
    expect(() => openSealed(e, join(dir, "u.enc"))).toThrow(/integrity sidecar/);
  });

  it("refuses to open without a key and refuses a non-.enc destination", () => {
    const { env: e, dir } = env();
    expect(() => openSealed(e, join(dir, "x.enc"))).toThrow(/key not available/);
    expect(() => sealTo(e, join(dir, "x"), join(dir, "x.bin"))).toThrow(/\.enc/);
  });
});
