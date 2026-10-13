// The plan's end-to-end check on the LOCAL stack (phases 2 and 3): the
// set-password link, Overview, one task assigned and cancelled, the live map
// (a driver shares a position; a new one arrives over Realtime), 2-step
// turned on in Settings, sign out, sign in with the code.
//
// Needs: supabase start (with Realtime), functions serve (OFFICE_MCP_KEY in
// its env), the web app's .env.local pointing at the local stack, and:
//   OFFICE_MCP_URL   http://127.0.0.1:54321/functions/v1/office-mcp
//   OFFICE_MCP_KEY   the local shared key (never the real one)
//   API_URL, ANON_KEY  the local stack (scripts/test-office-local.sh sets them)
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { totp } from "./totp";

const MCP = (process.env.OFFICE_MCP_URL || "http://127.0.0.1:54321/functions/v1/office-mcp").replace(/\/$/, "");
const KEY = process.env.OFFICE_MCP_KEY || "";
const API = (process.env.API_URL || "http://127.0.0.1:54321").replace(/\/$/, "");
const ANON = process.env.ANON_KEY || "";
const stamp = Date.now().toString(36);

/** The driver's side, as the Fame Driver app does it: sign in with the PIN, then REST with that session. */
async function driverRest(username: string, pin: string) {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { "content-type": "application/json", apikey: ANON },
    body: JSON.stringify({ email: `${username}@drivers.fame.invalid`, password: pin }),
  });
  const session = (await res.json()) as { access_token?: string };
  if (!session.access_token) throw new Error(`driver sign-in failed: ${res.status}`);
  const headers = { "content-type": "application/json", apikey: ANON, authorization: `Bearer ${session.access_token}`, prefer: "return=representation" };
  return {
    async get<T>(path: string): Promise<T> {
      const r = await fetch(`${API}/rest/v1/${path}`, { headers });
      return (await r.json()) as T;
    },
    async post(path: string, body: unknown): Promise<number> {
      const r = await fetch(`${API}/rest/v1/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
      return r.status;
    },
  };
}

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

test.beforeAll(() => {
  test.skip(!KEY, "OFFICE_MCP_KEY (the local shared key) is not set");
});

test("an office user sets a password, runs the fleet pages, watches a driver live, turns on 2-step, and signs in again with the code", async ({ page }) => {
  // Set up through the connector, as the admin would in Claude.
  const email = `e2e.${stamp}@fame.test`;
  const user = await tool<{ set_password_link: string }>("create_office_user", { name: "E2E Admin", email, role: "admin" });
  const driver = { name: `E2E Driver ${stamp}`, code: `E2E-${stamp}`, username: `e2e.${stamp}`, pin: "246810" };
  await tool("create_driver", driver);
  const plate = `WP E2E-${stamp.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Toyota HiAce", vehicle_type: "van", seats: 12, current_odometer_km: 1000 });

  // 1. The set-password link opens the app with a recovery session. 12 characters at least.
  // The link's redirect lands on the Site URL (port 5173); the test's own server is on 5174, so
  // the recovery tokens are taken from the redirect and handed to the app directly.
  const verify = await fetch(user.set_password_link, { redirect: "manual" });
  const landing = verify.headers.get("location") ?? "";
  expect(landing).toContain("#access_token=");
  await page.goto("/" + landing.slice(landing.indexOf("#")));
  await expect(page.getByRole("heading", { name: "Choose a password" })).toBeVisible();
  await page.getByLabel("New password").fill("short one");
  await page.getByLabel("Again").fill("short one");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
  const password = `Sentence for ${stamp}!`;
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Again").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();

  // 2. Straight to Overview, as this person: 2-step is optional.
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("E2E Admin")).toBeVisible();
  await expect(page.getByText("Vehicles on the road")).toBeVisible();

  // 3. Assign a task; it appears on the board; open it; cancel it.
  await page.getByRole("button", { name: "Assign task" }).click();
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  const title = `E2E drop ${stamp}`;
  await page.getByLabel("Task", { exact: true }).fill(title);
  await page.getByLabel("Leave by", { exact: true }).fill("09:30");
  await page.getByLabel("Pickup").fill("Head office");
  await page.getByLabel("Drop-off").fill("Nugegoda");
  await page.getByLabel("Driver", { exact: true }).selectOption(driver.username);
  await page.getByLabel("Vehicle", { exact: true }).selectOption(plate);
  // The plan preview follows the form (a moment after the last change): leave-by time and the estimated legs.
  await expect(page.getByTestId("plan-panel")).toContainText("Leave by", { timeout: 15000 });
  await page.getByRole("button", { name: "Assign & send" }).click();
  await expect(page.getByText(`Sent to ${driver.name}.`)).toBeVisible();
  const card = page.locator(".tcard", { hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Leave by 09:30");
  await card.click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Fame internal")).toBeVisible();
  await expect(page.getByRole("dialog").getByTestId("plan-panel")).toContainText("estimate");
  await page.getByLabel("Cancel this task").fill("E2E test over");
  await page.getByRole("button", { name: "Cancel task" }).click();
  await expect(page.getByRole("status")).toHaveText("Task cancelled");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card).toHaveCount(0);

  // 4. Live locations, the one status rule: no signal → Location off (heartbeat) → live (a fresh point), all over Realtime.
  const app = await driverRest(driver.username, driver.pin);
  const [me] = await app.get<{ id: string }[]>("employees?select=id");
  const session = randomUUID();
  expect(await app.post("duty_sessions", { id: session, employee_id: me.id, device_info: { model: "e2e" } })).toBe(201);
  const at = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
  // The only point so far is 4 minutes old: sharing, but nothing fresh.
  expect(await app.post("location_points", [{ employee_id: me.id, session_id: session, recorded_at: at(240), lat: 6.8649, lng: 79.8997, accuracy_m: 8, speed_mps: 10, battery_pct: 77 }])).toBe(201);
  await page.getByRole("link", { name: "Live locations" }).first().click();
  await expect(page.getByRole("heading", { name: "Live locations" })).toBeVisible();
  const row = page.locator(".lrow", { hasText: driver.name });
  await expect(row).toBeVisible();
  await row.click(); // another driver may be selected by default
  const detail = page.getByTestId("live-detail");
  await expect(detail).toContainText(driver.name);
  await expect(detail).toContainText("No signal since");
  await expect(page.getByTestId("rt-status")).toHaveText("Live updates");
  // The phone reports Location off: red within seconds, with since when, through Realtime.
  expect(await app.post("rpc/send_heartbeat", { p_at: new Date().toISOString(), p_sharing: true, p_location_on: false, p_permission: "always", p_battery_pct: 70, p_app_version: "e2e", p_queued_points: 2 })).toBeLessThan(300);
  await expect(detail).toContainText("Location off since", { timeout: 8000 });
  await expect(page.getByTestId("phone-line")).toContainText("Location off");
  await expect(page.getByTestId("phone-line")).toContainText("2 points waiting");
  await expect(page.getByRole("button", { name: /^Location off · \d+$/ })).toBeVisible();
  // A fresh point: live again at once, the marker moves, the speed shows.
  expect(await app.post("location_points", [{ employee_id: me.id, session_id: session, recorded_at: at(2), lat: 6.9, lng: 79.95, accuracy_m: 8, speed_mps: 20, battery_pct: 76 }])).toBe(201);
  await expect(detail).toContainText(/Live · \d+ min/, { timeout: 8000 });
  await expect(detail).toContainText("72 km/h");
  await expect(row).toContainText(/\d+ min/);
  // A third point a second later, about where the speed says: the move is confirmed, so the day has a line and km.
  expect(await app.post("location_points", [{ employee_id: me.id, session_id: session, recorded_at: at(1), lat: 6.9002, lng: 79.9502, accuracy_m: 8, speed_mps: 20, battery_pct: 76 }])).toBe(201);
  await page.getByRole("button", { name: "Today’s route" }).click();
  await expect(detail).toContainText(/Today: [\d.]+ km from 3 points/);

  // 4b. The driver page: status, the day's numbers, the timeline beside the map, playback; yesterday has nothing.
  await detail.getByRole("link", { name: "Driver page" }).click();
  const dp = page.getByTestId("driver-page");
  await expect(dp.getByRole("heading", { name: driver.name })).toBeVisible();
  await expect(dp).toContainText("Km (GPS)");
  await expect(dp).toContainText(/Live · \d+ min/);
  const timeline = page.getByTestId("timeline");
  await expect(timeline).toContainText("Driving", { timeout: 10000 });
  await expect(page.getByTestId("playback")).toBeVisible();
  await timeline.getByRole("button").first().click();
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.getByRole("button", { name: "Yesterday" }).click();
  await expect(dp).toContainText("No location was shared", { timeout: 10000 });
  await page.getByRole("button", { name: "Today" }).click();
  await expect(timeline).toContainText("Driving", { timeout: 10000 });
  await page.getByRole("link", { name: "Live locations" }).first().click();
  await expect(page.getByRole("heading", { name: "Live locations" })).toBeVisible();
  // Trails: every sharing driver's line today on the live map.
  await page.getByRole("button", { name: "Show today’s trails" }).click();
  await expect(page.getByRole("button", { name: "Show today’s trails" })).toHaveAttribute("aria-pressed", "true");

  // 5. The fleet pages (phase 4): vehicles, drivers, maintenance, mileage, projects, accounts.
  await page.getByRole("link", { name: "Vehicles" }).first().click();
  await expect(page.getByRole("heading", { name: "Vehicles" })).toBeVisible();
  const vrow = page.locator("tr", { hasText: plate });
  await expect(vrow).toBeVisible();
  await vrow.click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: plate })).toBeVisible();
  await page.getByLabel("Seats").fill("9");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Vehicle updated");
  await expect(page.locator("tr", { hasText: plate })).toContainText("9 seats");

  await page.getByRole("link", { name: "Drivers" }).first().click();
  await expect(page.getByRole("heading", { name: "Drivers" })).toBeVisible();
  const drow = page.locator("tr", { hasText: driver.name });
  await expect(drow).toBeVisible();
  await drow.getByRole("button", { name: "Manage" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: driver.name })).toBeVisible();
  await page.getByLabel("New 6-digit PIN").fill("111222");
  await page.getByRole("button", { name: "Set PIN" }).click();
  await expect(page.getByRole("dialog")).toContainText("New PIN 111222 is active");
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Maintenance" }).first().click();
  await expect(page.getByRole("heading", { name: "Maintenance" })).toBeVisible();
  await expect(page.getByText("Problems reported by drivers", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Mileage" }).first().click();
  await expect(page.getByRole("heading", { name: "Mileage" })).toBeVisible();
  await expect(page.locator(".tile .lbl", { hasText: "Task km" })).toBeVisible(); // the tile; the by-vehicle table has a column of the same name

  await page.getByRole("link", { name: "Projects" }).first().click();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await page.getByLabel("Find a project").fill(`zzz-${stamp}`);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No project matches", { exact: false })).toBeVisible();

  // Settings → Users: the admin's row shows every permission; a dispatcher is made from the preset, then given Approve.
  await page.getByRole("link", { name: "Settings" }).first().click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("link", { name: /^Users/ }).click();
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  const myRow = page.locator("tr", { hasText: email });
  await expect(myRow).toBeVisible();
  await expect(myRow).toContainText("Users");
  await page.getByRole("button", { name: "Add office user" }).click();
  const dispEmail = `e2e.disp.${stamp}@fame.test`;
  await page.getByLabel("Full name").fill("E2E Dispatcher");
  await page.getByLabel("E-mail").fill(dispEmail);
  await page.getByRole("button", { name: "Dispatcher" }).click();
  await expect(page.getByRole("checkbox", { name: /^Assign tasks/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^Approve/ })).not.toBeChecked();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("dialog")).toContainText("Account created");
  await page.keyboard.press("Escape");
  const dRow = page.locator("tr", { hasText: dispEmail });
  await expect(dRow).toContainText("Assign tasks");
  await dRow.getByRole("button", { name: "Manage" }).click();
  await page.getByRole("checkbox", { name: /^Approve/ }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("User updated");
  await page.keyboard.press("Escape");
  await expect(page.locator("tr", { hasText: dispEmail })).toContainText("Approve");

  // 6. Settings: turn on 2-step sign-in.
  await page.getByRole("link", { name: "Settings" }).first().click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Off", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Turn on 2-step sign-in" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim() ?? "";
  expect(secret.length).toBeGreaterThan(10);
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Turn on 2-step sign-in" }).click();
  await expect(page.getByText("On", { exact: true })).toBeVisible();

  // 7. Sign out; sign in again: password, then the code.
  await page.getByRole("link", { name: "More" }).first().click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  const users = await tool<{ users: { email: string; role: string }[] }>("list_office_users", {});
  expect(users.users.find((u) => u.email === email)?.role).toBe("admin");
});

