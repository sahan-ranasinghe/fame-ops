// The mobile website (Phase 8, O4; docs/mobile-website.md): Office mode's own screens under /m/, built for the browser from
// the driver app. The phone redirect is held (viewChoice.ts PHONE_REDIRECT): a phone stays on the desktop site until it
// opts in. Sign-in with the office e-mail and password → Home → Approve → Live, the switch both ways (remembered), then a
// desktop link opened on the phone → its own screen → Give a driver. Runs under the "mobile-web" Playwright project only,
// against the local mobile build the dev server serves under /m/ (FLEET_MOBILE_DIR; scripts/test-office-local.sh makes it).
import type { Locator, Page } from "@playwright/test";
import { fakeGoogleMapsScript } from "./fakeGoogleMaps";
import { expect, test } from "./offline";
import { setPasswordByLink } from "./links";

const MCP = (process.env.OFFICE_MCP_URL || "http://127.0.0.1:54321/functions/v1/office-mcp").replace(/\/$/, "");
const KEY = process.env.OFFICE_MCP_KEY || "";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const ANON = process.env.ANON_KEY || "";
const stamp = Date.now().toString(36) + "m";

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
  const password = `Mobile test ${stamp}!`;
  await setPasswordByLink(user.set_password_link, password);
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

/** A tab of the mobile website's bar (the last button with that name: the bar is at the end of the page). */
const tab = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).last();
/** The screen in front: a stack keeps the screens under it in the page, hidden. */
const shown = (l: Locator) => l.filter({ visible: true }).first();

test.beforeAll(() => {
  test.skip(!KEY || !ANON, "OFFICE_MCP_KEY and ANON_KEY (the local stack) are not set");
  test.skip(!process.env.FLEET_MOBILE_DIR, "FLEET_MOBILE_DIR (the local mobile build) is not set");
});

test.beforeEach(async ({ context }) => {
  // The suite keeps every other test on the desktop site (offline.ts desktopView); this tab starts as a new phone would, with
  // no choice made (the desktop rule set one on the first load: cleared once), and a choice the test makes is kept.
  await context.addInitScript(() => {
    if (window.sessionStorage.getItem("e2e.mobile")) return;
    window.sessionStorage.setItem("e2e.mobile", "1");
    window.localStorage.removeItem("fleet.view");
  });
});

