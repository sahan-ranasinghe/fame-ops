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

  // 3. Assign a task (its own page); it appears on the board; open it (the detail panel); cancel it from the edit page.
  await page.getByRole("link", { name: "Assign task" }).click();
  await expect(page).toHaveURL(/\/tasks\/new$/);
  await expect(page.getByRole("heading", { name: "Assign a task" })).toBeVisible();
  const title = `E2E drop ${stamp}`;
  await page.getByLabel("Task", { exact: true }).fill(title);
  await page.getByLabel("Leave by", { exact: true }).fill("09:30");
  // The stops are rows with their own type; the labels are numbered within the type.
  await page.getByLabel("Pickup 1", { exact: true }).fill("Head office");
  await page.getByLabel("Drop-off 1", { exact: true }).fill("Nugegoda");
  await page.getByLabel("Driver", { exact: true }).selectOption(driver.username);
  await page.getByLabel("Vehicle", { exact: true }).selectOption(plate);
  // The plan follows the form in one line (1.5 s after the last change): "Leave by 09:30 · … · estimated times".
  await expect(page.getByTestId("plan-line")).toContainText("Leave by 09:30", { timeout: 15000 });
  await expect(page.getByTestId("plan-line")).toContainText("estimated times");
  await page.getByRole("button", { name: "Assign & send" }).click();
  await expect(page.getByText(`Sent to ${driver.name}.`)).toBeVisible();
  await page.getByRole("link", { name: "The board" }).click();
  const card = page.locator(".tcard", { hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Leave by 09:30");
  await card.click();
  const detail = page.getByTestId("detail");
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+(\?date=.*)?$/);
  await expect(detail.getByRole("heading", { name: title })).toBeVisible();
  await expect(detail.getByText("Fame internal")).toBeVisible();
  await expect(detail.getByTestId("plan-panel")).toContainText("estimate");
  await detail.getByRole("link", { name: "Cancel task" }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+\/edit/);
  await page.getByLabel("Cancel this task").fill("E2E test over");
  await page.getByRole("button", { name: "Cancel task" }).click();
  await expect(page.getByRole("status")).toHaveText("Task cancelled");
  await expect(page).toHaveURL(/\/tasks$/);
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
  const live = page.getByTestId("live-detail");
  await expect(live).toContainText(driver.name);
  await expect(live).toContainText("No signal since");
  await expect(page.getByTestId("rt-status")).toHaveText("Live updates");
  // The phone reports Location off: red within seconds, with since when, through Realtime.
  expect(await app.post("rpc/send_heartbeat", { p_at: new Date().toISOString(), p_sharing: true, p_location_on: false, p_permission: "always", p_battery_pct: 70, p_app_version: "e2e", p_queued_points: 2 })).toBeLessThan(300);
  await expect(live).toContainText("Location off since", { timeout: 8000 });
  await expect(page.getByTestId("phone-line")).toContainText("Location off");
  await expect(page.getByTestId("phone-line")).toContainText("2 points waiting");
  await expect(page.getByRole("button", { name: /^Location off · \d+$/ })).toBeVisible();
  // A fresh point: live again at once, the marker moves, the speed shows.
  expect(await app.post("location_points", [{ employee_id: me.id, session_id: session, recorded_at: at(2), lat: 6.9, lng: 79.95, accuracy_m: 8, speed_mps: 20, battery_pct: 76 }])).toBe(201);
  await expect(live).toContainText(/Live · \d+ min/, { timeout: 8000 });
  await expect(live).toContainText("72 km/h");
  await expect(row).toContainText(/\d+ min/);
  // A third point a second later, about where the speed says: the move is confirmed, so the day has a line and km.
  expect(await app.post("location_points", [{ employee_id: me.id, session_id: session, recorded_at: at(1), lat: 6.9002, lng: 79.9502, accuracy_m: 8, speed_mps: 20, battery_pct: 76 }])).toBe(201);
  await page.getByRole("button", { name: "Today’s route" }).click();
  await expect(live).toContainText(/Today: [\d.]+ km from 3 points/);

  // 4b. The driver page: status, the day's numbers, the timeline beside the map, playback; yesterday has nothing.
  await live.getByRole("link", { name: "Driver page" }).click();
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
  // The vehicle's detail beside the list, then its own edit page.
  await expect(page.getByTestId("vehicle-detail")).toContainText(plate);
  await page.getByTestId("vehicle-detail").getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(/\/vehicles\/.+\/edit$/);
  await page.getByLabel("Seats").fill("9");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Vehicle updated");
  await expect(page.getByTestId("vehicle-detail")).toContainText("9 seats");
  await expect(page.locator("tr", { hasText: plate })).toContainText("9 seats");

  await page.getByRole("link", { name: "Drivers" }).first().click();
  await expect(page.getByRole("heading", { name: "Drivers" })).toBeVisible();
  const drow = page.locator("tr", { hasText: driver.name });
  await expect(drow).toBeVisible();
  await drow.getByRole("link", { name: "Manage" }).click();
  await expect(page).toHaveURL(/\/drivers\/.+\/edit$/);
  await expect(page.getByRole("heading", { name: driver.name })).toBeVisible();
  await page.getByLabel("New 6-digit PIN").fill("111222");
  await page.getByRole("button", { name: "Set PIN" }).click();
  await expect(page.getByTestId("driver-manage")).toContainText("New PIN 111222 is active");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/drivers$/);

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
  await page.getByRole("link", { name: "Add office user" }).click();
  await expect(page).toHaveURL(/\/settings\/users\/new$/);
  const dispEmail = `e2e.disp.${stamp}@fame.test`;
  await page.getByLabel("Full name").fill("E2E Dispatcher");
  await page.getByLabel("E-mail").fill(dispEmail);
  await page.getByRole("button", { name: "Dispatcher" }).click();
  await expect(page.getByRole("checkbox", { name: /^Assign tasks/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^Approve/ })).not.toBeChecked();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("user-created")).toContainText("Account created");
  await page.getByRole("link", { name: "Done" }).click();
  const dRow = page.locator("tr", { hasText: dispEmail });
  await expect(dRow).toContainText("Assign tasks");
  await dRow.getByRole("link", { name: "Manage" }).click();
  await expect(page).toHaveURL(/\/settings\/users\/.+\/edit$/);
  await page.getByRole("checkbox", { name: /^Approve/ }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("User updated");
  await page.getByRole("button", { name: "Back" }).click();
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

  // 6b. Settings → Notifications: this browser's state in words, the events of an admin, one switched off and kept.
  await page.goto("/settings");
  await page.getByRole("link", { name: "Notifications" }).click();
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  await expect(page.getByTestId("notifications")).toContainText(/in this browser|not switched on for the office/);
  const requestBox = page.getByRole("checkbox", { name: "A vehicle request comes in" });
  await expect(requestBox).toBeChecked();
  await expect(page.getByRole("checkbox")).toHaveCount(11);
  await requestBox.uncheck();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "A vehicle request comes in" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "A critical issue opens" })).toBeChecked();

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

