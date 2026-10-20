// The office app on a phone (412 × 915, touch): the tab bar per role with at
// most five tabs, the one big action on Home, every form as a page, a detail
// as a full screen with a back arrow, drafts, the stops editor's rows, pull to
// refresh. Runs under the "phone" Playwright project only.
import type { Page } from "@playwright/test";
import { expect, test } from "./offline";

const MCP = (process.env.OFFICE_MCP_URL || "http://127.0.0.1:54321/functions/v1/office-mcp").replace(/\/$/, "");
const KEY = process.env.OFFICE_MCP_KEY || "";
const stamp = Date.now().toString(36) + "p";

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

/** Makes an office user through the connector and signs them in through the set-password link. */
async function signIn(page: Page, name: string, email: string, permissions: string[]): Promise<void> {
  const user = await tool<{ set_password_link: string }>("create_office_user", { name, email, permissions });
  const verify = await fetch(user.set_password_link, { redirect: "manual" });
  const landing = verify.headers.get("location") ?? "";
  await page.goto("/" + landing.slice(landing.indexOf("#")));
  const password = `Phone test ${stamp}!`;
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Again").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
}

const tabs = (page: Page) => page.locator('nav[aria-label="Sections"] a');

test.beforeAll(() => {
  test.skip(!KEY, "OFFICE_MCP_KEY (the local shared key) is not set");
});

test("a fleet admin on a phone: five tabs, the big action, a task as a page, a detail as a full screen with a back arrow, the stops editor, pull to refresh", async ({ page }) => {
  await signIn(page, "Phone Admin", `phone.admin.${stamp}@fame.test`, ["view", "request", "approve", "assign_tasks", "vehicles", "issues", "users"]);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  // The rail is gone; the tab bar has Home, Requests, Tasks, Live, More and nothing else (Hotfix 3: the approver's four).
  await expect(page.locator("aside.rail")).toBeHidden();
  // The digits are the badges: the requests waiting, and on More the issues (Issues lives under More).
  await expect(tabs(page)).toHaveText(["Home", /^Requests\d*$/, "Tasks", "Live", /^More\d*$/]);
  // The big action: Requests to approve (N) while any wait (other tests leave some), else Assign a task.
  const big = page.getByTestId("home-action");
  await expect(big).toHaveText(/^(Assign a task|Requests to approve \(\d+\))$/);
  // More lists what is not on the bar, once.
  await tabs(page).filter({ hasText: "More" }).click();
  const more = page.getByTestId("more-list");
  // Hotfix 3 (L5): in the menu's section order: Today, Fleet, Reports, Admin.
  await expect(more.getByRole("link")).toHaveText(["Task history", "My trips", /^Issues\d*$/, "Drivers board", "Vehicles", "Drivers", "Places", "Maintenance", "Mileage", "Fuel", "Duty log", "Projects", "Settings"]);

  // The big action opens its page; Assign a task is a page of its own, its stops rows numbered within their type.
  await tabs(page).filter({ hasText: "Home" }).click();
  await expect(big).toBeVisible();
  const toRequests = /^Requests to approve/.test((await big.textContent()) ?? "");
  await big.click();
  if (toRequests) {
    await expect(page).toHaveURL(/\/requests$/);
    await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
    await tabs(page).filter({ hasText: "Tasks" }).click();
    await page.getByRole("link", { name: "Assign a task" }).click();
  }
  await expect(page).toHaveURL(/\/tasks\/new$/);
  await expect(page.getByRole("heading", { name: "Assign a task" })).toBeVisible();
  const rows = page.getByTestId("stop-row");
  await expect(rows).toHaveCount(2);
  // Stops are named by their place in the order (Phase 7, §11): "Stop 2 · Drop · …".
  await expect(rows.nth(0)).toContainText("Stop 1 · Pickup");
  await expect(rows.nth(1)).toContainText("Stop 2 · Drop");
  await page.getByRole("button", { name: "Add stop" }).click();
  await expect(rows.nth(2)).toContainText("Stop 3 · Drop");
  // Changing one row's type never changes another's.
  await rows.nth(1).getByLabel("Stop 2: type").selectOption("visit");
  await expect(rows.nth(0)).toContainText("Stop 1 · Pickup");
  await expect(rows.nth(1)).toContainText("Stop 2 · Visit");
  await expect(rows.nth(2)).toContainText("Stop 3 · Drop");
  // Every row shows its time at the stop.
  await expect(rows.nth(1).getByText("Time at this stop")).toBeVisible();
  // Every row has its own arrive-by field.
  await expect(rows.nth(2).getByLabel("Arrive by")).toBeVisible();
  // The plan says what is missing, in words that say what to do.
  await page.getByLabel("Stop 1", { exact: true }).fill("Head office");
  await expect(page.getByTestId("plan-reasons")).toContainText("Add a leave-by time, or an arrive-by time on a stop");
  // The primary button is sticky above the tab bar (its box sits within the viewport while the page scrolls).
  const save = page.getByRole("button", { name: "Assign & send" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(save).toBeInViewport();

  // A task made through the connector: the board's card opens the detail as a full screen; Back returns to the board.
  const driver = { name: `Phone Driver ${stamp}`, code: `PH-${stamp}`, username: `ph.${stamp}`, pin: "246810", phone: "0771234504" };
  await tool("create_driver", driver);
  const plate = `WP PH-${stamp.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Toyota HiAce", vehicle_type: "van", seats: 12, current_odometer_km: 1000 });
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date(Date.now() + 2 * 864e5));
  const t = await tool<{ task_id: string }>("create_task", { title: `Phone task ${stamp}`, date: day, start_time: "08:00", driver: driver.username, vehicle: plate, pickup: "Head office", dropoff: "Galle" });
  await page.goto(`/tasks?date=${day}`);
  await page.locator(".tcard", { hasText: `Phone task ${stamp}` }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${t.task_id}`));
  const detail = page.getByTestId("detail");
  await expect(detail.getByRole("heading", { name: `Phone task ${stamp}` })).toBeVisible();
  await expect(page.locator(".board")).toBeHidden();
  await detail.getByRole("button", { name: "Back" }).click();
  await expect(page.locator(".board")).toBeVisible();
  await expect(page).toHaveURL(/\/tasks\?date=/);

  // Pull to refresh: a touch drag from the top of the page (on the board, inside the wrapper) shows the indicator and refreshes.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => {
    const board = document.querySelector("main .board")!;
    const touch = (type: string, y: number) => {
      const t = new Touch({ identifier: 1, target: board, clientX: 200, clientY: y });
      board.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [t], changedTouches: [t] }));
    };
    touch("touchstart", 100);
    touch("touchmove", 160);
    touch("touchmove", 220);
  });
  await expect(page.getByTestId("pull")).toContainText("Release to refresh");
  await page.evaluate(() => {
    const board = document.querySelector("main .board")!;
    const t = new Touch({ identifier: 1, target: board, clientX: 200, clientY: 220 });
    board.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], changedTouches: [t] }));
  });
  await expect(page.getByTestId("pull")).toContainText("Refreshing…");
  await expect(page.getByTestId("pull")).toHaveCount(0, { timeout: 5000 });
});