test("a phone on the office site: the desktop site while the redirect is held; the mobile website by its address, sign-in → Home → Approve → Live, the switch both ways, then a desktop link → Give a driver", async ({ page }) => {
  const email = `mobile.admin.${stamp}@fame.test`;
  const password = await officeUser("Mobile Admin", email, ["view", "request", "approve", "assign_tasks", "vehicles", "issues"]);
  const d1 = { name: `Mobile Decliner ${stamp}`, code: `MD-${stamp}`, username: `md.${stamp}`, pin: "135792", phone: "0771234506" };
  const d2 = { name: `Mobile Standby ${stamp}`, code: `MS-${stamp}`, username: `ms.${stamp}`, pin: "135793", phone: "0771234507" };
  await tool("create_driver", d1);
  await tool("create_driver", d2);
  const plate = `WP MW-${stamp.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Toyota HiAce", vehicle_type: "van", seats: 12, current_odometer_km: 1000 });
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date(Date.now() + 3 * 864e5));
  const task = await tool<{ task_id: string }>("create_task", { title: `Mobile task ${stamp}`, date: day, start_time: "10:00", end_time: "11:00", driver: d1.username, vehicle: plate, pickup: "Head office", dropoff: "Galle" });
  await decline(d1.username, d1.pin, task.task_id);
  const asker = `Mobile Desk ${stamp}`;
  await tool("create_request", { requested_by: asker, date: day, time: "13:00", route_from: "Head office", route_to: "Kandy", need_type: "van", pax: 2 });

  // The phone redirect is held (viewChoice.ts PHONE_REDIRECT, off until Sahan's phone test): the site's address on a
  // phone stays on the desktop site.
  await page.goto("/");
  await expect(page.getByLabel("E-mail")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");

  // The mobile website by its address: its sign-in, its Office side only (no Driver | Office switch).
  await page.goto("/m/");
  await expect(page.getByText("Work email")).toBeVisible();
  await expect(page.getByText("Driver", { exact: true })).toHaveCount(0);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  // Home: its sections, the tab bar by permission.
  await expect(page.getByText("Needs a driver").first()).toBeVisible();
  await expect(tab(page, "Approve")).toBeVisible();

  // Approve: the request waiting opens its own screen.
  await tab(page, "Approve").click();
  const row = page.getByTestId("request-row").filter({ hasText: asker });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(/\/m\/office\/request\//);
  await expect(shown(page.getByText(asker))).toBeVisible();

  // Live: the map and its one filter row.
  await page.goto("/m/");
  await tab(page, "Live").click();
  await expect(page.getByTestId("live-map")).toBeVisible();
  await expect(page.getByTestId("live-filter")).toBeVisible();

  // More → Switch to desktop view: the desktop site, signed in (one origin), remembered.
  await tab(page, "More").click();
  await page.getByTestId("switch-desktop").click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
  expect(await page.evaluate(() => window.localStorage.getItem("fleet.view"))).toBe("desktop");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  // The desktop site on a phone offers the way in: Switch to mobile view, remembered.
  await page.goto("/more");
  await page.getByTestId("switch-mobile").click();
  await expect(page).toHaveURL(/\/m\/?/);
  await expect(tab(page, "Live")).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("fleet.view"))).toBe("mobile");

  // Having chosen it, a desktop link (a push or an e-mail) opens the task's own screen; its driver declined: Give a driver.
  await page.goto(`/tasks/${task.task_id}`);
  await expect(page).toHaveURL(new RegExp(`/m/office/task/${task.task_id}`));
  await expect(shown(page.getByText(`Mobile task ${stamp}`))).toBeVisible();
  await shown(page.getByRole("button", { name: "Give a driver", exact: true })).click();
  await expect(page).toHaveURL(new RegExp(`/m/office/task/${task.task_id}/driver`));
  await page.getByTestId(`give-row-${d2.username}`).click();
  await shown(page.getByRole("button", { name: new RegExp(`^Give to ${d2.name}`) })).click();
  await expect(page.getByText(`Task sent to ${d2.name}`)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/m/office/task/${task.task_id}$`));
});

/** An office user signed in on the mobile website. */
async function signInMobile(page: Page, who: string, permissions: string[]): Promise<void> {
  const email = `${who}.${stamp}@fame.test`;
  const password = await officeUser(`Mobile ${who}`, email, permissions);
  await page.goto("/m/");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(tab(page, "More")).toBeVisible();
}

test("step 5: installable with its own manifest, the worker on /m/, the No connection page offline, this browser's push card, an unsaved form asks before leaving", async ({ page, context }) => {
  await signInMobile(page, "install", ["view", "vehicles"]);

  // Installable: the page links its own manifest (scope /m/, the FF icons) and the worker controls /m/.
  const manifest = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifest).toBe("/m/manifest.webmanifest");
  const m = await (await page.request.get(manifest!)).json() as { name: string; scope: string; start_url: string; icons: { src: string }[] };
  expect([m.name, m.scope, m.start_url]).toEqual(["Fame Fleet", "/m/", "/m/"]);
  for (const icon of m.icons) expect((await page.request.get(icon.src)).status()).toBe(200);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)).toMatch(/\/m\/$/);

  // No connection: the site opened offline is the worker's page with Try again, in both languages.
  await page.reload();
  await expect(tab(page, "More")).toBeVisible();
  await context.setOffline(true);
  await page.goto("/m/office/vehicles").catch(() => undefined);
  await expect(page.getByRole("heading", { name: "No connection" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Try again/ })).toBeVisible();
  // Back online, the page reloads by itself (Try again does the same by hand).
  await context.setOffline(false);
  await expect(page.getByRole("heading", { name: "No connection" })).toHaveCount(0);
  await expect(page.getByText("Vehicles").first()).toBeVisible();

  // Notifications: this browser's own card (its state in words; one button when one makes sense).
  await page.goto("/m/office/notifications");
  await expect(page.getByTestId("browser-push")).toBeVisible();

  // An unsaved form: the browser's Back asks "Discard changes?" (Cancel keeps the form), and a reload asks the browser's
  // own "Leave site?".
  await page.goto("/m/office/vehicles");
  await shown(page.getByRole("button", { name: "Register vehicle" })).click();
  await expect(page).toHaveURL(/\/m\/office\/vehicles\/form/);
  await shown(page.locator("input")).fill(`WP MW-${stamp.slice(-4).toUpperCase()}`);
  const asked: string[] = [];
  page.once("dialog", (d) => { asked.push(`${d.type()}:${d.message()}`); void d.dismiss(); });
  await page.goBack({ timeout: 10_000 }).catch(() => undefined);
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toMatch(/^confirm:Discard changes\?/);
  await expect(page).toHaveURL(/\/m\/office\/vehicles\/form/);
  await expect(shown(page.locator("input"))).toHaveValue(`WP MW-${stamp.slice(-4).toUpperCase()}`);
  page.once("dialog", (d) => { asked.push(d.type()); void d.dismiss(); });
  await page.reload({ timeout: 5_000 }).catch(() => undefined);
  await expect.poll(() => asked.length).toBe(2);
  expect(asked[1]).toBe("beforeunload");
  // Discard: Back goes back for real, to the list.
  page.once("dialog", (d) => { asked.push(d.type()); void d.accept(); });
  await page.goBack({ timeout: 10_000 }).catch(() => undefined);
  await expect.poll(() => asked.length).toBe(3);
  await expect(page).toHaveURL(/\/m\/office\/vehicles$/);
  await expect(shown(page.getByRole("button", { name: "Register vehicle" }))).toBeVisible();
});

