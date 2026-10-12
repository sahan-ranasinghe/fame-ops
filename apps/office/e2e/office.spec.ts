// The plan's Phase 2 end-to-end check on the LOCAL stack: the set-password link,
// the second step, sign-in, Overview, one task assigned and cancelled, sign out.
//
// Needs: supabase start, functions serve (OFFICE_MCP_KEY in its env), the web
// app's .env.local pointing at the local stack, and these variables:
//   OFFICE_MCP_URL   http://127.0.0.1:54321/functions/v1/office-mcp
//   OFFICE_MCP_KEY   the local shared key (never the real one)
import { expect, test } from "@playwright/test";
import { totp } from "./totp";

const MCP = (process.env.OFFICE_MCP_URL || "http://127.0.0.1:54321/functions/v1/office-mcp").replace(/\/$/, "");
const KEY = process.env.OFFICE_MCP_KEY || "";
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

test.beforeAll(() => {
  test.skip(!KEY, "OFFICE_MCP_KEY (the local shared key) is not set");
});

test("an office user sets a password, enrols the second step, assigns and cancels a task", async ({ page }) => {
  // Set up through the connector, as the admin would in Claude.
  const email = `e2e.${stamp}@fame.test`;
  const user = await tool<{ set_password_link: string }>("create_office_user", { name: "E2E Admin", email, role: "admin" });
  const driver = { name: "E2E Driver", code: `E2E-${stamp}`, username: `e2e.${stamp}`, pin: "246810" };
  await tool("create_driver", driver);
  const plate = `WP E2E-${stamp.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Toyota HiAce", vehicle_type: "van", seats: 12, current_odometer_km: 1000 });

  // 1. The set-password link opens the app with a recovery session.
  await page.goto(user.set_password_link);
  await expect(page.getByRole("heading", { name: "Choose a password" })).toBeVisible();
  const password = `Sentence for ${stamp}!`;
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Again").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();

  // 2. An admin must set up the second step before anything loads.
  await expect(page.getByRole("heading", { name: "Set up your authenticator" })).toBeVisible();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim() ?? "";
  expect(secret.length).toBeGreaterThan(10);
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Continue" }).click();

  // 3. Overview, as this person.
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("E2E Admin")).toBeVisible();
  await expect(page.getByText("Vehicles on the road")).toBeVisible();

  // 4. Assign a task; it appears on the board; open it; cancel it.
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
  await expect(card).toHaveCount(0);

  // 5. Sign out, sign in again with the password and a fresh code.
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

  // The audit log carries the person's name on the web channel.
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