test("a requester-only user sees only their own screens in the menu, a No access page on a direct URL, and asks in their own name", async ({ page }) => {
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

  // Home for a requester is their own requests; the fleet screens are not in the menu at all.
  await expect(page.getByRole("heading", { name: "My requests" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Overview" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Live locations" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Requests" }).first()).toBeVisible();
  await page.goto("/vehicles");
  await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
  await expect(page.getByTestId("no-access")).toContainText("View");
  await page.goto("/settings/users");
  await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
  // Their notifications: the one event a requester can get.
  await page.goto("/settings/notifications");
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  // Their decided and redecided request events, plus the three booking events everyone can get.
  await expect(page.getByRole("checkbox")).toHaveCount(5);
  await expect(page.getByRole("checkbox", { name: "Your request is decided" })).toBeChecked();

  // A new request (its own page) is in their own name; "On behalf of" is for someone else.
  await page.goto("/requests");
  await page.getByRole("link", { name: "New request" }).first().click();
  await expect(page).toHaveURL(/\/requests\/new$/);
  await expect(page.getByLabel("Who needs it")).toHaveCount(0);
  await expect(page.getByLabel("On behalf of")).toBeVisible();
  await page.getByLabel("Time", { exact: true }).fill("09:00");
  await page.getByLabel("To", { exact: true }).fill("Galle");
  await page.getByRole("button", { name: "Save request" }).click();
  await expect(page.getByRole("status")).toHaveText("Sent to the fleet admin · you'll be notified.");
  await expect(page.locator("tr", { hasText: "E2E Requester" })).toBeVisible();
  await expect(page.locator("tr", { hasText: "E2E Requester" })).toContainText("sent ");
});

test("a dispatcher (view + assign tasks) gets the tasks board, not mileage or the requests queue; a form keeps a draft when the page is left", async ({ page }) => {
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
  await expect(page.getByRole("link", { name: "Tasks" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Mileage" })).toHaveCount(0);
  await page.goto("/mileage");
  await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: /^Users/ })).toHaveCount(0);
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Assign a task" })).toBeVisible();
  await page.goto("/requests");
  await expect(page.getByRole("heading", { name: "My requests" })).toBeVisible();

  // Drafts: what was typed survives leaving the page; coming back offers Resume or Discard.
  await page.getByRole("link", { name: "New request" }).first().click();
  await expect(page).toHaveURL(/\/requests\/new$/);
  await page.getByLabel("On behalf of").fill("Somebody");
  await page.getByLabel("Note").fill("Draft note");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "My requests" })).toBeVisible();
  await page.getByRole("link", { name: "New request" }).first().click();
  await expect(page.getByTestId("draft-banner")).toContainText("Resume draft from");
  await expect(page.getByLabel("On behalf of")).toHaveValue("");
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByLabel("On behalf of")).toHaveValue("Somebody");
  await expect(page.getByLabel("Note")).toHaveValue("Draft note");
  await expect(page.getByTestId("draft-banner")).toHaveCount(0);
  // Leave again, come back, discard: the form starts empty and the draft is gone.
  await page.getByRole("link", { name: "Overview" }).first().click();
  await page.goto("/requests/new");
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByLabel("On behalf of")).toHaveValue("");
  await page.reload();
  await expect(page.getByTestId("draft-banner")).toHaveCount(0);
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

  // The detail: the reason; the edit page: who is free, one click fills the driver, Reassign; back to the detail with the history.
  await card.click();
  const detail = page.getByTestId("detail");
  await expect(detail.getByText(/Flat tyre/).first()).toBeVisible();
  await detail.getByRole("link", { name: "Give it to a driver" }).first().click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+\/edit(\?date=.*)?$/);
  await page.getByTestId("suggestions").getByRole("button", { name: d2.name }).click();
  await expect(page.getByLabel("Driver", { exact: true })).toHaveValue(d2.username);
  await page.getByRole("button", { name: "Reassign" }).click();
  await expect(page.getByRole("status")).toHaveText("Task sent to the driver");
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+(\?date=.*)?$/);
  await expect(detail.getByTestId("history")).toContainText("Declined");
  await expect(detail.getByTestId("history")).toContainText("Reassigned");
  await expect(detail.getByText(d2.name).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(page).toHaveURL(/\/tasks/);
  await expect(card).toContainText("Sent · not opened yet");
  // This task left the "Needs a driver" column (another run's declined task may still sit there).
  await expect(page.locator(".col", { hasText: "Needs a driver" }).locator(".tcard", { hasText: `E2E decline ${stamp}` })).toHaveCount(0);

  // Drivers: accepts and declines in the last 30 days.
  await page.goto("/drivers");
  const row = page.locator("tr", { hasText: d1.name });
  await expect(row).toContainText("1 accepted");
  await expect(row).toContainText("1 declined");
});