/** The mobile website's map package, as /me would answer it (the local functions have no Google key: /me says open). */
async function mapPackage(page: Page, pkg: "google" | "open"): Promise<{ googleLoads: string[] }> {
  const googleLoads: string[] = [];
  await page.route("**/functions/v1/office-api/me", async (route) => {
    const res = await route.fetch();
    const me = await res.json() as { map?: { package: string; places: boolean } };
    await route.fulfill({ response: res, json: { ...me, map: { package: pkg, places: false } } });
  });
  // The server counts the load and hands over the browser key: a stand-in here (never a real key in a test).
  await page.route("**/functions/v1/office-api/tools/register_map_load", (route) =>
    route.fulfill({ json: { result: { allowed: true, package: "google", map: "google", key: "stand-in-browser-key" } } }));
  await page.route("https://maps.googleapis.com/**", (route) => {
    googleLoads.push(route.request().url());
    const callback = new URL(route.request().url()).searchParams.get("callback") ?? "";
    return route.fulfill({ status: 200, contentType: "text/javascript", body: fakeGoogleMapsScript(callback) });
  });
  return { googleLoads };
}

test("the map on /m/ follows the office's package: google asks Google's loader with the counted key; open never does", async ({ page }) => {
  const g = await mapPackage(page, "google");
  const mapLines: string[] = [];
  page.on("console", (m) => { if (m.text().startsWith("[Fame Fleet map]")) mapLines.push(m.text()); });
  await signInMobile(page, "mapg", ["view"]);
  await tab(page, "Live").click();
  await expect(page.getByTestId("live-map")).toBeVisible();
  await expect.poll(() => g.googleLoads.length, { timeout: 20_000 }).toBeGreaterThan(0);
  expect(g.googleLoads[0]).toContain("key=stand-in-browser-key");
  // Google's map stays: past the script's 15 s limit and the phones' 30 s wait, still Google's, never the free map.
  const live = page.getByTestId("live-map");
  await expect(live.locator("[data-fake-google-map]")).toHaveCount(1);
  await page.waitForTimeout(32_000);
  await expect(live.locator("[data-fake-google-map]")).toHaveCount(1);
  await expect(live.locator(".maplibregl-canvas")).toHaveCount(0);
  expect(mapLines).toContain("[Fame Fleet map] Google used");
});

test("the map on /m/ with the open package never asks Google", async ({ page }) => {
  const g = await mapPackage(page, "open");
  await signInMobile(page, "mapo", ["view"]);
  await tab(page, "Live").click();
  await expect(page.getByTestId("live-map")).toBeVisible();
  await expect(page.getByTestId("live-map").locator(".maplibregl-canvas")).toHaveCount(1);
  await page.waitForTimeout(5_000);
  expect(g.googleLoads).toEqual([]);
});

