// Round 4–7, item 12 (docs/phase8-plan.md §33.13): the screens built to the approved mockups, photographed beside them, for
// the checkpoint's comparison (design/mockups/2026-10-22). Runs under the Playwright project "mockups" only, on the e2e build
// (scripts/test-office-local.sh: the dev server serves the local mobile build under /m/, FLEET_MOBILE_DIR, made with
// FLEET_DESIGN=1 so the design pages of apps/driver/src/design have their routes).
//   - Phone (390 × 844, 2x), English and Sinhala: the design pages /m/design/<page>?lang=en|si: the REAL screens with sample
//     answers (Office mode's Home, Review, the request, the trip on the way; the driver's Today and running task). A page
//     missing from this build (no route, no marker) is skipped with the reason. Two pictures each: the first screen as a
//     phone shows it, and the whole page (the window as tall as the page's content).
//   - The website at a desktop's width (1440 × 900): the Overview, a task on the way (the driver accepts and starts it as
//     the app does) and a request waiting (its decide page), with data made through the connector.
//   - Writes apps/office/mockups-report/index.html: each mockup's PNG beside the built pictures, with captions.
// It fails only when a screen does not render (the marker or a key element missing), never on how it looks.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./offline";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const OUT = join(HERE, "..", "mockups-report");
const MOCKUPS = join(HERE, "..", "..", "..", "design", "mockups", "2026-10-22", "png");

const MCP = (process.env.OFFICE_MCP_URL || "http://127.0.0.1:54321/functions/v1/office-mcp").replace(/\/$/, "");
const KEY = process.env.OFFICE_MCP_KEY || "";
const API = (process.env.API_URL || "http://127.0.0.1:54321").replace(/\/$/, "");
const ANON = process.env.ANON_KEY || "";
const stamp = Date.now().toString(36) + "k";

/** The six mockups and the design page of each (the element that says the screen rendered, language-free). */
const PAGES = [
  { mockup: "1-office-home", title: "Office Home (Office mode, /m/)", route: "office-home", must: "stat-tiles", site: "site-overview.png", siteCaption: "The site's Overview at 1440 × 900" },
  { mockup: "2-office-review", title: "New trip, step 4: Review (Office mode, /m/)", route: "office-review", must: "trip-primary" },
  { mockup: "3-office-request-approve", title: "A request to approve (Office mode, /m/)", route: "office-request", must: "approve-button", site: "site-request.png", siteCaption: "The site's decide page for a request waiting, 1440 × 900" },
  { mockup: "4-office-trip-on-the-way", title: "The trip on the way (Office mode, /m/)", route: "office-trip", must: "task-banner", site: "site-task.png", siteCaption: "The site's task page, the driver on the way, 1440 × 900" },
  { mockup: "5-driver-today", title: "The driver's Today (driver app)", route: "driver-today", must: null },
  { mockup: "6-driver-task-in-progress", title: "The driver's task in progress (driver app)", route: "driver-task", must: null },
] as const;

const LANGS = ["en", "si"] as const;

async function tool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${MCP}/${KEY}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const line = raw.replace(/\r/g, "").split("\n").filter((l) => l.startsWith("data: ") || l.startsWith("{")).pop() ?? "";
  const msg = JSON.parse(line.replace(/^data: /, "")) as { result?: { isError?: boolean; content: { text: string }[] }; error?: { message: string } };
  if (msg.error) throw new Error(msg.error.message);
  if (msg.result?.isError) throw new Error(msg.result.content[0].text);
  return JSON.parse(msg.result!.content[0].text) as T;
}

/** The driver's side, as the app does it: sign in with the PIN, then REST and the RPCs with that session. */
async function driverRest(username: string, pin: string) {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { "content-type": "application/json", apikey: ANON },
    body: JSON.stringify({ email: `${username}@drivers.fame.invalid`, password: pin }),
  });
  const session = (await res.json()) as { access_token?: string };
  if (!session.access_token) throw new Error(`driver sign-in failed: ${res.status}`);
  const headers = { "content-type": "application/json", apikey: ANON, authorization: `Bearer ${session.access_token}`, prefer: "return=representation" };
  return {
    async post(path: string, body: unknown): Promise<number> {
      return (await fetch(`${API}/rest/v1/${path}`, { method: "POST", headers, body: JSON.stringify(body) })).status;
    },
    async patch(path: string, body: unknown): Promise<number> {
      return (await fetch(`${API}/rest/v1/${path}`, { method: "PATCH", headers, body: JSON.stringify(body) })).status;
    },
  };
}

const colomboDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date());
const colomboNow = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());

/** The page drawn and its fonts in: the sample answers and the maps get a moment. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1_500);
}

/** The height of the page's content: the tallest scrolling area (React Native's ScrollView on the web) plus what is fixed. */
async function contentHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    let max = document.documentElement.scrollHeight;
    document.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const style = getComputedStyle(el);
      if (el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(style.overflowY)) max = Math.max(max, el.scrollHeight + (window.innerHeight - el.clientHeight));
    });
    return Math.min(Math.max(max, window.innerHeight), 3200);
  });
}

/** The report: each mockup beside the pictures that exist (written after every test, from the files in the folder). */
function writeReport(): void {
  mkdirSync(OUT, { recursive: true });
  const have = new Set(existsSync(OUT) ? readdirSync(OUT) : []);
  const img = (file: string, caption: string) => have.has(file)
    ? `<figure><img src="${file}" alt="${caption}" loading="lazy"><figcaption>${caption}</figcaption></figure>`
    : `<figure class="none"><div>Not built in this run</div><figcaption>${caption}</figcaption></figure>`;
  const sections = PAGES.map((p) => {
    const mock = `mockup-${p.mockup}.png`;
    const figures = [
      img(mock, `The approved mockup (${p.mockup}.png)`),
      ...LANGS.map((l) => img(`${p.route}-${l}-full.png`, `Built, ${l === "en" ? "English" : "Sinhala"} · the whole page (390 px wide)`)),
      ...LANGS.map((l) => img(`${p.route}-${l}.png`, `Built, ${l === "en" ? "English" : "Sinhala"} · the first screen (390 × 844)`)),
      ...("site" in p && p.site ? [img(p.site, p.siteCaption)] : []),
    ];
    return `<section><h2>${p.title}</h2><p class="route">/m/design/${p.route}?lang=en | si</p><div class="row">${figures.join("")}</div></section>`;
  });
  writeFileSync(join(OUT, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mockups beside the build</title>
<style>
  :root { --ink: #15181c; --page: #f3f2ee; --card: #ffffff; --line: #e7e5df; --muted: #5f646b }
  body { margin: 0; padding: 24px; background: var(--page); color: var(--ink); font: 15px/1.45 "IBM Plex Sans", system-ui, sans-serif }
  h1 { font: 800 26px/1.2 Archivo, system-ui, sans-serif; margin: 0 0 6px } h2 { font-size: 18px; margin: 0 0 4px }
  .lead, .route { color: var(--muted); margin: 0 0 16px } section { margin: 0 0 40px }
  .row { display: flex; gap: 16px; align-items: flex-start; overflow-x: auto; padding-bottom: 8px }
  figure { margin: 0; flex: none; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 10px }
  figure img { display: block; width: 300px; height: auto; border-radius: 6px }
  figure:last-child img[src^="site-"] { width: 640px }
  figure.none div { width: 300px; height: 120px; display: grid; place-items: center; color: var(--muted); background: var(--page); border-radius: 6px }
  figcaption { color: var(--muted); font-size: 13px; margin-top: 6px; max-width: 300px }
</style></head><body>
<h1>The approved mockups beside the build</h1>
<p class="lead">design/mockups/2026-10-22 (approved 22 October 2026). Each built picture is the real screen with sample data (the design pages of
apps/driver/src/design) or, for the website, a page with data made for the run. Names, places and plates are samples.</p>
${sections.join("\n")}
</body></html>
`);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
  for (const p of PAGES) {
    const from = join(MOCKUPS, `${p.mockup}.png`);
    if (existsSync(from)) copyFileSync(from, join(OUT, `mockup-${p.mockup}.png`));
  }
  writeReport();
});

test.afterAll(() => writeReport());

for (const p of PAGES) {
  test(`phone, English and Sinhala: ${p.title} beside ${p.mockup}`, async ({ browser }) => {
    test.setTimeout(120_000);
    for (const lang of LANGS) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      await page.goto(`/m/design/${p.route}?lang=${lang}`);
      const marker = page.getByTestId("fleet-design-page");
      const there = await marker.first().waitFor({ state: "attached", timeout: 30_000 }).then(() => true, () => false);
      if (!there) {
        await context.close();
        test.skip(true, `/m/design/${p.route} is not in this build (no route or no "fleet-design-page" marker)`);
        return;
      }
      if (p.must) await expect(page.getByTestId(p.must).first()).toBeVisible({ timeout: 20_000 });
      await settled(page);
      // The page in the language asked for (the design page sets it from ?lang=).
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await page.screenshot({ path: join(OUT, `${p.route}-${lang}.png`) });
      await page.setViewportSize({ width: 390, height: await contentHeight(page) });
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(OUT, `${p.route}-${lang}-full.png`) });
      await context.close();
    }
    writeReport();
  });
}

test("the website at a desktop's width: the Overview, a task on the way, a request waiting", async ({ browser }) => {
  test.skip(!KEY, "OFFICE_MCP_KEY (the local shared key) is not set");
  test.setTimeout(180_000);
  // The data, through the connector as the admin would in Claude.
  const email = `e2e.mockups.${stamp}@fame.test`;
  const user = await tool<{ set_password_link: string }>("create_office_user", { name: "E2E Mockups", email, permissions: ["view", "request", "approve", "assign_tasks", "vehicles", "issues"] });
  const driver = { name: `E2E Mockups ${stamp}`, code: `E2MK-${stamp}`, username: `e2mk.${stamp}`, pin: "246817", phone: "0771234577" };
  await tool("create_driver", driver);
  const plate = `WP MK-${stamp.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Toyota HiAce", vehicle_type: "van", seats: 14, current_odometer_km: 45210, fuel_type: "diesel" });
  const task = await tool<{ task_id: string }>("create_task", {
    title: `Team drop · Kurunegala ${stamp}`, date: colomboDay(), start_time: colomboNow(), driver: driver.username, vehicle: plate,
    stops: [
      { type: "pickup", what: "people", place: "Head office", lat: 6.9022, lng: 79.8612 },
      { type: "drop", what: "people", place: "Kurunegala site", lat: 7.4863, lng: 80.3647 },
    ],
  });
  // The driver accepts and starts it, as the app does.
  const app = await driverRest(driver.username, driver.pin);
  expect(await app.post("rpc/accept_task", { p_task_id: task.task_id, p_at: new Date().toISOString() })).toBe(200);
  expect(await app.patch(`tasks?id=eq.${task.task_id}`, { status: "in_progress", started_at: new Date().toISOString(), start_odometer_km: 45210 })).toBe(200);
  const rq = await tool<{ request: { id: string } }>("create_request", { requested_by: "E2E Requester", date: colomboDay(), time: "15:00", route_from: "Head office", route_to: "Galle", need_type: "van", pax: 3 });

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const verify = await fetch(user.set_password_link, { redirect: "manual" });
  const landing = verify.headers.get("location") ?? "";
  await page.goto("/" + landing.slice(landing.indexOf("#")));
  const password = `Mockups for ${stamp}!`;
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Again").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Vehicles on the road").first()).toBeVisible();
  await settled(page);
  await page.screenshot({ path: join(OUT, "site-overview.png"), fullPage: true });

  await page.goto(`/tasks/${task.task_id}`);
  await expect(page.getByTestId("task-detail")).toBeVisible();
  await expect(page.getByTestId("task-banner")).toBeVisible();
  await settled(page);
  await page.screenshot({ path: join(OUT, "site-task.png"), fullPage: true });

  await page.goto(`/requests/${rq.request.id}/decide`);
  await expect(page.getByTestId("decide-banner")).toBeVisible();
  await settled(page);
  await page.screenshot({ path: join(OUT, "site-request.png"), fullPage: true });
  await context.close();
  writeReport();
});