test("a wrong password is refused", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("E-mail").fill("nobody@fame.test");
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Wrong e-mail or password.")).toBeVisible();
});

test("a requester-only user sees locked menu items, a No access page, and asks in their own name", async ({ page }) => {
  const email = `e2e.req.${stamp}@fame.test`;
  const user = await tool<{ set_password_link: string; created: { permissions: string[]; role: string } }>(
    "create_office_user", { name: "E2E Requester", email, permissions: ["request"] },
  );
  expect(user.created.permissions).toEqual(["request"]);
  expect(user.created.role).toBe("staff");
  const verify = await fetch(user.set_password_link, { redirect: "manual" });
  const landing = verify.headers.get("location") ?? "";
  await page.goto("/" + landing.slice(landing.indexOf("#")));
  const password = `Requester for ${stamp}!`;
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Again").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();

  // Home for a requester is their own requests; the fleet screens are in the menu but locked.
  await expect(page.getByRole("heading", { name: "My requests" })).toBeVisible();
  const overview = page.getByRole("link", { name: "Overview" }).first();
  await expect(overview).toHaveAttribute("aria-disabled", "true");
  await expect(overview).toHaveAttribute("title", "Ask an admin for access");
  await expect(page.getByRole("link", { name: "Requests" }).first()).not.toHaveAttribute("aria-disabled", "true");
  await page.goto("/vehicles");
  await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
  await expect(page.getByTestId("no-access")).toContainText("View");
  await page.goto("/settings/users");
  await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();

  // A new request has no "Who needs it" field: it is in their own name.
  await page.goto("/requests");
  await page.getByRole("button", { name: "New request" }).click();
  await expect(page.getByLabel("Who needs it")).toHaveCount(0);
  await page.getByLabel("Time", { exact: true }).fill("09:00");
  await page.getByLabel("To", { exact: true }).fill("Galle");
  await page.getByRole("button", { name: "Save request" }).click();
  await expect(page.getByRole("status")).toHaveText("Request saved");
  await expect(page.locator("tr", { hasText: "E2E Requester" })).toBeVisible();
});