test("the app's fonts on /m/: every family loads (self-hosted), headings Archivo / Gemunu Libre, body IBM Plex Sans / Yaldevi, plates and times IBM Plex Mono", async ({ page }) => {
  const googleFonts: string[] = [];
  page.on("request", (r) => { if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) googleFonts.push(r.url()); });
  const badFonts: string[] = [];
  page.on("response", (r) => {
    if (/\.(ttf|otf|woff2?)(\?|$)/.test(r.url()) && (r.status() !== 200 || !/font|octet-stream/.test(r.headers()["content-type"] ?? ""))) badFonts.push(`${r.status()} ${r.headers()["content-type"]} ${r.url()}`);
  });
  await signInMobile(page, "fonts", ["view", "approve", "assign_tasks"]);
  await page.evaluate(() => document.fonts.ready);
  const families = ["IBMPlexSans_400Regular", "IBMPlexSans_500Medium", "IBMPlexSans_600SemiBold", "IBMPlexSans_700Bold", "IBMPlexMono_500Medium", "IBMPlexMono_600SemiBold", "Archivo_800ExtraBold", "Yaldevi_400Regular", "Yaldevi_600SemiBold", "GemunuLibre_800ExtraBold"];
  const loaded = await page.evaluate(async (fs) => {
    const out: Record<string, boolean> = {};
    for (const f of fs) {
      await document.fonts.load(`16px "${f}"`, "Aa ශ්‍රී 0123");
      out[f] = document.fonts.check(`16px "${f}"`, "Aa ශ්‍රී 0123") && [...document.fonts].some((ff) => ff.family.replace(/"/g, "") === f && ff.status === "loaded");
    }
    return out;
  }, families);
  expect(loaded).toEqual(Object.fromEntries(families.map((f) => [f, true])));
  expect(badFonts).toEqual([]);
  expect(googleFonts).toEqual([]);
  // What the screens use: the Home header's title, a body line, a time in mono.
  const used = await page.evaluate(() => [...new Set([...document.querySelectorAll("#root *")].map((el) => getComputedStyle(el).fontFamily.split(",")[0].replace(/"/g, "").trim()))]);
  expect(used).toEqual(expect.arrayContaining(["Archivo_800ExtraBold", "IBMPlexSans_400Regular", "IBMPlexMono_600SemiBold"]));
});

// A regression guard: nothing on Live redraws by itself once loaded (no state set on a map move or render, no endless
// animation). It runs on the faked free style (no tiles, no sprites): the missing-sprite answer is checked against the real
// style by hand (docs/mobile-website.md), not here.
test("the map stays idle on /m/: a handful of frames at most in 5 s with no input", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: number; requestAnimationFrame: typeof requestAnimationFrame };
    w.__frames = 0;
    const raf = window.requestAnimationFrame.bind(window);
    w.requestAnimationFrame = (cb: FrameRequestCallback) => { w.__frames += 1; return raf(cb); };
  });
  await signInMobile(page, "idle", ["view"]);
  await tab(page, "Live").click();
  await expect(page.getByTestId("live-map")).toBeVisible();
  await expect(page.getByTestId("skeleton-rows")).toHaveCount(0); // the list loaded (a skeleton pulses by design)
  await page.waitForTimeout(6_000); // the map comes to rest
  const before = await page.evaluate(() => (window as unknown as { __frames: number }).__frames);
  await page.waitForTimeout(5_000);
  const after = await page.evaluate(() => (window as unknown as { __frames: number }).__frames);
  expect(after - before, "animation frames in 5 s with no input").toBeLessThanOrEqual(10);
});

/** The sign-in button in Sinhala (src/i18n/si.json login.signIn). */
const SI_SIGN_IN = "ඇතුළු වන්න";

for (const lang of ["en", "si"] as const) {
  test(`screenshots of /m/ in ${lang === "en" ? "English" : "Sinhala"}: Home, Approve, Live, a task, My profile, Where and More (kept with the run); the sign-in and More against their baselines on CI`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.addInitScript((l) => window.localStorage.setItem("language", JSON.stringify(l)), lang);
    // The sign-in, before anyone is signed in: the same on every run.
    await page.goto("/m/");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    if (process.env.CI) await expect(page).toHaveScreenshot(`signin-${lang}.png`, { animations: "disabled", maxDiffPixelRatio: 0.01 });
    await page.screenshot({ path: testInfo.outputPath(`m-${lang}-signin.png`) });

    const driver = { name: `Shot Driver ${stamp}${lang}`, code: `SD-${stamp}${lang}`, username: `sd.${stamp}${lang}`, pin: "135794", phone: "0771234508" };
    await tool("create_driver", driver);
    const plate = `WP SH-${stamp.slice(-3).toUpperCase()}${lang === "en" ? "1" : "2"}`;
    await tool("register_vehicle", { reg_no: plate, make_model: "Toyota HiAce", vehicle_type: "van", seats: 12, current_odometer_km: 1000 });
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date(Date.now() + 2 * 864e5));
    const task = await tool<{ task_id: string }>("create_task", { title: `Screenshot task ${stamp}`, date: day, start_time: "09:00", end_time: "10:00", driver: driver.username, vehicle: plate, pickup: "Head office", dropoff: "Galle" });
    const email = `shots.${lang}.${stamp}@fame.test`;
    const password = await officeUser(`Shots ${lang}`, email, ["view", "approve", "assign_tasks"]);
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: lang === "en" ? "Sign in" : SI_SIGN_IN, exact: true }).click();
    await expect(page).toHaveURL(/\/m\/office/);
    await page.waitForTimeout(3_000);

    const shot = async (name: string) => {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: testInfo.outputPath(`m-${lang}-${name}.png`) });
    };
    await shot("home");
    await page.goto("/m/office/approve");
    await page.waitForTimeout(2_000);
    await shot("approve");
    // Live with the map's picture hidden (the tiles are no part of the check).
    await page.goto("/m/office/live");
    await page.addStyleTag({ content: '[data-testid="live-map"] canvas, [data-testid="live-map"] [data-fake-google-map] { visibility: hidden !important; }' });
    await page.waitForTimeout(2_000);
    await shot("live");
    await page.goto(`/m/office/task/${task.task_id}`);
    await expect(shown(page.getByText(`Screenshot task ${stamp}`))).toBeVisible();
    await shot("task");
    // Round 1: My profile (the photo or the initials, Change photo) and the trip editor's empty Where suggestions.
    await page.goto("/m/office/profile");
    await expect(page.getByTestId("profile-change-photo")).toBeVisible();
    await shot("profile");
    await page.goto("/m/office/trip/where?mode=task");
    await page.waitForTimeout(2_000);
    await shot("where");
    await page.goto("/m/office/more");
    await page.waitForTimeout(2_000);
    await shot("more");
    // More is the same for everyone with these permissions but for the person's own row (masked).
    if (process.env.CI) {
      await expect(page).toHaveScreenshot(`more-${lang}.png`, { animations: "disabled", maxDiffPixelRatio: 0.01, mask: [page.getByText(`Shots ${lang}`), page.getByText(email), page.getByTestId("badge")] });
    }
  });
}