test("a vehicle problem becomes an issue: the bell, the issue page, Take, a note, Resolve closes the driver's report", async ({ page }) => {
  const email = `e2e.issues.${stamp}@fame.test`;
  const user = await tool<{ set_password_link: string }>("create_office_user", { name: "E2E Fleet Admin", email, permissions: ["view", "issues", "vehicles"] });
  const driver = { name: `E2E Reporter ${stamp}`, code: `E2R-${stamp}`, username: `e2r.${stamp}`, pin: "975310" };
  await tool("create_driver", driver);
  const plate = `WP E2R-${stamp.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Toyota Axio", vehicle_type: "car", seats: 4, current_odometer_km: 500 });
  // The driver reports a breakdown from the app; the sync (fleet-jobs, as pg_cron and the trigger call it) opens the issue.
  const app = await driverRest(driver.username, driver.pin);
  const [me] = await app.get<{ id: string }[]>("employees?select=id");
  const [vehicle] = await app.get<{ id: string }[]>(`vehicles?select=id&reg_no=eq.${encodeURIComponent(plate)}`);
  const reportId = randomUUID();
  expect(await app.post("vehicle_reports", { id: reportId, vehicle_id: vehicle.id, employee_id: me.id, category: "breakdown", note: "Engine stalls at idle" })).toBe(201);
  const sync = await fetch(`${API}/functions/v1/fleet-jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-server-key": process.env.SERVER_KEY ?? "" },
    body: JSON.stringify({ job: "sync", report_id: reportId }),
  });
  expect(sync.status).toBe(200);

  const verify = await fetch(user.set_password_link, { redirect: "manual" });
  const landing = verify.headers.get("location") ?? "";
  await page.goto("/" + landing.slice(landing.indexOf("#")));
  const password = `Fleet admin for ${stamp}!`;
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Again").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  // The bell counts it; the dropdown names it; the issue page shows the report.
  await expect(page.getByTestId("bell-count").first()).toBeVisible();
  const before = Number(await page.getByTestId("bell-count").first().textContent());
  expect(before).toBeGreaterThan(0);
  await page.getByRole("button", { name: /^Issues: \d+ open$/ }).first().click();
  await page.getByTestId("bell-menu").getByRole("menuitem", { name: /Vehicle problem: breakdown/ }).first().click();
  await expect(page.getByTestId("issue-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vehicle problem: breakdown" })).toBeVisible();
  await expect(page.getByTestId("issue-report")).toContainText("Engine stalls at idle");
  await expect(page.getByTestId("issue-history")).toContainText("Opened by system");

  // Take, a note, resolve: the driver's report is closed with the note.
  await page.getByRole("button", { name: "Take" }).click();
  await expect(page.getByRole("status")).toHaveText("Taken");
  await expect(page.getByTestId("issue-history")).toContainText("assigned it to E2E Fleet Admin");
  await page.getByLabel(/^Note/).fill("Towed to the garage");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByRole("status")).toHaveText("Note added");
  await page.getByLabel(/^Note/).fill("Fuel pump replaced");
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByRole("status")).toHaveText("Issue resolved");
  await expect(page.getByText(/Resolved by E2E Fleet Admin/)).toBeVisible();
  await expect(page.getByTestId("issue-report")).toContainText("closed");
  const reports = await tool<{ reports: { id: string; status: string; office_note?: string }[] }>("list_vehicle_reports", { status: "closed" });
  const closed = reports.reports.find((r) => r.id === reportId);
  expect(closed?.status).toBe("closed");
  expect(closed?.office_note).toBe("Fuel pump replaced");

  // The Issues page: the resolved tab has it; the open tab no longer.
  await page.goto("/issues?tab=resolved");
  await expect(page.getByTestId("issues-list")).toContainText("Vehicle problem: breakdown");
  await page.goto("/issues");
  await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();
  await expect(page.getByTestId("issues-list").getByText(`${plate}`)).toHaveCount(0);
});

