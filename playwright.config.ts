import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  workers: 1,
  timeout: 60000,
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
  webServer: {
    command: "node tests/server.mjs",
    port: 4173,
    reuseExistingServer: false,
  },
  use: { viewport: { width: 1100, height: 850 } },
});