// Fix B (29 October 2026): From / To / Add stop, Uber's and PickMe's route form (docs/phase8-plan.md §38.2). The Where step
// in Sinhala (the longest words) on a 390 px phone: From, To and + Add stop on screen, nothing wider than the screen, with a
// stop added and with a row's ⋯ Options open.
test("the Where step in Sinhala at 390 px: From, To and + Add stop, no horizontal overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => window.localStorage.setItem("language", JSON.stringify("si")));
  const email = `where.si.${stamp}@fame.test`;
  const password = await officeUser("Mobile Where", email, ["view", "request"]);
  await page.goto("/m/");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: SI_SIGN_IN, exact: true }).click();
  await expect(page).toHaveURL(/\/m\/office/);
  await page.goto("/m/office/trip/where?mode=request");
  const card = shown(page.getByTestId("route-card"));
  await expect(card).toBeVisible();
  // si.json office.trip.from, .to and .addStop (Sinhala has no capitals: the labels read as written).
  await expect(card.getByText("සිට", { exact: true })).toBeVisible();
  await expect(card.getByText("දක්වා", { exact: true })).toBeVisible();
  await expect(card.getByText("නැවතුමක් එකතු කරන්න", { exact: true })).toBeVisible();
  // To waits there while the trip goes back to the office: si.json office.trip.waitThere on the row (30 October 2026).
  await expect(card.getByText("එහි රැඳීම", { exact: true })).toBeVisible();
  const width = () => page.evaluate(() => document.documentElement.scrollWidth);
  await page.evaluate(() => document.fonts.ready);
  expect(await width(), "the page's width with From and To").toBeLessThanOrEqual(390);
  // + Add stop: a row between From and To.
  await shown(page.getByTestId("add-stop")).click();
  await expect(shown(page.getByTestId("stop-row-1"))).toBeVisible();
  expect(await width(), "the page's width with a stop added").toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("m-si-where-390.png") });
  // A row's ⋯ Options (what happens there, the times, More details, Move up / down).
  await shown(page.getByTestId("stop-options-0")).click();
  await expect(shown(page.getByTestId("stop-options-sheet"))).toBeVisible();
  await expect(shown(page.getByText("එහිදී සිදුවන්නේ", { exact: true }))).toBeVisible();
  // The added row is a short stop (si.json office.trip.role_short).
  await expect(shown(page.getByTestId("stop-options-sheet")).getByText("කෙටි නැවතුම", { exact: true })).toBeVisible();
  expect(await width(), "the page's width with the Options sheet open").toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("m-si-where-options-390.png") });
});