test("a requester on a phone: four tabs, New request as the big action, the request as a page, the detail full screen, the draft kept", async ({ page }) => {
  await signIn(page, "Phone Requester", `phone.req.${stamp}@fame.test`, ["view", "request"]);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(tabs(page)).toHaveText(["Home", "My trips", "Vehicles", "Live", "More"]);
  await expect(page.getByTestId("home-action")).toHaveText("New request");
  await tabs(page).filter({ hasText: "More" }).click();
  await expect(page.getByTestId("more-list").getByRole("link")).toHaveText(["Requests", "Drivers", "Projects", "Settings"]);

  // The request page from the big action; a draft survives leaving through the tab bar.
  await tabs(page).filter({ hasText: "Home" }).click();
  await page.getByTestId("home-action").click();
  await expect(page).toHaveURL(/\/requests\/new$/);
  await expect(page.getByLabel("Who needs it")).toHaveCount(0);
  await expect(page.getByLabel("On behalf of")).toBeVisible();
  await page.getByLabel("Note").fill("Phone draft");
  await tabs(page).filter({ hasText: "Live" }).click();
  await expect(page.getByRole("heading", { name: "Live locations" })).toBeVisible();
  await page.goto("/requests/new");
  await expect(page.getByTestId("draft-banner")).toContainText("Resume draft from");
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByLabel("Note")).toHaveValue("Phone draft");
  // Stage 0: a time on a phone is never typed: the field opens the time sheet, a pick counts and closes it.
  await page.getByLabel("Leave by", { exact: true }).click();
  await page.getByTestId("time-sheet").getByRole("option", { name: "09:00", exact: true }).click();
  await expect(page.getByTestId("time-sheet")).toHaveCount(0);
  await page.getByLabel("Stop 1", { exact: true }).fill("Head office");
  await page.getByLabel("Stop 2", { exact: true }).fill("Galle");
  await page.getByRole("button", { name: "Save request" }).click();
  await expect(page.getByRole("status")).toHaveText("Sent to the fleet admin · you'll be notified.");
  await expect(page).toHaveURL(/\/requests$/);

  // The list is cards on a phone; a card opens the detail as a full screen; Back returns to the list.
  const row = page.locator("tr", { hasText: "Phone Requester" }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]+$/);
  await expect(page.getByTestId("request-detail")).toBeVisible();
  await expect(page.getByTestId("request-timeline")).toContainText("Sent");
  await expect(page.getByRole("heading", { name: "My requests" })).toBeHidden();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "My requests" })).toBeVisible();
});

test("Live on a phone (Phase 7, §25): one control cluster on the right edge, 40 px buttons, no corner covered", async ({ page }) => {
  await signIn(page, "Phone Live", `phone.live.${stamp}@fame.test`, ["view", "assign_tasks"]);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.goto("/live");
  const cluster = page.getByTestId("map-controls");
  await expect(cluster).toBeVisible({ timeout: 15000 });
  for (const name of ["Zoom in", "Zoom out", "Today’s trails"]) {
    const box = await cluster.getByRole("button", { name }).boundingBox();
    expect(box && Math.round(box.width) === 40 && Math.round(box.height) === 40).toBe(true);
  }
  const map = await cluster.locator("xpath=..").boundingBox();
  const c = await cluster.boundingBox();
  expect(map && c).toBeTruthy();
  if (map && c) {
    expect(map.x + map.width - (c.x + c.width)).toBeLessThan(24); // on the right edge
    expect(c.y - map.y).toBeGreaterThan(40); // clear of the top corner
    expect(map.y + map.height - (c.y + c.height)).toBeGreaterThan(40); // and of the bottom corner
  }
});
