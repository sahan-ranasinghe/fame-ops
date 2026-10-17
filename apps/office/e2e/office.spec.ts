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
    async patch(path: string, body: unknown): Promise<number> {
      const r = await fetch(`${API}/rest/v1/${path}`, { method: "PATCH", headers, body: JSON.stringify(body) });
      return r.status;
    },
    /** The resumable upload the app uses for fuel videos (TUS): one chunk, as the phone would for a small file. */
    async tusUpload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<number> {
      const b64 = (t: string) => Buffer.from(t).toString("base64");
      const create = await fetch(`${API}/storage/v1/upload/resumable`, {
        method: "POST",
        headers: {
          apikey: ANON, authorization: `Bearer ${session.access_token}`, "tus-resumable": "1.0.0", "upload-length": String(bytes.length), "x-upsert": "false",
          "upload-metadata": `bucketName ${b64(bucket)},objectName ${b64(path)},contentType ${b64(contentType)},cacheControl ${b64("3600")}`,
        },
      });
      if (create.status !== 201) return create.status;
      const location = (create.headers.get("location") ?? "").replace("http://kong:8000", API);
      const patch = await fetch(location, {
        method: "PATCH",
        headers: { apikey: ANON, authorization: `Bearer ${session.access_token}`, "tus-resumable": "1.0.0", "upload-offset": "0", "content-type": "application/offset+octet-stream" },
        body: bytes as unknown as BodyInit,
      });
      return patch.status;
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
  await page.getByLabel("Stop 1", { exact: true }).fill("Head office");
  await page.getByLabel("Stop 2", { exact: true }).fill("Nugegoda");
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
  await expect(detail.getByTestId("plan-timeline")).toContainText("estimate");
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
  await expect(page.getByRole("button", { name: /^Problems · \d+$/ })).toBeVisible();
  // A fresh point: live again at once, the marker moves, the speed shows.
  expect(await app.post("location_points", [{ employee_id: me.id, session_id: session, recorded_at: at(2), lat: 6.9, lng: 79.95, accuracy_m: 8, speed_mps: 20, battery_pct: 76 }])).toBe(201);
  await expect(live).toContainText(/Live · \d+ min/, { timeout: 8000 });
  await expect(live).toContainText("72 km/h");
  // The position time with seconds, from the Realtime row: on the card and under the marker.
  await expect(live.getByTestId("live-position")).toHaveText(/^\d\d:\d\d:\d\d$/);
  await expect(page.getByText(/^position \d\d:\d\d:\d\d$/).first()).toBeVisible();
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
  // Phase 7 (§25): the trails are a button of the map's control cluster.
  await page.getByRole("button", { name: "Today’s trails" }).click();
  await expect(page.getByRole("button", { name: "Today’s trails" })).toHaveAttribute("aria-pressed", "true");

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
  // Phase 7: "A driver skips a stop", "A driver needs another vehicle"; Part 3: not decided, leave-by passed, and the
  // trip's four moments for the asker.
  await expect(page.getByRole("checkbox")).toHaveCount(19);
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

test("a driver's day in the office (Phase 7): on duty on Live, moved to another vehicle, clocked out on the card, the duty log with its dates", async ({ page }) => {
  const email = `e2e.duty.${stamp}@fame.test`;
  const user = await tool<{ set_password_link: string }>("create_office_user", { name: "E2E Duty Desk", email, permissions: ["view", "assign_tasks"] });
  const driver = { name: `E2E Dutyman ${stamp}`, code: `E2U-${stamp}`, username: `e2u.${stamp}`, pin: "246813" };
  await tool("create_driver", driver);
  const plateA = `WP E2U-${stamp.slice(-4).toUpperCase()}`;
  const plateB = `WP E2V-${stamp.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plateA, make_model: "Toyota HiAce", vehicle_type: "van", seats: 12 });
  await tool("register_vehicle", { reg_no: plateB, make_model: "Toyota Axio", vehicle_type: "car", seats: 4 });
  // The phone: Start work with today's vehicle (a duty session carrying it).
  const app = await driverRest(driver.username, driver.pin);
  const [me] = await app.get<{ id: string }[]>("employees?select=id");
  const vehicles = await app.get<{ id: string; reg_no: string }[]>(`vehicles?select=id,reg_no&reg_no=eq.${encodeURIComponent(plateA)}`);
  expect(await app.post("duty_sessions", { id: randomUUID(), employee_id: me.id, vehicle_id: vehicles[0].id, device_info: { brand: "OPPO", model: "CPH2119" } })).toBe(201);

  const verify = await fetch(user.set_password_link, { redirect: "manual" });
  const landing = verify.headers.get("location") ?? "";
  await page.goto("/" + landing.slice(landing.indexOf("#")));
  const password = `Duty desk for ${stamp}!`;
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Again").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  // Live: every driver with a duty; this one on duty with the van, the phone named.
  await page.goto("/live");
  const row = page.locator(".lrow", { hasText: driver.name });
  await expect(row).toBeVisible();
  await row.click();
  const live = page.getByTestId("live-detail");
  await expect(live.getByTestId("duty-chip")).toContainText("On duty");
  await expect(live).toContainText(plateA);
  await expect(live).toContainText("OPPO CPH2119");
  await expect(page.getByRole("button", { name: /^Off duty · \d+$/ })).toBeVisible();

  // Move to vehicle: a full page, the car picked, Move.
  await live.getByRole("link", { name: "Move to vehicle" }).click();
  await expect(page).toHaveURL(new RegExp(`/drivers/${driver.username.replace(".", "\\.")}/vehicle$`));
  await expect(page.getByRole("heading", { name: `Move ${driver.name} to a vehicle` })).toBeVisible();
  await page.getByTestId("move-vehicle").locator("label", { hasText: plateB }).click();
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(`is now on ${plateB}`);
  await expect(page).toHaveURL(/\/live/);

  // Clock out: a second step on the card, then Off duty by the office.
  await page.locator(".lrow", { hasText: driver.name }).click();
  await expect(live).toContainText(plateB);
  await live.getByRole("button", { name: "Clock out" }).click();
  await expect(live.getByTestId("clock-out-confirm")).toContainText("Clock out E2E?");
  await live.getByTestId("clock-out-confirm").getByRole("button", { name: "Clock out" }).click();
  await expect(live.getByTestId("duty-chip")).toContainText("Off duty", { timeout: 15000 });
  await expect(live.getByTestId("duty-chip")).toContainText("by the office");

  // The duty log: the period with both vehicles and how it ended; Yesterday and back to Today through the URL.
  await page.goto("/drivers");
  await page.getByRole("link", { name: "Duty log" }).first().click();
  await expect(page).toHaveURL(/\/drivers\/duty/);
  const period = page.getByTestId("duty-row").filter({ hasText: driver.name });
  await expect(period).toContainText(plateA);
  await expect(period).toContainText(plateB);
  await expect(period).toContainText("office");
  await page.getByTestId("date-range").getByRole("button", { name: "Yesterday" }).click();
  await expect(page).toHaveURL(/range=yesterday/);
  await expect(page.getByTestId("duty-row").filter({ hasText: driver.name })).toHaveCount(0);
  await page.getByTestId("date-range").getByRole("button", { name: "Today" }).click();
  await expect(page.getByTestId("duty-row").filter({ hasText: driver.name })).toBeVisible();
});

test("a wrong password is refused", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("E-mail").fill("nobody@fame.test");
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Wrong e-mail or password.")).toBeVisible();
});

test("a requester (request brings view, Phase 7 §12) sees what a viewer sees plus their own requests, a No access page on a direct URL, and asks in their own name", async ({ page }) => {
  const email = `e2e.req.${stamp}@fame.test`;
  const user = await tool<{ set_password_link: string; created: { permissions: string[]; role: string } }>(
    "create_office_user", { name: "E2E Requester", email, permissions: ["request"] },
  );
  expect(user.created.permissions).toEqual(["view", "request"]);
  expect(user.created.role).toBe("staff");
  const verify = await fetch(user.set_password_link, { redirect: "manual" });
  const landing = verify.headers.get("location") ?? "";
  await page.goto("/" + landing.slice(landing.indexOf("#")));
  const password = `Requester for ${stamp}!`;
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Again").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();

  // Request brings view: the viewer's screens (Overview, Live, Vehicles) and their own requests; nothing more.
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Live locations" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Requests" }).first()).toBeVisible();
  await page.goto("/vehicles");
  await expect(page.getByRole("heading", { name: "Vehicles" })).toBeVisible();
  await page.goto("/maintenance");
  await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
  await page.goto("/settings/users");
  await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
  await page.goto("/requests");
  await expect(page.getByRole("heading", { name: "My requests" })).toBeVisible();
  // Their notifications: their decided and redecided request events, a task of theirs that needs a driver (declined, not
  // accepted), the three booking events everyone can get, and (Phase 7, §4, §33) not decided 30 minutes before leaving and
  // the trip's four moments (on the way, arrived, driver changed, cancelled).
  await page.goto("/settings/notifications");
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(12);
  await expect(page.getByRole("checkbox", { name: "Your driver is on the way" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Your request is decided" })).toBeChecked();

  // A new request (its own page) is in their own name; "On behalf of" is for someone else.
  await page.goto("/requests");
  await page.getByRole("link", { name: "New request" }).first().click();
  await expect(page).toHaveURL(/\/requests\/new$/);
  await expect(page.getByLabel("Who needs it")).toHaveCount(0);
  await expect(page.getByLabel("On behalf of")).toBeVisible();
  // Phase 7 (§34): the request is the trip editor (Leave by, the stops).
  await page.getByLabel("Leave by", { exact: true }).fill("09:00");
  await page.getByLabel("Stop 1", { exact: true }).fill("Head office");
  await page.getByLabel("Stop 2", { exact: true }).fill("Galle");
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
  await expect(page.locator(".col", { hasText: "Needs a driver" }).first()).toBeVisible();
  // Phase 7 (§19): the red banner on every Tasks page.
  await expect(page.getByTestId("needs-driver-banner")).toContainText(/need(s)? a driver/);
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
  await expect(page.getByRole("status")).toHaveText(`Task sent to ${d2.name}`);
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

test("a task that needs a driver can't be missed; the decide page fills the vehicle from the driver (Phase 7, Part 2)", async ({ page }) => {
  test.setTimeout(240_000);
  const email = `e2e.needs.${stamp}@fame.test`;
  const user = await tool<{ set_password_link: string }>("create_office_user", { name: "E2E Needs Driver", email, permissions: ["view", "request", "approve", "assign_tasks"] });
  const d1 = { name: `E2E Nope ${stamp}`, code: `E2N-${stamp}`, username: `e2n.${stamp}`, pin: "246801" };
  const d2 = { name: `E2E Ready ${stamp}`, code: `E2Y-${stamp}`, username: `e2y.${stamp}`, pin: "246802" };
  await tool("create_driver", d1);
  await tool("create_driver", d2);
  const plate = `WP E2N-${stamp.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Toyota HiAce", vehicle_type: "van", seats: 12, current_odometer_km: 1000 });
  await tool("update_vehicle", { reg_no: plate, regular_driver: d2.username });
  const day = new Date(Date.now() + 5.5 * 3600000 + 86400000).toISOString().slice(0, 10); // tomorrow in Colombo
  const title = `E2E needs ${stamp}`;
  const t = await tool<{ task_id: string }>("create_task", { title, date: day, start_time: "08:00", driver: d1.username, vehicle: plate, pickup: "Head office", dropoff: "Nugegoda" });
  const app = await driverRest(d1.username, d1.pin);
  expect(await app.post("rpc/decline_task", { p_task_id: t.task_id, p_reason: "unwell", p_note: "Fever" })).toBe(200);

  const verify = await fetch(user.set_password_link, { redirect: "manual" });
  const landing = verify.headers.get("location") ?? "";
  await page.goto("/" + landing.slice(landing.indexOf("#")));
  const password = `Needs a driver for ${stamp}!`;
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Again").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  // Overview: the red block first, the row opens the task's change page with the reason and the driver first.
  const row = page.getByTestId("needs-driver-row").filter({ hasText: title });
  await expect(row).toContainText("declined");
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${t.task_id}/edit\\?driver=1`));
  await expect(page.getByText(/Fever/).first()).toBeVisible();
  await expect(page.getByTestId("needs-driver-banner")).toBeVisible();

  // The decide page: the driver first, the vehicle fills itself (their regular one). (The 30 seconds of refreshes are
  // the test of two drivers side by side, below, in both colour schemes.)
  const rq = await tool<{ request: { id: string } }>("create_request", { requested_by: "E2E Needs Driver", date: day, time: "13:00", route_from: "Head office", route_to: "Galle", need_type: "van", pax: 3 });
  await page.goto(`/requests/${rq.request.id}/decide`);
  await page.getByLabel("Driver", { exact: true }).selectOption(d2.username);
  await expect(page.getByTestId("vehicle-default")).toContainText(plate);
  await expect(page.getByTestId("plan-card")).toContainText("Leave by", { timeout: 15000 });
});

/** WCAG contrast of an element's text on its own background (the first one that is not transparent, walking up). */
async function contrastOf(el: import("@playwright/test").Locator): Promise<number> {
  return el.evaluate((node) => {
    const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    let bgEl: Element | null = node;
    let bg = "rgba(0, 0, 0, 0)";
    while (bgEl) {
      bg = getComputedStyle(bgEl).backgroundColor;
      const a = rgb(bg)[3];
      if (!(a === 0)) break;
      bgEl = bgEl.parentElement;
    }
    const [l1, l2] = [lum(rgb(getComputedStyle(node).color)), lum(rgb(bg))].sort((a, b) => b - a);
    return (l1 + 0.05) / (l2 + 0.05);
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`Who's available stays still for 30 seconds with two drivers side by side; a row click or Enter picks the driver and the vehicle (${scheme}; hotfix 17 Oct 2026)`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ colorScheme: scheme });
    const tag = `${scheme}${stamp}`;
    const email = `e2e.twins.${tag}@fame.test`;
    const user = await tool<{ set_password_link: string }>("create_office_user", { name: "E2E Twins Desk", email, permissions: ["view", "request", "approve", "assign_tasks"] });
    // A place of this run's own (drivers another run left on duty are far from it), and two drivers called Twin, both on
    // duty with today's vehicle, parked side by side near it.
    const depot = { name: `Twins depot ${tag}`, lat: 7.1 + (parseInt(stamp.slice(-3), 36) % 1000) / 5000 + (scheme === "dark" ? 0.3 : 0), lng: 80.2 };
    await tool("add_place", { ...depot, kind: "office" });
    const a = { name: `Twin ${tag}`, code: `TWA-${tag}`, username: `twa.${tag}`, pin: "135791" };
    const b = { name: `Twin ${tag} Two`, code: `TWB-${tag}`, username: `twb.${tag}`, pin: "135792" };
    const plateA = `WP TWA-${scheme[0].toUpperCase()}${stamp.slice(-4).toUpperCase()}`;
    const plateB = `WP TWB-${scheme[0].toUpperCase()}${stamp.slice(-4).toUpperCase()}`;
    const phones: { app: Awaited<ReturnType<typeof driverRest>>; id: string; session: string }[] = [];
    for (const [d, plate] of [[a, plateA], [b, plateB]] as const) {
      await tool("create_driver", d);
      await tool("register_vehicle", { reg_no: plate, make_model: "Toyota HiAce", vehicle_type: "van", seats: 12, current_odometer_km: 1000 });
      const app = await driverRest(d.username, d.pin);
      const [me] = await app.get<{ id: string }[]>("employees?select=id");
      const [veh] = await app.get<{ id: string }[]>(`vehicles?select=id&reg_no=eq.${encodeURIComponent(plate)}`);
      const session = randomUUID();
      expect(await app.post("duty_sessions", { id: session, employee_id: me.id, vehicle_id: veh.id, device_info: { model: "e2e" } })).toBe(201);
      phones.push({ app, id: me.id, session });
    }
    // Each phone's fix: about 100 m from the depot, the nearer one swapping each time (their GPS wanders).
    let tick = 0; // keeps two fixes in the same millisecond apart
    const wander = async (aNearer: boolean) => {
      const at = new Date(Date.now() - 1000 + tick++).toISOString();
      for (const [i, p] of phones.entries()) {
        const near = (i === 0) === aNearer;
        expect(await p.app.post("location_points", [{ employee_id: p.id, session_id: p.session, recorded_at: at, lat: depot.lat + (near ? 0.0009 : 0.0011), lng: depot.lng, accuracy_m: 8, speed_mps: 0, battery_pct: 80 }])).toBe(201);
      }
    };
    await wander(true);

    const verify = await fetch(user.set_password_link, { redirect: "manual" });
    const landing = verify.headers.get("location") ?? "";
    await page.goto("/" + landing.slice(landing.indexOf("#")));
    const password = `Twins desk for ${tag}!`;
    await page.getByLabel("New password").fill(password);
    await page.getByLabel("Again").fill(password);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

    // The decide page with nothing chosen: the best match (Twin A, nearer) is the default and its row is picked. The
    // page's clock is ours from here, so a minute's refresh can be brought forward.
    const day = new Date(Date.now() + 5.5 * 3600000 + 86400000).toISOString().slice(0, 10); // tomorrow in Colombo
    const rq = await tool<{ request: { id: string } }>("create_request", { requested_by: "E2E Twins Desk", date: day, time: "13:00", route_from: depot.name, route_to: "Galle", need_type: "van", pax: 3 });
    // The vehicle for the other day's tasks below, registered now: a vehicle that becomes free is new data (the list above
    // the panel grows by a row), not a refresh.
    const spare = `WP TWC-${scheme[0].toUpperCase()}${stamp.slice(-4).toUpperCase()}`;
    await tool("register_vehicle", { reg_no: spare, make_model: "Toyota Axio", vehicle_type: "car", seats: 4, current_odometer_km: 500 });
    await page.clock.install();
    await page.goto(`/requests/${rq.request.id}/decide`);
    const panel = page.getByTestId("availability");
    const rowOf = (scope: import("@playwright/test").Locator, name: string) =>
      scope.getByTestId("avail-row").filter({ has: page.locator(".name", { hasText: new RegExp(`^${name}$`) }) });
    const rowA = rowOf(panel, a.name);
    const rowB = rowOf(panel, b.name);
    await expect(rowA).toHaveAttribute("aria-pressed", "true");
    await expect(rowB).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByLabel("Driver", { exact: true })).toHaveValue(a.username);
    await expect(panel.getByTestId("best-match")).toContainText(a.name);
    // Two drivers called Twin: the full name in the vehicle's words.
    await expect(rowA).toContainText(`${plateA} ${a.name}'s vehicle today`);
    await expect(rowB).toContainText(`${plateB} ${b.name}'s vehicle today`);
    await expect(page.getByTestId("vehicle-default")).toContainText(`${plateA} · ${a.name}'s vehicle today`);
    await expect(page.getByTestId("plan-card")).toContainText("Leave by", { timeout: 15000 });
    // The picked row and a hovered row are readable in this colour scheme.
    expect(await contrastOf(rowA.locator(".name"))).toBeGreaterThan(4.5);
    await rowB.hover();
    expect(await contrastOf(rowB.locator(".name"))).toBeGreaterThan(4.5);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(1000);

    // 30 seconds: the drivers swap places by GPS, a heartbeat, new tasks elsewhere, and two of the page's minute
    // refreshes (Who's available, the free vehicles). Nothing moves: no layout shift, the same rows in the same order,
    // the same row picked, the same best match.
    await page.evaluate(() => {
      const w = window as unknown as { __shift: number; __orders: string[]; __picked: string[]; __moved: string[] };
      w.__shift = 0;
      w.__orders = [];
      w.__picked = [];
      w.__moved = [];
      const describe = (n: Node | null) => {
        const el = n instanceof Element ? n : n?.parentElement;
        if (!el) return "?";
        const id = el.closest("[data-testid]")?.getAttribute("data-testid") ?? "";
        return `${id}>${el.tagName.toLowerCase()}.${[...el.classList].join(".")} "${(el.textContent ?? "").slice(0, 40)}"`;
      };
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean; sources?: { node: Node | null }[] }[]) {
          if (e.hadRecentInput) continue;
          w.__shift += e.value;
          w.__moved.push(`${e.value.toFixed(4)}: ${(e.sources ?? []).map((x) => describe(x.node)).join(" | ")}`);
        }
      }).observe({ type: "layout-shift", buffered: false });
      const root = document.querySelector('[data-testid="availability"]')!;
      const note = () => {
        const rows = [...root.querySelectorAll('[data-testid="avail-row"]')];
        w.__orders.push(rows.map((r) => r.querySelector(".name")?.textContent ?? "").join(" | "));
        w.__picked.push(rows.filter((r) => r.getAttribute("aria-pressed") === "true").map((r) => r.querySelector(".name")?.textContent ?? "").join(","));
      };
      note();
      new MutationObserver(note).observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    const after = new Date(Date.now() + 5.5 * 3600000 + 2 * 86400000).toISOString().slice(0, 10);
    for (let i = 0; i < 6; i++) {
      await wander(i % 2 === 1); // B nearer, then A, then B…
      await phones[1].app.post("rpc/send_heartbeat", { p_at: new Date().toISOString(), p_sharing: true, p_location_on: true, p_permission: "always" });
      await tool("create_task", { title: `E2E twins churn ${tag} ${i}`, date: after, start_time: `1${i}:30`, driver: a.username, vehicle: spare, pickup: "Head office", dropoff: "Kandy" });
      if (i === 1 || i === 4) await page.clock.fastForward(61_000);
      await page.waitForTimeout(5000);
    }
    const seen = await page.evaluate(() => {
      const w = window as unknown as { __shift: number; __orders: string[]; __picked: string[]; __moved: string[] };
      return { shift: w.__shift, orders: [...new Set(w.__orders)], picked: [...new Set(w.__picked)], moved: w.__moved };
    });
    expect(seen.orders).toHaveLength(1);
    expect(seen.shift, `what moved: ${seen.moved.join(" ;; ")}`).toBeLessThan(0.01);
    expect(seen.picked).toEqual([a.name]);
    await expect(panel.getByTestId("best-match")).toContainText(a.name);
    await expect(page.getByLabel("Driver", { exact: true })).toHaveValue(a.username);
    await expect(page.getByTestId("vehicle-default")).toContainText(plateA);

    // A click on Twin B's row picks B with the vehicle B brings, and the pick stays through the next refresh.
    await rowB.click();
    await expect(rowB).toHaveAttribute("aria-pressed", "true");
    await expect(rowA).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByLabel("Driver", { exact: true })).toHaveValue(b.username);
    await expect(page.getByTestId("vehicle-default")).toContainText(`${plateB} · ${b.name}'s vehicle today`);
    expect(await contrastOf(rowB.locator(".name"))).toBeGreaterThan(4.5);
    await wander(true);
    await page.clock.fastForward(61_000);
    await page.waitForTimeout(3000);
    await expect(rowB).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Driver", { exact: true })).toHaveValue(b.username);
    // Enter on Twin A's row picks A again.
    await rowA.focus();
    await page.keyboard.press("Enter");
    await expect(rowA).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Driver", { exact: true })).toHaveValue(a.username);
    await expect(page.getByTestId("vehicle-default")).toContainText(`${plateA} · ${a.name}'s vehicle today`);

    // Assign a task: a row click fills the driver and leaves the vehicle to them (their vehicle today).
    await page.goto("/tasks/new");
    await page.getByLabel("Date", { exact: true }).fill(day);
    await page.getByLabel("Leave by", { exact: true }).fill("13:00");
    await page.getByLabel("Stop 1", { exact: true }).fill(depot.name);
    await page.getByLabel("Stop 2", { exact: true }).fill("Galle");
    const rowBNew = rowOf(page.getByTestId("availability"), b.name);
    await rowBNew.click();
    await expect(rowBNew).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Driver", { exact: true })).toHaveValue(b.username);
    await expect(page.getByLabel("Vehicle", { exact: true }).locator("option:checked")).toContainText(plateB);
    // Finish work on both phones: nobody this test put on duty stays for the next run.
    for (const p of phones) expect(await p.app.patch(`duty_sessions?id=eq.${p.session}&ended_at=is.null`, { ended_at: new Date().toISOString(), end_reason: "driver" })).toBe(200);
  });
}

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
  await page.getByLabel("Leave by", { exact: true }).fill("09:30");
  await page.getByLabel("Stop 1", { exact: true }).fill("Head office");
  await page.getByLabel("Stop 2", { exact: true }).fill("Galle");
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
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.goto("/requests/new");
  await page.getByLabel("On behalf of").fill(visitor);
  await page.getByLabel("Day").fill(day);
  await page.getByLabel("Leave by", { exact: true }).fill("09:00");
  await page.getByLabel("Back by").fill("12:00");
  await page.getByLabel("Stop 1", { exact: true }).fill("Head office");
  await page.getByLabel("Stop 2", { exact: true }).fill("Galle");
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
  await page.getByLabel("Leave by", { exact: true }).fill("09:30");
  await page.getByLabel("Stop 2", { exact: true }).fill("Matara");
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

