// Contrast, light AND dark (Round 2b, 21 October 2026): axe-core's color-contrast rule on every main screen of the site, at
// a desktop's width (project "chromium") and a phone's (project "phone", 412 px), each screen checked in the light theme
// and again with the browser asking for dark (emulateMedia colorScheme). The mobile website /m/ (project "mobile-web") is
// light on purpose for now: its screens are checked light, and the page must say so (color-scheme: only light) so a
// browser's or Android's forced dark mode leaves it alone. A violation fails the test with every selector and its colours.
// Each screen is also kept as a picture, light and dark (testInfo.outputPath: CI keeps test-results with the run).
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./offline";

const MCP = (process.env.OFFICE_MCP_URL || "http://127.0.0.1:54321/functions/v1/office-mcp").replace(/\/$/, "");
const KEY = process.env.OFFICE_MCP_KEY || "";
const API = (process.env.API_URL || "http://127.0.0.1:54321").replace(/\/$/, "");
const ANON = process.env.ANON_KEY || "";
const stamp = Date.now().toString(36);

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

type Scheme = "light" | "dark";
type AxeNode = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"][number]["nodes"][number];

/** One line per failing element: where, the colours axe measured, the ratio and what it needs. */
function describe(scheme: Scheme, screen: string, n: AxeNode): string {
  const d = (n.any[0]?.data ?? {}) as { fgColor?: string; bgColor?: string; contrastRatio?: number; expectedContrastRatio?: string; fontSize?: string; fontWeight?: string };
  const colours = d.fgColor ? `${d.fgColor} on ${d.bgColor} = ${d.contrastRatio} (needs ${d.expectedContrastRatio}; ${d.fontSize} ${d.fontWeight})` : (n.failureSummary ?? "").replace(/\s+/g, " ");
  return `${scheme} · ${screen} · ${n.target.join(" ")} · ${colours}`;
}

