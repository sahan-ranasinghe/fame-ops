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
  await page.goto(user.set_password_link);
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
  await page.getByLabel("Start", { exact: true }).fill("09:30");
  await page.getByLabel("Pickup").fill("Head office");
  await page.getByLabel("Drop-off").fill("Nugegoda");
  await page.getByLabel("Driver", { exact: true }).selectOption(driver.username);
  await page.getByLabel("Vehicle", { exact: true }).selectOption(plate);
  await page.getByRole("button", { name: "Assign & send" }).click();
  await expect(page.getByText(`Sent to ${driver.name}.`)).toBeVisible();
  const card = page.locator(".tcard", { hasText: title });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Fame internal")).toBeVisible();
  await page.getByLabel("Cancel this task").fill("E2E test over");
  await page.getByRole("button", { name: "Cancel task" }).click();
  await expect(page.getByRole("status")).toHaveText("Task cancelled");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card).toHaveCount(0);

  // 4. Live locations: the driver shares a position; a newer one arrives over Realtime.
  const app = await driverRest(driver.username, driver.pin);
  const [me] = await app.get<{ id: string }[]>("employees?select=id");
  const session = randomUUID();
  expect(await app.post("duty_sessions", { id: session, employee_id: me.id, device_info: { model: "e2e" } })).toBe(201);
  const at = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
  expect(await app.post("location_points", [{ employee_id: me.id, session_id: session, recorded_at: at(60), lat: 6.8649, lng: 79.8997, accuracy_m: 8, speed_mps: 10, battery_pct: 77 }])).toBe(201);
  await page.getByRole("link", { name: "Live locations" }).first().click();
  await expect(page.getByRole("heading", { name: "Live locations" })).toBeVisible();
  const row = page.locator(".lrow", { hasText: driver.name });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/Live · \d+ min/);
  await row.click(); // another driver may be selected by default
  const detail = page.getByTestId("live-detail");
  await expect(detail).toContainText(driver.name);
  await expect(detail).toContainText("36 km/h");
  // A new point: the trigger updates driver_latest, Realtime delivers it, the detail changes without a reload.
  await expect(page.getByTestId("rt-status")).toHaveText("Live updates");
  expect(await app.post("location_points", [{ employee_id: me.id, session_id: session, recorded_at: at(2), lat: 6.9, lng: 79.95, accuracy_m: 8, speed_mps: 20, battery_pct: 76 }])).toBe(201);
  await expect(detail).toContainText("72 km/h", { timeout: 8000 });
  await expect(detail).toContainText("76%");
  await page.getByRole("button", { name: "Today’s route" }).click();
  await expect(detail).toContainText(/Today: [\d.]+ km from 2 points/);

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
  await expect(page.getByText("Task km", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Projects" }).first().click();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await page.getByLabel("Find a project").fill(`zzz-${stamp}`);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No project matches", { exact: false })).toBeVisible();

  await page.getByRole("link", { name: "Accounts" }).first().click();
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  await expect(page.locator("tr", { hasText: email })).toBeVisible();

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
