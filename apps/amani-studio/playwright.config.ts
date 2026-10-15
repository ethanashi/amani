import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "studio.e2e.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "AMANI_ENGINE_ENTRY=tests/fixtures/service.mjs node node_modules/vite/bin/vite.js --host 127.0.0.1",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: false,
    timeout: 60000,
  },
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
});
