import { defineConfig } from "vitest/config";

// Fast-test rule: the whole suite must finish in seconds. Crash and kill tests
// inject faults at exact boundaries and use fake clocks; no test waits on a real
// timer longer than it must. See CONTRACT.md "Test speed".
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    // CLI replay tests build transient repository copies under their fixture roots.
    exclude: ["**/node_modules/**", "**/.tmp*/**"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    pool: "forks",
  },
});
