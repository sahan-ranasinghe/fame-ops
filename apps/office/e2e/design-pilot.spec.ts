// Part B, the design pass's pilot (docs/design-pass.md §5): the six pilot screens photographed with the same data, for
// Sahan to compare before and after. Run on branch design-pilot-before (main as deployed + this file + the design page's
// route) and on phase9-rd; CI keeps the pictures in the run's artifact (test-results/…/design-pilot-*.png). Nothing is
// compared against a baseline here: the pictures are for a person's eyes.
//
//   the site, desktop 1440 × 900 and phone width 412 × 915: the Overview, the Tasks board
//   /m/ (Office mode) 412 × 915, English and Sinhala: Home, a task's page, a request's page, the trip's Review step
//   the driver's task under way (the design page of the e2e build, /m/design/driver-task), English and Sinhala
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./offline";

const MCP = (process.env.OFFICE_MCP_URL || "http://127.0.0.1:54321/functions/v1/office-mcp").replace(/\/$/, "");
const KEY = process.env.OFFICE_MCP_KEY || "";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const ANON = process.env.ANON_KEY || "";
const stamp = Date.now().toString(36) + "d";

test.beforeAll(() => {
  test.skip(!KEY || !ANON, "OFFICE_MCP_KEY and ANON_KEY (the local stack) are not set");
  test.skip(!process.env.FLEET_MOBILE_DIR, "FLEET_MOBILE_DIR (the local mobile build) is not set");
});

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

/** An office user with a password, set through their set-password link's session (as the site's /set-password does). */
async function officeUser(name: string, email: string, permissions: string[]): Promise<string> {
  const user = await tool<{ set_password_link: string }>("create_office_user", { name, email, permissions });
  const verify = await fetch(user.set_password_link, { redirect: "manual" });
  const hash = new URLSearchParams((verify.headers.get("location") ?? "").split("#")[1] ?? "");
  const password = `Design pilot ${stamp}!`;
  const res = await fetch(`${API}/auth/v1/user`, {
    method: "PUT",
    headers: { "content-type": "application/json", apikey: ANON, authorization: `Bearer ${hash.get("access_token")}` },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error(`set password failed: ${res.status}`);
  return password;
}

/** The driver's "Can't do this task", as the app sends it. */
async function decline(username: string, pin: string, taskId: string): Promise<void> {
  const auth = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { "content-type": "application/json", apikey: ANON },
    body: JSON.stringify({ email: `${username}@drivers.fame.invalid`, password: pin }),
  });
  const { access_token } = (await auth.json()) as { access_token?: string };
  const res = await fetch(`${API}/rest/v1/rpc/decline_task`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: ANON, authorization: `Bearer ${access_token}` },
    body: JSON.stringify({ p_task_id: taskId, p_reason: "unwell", p_note: "Fever" }),
  });
  if (!res.ok) throw new Error(`decline failed: ${res.status}`);
}

const colomboDay = (plusDays: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date(Date.now() + plusDays * 864e5));

async function shot(page: Page, testInfo: TestInfo, name: string, full = false): Promise<void> {
  await expect(page.getByTestId("skeleton-rows")).toHaveCount(0, { timeout: 20_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1_500);
  // What the phone shows first (the window as it is), then, for a screen that scrolls inside itself (Office mode, the
  // driver's sheet), the whole of it: the window as tall as its longest scrolling part.
  await page.screenshot({ path: testInfo.outputPath(`design-pilot-${name}.png`), fullPage: true, animations: "disabled" });
  if (!full) return;
  const size = page.viewportSize()!;
  const tallest = await page.evaluate(() => Math.max(...[...document.querySelectorAll("*")].filter((e) => {
    const o = getComputedStyle(e).overflowY;
    return (o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight;
  }).map((e) => e.scrollHeight - e.clientHeight), 0));
  if (tallest <= 0) return;
  await page.setViewportSize({ width: size.width, height: Math.min(size.height + tallest, 5_000) });
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath(`design-pilot-${name}-full.png`), animations: "disabled" });
  await page.setViewportSize(size);
}

/** A phone's context for /m/ in a language (the tab marked as a phone's, as mobile.spec.ts does). */
async function mobileContext(browser: Browser, lang: "en" | "si"): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await context.addInitScript((l) => {
    window.localStorage.setItem("language", JSON.stringify(l));
    if (window.sessionStorage.getItem("e2e.mobile")) return;
    window.sessionStorage.setItem("e2e.mobile", "1");
    window.localStorage.removeItem("fleet.view");
  }, lang);
  return context;
}

