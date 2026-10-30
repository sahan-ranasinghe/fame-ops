// Round 52 (docs/phase8-plan.md §40): archive, delete and restore on the site against the local stack. An admin (users,
// vehicles, approve, assign_tasks): a vehicle with no history deleted from its page after typing its plate (GitHub's
// type-to-confirm), found in Settings → Recently deleted and restored; a driver with a trip tomorrow archived (the trips step
// names it, Archive anyway) and listed under Show archived; a task deleted from its page with a reason, the reason in
// Recently deleted, restored. The delete and bin tools are the web app's only (the connector keeps no delete), so every
// delete here goes through the pages; the connector only sets things up.
import type { Page } from "@playwright/test";
import { expect, test } from "./offline";
import { setPasswordByLink } from "./links";

const MCP = (process.env.OFFICE_MCP_URL || "http://127.0.0.1:54321/functions/v1/office-mcp").replace(/\/$/, "");
const KEY = process.env.OFFICE_MCP_KEY || "";
const stamp = Date.now().toString(36) + "b";

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

/** Colombo's date `days` from today. */
const dayFromNow = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date(Date.now() + days * 864e5));

/** An admin with users, vehicles, approve and assign_tasks, signed in on the page. */
async function signInAdmin(page: Page, tag: string): Promise<void> {
  const email = `bin.${tag}@fame.test`;
  const password = `Bin test ${tag}!`;
  const user = await tool<{ set_password_link: string }>("create_office_user", {
    name: `Bin Admin ${tag}`, email, permissions: ["view", "request", "vehicles", "users", "approve", "assign_tasks", "issues"],
  });
  await setPasswordByLink(user.set_password_link, password);
  await page.goto("/");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

/** Settings → Recently deleted, searched for `words`: its row. */
async function binRow(page: Page, words: string) {
  await page.goto("/settings/recently-deleted");
  await expect(page.getByRole("heading", { name: "Recently deleted" })).toBeVisible();
  await page.getByTestId("list-search").fill(words);
  const row = page.getByTestId("bin-row").filter({ hasText: words });
  await expect(row).toBeVisible();
  return row;
}

test("a vehicle with no history: Delete permanently after typing its plate, then Recently deleted restores it", async ({ page }) => {
  const plate = `WP BN-${stamp.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Toyota HiAce", vehicle_type: "van", seats: 12 });
  await signInAdmin(page, `${stamp}v`);

  await page.goto(`/vehicles/${encodeURIComponent(plate)}`);
  await expect(page.getByTestId("vehicle-detail")).toBeVisible();
  await page.getByTestId("delete-permanently").click();
  const sheet = page.getByTestId("delete-record-sheet");
  const confirm = sheet.getByTestId("delete-record-confirm");
  await expect(confirm).toBeDisabled();
  await sheet.getByLabel(`Type the plate ${plate} to confirm`).fill(plate.toLowerCase().replace(/[\s-]/g, ""));
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.locator("#toast")).toContainText("Deleted · in Recently deleted until");
  await expect(page).toHaveURL(/\/vehicles(\?.*)?$/);

  const row = await binRow(page, plate);
  await expect(row).toContainText("Vehicle");
  await expect(row).toContainText("Deleted by Bin Admin");
  await row.getByRole("button", { name: "Restore" }).click();
  await expect(page.locator("#toast")).toContainText(`Restored ${plate}`);
  await expect(page.getByTestId("bin-row").filter({ hasText: plate })).toHaveCount(0);

  // Back: its page opens again, and the connector lists it.
  await page.goto(`/vehicles/${encodeURIComponent(plate)}`);
  await expect(page.getByTestId("vehicle-detail")).toBeVisible();
  const listed = await tool<{ vehicles: { reg_no: string }[] }>("list_vehicles", { search: plate });
  expect(listed.vehicles.some((v) => v.reg_no === plate)).toBe(true);
});

test("a driver with a trip tomorrow: Archive lists it, Archive anyway archives, and Show archived finds the driver", async ({ page }) => {
  const tag = `${stamp}d`;
  const driver = { name: `Bin Driver ${tag}`, code: `BN-${tag}`, username: `bn.${tag}`, pin: "246813", phone: "0771234531" };
  await tool("create_driver", driver);
  const plate = `WP BD-${stamp.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Toyota HiAce", vehicle_type: "van", seats: 12, current_odometer_km: 1000 });
  const title = `Bin trip ${tag}`;
  await tool("create_task", { title, date: dayFromNow(1), start_time: "09:00", driver: driver.username, vehicle: plate, pickup: "Head office", dropoff: "Galle" });
  await signInAdmin(page, tag);

  await page.goto(`/drivers/${driver.username}/edit`);
  const box = page.getByTestId("driver-archive");
  await box.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(box).toContainText(`Archive ${driver.name}?`);
  await box.getByRole("button", { name: "Yes, archive" }).click();
  const trips = page.getByTestId("archive-trips");
  await expect(trips).toContainText(title);
  await expect(trips.getByRole("link", { name: new RegExp(title) })).toHaveAttribute("href", /^\/tasks\/[0-9a-f-]+$/);
  await box.getByRole("button", { name: "Archive anyway" }).click();
  await expect(page.locator("#toast")).toContainText(`${driver.name} archived`);

  await page.goto("/drivers");
  await page.getByTestId("list-search").fill(driver.username);
  await expect(page.getByTestId("driver-row").filter({ hasText: driver.name })).toHaveCount(0);
  await page.getByTestId("filter-button").click();
  const panel = page.getByTestId("filter-panel");
  await panel.getByLabel("Show archived").check();
  await panel.getByTestId("filter-apply").click();
  await expect(page).toHaveURL(/inactive=1/);
  const row = page.getByTestId("driver-row").filter({ hasText: driver.name });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Archived");
});

test("a wrong task: Delete… with a reason from its page, the reason in Recently deleted, then Restore", async ({ page }) => {
  const tag = `${stamp}t`;
  const driver = { name: `Bin Task Driver ${tag}`, code: `BT-${tag}`, username: `bt.${tag}`, pin: "246815", phone: "0771234532" };
  await tool("create_driver", driver);
  const plate = `WP BT-${stamp.slice(-4).toUpperCase()}`;
  await tool("register_vehicle", { reg_no: plate, make_model: "Toyota HiAce", vehicle_type: "van", seats: 12, current_odometer_km: 1000 });
  const title = `Bin wrong task ${tag}`;
  const task = await tool<{ task_id: string }>("create_task", { title, date: dayFromNow(2), start_time: "10:00", driver: driver.username, vehicle: plate, pickup: "Head office", dropoff: "Kandy" });
  await signInAdmin(page, tag);

  await page.goto(`/tasks/${task.task_id}`);
  await expect(page.getByTestId("task-detail")).toBeVisible();
  await page.getByTestId("delete-entry-task").click();
  const sheet = page.getByTestId("delete-entry-sheet");
  await expect(sheet.getByTestId("delete-entry-label")).toContainText(title);
  await expect(sheet.getByTestId("delete-entry-affects")).toContainText("stop");
  const del = sheet.getByTestId("delete-entry-confirm");
  await expect(del).toBeDisabled();
  const reason = `Made by mistake ${tag}`;
  await sheet.getByTestId("delete-entry-reason").fill(reason);
  await expect(del).toBeEnabled();
  await del.click();
  await expect(page.locator("#toast")).toContainText("Deleted · in Recently deleted until");

  const row = await binRow(page, title);
  await expect(row.getByTestId("bin-reason")).toHaveText(`Reason: ${reason}`);
  await row.getByRole("button", { name: "Restore" }).click();
  await expect(page.locator("#toast")).toContainText("Restored");
  await expect(page.getByTestId("bin-row").filter({ hasText: title })).toHaveCount(0);

  await page.goto(`/tasks/${task.task_id}`);
  await expect(page.getByTestId("task-detail")).toContainText(title);
});
