// The place search as someone types (30 October 2026; Round 51b; and bug 2's row test at the end). The map search had stopped on the real server: its
// minute counter (bump_minute_calls) failed on its own "keep an hour" delete, and since Round 48 a counter that cannot be
// read pauses the search, so a box showed only our places and the recent ones. This runs the site's trip form against the
// local stack: on From, To and a stop between them the empty box shows Saved and Recent, typing asks search_places once
// the typing pauses (300 ms; never once a letter for ordinary typing), every answer is 200 (no 429 from the rate limit, no
// loop error from the breaker), and the place found shows. The counter itself as the functions call it:
// supabase/tests/database/minute_counter.test.sql. The same on /m/: mobile.spec.ts; Office mode: tests/whereTyping.test.tsx.
import type { Page, Request } from "@playwright/test";
import { expect, test } from "./offline";
import { setPasswordByLink } from "./links";

const MCP = (process.env.OFFICE_MCP_URL || "http://127.0.0.1:54321/functions/v1/office-mcp").replace(/\/$/, "");
const KEY = process.env.OFFICE_MCP_KEY || "";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const ANON = process.env.ANON_KEY || "";
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

/** A tool as the person, through office-api with their own session (their own request makes their Recent). */
async function asPerson(email: string, password: string, name: string, args: Record<string, unknown>): Promise<void> {
  const auth = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { "content-type": "application/json", apikey: ANON }, body: JSON.stringify({ email, password }),
  });
  const { access_token } = (await auth.json()) as { access_token?: string };
  if (!access_token) throw new Error(`sign-in failed: ${auth.status}`);
  const res = await fetch(`${API}/functions/v1/office-api/tools/${name}`, {
    method: "POST", headers: { "content-type": "application/json", apikey: ANON, authorization: `Bearer ${access_token}` }, body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
}

test.beforeAll(() => {
  test.skip(!KEY || !ANON, "OFFICE_MCP_KEY and ANON_KEY (the local stack) are not set");
});

/** The searches a page sends (the typed ones: suggestions carry no text) and every answer's status. */
function watchSearches(page: Page) {
  const typed: string[] = [];
  const statuses: number[] = [];
  page.on("request", (r: Request) => {
    if (!r.url().includes("/office-api/tools/search_places")) return;
    const body = JSON.parse(r.postData() || "{}") as { text?: string };
    if (typeof body.text === "string" && body.text !== "") typed.push(body.text);
  });
  page.on("response", (r) => {
    if (r.url().includes("/office-api/tools/search_places")) statuses.push(r.status());
  });
  return { typed, statuses };
}

test("the trip form's place boxes: Saved and Recent first, then one search per pause on From, To and a stop, its results shown", async ({ page }) => {
  // Our place to find, and the person's own Recent (a request of theirs to a place typed in).
  const depot = `Typing Depot ${stamp}`;
  await tool("add_place", { name: depot, address: "Galle Road, Colombo 03", lat: 6.9012, lng: 79.8521, kind: "store" });
  const email = `typing.${stamp}@fame.test`;
  const password = `Typing test ${stamp}!`;
  const user = await tool<{ set_password_link: string }>("create_office_user", { name: "Typing Requester", email, permissions: ["view", "request"] });
  await setPasswordByLink(user.set_password_link, password);
  const recentSpot = `Recent Spot ${stamp}`;
  await asPerson(email, password, "create_request", { date: "2026-12-01", time: "09:00", route_from: "Head office", route_to: recentSpot, need_type: "van", pax: 2 });

  await page.goto("/");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.goto("/requests/new");
  await expect(page.getByLabel("To", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  const searches = watchSearches(page);

  for (const [label, word] of [["From", "Typing Dep"], ["To", "Typing Depo"], ["Stop 1", "Typing Depot"]] as const) {
    const box = page.getByLabel(label, { exact: true });
    await box.fill("");
    await box.focus();
    // Empty: Saved (our places) and Recent (the person's own, the request above).
    const list = page.getByRole("listbox");
    await expect(list.getByTestId("where-group").filter({ hasText: /^Saved$/ })).toBeVisible();
    await expect(list.getByTestId("where-group").filter({ hasText: /^Recent$/ })).toBeVisible();
    await expect(list.getByRole("option", { name: new RegExp(recentSpot) })).toBeVisible();
    // Typing, faster than the pause: one search when it stops (at most one more if the browser was slow), and the result.
    const before = searches.typed.length;
    await box.pressSequentially(word, { delay: 40 });
    await expect(page.getByRole("listbox").getByRole("option", { name: new RegExp(depot) })).toBeVisible();
    const sent = searches.typed.slice(before);
    expect(sent.at(-1), `${label}: the whole word was searched`).toBe(word);
    expect(sent.length, `${label}: debounced (${sent.join(" | ")})`).toBeLessThanOrEqual(2);
    await page.keyboard.press("Escape");
  }
  expect(searches.statuses.length).toBeGreaterThan(0);
  expect(searches.statuses.every((s) => s === 200), `every search answered 200: ${searches.statuses.join(",")}`).toBe(true);
  await expect(page.getByText("This screen asked the server too often")).toHaveCount(0);
});

// Round 51b, bug 2 (Uber's trip card, Google Calendar's event card): a row opens its item from anywhere on it, not only its
// name; its own button keeps its action. The Overview's request row, clicked on its second line (no link there).
test("the Overview's request row opens the request from anywhere on it; Decide keeps its own page", async ({ page }) => {
  const email = `cards.${stamp}@fame.test`;
  const password = `Cards test ${stamp}!`;
  const user = await tool<{ set_password_link: string }>("create_office_user", { name: "Cards Approver", email, permissions: ["view", "request", "approve"] });
  await setPasswordByLink(user.set_password_link, password);
  const asker = `Cards Desk ${stamp}`;
  const rq = await tool<{ request: { id: string } }>("create_request", { requested_by: asker, date: "2026-12-02", time: "10:00", route_from: "Head office", route_to: "Kandy", need_type: "van", pax: 2 });
  await page.goto("/");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  const row = page.getByTestId("request-row").filter({ hasText: asker });
  await expect(row).toBeVisible();
  await row.locator(".sub").click();
  await expect(page).toHaveURL(new RegExp(`/requests/${rq.request.id}$`));
  await page.goBack();
  await page.getByTestId("request-row").filter({ hasText: asker }).getByRole("link", { name: "Decide" }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/${rq.request.id}/decide$`));
});
