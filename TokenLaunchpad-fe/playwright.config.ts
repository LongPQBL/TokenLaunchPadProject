import { defineConfig } from "@playwright/test";

// The whole stack is started outside this config, by TokenLaunchpad-be/scripts/e2e.sh: a local Sepolia fork with the launchpad deployed,
// the indexer, the API and the web app. Playwright only drives a browser against it.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // the tests change rows in one shared database, then put them back
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    // The system Chrome, so no browser download is needed.
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