test("the Fuel page: a fill with its video uploaded from the phone plays in the office; the checklist is edited in Fleet settings", async ({ page }) => {
  const email = `e2e.fuel.${stamp}@fame.test`;
  const user = await tool<{ set_password_link: string }>("create_office_user", { name: "E2E Fuel Admin", email, permissions: ["view", "vehicles", "assign_tasks", "users"] });
  const driver = { name: `E2E Fuel Driver ${stamp}`, code: `E2F-${stamp}`, username: `e2f.${stamp}`, pin: "357913" };
  await tool("create_driver", driver);
  const plate = `WP E2F-${stamp.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Toyota HiAce", vehicle_type: "van", seats: 9, current_odometer_km: 900 });
  const app = await driverRest(driver.username, driver.pin);
  const me = await app.get<{ id: string }[]>("employees?select=id");
  const employeeId = me[0].id;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date());
  // A valid, empty MP4 (an ftyp box and a free box): enough for the bucket's mime rule.
  const mp4 = Uint8Array.from(Buffer.from("00000018667479706d703432000000006d70343269736f6d0000000866726565", "hex"));
  const fuelId = randomUUID();
  const path = `${employeeId}/${day}/${fuelId}.mp4`;
  const vehicles = await app.get<{ id: string }[]>(`vehicles?select=id&reg_no=eq.${encodeURIComponent(plate)}`);
  // The app saves the fill with its recorded video, uploads the file, then marks the row uploaded.
  expect(await app.post("fuel_logs", { id: fuelId, vehicle_id: vehicles[0].id, employee_id: employeeId, litres: 28.5, amount_cents: 1054500, odometer_km: 912, video_path: path, video_status: "recorded", video_duration_s: 41, video_bytes: mp4.length, video_checklist: [{ key: "plate", at_s: 4 }, { key: "zero", at_s: 11 }, { key: "pumping", at_s: 15 }, { key: "final", at_s: 38 }] })).toBe(201);
  expect(await app.tusUpload("fuel-videos", path, mp4, "video/mp4")).toBe(204);
  expect(await app.patch(`fuel_logs?id=eq.${fuelId}`, { video_status: "uploaded", video_uploaded_at: new Date().toISOString() })).toBe(200);
  // A second fill with no video.
  expect(await app.post("fuel_logs", { vehicle_id: vehicles[0].id, employee_id: employeeId, litres: 10, amount_cents: 370000 })).toBe(201);
  // A third fill whose recording was interrupted: two pieces, uploaded one after the other.
  const twoId = randomUUID();
  const piece1 = `${employeeId}/${day}/${twoId}.mp4`;
  const piece2 = `${employeeId}/${day}/${twoId}-2.mp4`;
  expect(await app.post("fuel_logs", {
    id: twoId, vehicle_id: vehicles[0].id, employee_id: employeeId, litres: 40, amount_cents: 1480000, video_path: piece1, video_status: "recorded",
    video_duration_s: 312, video_bytes: mp4.length * 2, video_checklist: [{ key: "plate", at_s: 4 }, { key: "final", at_s: 250 }], video_interrupted: true,
    video_segments: [{ path: piece1, duration_s: 200, bytes: mp4.length }, { path: piece2, duration_s: 112, bytes: mp4.length }],
  })).toBe(201);
  expect(await app.tusUpload("fuel-videos", piece1, mp4, "video/mp4")).toBe(204);
  expect(await app.tusUpload("fuel-videos", piece2, mp4, "video/mp4")).toBe(204);
  expect(await app.patch(`fuel_logs?id=eq.${twoId}`, { video_status: "uploaded", video_uploaded_at: new Date().toISOString() })).toBe(200);

  const verify = await fetch(user.set_password_link, { redirect: "manual" });
  const landing = verify.headers.get("location") ?? "";
  await page.goto("/" + landing.slice(landing.indexOf("#")));
  const password = `Fuel admin ${stamp}!`;
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Again").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  // The Fuel page from the menu: this month, this vehicle; the two fills with their video chips.
  await page.getByRole("link", { name: "Fuel" }).first().click();
  await expect(page).toHaveURL(/\/fuel/);
  await page.getByLabel("Vehicle").selectOption(plate);
  const table = page.getByTestId("fuel-table");
  const withVideo = table.locator("tr", { hasText: plate }).filter({ hasText: "28.5" });
  const without = table.locator("tr", { hasText: plate }).filter({ hasText: "3,700" });
  await expect(withVideo).toContainText("Video");
  await expect(withVideo).toContainText("0:41");
  await expect(without).toContainText("No video");
  // The fill opens beside the list with its video on a signed link, and what the driver ticked.
  await withVideo.click();
  await expect(page).toHaveURL(new RegExp(`/fuel/${fuelId}`));
  const detail = page.getByTestId("fuel-detail");
  await expect(detail.getByTestId("fuel-video")).toHaveAttribute("src", /\/object\/sign\/fuel-videos\//);
  // The steps the driver ticked are a timeline, and bookmarks under the video.
  await expect(detail).toContainText("Plate 0:04 · Zero 0:11 · Pumping 0:15 · Final 0:38");
  await expect(detail.getByTestId("fuel-marks").getByRole("button")).toHaveCount(4);
  await expect(detail).toContainText("the link works for 1 hour");
  // The interrupted fill: its chip says so, the detail lists the two pieces and plays them one after another.
  const interrupted = table.locator("tr", { hasText: plate }).filter({ hasText: "5:12" });
  await expect(interrupted).toContainText("Video · interrupted");
  await expect(interrupted).toContainText("interrupted, 2 pieces");
  await interrupted.click();
  await expect(page).toHaveURL(new RegExp(`/fuel/${twoId}`));
  await expect(page.getByTestId("fuel-pieces")).toContainText("Interrupted · 2 pieces");
  await expect(page.getByTestId("fuel-pieces").getByRole("button")).toHaveCount(2);
  await expect(page.getByTestId("fuel-video")).toHaveAttribute("src", new RegExp(`${twoId}\\.mp4`));
  // A bookmark in the second piece opens that piece (at 0:50 into it); one in the first goes back.
  await page.getByTestId("fuel-marks").getByRole("button", { name: "Final 4:10" }).click();
  await expect(page.getByTestId("fuel-video")).toHaveAttribute("src", new RegExp(`${twoId}-2\\.mp4`));
  await page.getByTestId("fuel-marks").getByRole("button", { name: "Plate 0:04" }).click();
  await expect(page.getByTestId("fuel-video")).toHaveAttribute("src", new RegExp(`${twoId}\\.mp4`));
  await page.getByTestId("fuel-pieces").getByRole("button", { name: /Piece 2/ }).click();
  await expect(page.getByTestId("fuel-video")).toHaveAttribute("src", new RegExp(`${twoId}-2\\.mp4`));

  // Mileage links to the fuel page and counts the videos per vehicle.
  await page.goto("/mileage");
  await page.getByLabel("Vehicle").selectOption(plate);
  await expect(page.locator("tr", { hasText: plate })).toContainText("78.5"); // 28.5 + 10 + 40 litres
  await expect(page.getByRole("link", { name: "Fuel entries and videos" })).toBeVisible();
  const summary = await tool<{ vehicles: { vehicle: string; fuel_entries: number; fuel_videos: number }[] }>("mileage_summary", { vehicle: plate });
  expect(summary.vehicles[0]).toMatchObject({ fuel_entries: 3, fuel_videos: 2 });

  // Fleet settings: the steps start with the four defaults in order; add one, move it above the last, save; the driver gets it.
  await page.goto("/settings/fleet");
  const checklist = page.getByTestId("checklist-settings");
  await expect(checklist.getByTestId("checklist-row")).toHaveCount(4);
  await expect(checklist.getByLabel("Short word 1")).toHaveValue("Plate");
  await checklist.getByRole("button", { name: "Add step" }).click();
  await checklist.getByLabel("English").nth(4).fill("Fuel cap closed");
  await checklist.getByLabel("Short word 5").fill("Cap");
  await checklist.getByRole("button", { name: "Move up 5" }).click();
  await checklist.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Setting saved");
  const settings = await tool<{ settings: { fuel_video_checklist: { key: string; en: string; si: string; short?: string }[] } }>("get_settings", {});
  expect(settings.settings.fuel_video_checklist.map((i) => i.key)).toEqual(["plate", "zero", "pumping", "fuel_cap_closed", "final"]);
  expect(settings.settings.fuel_video_checklist[3]).toEqual({ key: "fuel_cap_closed", en: "Fuel cap closed", si: "Fuel cap closed", short: "Cap" });
  // The quality and the keep months: 480p and 12 months by default; a change is saved at once.
  await expect(page.getByLabel("Recording quality")).toHaveValue("480p");
  await expect(page.getByLabel("Keep videos for")).toHaveValue("12");
  await page.getByLabel("Keep videos for").selectOption("6");
  // The toast from the checklist save may still be showing: ask the server instead.
  await expect.poll(async () => (await tool<{ settings: { fuel_video_keep_months: number } }>("get_settings", {})).settings.fuel_video_keep_months, { timeout: 15000 }).toBe(6);
  await tool("update_settings", { key: "fuel_video_keep_months", value: 12 });
  // Back to the four in order (other runs and the driver tests count on them).
  await tool("update_settings", { key: "fuel_video_checklist", value: settings.settings.fuel_video_checklist.filter((i) => i.key !== "fuel_cap_closed") });
});

test("the location search box: sites by id with their badges, a pasted pin saved as a place, a map result confirmed; the place page; the site import", async ({ page }) => {
  const email = `e2e.sites.${stamp}@fame.test`;
  const user = await tool<{ set_password_link: string }>("create_office_user", { name: "E2E Sites Admin", email, permissions: ["view", "request", "assign_tasks", "vehicles"] });
  const S = stamp.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-5);
  const pinned = `E2E${S}P`;
  const bare = `E2E${S}N`;
  await tool("import_places", { preset: "dialog", rows: [
    { operator: "dialog", site_id: pinned, name: `Pinned Site ${stamp}`, district: "Kandy", lat: 7.2581, lng: 80.5976 },
    { operator: "dialog", site_id: bare, name: `Bare Site ${stamp}`, district: "Matale" },
  ] });

  const verify = await fetch(user.set_password_link, { redirect: "manual" });
  const landing = verify.headers.get("location") ?? "";
  await page.goto("/" + landing.slice(landing.indexOf("#")));
  const password = `Sites for ${stamp}!`;
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Again").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  // Assign a task: a site by its id, with its badge; a site without a pin warns under the row.
  await page.goto("/tasks/new");
  const pickup = page.getByLabel("Stop 1", { exact: true });
  await pickup.fill(pinned.toLowerCase());
  const option = page.getByRole("option", { name: new RegExp(`Pinned Site ${stamp}`) });
  await expect(option).toContainText("Site · Dialog");
  await option.click();
  await expect(pickup).toHaveValue(`Pinned Site ${stamp}`);
  const drop = page.getByLabel("Stop 2", { exact: true });
  await drop.fill(bare);
  await expect(page.getByRole("option", { name: new RegExp(`Bare Site ${stamp}`) })).toContainText("no pin");
  await page.getByRole("option", { name: new RegExp(`Bare Site ${stamp}`) }).click();
  await expect(page.getByTestId("no-pin-warning")).toContainText(`Bare Site ${stamp} has no pin`);

  // A pasted "lat, lng": the pin to confirm, named, saved as one of our places.
  await drop.fill("6.9271, 79.8612");
  await page.getByRole("option", { name: /This pin/ }).click();
  const confirm = page.getByTestId("pin-confirm");
  await expect(confirm.getByTestId("pin-map")).toBeVisible();
  await confirm.getByLabel("Name").fill(`Pasted pin ${stamp}`);
  await confirm.getByRole("button", { name: "Save place" }).click();
  await expect(drop).toHaveValue(`Pasted pin ${stamp}`);
  await expect(page.getByTestId("no-pin-warning")).toHaveCount(0);
  const saved = await tool<{ results: { name: string; badge: string }[] }>("search_places", { text: `Pasted pin ${stamp}`, map: false });
  expect(saved.results[0]).toMatchObject({ name: `Pasted pin ${stamp}`, badge: "Saved" });

  // A Map result (the map search answers through office-api; here its answer is stood in for): confirmed, saved with its credit.
  await page.route("**/functions/v1/office-api/tools/search_places", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { text?: string };
    if (!String(body.text).includes("fakemap")) return route.continue();
    // office-api's envelope: { result: <the tool's answer> }.
    await route.fulfill({ json: { result: { text: body.text, results: [{ layer: "map", badge: "Map", name: `Map Cafe ${stamp}`, detail: "Map Cafe, Kandy, Central Province", pinned: true, lat: 7.2906, lng: 80.6337, ref: "openstreetmap:node/1", attribution: "© OpenStreetMap contributors · openrouteservice" }], map_cached: false } } });
  });
  await page.getByRole("button", { name: "Add stop" }).click();
  const visit = page.getByLabel("Stop 3", { exact: true });
  await visit.fill("fakemap cafe");
  const mapRow = page.getByRole("option", { name: new RegExp(`Map Cafe ${stamp}`) });
  await expect(mapRow).toContainText("Map");
  await expect(page.locator(".ls-credit")).toContainText("OpenStreetMap");
  await mapRow.click();
  await expect(page.getByTestId("pin-confirm")).toContainText("OpenStreetMap");
  await page.getByTestId("pin-confirm").getByRole("button", { name: "Save place" }).click();
  await expect(visit).toHaveValue(`Map Cafe ${stamp}`);
  const cafe = await tool<{ results: { id: string }[] }>("search_places", { text: `Map Cafe ${stamp}`, map: false });
  const cafeDetail = await tool<{ place: { source: string; attribution: string } }>("place_detail", { id: cafe.results[0].id });
  expect(cafeDetail.place).toMatchObject({ source: "ors", attribution: "© OpenStreetMap contributors · openrouteservice" });
  await page.unroute("**/functions/v1/office-api/tools/search_places");

  // The request form's stops use the same box (Phase 7, §34: the request is the trip editor).
  await page.goto("/requests/new");
  await page.getByLabel("Stop 1", { exact: true }).fill(pinned);
  await page.getByRole("option", { name: new RegExp(`Pinned Site ${stamp}`) }).click();
  await expect(page.getByLabel("Stop 1", { exact: true })).toHaveValue(`Pinned Site ${stamp}`);

  // Places: find the bare site, give it a pin by hand; a later import never moves it.
  await page.goto("/places?who=dialog");
  await page.getByLabel("Find a place").fill(bare);
  await page.getByTestId("places-table").getByText(`Bare Site ${stamp}`).click();
  const placePage = page.getByTestId("place-page");
  await expect(placePage).toContainText("no pin");
  await placePage.getByLabel("Pin (lat, lng)").fill("7.4675, 80.6234");
  await placePage.getByRole("button", { name: "Save" }).click();
  await expect(placePage).toContainText("Pin from set by hand");
  await tool("import_places", { preset: "dialog", rows: [{ operator: "dialog", site_id: bare, name: `Bare Site ${stamp}`, lat: 7.1, lng: 80.1 }] });
  const bareNow = await tool<{ results: { lat: number; site_id: string }[] }>("search_places", { text: bare, map: false });
  expect(bareNow.results[0]).toMatchObject({ site_id: bare, lat: 7.4675 });

  // Import sites: a spreadsheet shaped like Dialog's, read in the browser, previewed, imported in one batch.
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.json_to_sheet([
    { "Site ID": `${S}X1`, "Other Site IDS": null, "Site Name": `Import One ${stamp}`, "New Region": "Central", District: "Kandy", Depot: "Kandy", Latitude: 7.29, Longitude: 80.63 },
    { "Site ID": `${S}X2`, "Other Site IDS": `${S}Y2`, "Site Name": `Import Two ${stamp}`, "New Region": "Central", District: "Kandy", Depot: "Kandy", Latitude: null, Longitude: null },
    { "Site ID": `${S}X1`, "Site Name": "the same id again" },
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "All Operational Sites_DNS Data");
  const buffer = Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
  await page.goto("/settings/import-sites");
  const xlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  await page.getByLabel("The spreadsheet").setInputFiles({ name: "dialog.xlsx", mimeType: xlsxType, buffer });
  // The file's sheet names its preset: Dialog's, with its mapping filled in.
  await expect(page.getByLabel("The preset")).toHaveValue("dialog");
  await expect(page.getByLabel("Site id", { exact: true })).toHaveValue("Site ID");
  await page.getByRole("button", { name: "Preview" }).click();
  const preview = page.getByTestId("import-preview");
  await expect(preview).toContainText("Places2");
  await expect(preview).toContainText("Without a pin1");
  await expect(preview).toContainText("Problem rows (skipped)1");
  await expect(page.getByTestId("problem-rows")).toContainText(`${S}X1 appears twice`);
  await page.getByRole("button", { name: "Import 2 places" }).click();
  const report = page.getByTestId("import-report");
  await expect(report).toContainText("Added2");
  const two = await tool<{ results: { site_id: string; pinned: boolean }[] }>("search_places", { text: `${S}Y2`, map: false });
  expect(two.results[0]).toMatchObject({ site_id: `${S}X2`, pinned: false });

  // A custom list (Part 4b): a title row above the column names, "lat, lng" in one column, the operator in a column.
  const custom = XLSX.utils.aoa_to_sheet([
    ["Hutch towers, October"],
    ["Code", "Location name", "GPS", "Owner"],
    [`${S}H1`, `Hutch One ${stamp}`, "7.2906, 80.6337", "Dialog"],
    [`${S}H2`, `Hutch Two ${stamp}`, "80.0791, 6.6209", "Mobitel"],
    [`${S}H3`, `Far Away ${stamp}`, "3.139, 101.6869", "Dialog"],
  ]);
  const book2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book2, custom, "Towers");
  await page.getByLabel("The spreadsheet").setInputFiles({ name: `hutch-${stamp}.xlsx`, mimeType: xlsxType, buffer: Buffer.from(XLSX.write(book2, { type: "buffer", bookType: "xlsx" })) });
  await expect(page.getByLabel("The preset")).toHaveValue("__custom__");
  await page.getByLabel("Row with the column names").fill("2");
  await page.getByLabel("Name (required)").selectOption("Location name");
  await page.getByLabel("Site id", { exact: true }).selectOption("Code");
  await page.getByLabel('One "lat, lng" column').check();
  await page.getByLabel('"lat, lng" in one column').selectOption("GPS");
  await page.getByLabel("From a column").check();
  await page.getByLabel("Operator column").selectOption("Owner");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(preview).toContainText("Places2");
  await expect(preview).toContainText("Repaired1");
  await expect(page.getByTestId("problem-rows")).toContainText(`${S}H3: outside Sri Lanka`);
  await expect(page.getByTestId("problem-rows")).toContainText("latitude and longitude were swapped");
  // Saved as a preset for the next file of this kind.
  await page.getByLabel("Name for this mapping").fill(`Hutch ${stamp}`);
  await page.getByRole("button", { name: "Save this mapping as a preset" }).click();
  await expect(page.getByLabel("The preset").locator("option", { hasText: `Hutch ${stamp} (saved mapping)` })).toHaveCount(1);
  await page.getByRole("button", { name: "Import 2 places" }).click();
  await expect(report).toContainText("Added2");
  const h2 = await tool<{ results: { site_id: string; operator: string; lat: number }[] }>("search_places", { text: `${S}H2`, map: false });
  expect(h2.results[0]).toMatchObject({ site_id: `${S}H2`, operator: "mobitel", lat: 6.6209 });
  // The import is in the history; Undo takes it back: its places switched off, out of the search.
  const row = page.getByTestId("import-row").filter({ hasText: `hutch-${stamp}.xlsx` });
  await expect(row).toContainText(`Hutch ${stamp}`);
  page.once("dialog", (d) => void d.accept());
  await row.getByRole("button", { name: "Undo this import" }).click();
  await expect(row).toContainText("Undone");
  const gone = await tool<{ results: { site_id?: string }[] }>("search_places", { text: `${S}H1`, map: false });
  expect(gone.results.some((r) => r.site_id === `${S}H1`)).toBe(false);
});

test("Phase 7, Part 2b: the plan on the map beside the timeline; a route's gaps as markers with a list; playback at 60×", async ({ page }) => {
  test.setTimeout(180_000);
  const email = `e2e.maps.${stamp}@fame.test`;
  const user = await tool<{ set_password_link: string }>("create_office_user", { name: "E2E Maps", email, permissions: ["view", "assign_tasks"] });
  const driver = { name: `E2E Mapper ${stamp}`, code: `E2M-${stamp}`, username: `e2m.${stamp}`, pin: "864201" };
  await tool("create_driver", driver);
  const verify = await fetch(user.set_password_link, { redirect: "manual" });
  const landing = verify.headers.get("location") ?? "";
  await page.goto("/" + landing.slice(landing.indexOf("#")));
  const password = `Maps for ${stamp}!`;
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Again").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  // The plan map (§20): two towns as stops, planned 1.5 s after the last edit; our map draws the pins with straight
  // connectors marked "not the road" (no Google line on the open package); a pin highlights its timeline row.
  await page.goto("/tasks/new");
  await page.getByLabel("Leave by", { exact: true }).fill("09:30");
  await page.getByLabel("Stop 1", { exact: true }).fill("Kandy");
  await page.getByLabel("Stop 2", { exact: true }).fill("Galle");
  const planMap = page.getByTestId("plan-map");
  await expect(planMap).toBeVisible({ timeout: 15000 });
  await expect(planMap.locator(".plan-pin")).toHaveCount(2, { timeout: 15000 });
  await expect(planMap).toContainText("not the road");
  await planMap.locator(".plan-pin").nth(1).click();
  await expect(planMap.locator(".plan-pin").nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("plan-timeline").locator('[aria-pressed="true"]')).toContainText("Galle");

  // A day with a gap (§21, §22): 14 minutes of driving, 12 minutes with nothing, 8 minutes of driving.
  const app = await driverRest(driver.username, driver.pin);
  const [me] = await app.get<{ id: string }[]>("employees?select=id");
  const session = randomUUID();
  const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
  expect(await app.post("duty_sessions", { id: session, employee_id: me.id, started_at: ago(40) })).toBe(201);
  const point = (min: number, i: number) => ({ employee_id: me.id, session_id: session, recorded_at: ago(min), lat: 6.90 + i * 0.002, lng: 79.95, accuracy_m: 8, speed_mps: 7, battery_pct: 70 });
  const first = Array.from({ length: 29 }, (_, i) => point(34 - i * 0.5, i));
  const second = Array.from({ length: 17 }, (_, i) => point(8 - i * 0.5, 40 + i));
  expect(await app.post("location_points", [...first, ...second])).toBe(201);

  await page.goto(`/drivers/${driver.username}`);
  const timeline = page.getByTestId("timeline");
  await expect(timeline).toContainText("Driving", { timeout: 15000 });
  // The points went up together just now, so the stretches before the gap also show as "uploaded later" rows.
  const gaps = page.getByTestId("gaps-list");
  const noApp = gaps.getByTestId("gap-row").filter({ hasText: "App not running" }).first();
  await expect(noApp).toBeVisible({ timeout: 15000 });
  await expect(gaps.getByTestId("gap-row").filter({ hasText: "Offline here · uploaded" }).first()).toBeVisible();
  await noApp.click();
  await expect(noApp).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.gap-mk[aria-expanded="true"]')).toHaveCount(1);
  // No map draws a gap's words permanently: they are in the marker's card only.
  await expect(page.locator(".maplibregl-canvas, svg").first()).toBeVisible();

  // Playback at 60×: the recorded clock moves about a minute per second.
  const playback = page.getByTestId("playback");
  await playback.getByRole("button", { name: "60×" }).click();
  const seconds = (t: string) => { const [h, m, sec] = t.slice(0, 8).split(":").map(Number); return h * 3600 + m * 60 + sec; };
  await playback.getByRole("button", { name: "Play" }).click();
  const t0 = seconds((await page.getByTestId("playback-clock").textContent()) ?? "");
  await page.waitForTimeout(3000);
  const t1 = seconds((await page.getByTestId("playback-clock").textContent()) ?? "");
  expect(t1 - t0).toBeGreaterThan(100);
  expect(t1 - t0).toBeLessThan(260);
  await playback.getByRole("button", { name: "Pause" }).click();
});

test("a request planned like a task is approved with its stops; a dispatcher's task waits for the fleet admin's OK and is sent as proposed (Phase 7, Part 3)", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const tag = `p3${stamp}`;
  const requester = await tool<{ set_password_link: string }>("create_office_user", { name: "E2E P3 Requester", email: `e2e.p3req.${stamp}@fame.test`, permissions: ["view", "request"] });
  const dispatcher = await tool<{ set_password_link: string }>("create_office_user", { name: "E2E P3 Dispatcher", email: `e2e.p3disp.${stamp}@fame.test`, permissions: ["view", "request", "assign_tasks"] });
  const approver = await tool<{ set_password_link: string }>("create_office_user", { name: "E2E P3 Approver", email: `e2e.p3appr.${stamp}@fame.test`, permissions: ["view", "request", "approve", "assign_tasks"] });
  const driver = { name: `E2E P3 Driver ${stamp}`, code: `EP3-${stamp}`, username: `ep3.${stamp}`, pin: "357913" };
  await tool("create_driver", driver);
  const plate = `WP EP3-${stamp.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Toyota HiAce", vehicle_type: "van", seats: 12, current_odometer_km: 1000 });
  await tool("update_vehicle", { reg_no: plate, regular_driver: driver.username });
  const day = new Date(Date.now() + 5.5 * 3600000 + 86400000).toISOString().slice(0, 10); // tomorrow in Colombo
  const signIn = async (p: import("@playwright/test").Page, link: string, password: string) => {
    const verify = await fetch(link, { redirect: "manual" });
    const landing = verify.headers.get("location") ?? "";
    await p.goto("/" + landing.slice(landing.indexOf("#")));
    await p.getByLabel("New password").fill(password);
    await p.getByLabel("Again").fill(password);
    await p.getByRole("button", { name: "Save password" }).click();
    await expect(p.getByRole("heading", { name: "Overview" })).toBeVisible();
  };

  // 1. The requester plans the trip as Assign a task does: two stops, be in Galle by 16:00; the plan's timeline shows.
  await signIn(page, requester.set_password_link, `P3 requester ${stamp}!`);
  await page.goto("/requests/new");
  await page.getByLabel("Day").fill(day);
  await page.getByLabel("Stop 1", { exact: true }).fill("Head office");
  await page.getByLabel("Stop 2", { exact: true }).fill("Galle");
  await page.getByLabel("Arrive by").nth(1).fill("16:00");
  await expect(page.getByTestId("plan-card")).toContainText("Leave by", { timeout: 20000 });
  await expect(page.getByTestId("availability")).toHaveCount(0); // a requester never sees who drives
  await page.getByLabel("Note").fill(`P3 trip ${tag}`);
  await page.getByRole("button", { name: "Save request" }).click();
  await expect(page.getByRole("status")).toHaveText("Sent to the fleet admin · you'll be notified.");
  const waiting = await tool<{ requests: { id: string; note?: string; trip?: { stops: unknown[] } }[] }>("list_requests", { status: "waiting" });
  const asked = waiting.requests.find((r) => r.note === `P3 trip ${tag}`)!;
  expect(asked.trip?.stops.length).toBe(2);

  // 2. The approver: the decide page shows the trip as asked; a row of Who's available picks the driver; Approve and send.
  const approverPage = await (await browser.newContext()).newPage();
  await signIn(approverPage, approver.set_password_link, `P3 approver ${stamp}!`);
  await approverPage.goto(`/requests/${asked.id}/decide`);
  await expect(approverPage.getByTestId("request-decide-trip")).toBeVisible();
  await expect(approverPage.getByTestId("request-trip").getByTestId("plan-timeline")).toContainText("Galle");
  await approverPage.getByTestId("availability").getByTestId("avail-row").filter({ hasText: driver.name }).click();
  await expect(approverPage.getByLabel("Driver", { exact: true })).toHaveValue(driver.username);
  await approverPage.getByTestId("decide-send").click();
  await expect(approverPage.getByTestId("request-decided")).toBeVisible();
  const decided = await tool<{ requests: { task_id?: string; status: string }[] }>("list_requests", { status: "all", id: asked.id });
  expect(decided.requests[0].status).toBe("approved");
  const task = await tool<{ stops: { place?: string; place_name?: string }[] }>("task_detail", { task_id: decided.requests[0].task_id });
  expect(task.stops.map((s) => s.place ?? s.place_name)).toHaveLength(2);

  // 3. The dispatcher (no approve) assigns a task: it waits for the fleet admin's OK; the board's first column holds it.
  const dispatcherPage = await (await browser.newContext()).newPage();
  await signIn(dispatcherPage, dispatcher.set_password_link, `P3 dispatcher ${stamp}!`);
  await dispatcherPage.goto("/tasks/new");
  const title = `E2E proposed ${tag}`;
  await dispatcherPage.getByLabel("Task", { exact: true }).fill(title);
  await dispatcherPage.getByLabel("Date", { exact: true }).fill(day);
  await dispatcherPage.getByLabel("Leave by", { exact: true }).fill("10:00");
  await dispatcherPage.getByLabel("Stop 1", { exact: true }).fill("Head office");
  await dispatcherPage.getByLabel("Stop 2", { exact: true }).fill("Kandy");
  await dispatcherPage.getByLabel("Driver", { exact: true }).selectOption(driver.username);
  await expect(dispatcherPage.getByTestId("plan-card")).toContainText("Leave by", { timeout: 20000 });
  await dispatcherPage.getByRole("button", { name: "Send for approval" }).click();
  await expect(dispatcherPage.getByText("Waiting for the fleet admin's OK").first()).toBeVisible();
  await expect(dispatcherPage.getByRole("link", { name: "Open the request" })).toBeVisible();
  await dispatcherPage.goto(`/tasks?date=${day}`);
  await expect(dispatcherPage.getByTestId("waiting-approval").getByTestId("waiting-card").filter({ hasText: title })).toBeVisible();
  const proposals = await tool<{ requests: { id: string; title?: string; kind?: string }[] }>("list_requests", { status: "waiting", kind: "task" });
  const proposal = proposals.requests.find((r) => r.title === title)!;
  expect(proposal.kind).toBe("task");

  // 4. The approver sends it as proposed: now the driver has it.
  await approverPage.goto(`/requests/${proposal.id}/decide`);
  await expect(approverPage.getByTestId("decide-send")).toHaveText("Send as proposed");
  await approverPage.getByTestId("decide-send").click();
  await expect(approverPage.getByTestId("request-decided")).toBeVisible();
  const board = await tool<{ assigned: { title: string; driver?: string }[]; waiting_approval?: { title: string }[] }>("task_board", { date: day });
  expect(board.assigned.some((c) => c.title === title && c.driver === driver.name)).toBe(true);
  expect((board.waiting_approval ?? []).some((c) => c.title === title)).toBe(false);
});

test("a vehicle's documents: upload with its expiry, view, replace, remove with a second step, restore (Phase 7, §28)", async ({ page }) => {
  test.setTimeout(180_000);
  const user = await tool<{ set_password_link: string }>("create_office_user", { name: "E2E Docs Desk", email: `e2e.docs.${stamp}@fame.test`, permissions: ["view", "vehicles"] });
  const plate = `WP EDC-${stamp.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Toyota Axio", vehicle_type: "car", seats: 4 });
  const verify = await fetch(user.set_password_link, { redirect: "manual" });
  const landing = verify.headers.get("location") ?? "";
  await page.goto("/" + landing.slice(landing.indexOf("#")));
  await page.getByLabel("New password").fill(`Docs desk for ${stamp}!`);
  await page.getByLabel("Again").fill(`Docs desk for ${stamp}!`);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  await page.goto(`/vehicles/${encodeURIComponent(plate)}`);
  const docs = page.getByTestId("vehicle-documents");
  await expect(docs.getByTestId("docs-missing")).toContainText("insurance");
  // A PDF with its expiry: the row shows who uploaded it and View; the vehicle's insurance date follows.
  const insurance = docs.getByTestId("doc-insurance");
  const expiry = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10);
  await insurance.getByLabel("Expires").fill(expiry);
  await insurance.locator('input[type="file"]').setInputFiles({ name: "insurance.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
  await expect(insurance).toContainText("Uploaded by E2E Docs Desk");
  await expect(insurance.getByRole("link", { name: "View" })).toHaveAttribute("href", /\/storage\/v1\/object\/sign\/vehicle-docs\//);
  const listed = await tool<{ vehicles: { reg_no: string; documents_missing?: string[] }[] }>("list_vehicles", {});
  expect(listed.vehicles.find((v) => v.reg_no === plate)?.documents_missing).not.toContain("insurance");
  // Replace: the old one is kept as replaced.
  await insurance.locator('input[type="file"]').setInputFiles({ name: "insurance-2.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%second\n%%EOF\n") });
  await expect(docs.getByTestId("removed-documents").getByTestId("removed-doc")).toContainText("Replaced");
  // Remove has a second step on the page; Restore brings it back.
  await insurance.getByRole("button", { name: "Remove" }).click();
  await insurance.getByTestId("doc-remove-confirm").getByRole("button", { name: "Remove" }).click();
  await expect(insurance).toContainText("No document");
  await expect(docs.getByTestId("removed-doc")).toHaveCount(2);
  await docs.getByTestId("removed-doc").filter({ hasText: "Removed" }).getByRole("button", { name: "Restore" }).click();
  await expect(insurance).toContainText("Uploaded by E2E Docs Desk");
  await expect(docs.getByTestId("removed-doc")).toHaveCount(1);
});