test("a dispatcher (view + assign tasks) gets the tasks board, not mileage or the requests queue; a form dialog never closes on a click outside", async ({ page }) => {
  const email = `e2e.dispatch.${stamp}@fame.test`;
  const user = await tool<{ set_password_link: string }>("create_office_user", { name: "E2E Dispatcher", email, permissions: ["view", "request", "assign_tasks"] });
  const verify = await fetch(user.set_password_link, { redirect: "manual" });
  const landing = verify.headers.get("location") ?? "";
  await page.goto("/" + landing.slice(landing.indexOf("#")));
  const password = `Dispatcher for ${stamp}!`;
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Again").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();

  // Overview: the counts and the task attention card, no requests queue.
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Free now")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await expect(page.getByText("Requests to approve")).toHaveCount(0);
  await expect(page.getByText("Requests awaiting approval")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Tasks" }).first()).not.toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("link", { name: "Mileage" }).first()).toHaveAttribute("aria-disabled", "true");
  await page.goto("/mileage");
  await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: /^Users/ })).toHaveAttribute("aria-disabled", "true");
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Assign a task" })).toBeVisible();
  await page.goto("/requests");
  await expect(page.getByRole("heading", { name: "My requests" })).toBeVisible();

  // The dialog rules: a click outside does nothing; Esc asks; Keep editing keeps the text; Close then Discard closes.
  await page.getByRole("button", { name: "New request" }).click();
  await page.getByLabel("Who needs it").fill("Somebody");
  await page.locator(".drawer").click({ position: { x: 20, y: 300 } });
  await expect(page.getByLabel("Who needs it")).toHaveValue("Somebody");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("discard")).toContainText("Discard changes?");
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByTestId("discard")).toHaveCount(0);
  await expect(page.getByLabel("Who needs it")).toHaveValue("Somebody");
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a driver accepts one task and declines another; the office gives it to a free driver from the suggestions", async ({ page }) => {
  const email = `e2e.dispatch2.${stamp}@fame.test`;
  const user = await tool<{ set_password_link: string }>("create_office_user", { name: "E2E Dispatcher Two", email, permissions: ["view", "assign_tasks"] });
  const d1 = { name: `E2E Decliner ${stamp}`, code: `E2D-${stamp}`, username: `e2d.${stamp}`, pin: "135790" };
  const d2 = { name: `E2E Standby ${stamp}`, code: `E2S-${stamp}`, username: `e2s.${stamp}`, pin: "135791" };
  await tool("create_driver", d1);
  await tool("create_driver", d2);
  const plate = `WP E2D-${stamp.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Toyota HiAce", vehicle_type: "van", seats: 12, current_odometer_km: 1000 });
  const day = new Date(Date.now() + 5.5 * 3600000 + 86400000).toISOString().slice(0, 10); // tomorrow in Colombo
  const t1 = await tool<{ task_id: string }>("create_task", { title: `E2E accept ${stamp}`, date: day, start_time: "08:00", end_time: "09:00", driver: d1.username, vehicle: plate, pickup: "Head office", dropoff: "Nugegoda" });
  const t2 = await tool<{ task_id: string }>("create_task", { title: `E2E decline ${stamp}`, date: day, start_time: "10:00", end_time: "11:00", driver: d1.username, vehicle: plate, pickup: "Head office", dropoff: "Galle" });
  // The driver's app: Accept on one, "Can't do this task" on the other (the RPCs the app's queue sends).
  const app = await driverRest(d1.username, d1.pin);
  expect(await app.post("rpc/accept_task", { p_task_id: t1.task_id, p_at: new Date().toISOString() })).toBe(200);
  expect(await app.post("rpc/decline_task", { p_task_id: t2.task_id, p_reason: "vehicle_problem", p_note: "Flat tyre" })).toBe(200);

  const verify = await fetch(user.set_password_link, { redirect: "manual" });
  const landing = verify.headers.get("location") ?? "";
  await page.goto("/" + landing.slice(landing.indexOf("#")));
  const password = `Dispatcher two for ${stamp}!`;
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Again").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  // The board: Accepted HH:MM on one card; the other in "Needs a driver" with the reason.
  await page.goto(`/tasks?date=${day}`);
  const accepted = page.locator(".tcard", { hasText: `E2E accept ${stamp}` });
  await expect(accepted).toContainText(/Accepted \d\d:\d\d/);
  await expect(page.getByText("Needs a driver")).toBeVisible();
  const card = page.locator(".tcard", { hasText: `E2E decline ${stamp}` });
  await expect(card).toContainText("Declined (Vehicle problem) · Flat tyre");

  // The drawer: the reason, who is free, one click fills the driver, Reassign.
  await card.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Flat tyre/).first()).toBeVisible();
  await dialog.getByTestId("suggestions").getByRole("button", { name: d2.name }).click();
  await expect(dialog.getByLabel("Driver", { exact: true })).toHaveValue(d2.username);
  await dialog.getByRole("button", { name: "Reassign" }).click();
  await expect(page.getByRole("status")).toHaveText("Task changed");
  await expect(dialog.getByTestId("history")).toContainText("Declined");
  await expect(dialog.getByTestId("history")).toContainText("Reassigned");
  await expect(dialog.getByText(d2.name).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(card).toContainText("Sent · not opened yet");
  await expect(page.getByText("Needs a driver")).toHaveCount(0);

  // Drivers: accepts and declines in the last 30 days.
  await page.goto("/drivers");
  const row = page.locator("tr", { hasText: d1.name });
  await expect(row).toContainText("1 accepted");
  await expect(row).toContainText("1 declined");
});
