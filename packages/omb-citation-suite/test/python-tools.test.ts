// Finding 2 regressions live in tools/test_scholarly.py (the client and verifier are Python). They
// run offline: urllib is replaced by a function that fails the test, and responses are scripted.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_DIR } from "../src/seal.ts";

describe("scholarly client and row verifier (offline Python tests)", () => {
  it("fail closed on outages, distinguish definite absence, honour freshness, extract windows", () => {
    const r = spawnSync("python3", ["-m", "unittest", "discover", "-s", join(PACKAGE_DIR, "tools"), "-p", "test_*.py"], {
      cwd: PACKAGE_DIR,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "", PYTHONDONTWRITEBYTECODE: "1" },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(r.stderr, r.stderr).toMatch(/\nOK\s*$/);
    expect(r.status).toBe(0);
  });
});
