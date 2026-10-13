// End-to-end test against the LOCAL stack: see scripts/test-office-local.sh.
// It starts its own dev server on port 5174 and never reuses one that is
// already running: port 5173 may hold `npm run dev:live`, which talks to the
// real project, and a local-stack sign-in token sent there is refused.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: "npm run dev -- --port 5174",
    url: "http://localhost:5174",
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
