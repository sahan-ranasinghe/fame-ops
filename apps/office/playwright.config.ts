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
  // Screenshot baselines (the mobile website's, CI only): a missing one is written by the run and kept with its artifact
  // (then committed); an existing one is compared.
  updateSnapshots: "missing",
  snapshotPathTemplate: "{testDir}/screens/{arg}{ext}",
  workers: 1,
  // On GitHub (CI, docs/ci.md) also the HTML report, uploaded with the run.
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
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
    // A desktop: the full flows; also the contrast check at a desktop's width (e2e/contrast.spec.ts, light and dark).
    { name: "chromium", use: { browserName: "chromium" }, testIgnore: /(phone|mobile|mockups)\.spec\.ts/ },
    // Round 4–7, item 12: the screens built to the approved mockups, photographed beside them (e2e/mockups.spec.ts opens its
    // own phone and desktop windows; the pictures stay in the run's artifact).
    { name: "mockups", use: { browserName: "chromium" }, testMatch: /mockups\.spec\.ts/ },
    // A phone (412 × 915, touch): the tab bar per role, pages and detail screens, drafts, the stops editor, pull to refresh;
    // the contrast check at a phone's width (the site's screens, light and dark).
    { name: "phone", use: { browserName: "chromium", viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, testMatch: /(phone|contrast)\.spec\.ts/ },
    // The mobile website (O4): an Android phone's browser on the same origin; the dev server serves the local mobile build
    // under /m/ (FLEET_MOBILE_DIR, made by scripts/test-office-local.sh).
    {
      name: "mobile-web",
      use: {
        browserName: "chromium", viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
        userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      },
      // The contrast check of /m/ too (light only, on purpose for now).
      testMatch: /(mobile|contrast)\.spec\.ts/,
    },
  ],
});