test("an approver books a vehicle in one step from the Free group; the task is on the board with Leave by; the booking is cancelled", async ({ page }) => {
  const email = `e2e.book.${stamp}@fame.test`;
  const user = await tool<{ set_password_link: string }>("create_office_user", { name: "E2E Booker", email, permissions: ["view", "request", "approve", "assign_tasks", "users"] });
  const driver = { name: `E2E Pool Driver ${stamp}`, code: `E2B-${stamp}`, username: `e2b.${stamp}`, pin: "246810" };
  await tool("create_driver", driver);
  const plate = `WP E2B-${stamp.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Suzuki Every", vehicle_type: "van", seats: 7, current_odometer_km: 100 });
  // Three days ahead (Colombo), so nothing else of the suite shares the day.
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date(Date.now() + 3 * 864e5));

  const verify = await fetch(user.set_password_link, { redirect: "manual" });
  const landing = verify.headers.get("location") ?? "";
  await page.goto("/" + landing.slice(landing.indexOf("#")));
  const password = `Booker for ${stamp}!`;
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Again").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  // New request → Assign now: the Free group lists the pool van; pick it and a free driver; Book now.
  await page.goto("/requests/new");
  await page.getByLabel("On behalf of").fill("Someone from HR");
  await page.getByLabel("Day").fill(day);
  await page.getByLabel("Time", { exact: true }).fill("09:30");
  await page.getByLabel("To", { exact: true }).fill("Galle");
  await expect(page.getByTestId("group-free_pool")).toContainText(plate);
  await page.getByTestId("group-free_pool").locator(".opt", { hasText: plate }).getByRole("radio").check();
  await page.getByTestId("assign-now").getByLabel("Driver", { exact: true }).selectOption({ label: driver.name });
  await page.getByRole("button", { name: "Book now" }).click();
  await expect(page.getByTestId("booked")).toContainText("Someone from HR has");
  await expect(page.getByTestId("booked")).toContainText(plate);
  await page.getByRole("link", { name: "Done" }).click();

  // The task is on that day's board with its leave-by time.
  await page.goto(`/tasks?date=${day}`);
  await expect(page.locator(".tcard", { hasText: "Trip · Galle" }).first()).toContainText("Leave by");

  // The request is approved, booked directly; its timeline says so; Cancel booking with a reason.
  await page.goto("/requests");
  await page.getByRole("button", { name: "Approved", exact: true }).click();
  await page.locator("tr", { hasText: "Someone from HR" }).first().click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]+$/);
  await expect(page.getByTestId("request-timeline")).toContainText("Approved");
  await page.getByLabel("Cancel this booking with a reason").fill("Trip called off");
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await expect(page.getByRole("status")).toHaveText("Booking cancelled");
  const cancelled = await tool<{ requests: { requested_by: string; on_behalf_of?: string; status: string; cancel_reason?: string; task_id?: string }[] }>("list_requests", { status: "cancelled" });
  const mine = cancelled.requests.find((r) => r.on_behalf_of === "Someone from HR" && r.requested_by === "E2E Booker");
  expect(mine?.cancel_reason).toBe("Trip called off");
  const board = await tool<{ counts: { cancelled: number } }>("task_board", { date: day });
  expect(board.counts.cancelled).toBeGreaterThan(0);

  // The self-drive switch (Settings → Fleet): off hides "A driver is needed" on the request form; then back on.
  // The local database is not reset between runs: start from on, whatever the last run left.
  await tool("update_settings", { key: "self_drive_allowed", value: true });
  await page.goto("/settings/fleet");
  const selfDrive = page.getByRole("checkbox", { name: /Self-drive bookings allowed/ });
  await expect(selfDrive).toBeChecked();
  await selfDrive.uncheck();
  await expect(page.getByRole("status")).toHaveText("Setting saved");
  await page.goto("/requests/new");
  await expect(page.getByLabel("On behalf of")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "A driver is needed" })).toHaveCount(0);
  // Back on through the tool (the same save as the untick above; the local runtime sometimes drops a second call).
  await tool("update_settings", { key: "self_drive_allowed", value: true });
  await page.goto("/settings/fleet");
  await expect(page.getByRole("checkbox", { name: /Self-drive bookings allowed/ })).toBeChecked();
});

test("a requester changes an approved booking; the approver sees who is available and keeps it; a task is changed with its history", async ({ page }) => {
  const approverEmail = `e2e.p6a.${stamp}@fame.test`;
  const requesterEmail = `e2e.p6r.${stamp}@fame.test`;
  const requester = await tool<{ set_password_link: string }>("create_office_user", { name: "E2E P6 Requester", email: requesterEmail, permissions: ["request"] });
  const driver = { name: `E2E P6 Driver ${stamp}`, code: `E2P-${stamp}`, username: `e2p.${stamp}`, pin: "864209" };
  await tool("create_driver", driver);
  const plate = `WP E2P-${stamp.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Toyota HiAce", vehicle_type: "van", seats: 9, current_odometer_km: 300 });
  // Four days ahead (Colombo), so nothing else of the suite shares the day.
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date(Date.now() + 4 * 864e5));
  const landingOf = async (link: string) => {
    const verify = await fetch(link, { redirect: "manual" });
    const landing = verify.headers.get("location") ?? "";
    return "/" + landing.slice(landing.indexOf("#"));
  };
  const setPassword = async (link: string, password: string) => {
    await page.goto(await landingOf(link));
    await page.getByLabel("New password").fill(password);
    await page.getByLabel("Again").fill(password);
    await page.getByRole("button", { name: "Save password" }).click();
  };
  const signOut = async () => {
    await page.goto("/more");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  };
  const visitor = `A visitor ${stamp}`;
  const requesterPassword = `P6 requester ${stamp}!`;
  const approverPassword = `P6 approver ${stamp}!`;

  // 1. The requester asks, on behalf of a visitor.
  await setPassword(requester.set_password_link, requesterPassword);
  await expect(page.getByRole("heading", { name: "My requests" })).toBeVisible();
  await page.goto("/requests/new");
  await page.getByLabel("On behalf of").fill(visitor);
  await page.getByLabel("Day").fill(day);
  await page.getByLabel("Time", { exact: true }).fill("09:00");
  await page.getByLabel("Back by").fill("12:00");
  await page.getByLabel("To", { exact: true }).fill("Galle");
  await page.getByRole("button", { name: "Save request" }).click();
  await expect(page.getByRole("status")).toHaveText("Sent to the fleet admin · you'll be notified.");
  const row = page.locator("tr", { hasText: visitor });
  await expect(row).toBeVisible();
  const list = await tool<{ requests: { id: string; on_behalf_of?: string; version: number }[] }>("list_requests", { status: "waiting" });
  const req = list.requests.find((r) => r.on_behalf_of === visitor)!;
  expect(req.version).toBe(0);

  // The office approves it (through the connector, as Claude would).
  const approved = await tool<{ task_id: string }>("decide_request", { request_id: req.id, decision: "approve", vehicle: plate, driver: driver.username, decided_by: "E2E P6 Approver" });

  // 2. The requester changes the approved booking: it needs re-approval.
  await page.goto(`/requests/${req.id}`);
  await expect(page.getByTestId("request-timeline")).toContainText("Approved");
  await page.getByRole("link", { name: "Edit request" }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/${req.id}/edit$`));
  await expect(page.getByText("your change needs re-approval")).toBeVisible();
  await page.getByLabel("Time", { exact: true }).fill("09:30");
  await page.getByLabel("To", { exact: true }).fill("Matara");
  await page.getByRole("button", { name: "Save · ask for re-approval" }).click();
  await expect(page.getByRole("status")).toHaveText("Changed · the office will decide again");
  await expect(page).toHaveURL(new RegExp(`/requests/${req.id}$`));
  await expect(page.getByTestId("changed-notice")).toContainText("needs re-approval");
  await expect(page.getByTestId("changes")).toContainText("to Galle → Matara");
  await expect(page.getByTestId("changes")).toContainText("09:30");
  await expect(page.getByTestId("request-timeline")).toContainText("Changed · needs re-approval");
  await signOut();

  // 3. The approver: the changed booking is in the queue; the decide page shows what changed and who is available; Keep as asked.
  // (Their set-password link is made now: a link is one use, and it is used right away.)
  const approver = await tool<{ set_password_link: string }>("create_office_user", { name: "E2E P6 Approver", email: approverEmail, permissions: ["view", "request", "approve", "assign_tasks"] });
  await setPassword(approver.set_password_link, approverPassword);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.goto("/requests");
  await expect(page.locator("tr", { hasText: visitor })).toContainText("Changed");
  await page.getByRole("button", { name: "Changed", exact: true }).click();
  await page.locator("tr", { hasText: visitor }).getByRole("link", { name: "Review" }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/${req.id}/decide$`));
  await expect(page.getByRole("heading", { name: "Decide the change" })).toBeVisible();
  await expect(page.getByTestId("changes")).toContainText("to Galle → Matara");
  await expect(page.getByTestId("availability")).toContainText(driver.name, { timeout: 15000 });
  await expect(page.getByTestId("availability").locator(".avail-row", { hasText: driver.name })).toContainText(/Busy|Free/);
  await page.getByRole("button", { name: "Keep as asked" }).click();
  await expect(page.getByText("Kept as asked.")).toBeVisible();
  const after = await tool<{ task: { start: string; plan_version: number }; stops: { place: string }[]; assignment_history: { action: string; changes?: Record<string, { to?: string }> }[] }>("task_detail", { task_id: approved.task_id });
  expect(after.task.start.endsWith("09:30")).toBe(true);
  expect(after.stops[after.stops.length - 1].place).toBe("Matara");
  expect(after.assignment_history[after.assignment_history.length - 1].action).toBe("changed");

  // 4. The task's edit page: who is available beside the picks; a note and a later end time; the history shows the diff.
  await page.goto(`/tasks/${approved.task_id}/edit`);
  await expect(page.getByRole("heading", { name: "Change the task" })).toBeVisible();
  await expect(page.getByTestId("availability")).toContainText(driver.name, { timeout: 15000 });
  await page.getByLabel("Vehicle free again by").fill("13:00");
  await page.getByLabel("Notes for the driver").fill("Bring the ladder");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Task changed");
  await expect(page).toHaveURL(new RegExp(`/tasks/${approved.task_id}$`));
  const history = page.getByTestId("history");
  await expect(history).toContainText("Changed");
  await expect(history).toContainText("end by 12:00 → 13:00");
  await expect(history).toContainText("notes — → Bring the ladder");
  // Stale version: a second tab's old plan_version is refused by the server.
  await expect(tool("update_task", { task_id: approved.task_id, plan_version: 0, notes: "late" })).rejects.toThrow(/changed since you loaded it/);
});