// The place search as someone types (30 October 2026, Round 51b; the site: placeSearch.spec.ts): the Where step's real box on
// From, To and a stop between them. Empty, Saved (our places) and Recent (the person's own); typing asks search_places once
// the typing pauses, every answer 200 (no 429, no loop), and the place found shows.
test("the Where step's place boxes on /m/: Saved and Recent, then one search per pause on From, To and a stop, its results shown", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const depot = `Typing Depot ${stamp}`;
  await tool("add_place", { name: depot, address: "Galle Road, Colombo 03", lat: 6.9012, lng: 79.8521, kind: "store" });
  const email = `where.typing.${stamp}@fame.test`;
  const password = await officeUser("Mobile Typing", email, ["view", "request"]);
  const recentSpot = `Recent Spot ${stamp}`;
  await asPerson(email, password, "create_request", { date: "2026-12-01", time: "09:00", route_from: "Head office", route_to: recentSpot, need_type: "van", pax: 2 });
  const typed: string[] = [];
  const statuses: number[] = [];
  page.on("request", (r) => {
    if (!r.url().includes("/office-api/tools/search_places")) return;
    const body = JSON.parse(r.postData() || "{}") as { text?: string };
    if (typeof body.text === "string" && body.text !== "") typed.push(body.text);
  });
  page.on("response", (r) => {
    if (r.url().includes("/office-api/tools/search_places")) statuses.push(r.status());
  });
  await page.goto("/m/");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/m\/office/);
  await page.goto("/m/office/trip/where?mode=request");
  await expect(shown(page.getByTestId("route-card"))).toBeVisible();
  const box = () => shown(page.getByLabel("Search a place, or paste a Maps link", { exact: true }));
  const typeAndFind = async (word: string, label: string) => {
    // Empty: Saved (our places, a building) and Recent (the person's own, a clock).
    await expect(shown(page.getByLabel(new RegExp(`^${recentSpot}, Recent$`)))).toBeVisible();
    await expect(shown(page.getByLabel(/, Our place$/))).toBeVisible();
    const before = typed.length;
    await box().pressSequentially(word, { delay: 40 });
    // The search went out once the typing paused, and its result shows (a result row: not From's own name, nor a suggestion).
    await expect.poll(() => typed.slice(before).at(-1), { message: `${label}: the whole word was searched` }).toBe(word);
    const result = shown(page.getByRole("button", { name: new RegExp(`${depot}(?!, )`) }));
    await expect(result).toBeVisible();
    const sent = typed.slice(before);
    expect(sent.length, `${label}: debounced (${sent.join(" | ")})`).toBeLessThanOrEqual(2);
    await result.click();
  };
  // From: Change opens its box.
  await shown(page.getByTestId("from-change")).click();
  await typeAndFind("Typing Dep", "From");
  await expect(shown(page.getByTestId("from-name"))).toHaveText(depot);
  // To: its box is open on a new trip.
  await typeAndFind("Typing Depo", "To");
  // A stop between: + Add stop opens its box.
  await shown(page.getByTestId("add-stop")).click();
  await typeAndFind("Typing Depot", "Stop 1");
  expect(statuses.length).toBeGreaterThan(0);
  expect(statuses.every((s) => s === 200), `every search answered 200: ${statuses.join(",")}`).toBe(true);
});

