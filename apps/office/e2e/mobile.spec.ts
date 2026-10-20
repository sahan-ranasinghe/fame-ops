// The mobile website (Phase 8, O4; docs/mobile-website.md): Office mode's own screens under /m/, built for the browser from
// the driver app. The phone redirect is held (viewChoice.ts PHONE_REDIRECT): a phone stays on the desktop site until it
// opts in. Sign-in with the office e-mail and password → Home → Approve → Live, the switch both ways (remembered), then a
// desktop link opened on the phone → its own screen → Give a driver. Runs under the "mobile-web" Playwright project only,
// against the local mobile build the dev server serves under /m/ (FLEET_MOBILE_DIR; scripts/test-office-local.sh makes it).
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./offline";

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
  const verify = await fetch(user.set_password_link, { redirect: "manual" });
  const hash = new URLSearchParams((verify.headers.get("location") ?? "").split("#")[1] ?? "");
  const password = `Mobile test ${stamp}!`;
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
