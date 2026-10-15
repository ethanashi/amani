// No private row appears in plaintext anywhere in the repository: tracked files, untracked
// non-ignored files, and the git history of this package, exactly the set `build` and `leak-scan`
// scan (finding 7). The keyless scan always runs; the keyed scan runs when the sealing key is present
// (OMB_CITATION_SUITE_REQUIRE_KEY=1 makes it mandatory).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { main } from "../src/cli.ts";
import { repoScanSet, scanFingerprints } from "../src/leak.ts";
import { defaultSealEnv, keyAvailable, PACKAGE_DIR, type SealEnv } from "../src/seal.ts";
import { PUBLIC_FILE, readFingerprints } from "../src/suite.ts";
import { tempDir } from "./helpers.ts";

const fullSuite = existsSync(PUBLIC_FILE);
// Published source archives need no development repository history.
const scan = fullSuite ? repoScanSet(PACKAGE_DIR) : { files: [], history: { path: "", text: "" }, pkgRel: "" };
const set = [...scan.files, scan.history];
const tmp = tempDir();
afterAll(() => tmp.cleanup());
const env: SealEnv = { ...defaultSealEnv(), gradingRoot: join(tmp.dir, "grading") };
const haveKey = keyAvailable(env);
const requireKey = process.env.OMB_CITATION_SUITE_REQUIRE_KEY === "1";

describe.skipIf(!fullSuite)("leak scan of the repository", () => {
  it("the production scan set covers repo files, this package's public rows and its git history", () => {
    expect(scan.files.length).toBeGreaterThan(100);
    expect(scan.files.some((f) => f.path === `${scan.pkgRel}/suite/public.jsonl`)).toBe(true);
    expect(scan.files.some((f) => f.path.endsWith("private.jsonl.enc"))).toBe(false);
    expect(scan.history.path).toContain(scan.pkgRel);
    expect(scan.history.text).toMatch(/^commit [0-9a-f]{40}/m);
  });

  it("keyless: no committed private fingerprint occurs in any repo file or in the package history", () => {
    const fp = readFingerprints();
    expect(fp.fingerprints.length).toBeGreaterThan(50);
    expect(scanFingerprints(set, fp)).toEqual([]);
  });

  it("the key and plaintext hold-out live only in ignored paths", () => {
    const top = execFileSync("git", ["-C", PACKAGE_DIR, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    const tracked = execFileSync("git", ["-C", top, "ls-files", "--", scan.pkgRel], { encoding: "utf8" }).split("\n").filter(Boolean);
    expect(tracked.filter((p) => /\/\.private\/|\/\.cache\/|\.key$|private\.jsonl$/.test(p))).toEqual([]);
    expect(readFileSync(join(PACKAGE_DIR, ".gitignore"), "utf8")).toMatch(/^\.private\/$/m);
    const ignored = execFileSync("git", ["-C", top, "check-ignore", `${scan.pkgRel}/.private/keys/citation-suite.key`, `${scan.pkgRel}/.private/grading/rows.jsonl`], { encoding: "utf8" });
    expect(ignored.trim().split("\n")).toHaveLength(2);
  });
});

describe.skipIf(!fullSuite)("the production leak-scan command", () => {
  // One real CLI run covers the command path: repo files + package history, keyed when the key is present.
  it("scans repo files and the package history (keyless, plus keyed with the key) and finds no leak", () => {
    if (requireKey) expect(haveKey).toBe(true);
    const out: string[] = [];
    expect(main(["leak-scan"], { env, log: (s) => out.push(s) })).toBe(0);
    expect(out.join("\n")).toMatch(haveKey ? /no leak \(keyless\+keyed, \d+ files \+ package history\)/ : /no leak \(keyless, \d+ files \+ package history\)/);
  });
});