/** A tool as an office person through office-api with their own session (a self trip is made by its own person). */
async function asPerson<T>(email: string, password: string, name: string, args: Record<string, unknown>): Promise<T> {
  const auth = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { "content-type": "application/json", apikey: ANON }, body: JSON.stringify({ email, password }),
  });
  const { access_token } = (await auth.json()) as { access_token?: string };
  if (!access_token) throw new Error(`sign-in failed: ${auth.status}`);
  const res = await fetch(`${API}/functions/v1/office-api/tools/${name}`, {
    method: "POST", headers: { "content-type": "application/json", apikey: ANON, authorization: `Bearer ${access_token}` }, body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
  // office-api answers { result } (the connector's JSON inside).
  return ((await res.json()) as { result: T }).result;
}

/** A 1 × 1 PNG: the odometer's "photo" from the phone's photos (the shared PhotoPick's Choose from photos). */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

/** Drags a slide's thumb to the end of its track (the shared SlideToConfirm completes at 90 % or more). */
async function slide(page: Page, testId: string): Promise<void> {
  const track = shown(page.getByTestId(testId));
  await expect(track).toBeVisible();
  const box = (await track.boundingBox())!;
  const thumb = (await shown(page.getByTestId(`${testId}-thumb`)).boundingBox())!;
  const y = thumb.y + thumb.height / 2;
  await page.mouse.move(thumb.x + thumb.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, y, { steps: 12 });
  await page.mouse.up();
}

/** Choose from photos with the file the browser's chooser gets. */
async function choosePhoto(page: Page, within: Locator): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await shown(within.getByRole("button", { name: "Choose from photos" })).click();
  await (await chooser).setFiles({ name: "odometer.png", mimeType: "image/png", buffer: PIXEL });
}

