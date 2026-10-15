import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.ts";
import { insideRealRoot, recordLook, writePrivateFile } from "../src/private-io.ts";
import { tempDir } from "./helpers.ts";

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
});
function dirs() {
  const t = tempDir();
  cleanups.push(t.cleanup);
  const root = join(t.dir, "grading");
  const outside = join(t.dir, "outside");
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
  return { base: t.dir, root, outside };
}

describe("finding 6: private plaintext never leaves the grading root", () => {
  it("writes a new file inside the root, exclusively and with mode 0600", () => {
    const { root } = dirs();
    mkdirSync(join(root, "sub"));
    const p = writePrivateFile(root, join(root, "sub", "rows.jsonl"), "hidden\n");
    expect(readFileSync(p, "utf8")).toBe("hidden\n");
    expect(() => writePrivateFile(root, p, "again")).toThrow(/existing file or symlink/);
  });

  it("refuses a destination reached through a symlinked directory pointing outside", () => {
    const { root, outside } = dirs();
    symlinkSync(outside, join(root, "link"));
    expect(() => writePrivateFile(root, join(root, "link", "out.jsonl"), "hidden")).toThrow(/inside the grading root|symlink/);
    expect(existsSync(join(outside, "out.jsonl"))).toBe(false);
  });

  it("refuses a symlink inside the root even when it points back inside", () => {
    const { root } = dirs();
    mkdirSync(join(root, "real"));
    symlinkSync(join(root, "real"), join(root, "alias"));
    expect(insideRealRoot(root, join(root, "alias", "x.jsonl"))).toMatchObject({ ok: false });
  });

  it("never follows a planted symlink at the final component", () => {
    const { root, outside } = dirs();
    const target = join(outside, "victim.txt");
    writeFileSync(target, "original");
    symlinkSync(target, join(root, "out.jsonl"));
    expect(() => writePrivateFile(root, join(root, "out.jsonl"), "hidden")).toThrow(/existing file or symlink/);
    expect(readFileSync(target, "utf8")).toBe("original");
  });

  it("refuses paths outside the root and missing directories", () => {
    const { root, outside } = dirs();
    expect(() => writePrivateFile(root, join(outside, "x.jsonl"), "h")).toThrow(/inside the grading root/);
    expect(() => writePrivateFile(root, join(root, "nope", "x.jsonl"), "h")).toThrow(/does not exist/);
    expect(() => writePrivateFile(root, join(root, "..", "outside", "x.jsonl"), "h")).toThrow(/inside the grading root/);
  });

  it("the CLI export path refuses the symlink attack before decrypting anything", () => {
    const { root, outside, base } = dirs();
    symlinkSync(outside, join(root, "link"));
    const log: string[] = [];
    // No key is available here: refusal must come from the path check or the key check, never a write outside.
    const code = main(["export-inputs", "--split", "private", "--out", join(root, "link", "inputs.jsonl")], {
      env: { keyPath: join(base, "absent.key"), gradingRoot: root },
      log: (s) => log.push(s),
    });
    expect(code).toBe(2);
    expect(log.join()).toMatch(/inside the grading root|symlink/); // the path check fires first
    expect(existsSync(join(outside, "inputs.jsonl"))).toBe(false);
  });
});

describe("finding 3: the look ledger freezes held-out scorings", () => {
  const clock = (iso: string) => () => new Date(iso);

  it("counts distinct frozen verifiers and refuses changed results for the same id", () => {
    const { root } = dirs();
    const a = recordLook(root, { suite: "s1", verifierId: "v1", resultsSha256: "aa" }, clock("2026-10-11T10:00:00Z"));
    expect(a).toEqual({ number: 1, priorVerifierIds: [] });
    expect(recordLook(root, { suite: "s1", verifierId: "v1", resultsSha256: "aa" }, clock("2026-10-11T11:00:00Z"))).toEqual(a);
    expect(() => recordLook(root, { suite: "s1", verifierId: "v1", resultsSha256: "bb" }, clock("2026-10-11T12:00:00Z"))).toThrow(/different results/);
    expect(recordLook(root, { suite: "s1", verifierId: "v2", resultsSha256: "cc" }, clock("2026-10-12T00:00:00Z"))).toEqual({ number: 2, priorVerifierIds: ["v1"] });
    expect(recordLook(root, { suite: "s2", verifierId: "v2", resultsSha256: "cc" }, clock("2026-10-12T00:00:00Z")).number).toBe(1);
    const ledger = readFileSync(join(root, "pw4s-looks.jsonl"), "utf8").trim().split("\n");
    expect(ledger).toHaveLength(3);
    expect(JSON.parse(ledger[0]!).at).toBe("2026-10-11T10:00:00.000Z");
    expect(() => recordLook(root, { suite: "s1", verifierId: " ", resultsSha256: "x" }, clock("2026-10-11T00:00:00Z"))).toThrow(/verifier id/);
  });

  it("the CLI refuses held-out scoring without a frozen verifier id", () => {
    const { root, base } = dirs();
    const res = join(base, "r.jsonl");
    writeFileSync(res, "");
    const log: string[] = [];
    expect(main(["score", "--results", res, "--split", "private"], { env: { keyPath: join(base, "k"), gradingRoot: root }, log: (s) => log.push(s) })).toBe(2);
    expect(log.join()).toMatch(/--verifier-id/);
  });
});