/** The screen as it is now, in one theme: its picture kept, then axe's color-contrast rule. Answers the violations. */
async function check(page: Page, testInfo: TestInfo, screen: string, scheme: Scheme): Promise<string[]> {
  await page.emulateMedia({ colorScheme: scheme });
  await page.waitForTimeout(400); // the theme's colours applied (transitions end)
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-${screen}-${scheme}.png`), fullPage: testInfo.project.name === "chromium" });
  const result = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  return result.violations.flatMap((v) => v.nodes.map((n) => describe(scheme, screen, n)));
}

/** A screen checked light and then dark (the site keeps both themes). Leaves the page in the light theme. */
async function bothThemes(page: Page, testInfo: TestInfo, screen: string): Promise<string[]> {
  const out = [...(await check(page, testInfo, screen, "light")), ...(await check(page, testInfo, screen, "dark"))];
  await page.emulateMedia({ colorScheme: "light" });
  return out;
}

/** A list's first page loaded (no skeleton rows left), then a moment for the rest of the screen. */
async function settle(page: Page, ready: Locator): Promise<void> {
  await expect(ready).toBeVisible();
  await expect(page.getByTestId("skeleton-rows")).toHaveCount(0, { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
}

const fail = (found: string[]) => expect(found, `colour contrast (WCAG AA) failed on ${found.length} element(s):\n${found.join("\n")}`).toEqual([]);

test("the site's sign-in page: readable light and dark", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-web", "the mobile website has its own sign-in (the /m/ test)");
  await page.goto("/");
  await settle(page, page.getByLabel("E-mail"));
  fail(await bothThemes(page, testInfo, "signin"));
});

test("every main screen of the site: readable light and dark (desktop and phone width)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-web", "the site's screens run under the chromium and phone projects");
  test.skip(!KEY, "OFFICE_MCP_KEY (the local shared key) is not set");
  test.setTimeout(420_000);
  const tag = `${stamp}${testInfo.project.name === "phone" ? "p" : "d"}`;
  const driver = { name: `Contrast Driver ${tag}`, code: `CT-${tag}`, username: `ct.${tag}`, pin: "246817", phone: "0771234530" };
  await tool("create_driver", driver);
  const plate = `WP CT-${tag.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Toyota HiAce", vehicle_type: "van", seats: 12, current_odometer_km: 1000 });
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date(Date.now() + 2 * 864e5));
  const title = `Contrast task ${tag}`;
  const task = await tool<{ task_id: string }>("create_task", { title, date: day, start_time: "09:00", end_time: "10:00", driver: driver.username, vehicle: plate, pickup: "Head office", dropoff: "Galle" });
  await tool("create_request", { requested_by: `Contrast Desk ${tag}`, date: day, time: "13:00", route_from: "Head office", route_to: "Kandy", need_type: "van", pax: 2 });

  // Signed in through the set-password link, with every permission (every screen and every button shows).
  const email = `contrast.${tag}@fame.test`;
  const user = await tool<{ set_password_link: string }>("create_office_user", { name: `Contrast ${tag}`, email, permissions: ["view", "request", "approve", "assign_tasks", "vehicles", "issues", "users"] });
  const verify = await fetch(user.set_password_link, { redirect: "manual" });
  const landing = verify.headers.get("location") ?? "";
  await page.goto("/" + landing.slice(landing.indexOf("#")));
  const password = `Contrast for ${tag}!`;
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Again").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();

  const found: string[] = [];
  const heading = (name: string) => page.getByRole("heading", { name, exact: true }).first();

  await settle(page, heading("Overview"));
  found.push(...(await bothThemes(page, testInfo, "overview")));

  await page.goto("/live");
  await settle(page, heading("Live locations"));
  found.push(...(await bothThemes(page, testInfo, "live")));

  await page.goto("/tasks");
  await settle(page, heading("Tasks"));
  found.push(...(await bothThemes(page, testInfo, "tasks")));

  await page.goto(`/tasks/${task.task_id}`);
  await settle(page, page.getByRole("heading", { name: title }).first());
  found.push(...(await bothThemes(page, testInfo, "task")));

  await page.goto("/requests");
  await settle(page, heading("Requests"));
  found.push(...(await bothThemes(page, testInfo, "requests")));

  // Assign a task with the leave time's clock open (a drop-down on a desktop, the time sheet on a phone).
  await page.goto("/tasks/new");
  await settle(page, heading("Assign a task"));
  await page.getByLabel("Leave by", { exact: true }).click();
  await expect(page.getByTestId("time-dial")).toBeVisible();
  found.push(...(await bothThemes(page, testInfo, "assign-clock")));
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("time-dial")).toHaveCount(0);
  // A stop's Stay sheet (the two lists), where the form shows the field.
  const stay = page.getByTestId("dwell-picker").first().getByRole("button").first();
  if (await stay.isVisible()) {
    await stay.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("stay-sheet")).toBeVisible();
    found.push(...(await bothThemes(page, testInfo, "assign-stay")));
    await page.keyboard.press("Escape");
  }

  await page.goto("/vehicles");
  await settle(page, heading("Vehicles"));
  found.push(...(await bothThemes(page, testInfo, "vehicles")));

  await page.goto("/drivers");
  await settle(page, heading("Drivers"));
  found.push(...(await bothThemes(page, testInfo, "drivers")));

  await page.goto("/issues");
  await settle(page, heading("Issues"));
  found.push(...(await bothThemes(page, testInfo, "issues")));

  await page.goto("/settings/users");
  await settle(page, heading("Users"));
  found.push(...(await bothThemes(page, testInfo, "settings-users")));

  await page.goto("/my-trips");
  await settle(page, heading("My trips"));
  found.push(...(await bothThemes(page, testInfo, "my-trips")));

  fail(found);
});

/** A tab of the mobile website's bar (the last button with that name: the bar is at the end of the page). */
const mtab = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).last();
/** The screen in front: a stack keeps the screens under it in the page, hidden. */
const shown = (l: Locator) => l.filter({ visible: true }).first();