test("Round 50 and 53: Users → Can drive on /m/, Home's trip card and More → Driving, then a self trip driven in the browser (driver-lite): Start with the check and the odometer, Arrived and Done, Finish; one position per action, no live tracking", async ({ page, context }) => {
  // The self-driver: an office person who books and drives their own trip (approve, so the task is made at once).
  const email = `selfdriver.${stamp}@fame.test`;
  const password = await officeUser(`Self Driver ${stamp}`, email, ["view", "request", "approve", "assign_tasks"]);
  const plate = `WP SD-${stamp.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Toyota Axio", vehicle_type: "car", seats: 4, current_odometer_km: 2000 });
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date());
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  const start = `${String(Math.min(hour + 1, 22)).padStart(2, "0")}:00`;
  // An admin on /m/: People → the self-driver's page → Can drive (self-drive trips in the app), saved at once.
  // (approve too: an account holding approve is changed only by someone who holds it: accountGuards.ts)
  await signInMobile(page, "users", ["view", "request", "approve", "assign_tasks", "vehicles", "issues", "users"]);
  await page.goto(`/m/office/people/user/${encodeURIComponent(email)}`);
  const can = shown(page.getByTestId("can-drive"));
  await expect(can).toContainText("Can drive (self-drive trips in the app)");
  await can.getByRole("switch").click();
  await expect(can.getByRole("switch")).toBeChecked();
  expect((await tool<{ users: { email: string; can_drive?: boolean }[] }>("list_office_users", { search: email })).users.find((u) => u.email === email)?.can_drive).toBe(true);
  // Then the person books their own trip (made at once: they hold approve). Can drive was turned on first: a self-drive
  // task would also give it by itself (Round 50), and the switch would then turn it off.
  const task = await asPerson<{ task_id: string }>(email, password, "create_task", {
    title: `Web trip ${stamp}`, date: day, start_time: start, driven_by: "self", vehicle: plate, pickup: "Head office", dropoff: "Galle",
  });

  // The self-driver on /m/ in a browser that gives a position when asked (one, per action).
  await context.clearCookies();
  await page.evaluate(() => window.localStorage.clear());
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 6.9271, longitude: 79.8612, accuracy: 15 });
  await page.goto("/m/");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(tab(page, "More")).toBeVisible();

  // Round 53 (c): Home says "You have a trip to drive" in the browser too, and Start driving opens the trip's drive page
  // (never Driving mode, which is the app's).
  const card = shown(page.getByTestId("home-drive-line"));
  await expect(card).toContainText("You have a trip to drive");
  await expect(card).toContainText(`Web trip ${stamp}`);
  await card.getByRole("button", { name: "Start driving" }).click();
  await expect(page).toHaveURL(new RegExp(`/m/office/my-trip/${task.task_id}/drive`));
  // More → Driving opens the same trip there.
  await page.goto("/m/office/more");
  const driving = shown(page.getByTestId("more-driving"));
  await expect(driving).toContainText(`Your trip, from this browser · Web trip ${stamp}`);
  await driving.click();
  await expect(page).toHaveURL(new RegExp(`/m/office/my-trip/${task.task_id}/drive`));

  // My trip offers "Drive this trip here" in the browser; the page says live tracking needs the app.
  await page.goto(`/m/office/my-trip/${task.task_id}`);
  await shown(page.getByTestId("web-drive-offer")).getByRole("button", { name: "Drive this trip here" }).click();
  await expect(page).toHaveURL(new RegExp(`/m/office/my-trip/${task.task_id}/drive`));
  await expect(shown(page.getByText(/Live tracking needs the Fame Fleet app/)).first()).toBeVisible();

  // Start: the check (when the switch asks it), the fuel card (when it asks), the odometer photo and the reading.
  const startWhy = shown(page.getByTestId("web-start-why"));
  if (await shown(page.getByTestId("web-check")).count()) await shown(page.getByRole("radio", { name: /No, all good/ })).click();
  if (await shown(page.getByTestId("web-fuel-card")).count()) await shown(page.getByRole("radio", { name: /Enough fuel/ })).click();
  await expect(startWhy).toHaveText("Take the odometer photo");
  await choosePhoto(page, shown(page.getByTestId("web-odometer-start")));
  await shown(page.getByTestId("web-odometer")).fill("2015");
  await expect(page.getByTestId("web-start-why")).toHaveCount(0);
  await shown(page.getByRole("button", { name: "Start trip", exact: true })).click();
  await expect(page.getByText("Trip started")).toBeVisible();

  // Each stop: Arrived, then Done, each a slide (dragged with the mouse: the shared SlideToConfirm's responder runs on the
  // web), each with one position.
  for (const place of ["Head office", "Galle"]) {
    await slide(page, "web-slide-arrive");
    await expect(page.getByText(new RegExp(`Arrived at ${place}`))).toBeVisible();
    await slide(page, "web-slide-leave");
    await expect(page.getByText(new RegExp(`Done at ${place}`))).toBeVisible();
  }

  // Finish: the odometer photo and the reading (the km as typed); the fuel under More details says no video.
  await choosePhoto(page, shown(page.getByTestId("web-finish")));
  await shown(page.getByTestId("web-odometer-end")).fill("2057");
  await expect(shown(page.getByTestId("web-km"))).toContainText("42 km this trip");
  await shown(page.getByRole("button", { name: "More details" })).click();
  await expect(shown(page.getByTestId("web-no-video"))).toHaveText("Fuel video needs the Fame Fleet app.");
  await shown(page.getByRole("button", { name: "Finish trip", exact: true })).click();
  await expect(shown(page.getByTestId("web-trip-done"))).toContainText("Trip finished · 42 km");

  // The office's view: driver_route draws the actions joined by straight dashed lines (web_points), never a GPS line.
  const route = await tool<{ web_trip?: boolean; web_points?: { action: string }[]; recorded_points: number }>("driver_route", { task_id: task.task_id });
  expect(route.web_trip).toBe(true);
  expect(route.web_points?.map((p) => p.action)).toEqual(["start", "arrive", "leave", "arrive", "leave", "finish"]);
});
