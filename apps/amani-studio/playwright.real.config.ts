import { defineConfig } from "@playwright/test";
import path from "node:path";
export default defineConfig({
  testDir: "./tests",
  testMatch: "real.e2e.ts",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:1421",
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1421",
    url: "http://127.0.0.1:1421",
    reuseExistingServer: false,
    env: {
      AMANI_ENGINE_ROOT: path.resolve(".runtime/real-e2e"),
      AMANI_DAEMON_ENTRY: path.resolve("tests/fake-daemon.ts"),
    },
  },
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/real-results.json" }],
  ],
});
