// End-to-end test against the LOCAL stack: see scripts/test-office-local.sh.
// It starts its own dev server on port 5174 and never reuses one that is
// already running: port 5173 may hold `npm run dev:live`, which talks to the
// real project, and a local-stack sign-in token sent there is refused.
import { defineConfig } from "@playwright/test";

// The e2e never depends on the internet (Sahan, 19 October 2026): in the test browser every host but this laptop fails at
// once (every context, also those a test opens itself). The fonts are the site's own (public/fonts); the free map's style
// (OpenFreeMap) is faked by e2e/offline.ts, so the free map runs on the land colour with no tiles;
// Google's map is never asked for (the local functions have no Google key); the map search's public places
// (openrouteservice) are faked in their own test; the local functions have no openrouteservice key (road times estimated).
const OFFLINE = "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // The gate (Sahan, 19 October 2026): zero failed tests; a test that passes on its one retry is flaky, and each flaky test
  // is checked against the local functions log for a CPU cut at its time (the local runtime's fixed per-worker budget drops
  // requests; a write is never repeated by the app, so a dropped save fails its first try). Still one worker.
  retries: 1,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
    launchOptions: { args: [OFFLINE], ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) },
  },
  webServer: {
    command: "npm run dev -- --port 5174",
    url: "http://localhost:5174",
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    // A desktop: the full flows.
    { name: "chromium", use: { browserName: "chromium" }, testIgnore: /phone\.spec\.ts/ },
    // A phone (412 × 915, touch): the tab bar per role, pages and detail screens, drafts, the stops editor, pull to refresh.
    { name: "phone", use: { browserName: "chromium", viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, testMatch: /phone\.spec\.ts/ },
  ],
});