test("the design pilot: the six screens before and after (pictures kept with the run)", async ({ browser }, testInfo) => {
  test.setTimeout(420_000);
  // The same data on every run: a driver, a van, tomorrow's task, tomorrow's declined task (needs a driver), a request waiting.
  const driver = { name: `Pilot Driver ${stamp}`, code: `PD-${stamp}`, username: `pd.${stamp}`, pin: "135799", phone: "0771234509" };
  const spare = { name: `Pilot Spare ${stamp}`, code: `PS-${stamp}`, username: `ps.${stamp}`, pin: "135798", phone: "0771234510" };
  await tool("create_driver", driver);
  await tool("create_driver", spare);
  const plate = `WP DP-${stamp.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Toyota HiAce", vehicle_type: "van", seats: 12, current_odometer_km: 84512 });
  const tomorrow = colomboDay(1);
  const task = await tool<{ task_id: string }>("create_task", {
    title: `Team drop ${stamp}`, date: tomorrow, start_time: "07:00", end_time: "12:00", driver: driver.username, vehicle: plate, passengers: 5,
    stops: [{ type: "pickup", what: "people", place: "Head office", lat: 6.9271, lng: 79.8612 }, { type: "drop", place: "Kurunegala site", lat: 7.4863, lng: 80.3647, arrive_by: "10:30" }],
  });
  const declined = await tool<{ task_id: string }>("create_task", {
    title: `Site visit ${stamp}`, date: tomorrow, start_time: "14:00", driver: spare.username, vehicle: plate,
    stops: [{ type: "visit", place: "Kelaniya East Dialog", lat: 6.9529, lng: 79.9246 }],
  });
  await decline(spare.username, spare.pin, declined.task_id);
  const rq = await tool<{ request: { id: string } }>("create_request", { requested_by: "Nimali Perera", date: tomorrow, time: "08:30", route_from: "Head office", route_to: "Kandy", need_type: "van", pax: 3, note: "Bring the ladder" });

  const email = `design.${stamp}@fame.test`;
  const password = await officeUser(`Design Pilot ${stamp}`, email, ["view", "request", "approve", "assign_tasks", "vehicles", "issues"]);

  // The site, desktop and phone width.
  for (const [size, viewport, phone] of [["desktop", { width: 1440, height: 900 }, false], ["phone", { width: 412, height: 915 }, true]] as const) {
    const context = await browser.newContext({ viewport, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible({ timeout: 30_000 });
    await shot(page, testInfo, `site-${size}-overview`);
    // Tomorrow's board: the pilot's tasks (one sent, one that needs a driver) are on it.
    await page.goto(`/tasks?date=${tomorrow}`);
    await expect(page.getByText(`Team drop ${stamp}`).first()).toBeVisible({ timeout: 30_000 });
    await shot(page, testInfo, `site-${size}-tasks`);
    await context.close();
  }

  // /m/ in both languages, and the driver's design page.
  for (const lang of ["en", "si"] as const) {
    const context = await mobileContext(browser, lang);
    const page = await context.newPage();
    await page.goto("/m/");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: lang === "en" ? "Sign in" : "ඇතුළු වන්න", exact: true }).click();
    await expect(page).toHaveURL(/\/m\/office/, { timeout: 30_000 });
    await page.waitForTimeout(2_000);
    await shot(page, testInfo, `m-${lang}-home`, true);
    await page.goto(`/m/office/task/${task.task_id}`);
    await expect(page.getByText(`Team drop ${stamp}`).first()).toBeVisible({ timeout: 20_000 });
    await shot(page, testInfo, `m-${lang}-task`, true);
    await page.goto(`/m/office/request/${rq.request.id}`);
    await page.waitForTimeout(2_000);
    await shot(page, testInfo, `m-${lang}-request`, true);
    // Review: a draft as the trip editor keeps it (lib/kv on localStorage, office.trip.draft), then the step itself.
    await page.evaluate(({ day, d, v, name }) => {
      const stop = (key: string, type: string, place: string, pin: string, arriveBy = "") => ({ key, type, what: type === "pickup" ? "people" : "", place, pin, dwell: "", arriveBy, note: "" });
      window.localStorage.setItem("office.trip.draft", JSON.stringify({
        mode: "task",
        fields: {
          date: day, leaveBy: "07:00", stops: [stop("p1", "pickup", "Head office", "6.9271, 79.8612"), stop("p2", "drop", "Kurunegala site", "7.4863, 80.3647", "10:30")],
          returnToBase: true, avoidExpressway: false, end: "", start: "", startPax: false,
          title: "Team drop", buffer: "", driver: d, vehicle: v, pax: "5", cname: "", cphone: "", notes: "", whatsapp: false,
        },
        req: { behalf: "", project: "", need: "", tools: false, note: "", requesterPhone: "" },
        rows: [], step: "review", at: Date.now(), driverName: name,
      }));
    }, { day: tomorrow, d: driver.username, v: plate, name: driver.name });
    await page.goto("/m/office/trip/review");
    await page.waitForTimeout(5_000); // the plan comes (the estimate: no routing key on the local stack)
    await page.addStyleTag({ content: "canvas, [data-fake-google-map] { visibility: hidden !important; }" });
    await shot(page, testInfo, `m-${lang}-review`, true);
    await page.goto("/m/design/driver-task");
    await expect(page.getByTestId("design-driver-task")).toBeVisible({ timeout: 20_000 });
    await shot(page, testInfo, `driver-${lang}-task`, true);
    await context.close();
  }
});