test("the mobile website /m/: light only (a forced dark mode leaves it alone) and readable on every main screen", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-web", "the mobile website runs under the mobile-web project");
  test.skip(!KEY || !ANON, "OFFICE_MCP_KEY and ANON_KEY (the local stack) are not set");
  test.skip(!process.env.FLEET_MOBILE_DIR, "FLEET_MOBILE_DIR (the local mobile build) is not set");
  test.setTimeout(300_000);
  // As mobile.spec.ts: this tab starts as a new phone would, with no desktop/mobile choice made.
  await context.addInitScript(() => {
    if (window.sessionStorage.getItem("e2e.mobile")) return;
    window.sessionStorage.setItem("e2e.mobile", "1");
    window.localStorage.removeItem("fleet.view");
  });
  const tag = `${stamp}m`;
  const driver = { name: `Contrast Driver ${tag}`, code: `CT-${tag}`, username: `ct.${tag}`, pin: "246818", phone: "0771234531" };
  await tool("create_driver", driver);
  const plate = `WP CM-${tag.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Toyota HiAce", vehicle_type: "van", seats: 12, current_odometer_km: 1000 });
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date(Date.now() + 2 * 864e5));
  const title = `Contrast task ${tag}`;
  const task = await tool<{ task_id: string }>("create_task", { title, date: day, start_time: "09:00", end_time: "10:00", driver: driver.username, vehicle: plate, pickup: "Head office", dropoff: "Galle" });
  await tool("create_request", { requested_by: `Contrast Desk ${tag}`, date: day, time: "13:00", route_from: "Head office", route_to: "Kandy", need_type: "van", pax: 2 });

  // The office user's password, set through the set-password link's session (mobile.spec.ts officeUser).
  const email = `contrast.${tag}@fame.test`;
  const user = await tool<{ set_password_link: string }>("create_office_user", { name: `Contrast ${tag}`, email, permissions: ["view", "request", "approve", "assign_tasks", "vehicles", "issues"] });
  const verify = await fetch(user.set_password_link, { redirect: "manual" });
  const hash = new URLSearchParams((verify.headers.get("location") ?? "").split("#")[1] ?? "");
  const password = `Contrast for ${tag}!`;
  const set = await fetch(`${API}/auth/v1/user`, {
    method: "PUT",
    headers: { "content-type": "application/json", apikey: ANON, authorization: `Bearer ${hash.get("access_token")}` },
    body: JSON.stringify({ password }),
  });
  expect(set.ok, `set password: ${set.status}`).toBe(true);

  // Light on purpose: the page says "only light" (meta and CSS), so the browser keeps it light when the phone is dark.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/m/");
  await expect(page.locator('input[type="email"]')).toBeVisible();
  expect(await page.locator('meta[name="color-scheme"]').getAttribute("content")).toBe("only light");
  // Chromium may write the keywords in either order ("only light" / "light only"): light, only, never dark.
  const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  expect(scheme.split(/\s+/).sort()).toEqual(["light", "only"]);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(243, 242, 238)");
  await page.emulateMedia({ colorScheme: "light" });

  const found: string[] = [];
  const screen = async (name: string) => found.push(...(await check(page, testInfo, `m-${name}`, "light")));
  await screen("signin");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(mtab(page, "More")).toBeVisible();
  await page.waitForTimeout(2_000);
  await screen("home");

  await page.goto("/m/office/approve");
  await expect(shown(page.getByText(`Contrast Desk ${tag}`))).toBeVisible();
  await screen("approve");

  await page.goto("/m/office/tasks");
  await expect(mtab(page, "More")).toBeVisible();
  await page.waitForTimeout(2_000);
  await screen("tasks");

  await page.goto(`/m/office/task/${task.task_id}`);
  await expect(shown(page.getByText(title))).toBeVisible();
  await screen("task");

  await page.goto("/m/office/live");
  await expect(page.getByTestId("live-map")).toBeVisible();
  await page.waitForTimeout(2_000);
  await screen("live");

  await page.goto("/m/office/more");
  await expect(mtab(page, "More")).toBeVisible();
  await page.waitForTimeout(1_500);
  await screen("more");

  await page.goto("/m/office/profile");
  await expect(page.getByTestId("profile-change-photo")).toBeVisible();
  await screen("profile");

  fail(found);
});
