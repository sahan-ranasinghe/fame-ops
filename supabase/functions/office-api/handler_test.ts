// office-api's door (Round 48, item 6b): the per-address bucket before Auth, the general and the paid buckets per person,
// the one 429 sentence. The handler runs with a fake person resolver (counts how often Auth would be asked), a fake tool
// runner and a clock of its own.
import { assertEquals } from "@std/assert";
import type { Db } from "../_shared/fleet/db.ts";
import { TokenBuckets } from "../_shared/fleet/rateLimit.ts";
import { createHandler, type Limits, type Resolved } from "./handler.ts";

const ACTOR = {
  employeeId: "e1",
  name: "Sahan",
  role: "admin" as const,
  permissions: ["view", "approve", "assign_tasks", "vehicles", "issues", "users", "request"] as never[],
  authUserId: "u1",
  channel: "web" as const,
};

function setup(clockStart = 0) {
  const t = { now: clockStart };
  const clock = () => t.now;
  const limits: Limits = {
    general: new TokenBuckets({ capacity: 120 }, clock),
    paid: new TokenBuckets({ capacity: 30 }, clock),
    search: new TokenBuckets({ capacity: 90 }, clock),
    unauth: new TokenBuckets({ capacity: 20 }, clock),
    pub: new TokenBuckets({ capacity: 60 }, clock),
  };
  const auth = { asked: 0 };
  const ran: string[] = [];
  const resolvePerson = (request: Request): Promise<Resolved> => {
    auth.asked += 1;
    const token = request.headers.get("authorization");
    if (!token) return Promise.resolve({ ok: false, status: 401, error: "not_signed_in" });
    return Promise.resolve({ ok: true, actor: ACTOR, email: "s@x.test", mfa: false, phone: null });
  };
  const handle = createHandler({
    db: {} as Db,
    resolvePerson,
    mfaRoles: [],
    allowedOrigins: () => ["https://fame-fleet.pages.dev"],
    limits,
    // deno-lint-ignore require-await
    runTool: async (_db, def) => {
      ran.push(def.name);
      return { text: JSON.stringify({ ok: true }), kind: "ok" as const };
    },
  });
  const post = (tool: string, opts: { token?: string; ip?: string } = { token: "tok" }) =>
    handle(
      new Request(`https://x.test/functions/v1/office-api/tools/${tool}`, {
        method: "POST",
        headers: {
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          "x-real-ip": opts.ip ?? "203.0.113.9",
          "content-type": "application/json",
        },
        body: tool === "plan_task"
          ? JSON.stringify({ date: "2026-10-28", leave_by: "09:00", stops: [{ type: "drop", place: "Kandy" }] })
          : "{}",
      }),
    );
  return { t, limits, auth, ran, handle, post };
}

Deno.test("an address refused 20 times a minute is answered 429 before Supabase Auth is asked; another address is not", async () => {
  const { auth, post, t } = setup();
  for (let i = 0; i < 20; i++) assertEquals((await post("task_board", { ip: "198.51.100.7" })).status, 401);
  assertEquals(auth.asked, 20);
  const refused = await post("task_board", { ip: "198.51.100.7" });
  assertEquals(refused.status, 429);
  assertEquals(await refused.json(), { error: "rate_limited", code: "rate_limited", message: "Too many requests · try again in a minute" });
  assertEquals(auth.asked, 20, "the 21st never reached Auth");
  assertEquals((await post("task_board", { ip: "198.51.100.8" })).status, 401, "another address still gets its answer");
  assertEquals(auth.asked, 21);
  t.now += 60_000;
  assertEquals((await post("task_board", { ip: "198.51.100.7" })).status, 401, "a minute later the address is heard again");
});

Deno.test("a signed-in person: 30 paid calls a minute (plan_task), the 31st is 429 with the sentence; a free tool goes on", async () => {
  const { post, ran, t } = setup();
  for (let i = 0; i < 30; i++) assertEquals((await post("plan_task")).status, 200);
  const refused = await post("plan_task");
  assertEquals(refused.status, 429);
  assertEquals(((await refused.json()) as { message: string }).message, "Too many requests · try again in a minute");
  assertEquals(ran.filter((n) => n === "plan_task").length, 30, "the 31st was never run");
  assertEquals((await post("task_board")).status, 200, "a tool that costs nothing is still answered");
  t.now += 2_000; // 30 a minute: one token back a second
  assertEquals((await post("plan_task")).status, 200);
});

Deno.test("the place search as someone types: its own 90 a minute (30 October 2026), the 91st is 429; it never spends the paid 30", async () => {
  const { post, ran, limits } = setup();
  for (let i = 0; i < 90; i++) assertEquals((await post("search_places")).status, 200);
  assertEquals((await post("search_places")).status, 429);
  assertEquals(ran.filter((n) => n === "search_places").length, 90, "the 91st was never run");
  assertEquals(limits.paid.peek("e1"), 30, "typing spent nothing of the paid allowance");
  assertEquals((await post("plan_task")).status, 200, "the plan is still answered");
});

Deno.test("the general limit: 120 calls a minute per person over every tool, then 429; the person's refusals never charge the address bucket", async () => {
  const { post, limits } = setup();
  for (let i = 0; i < 120; i++) assertEquals((await post("task_board")).status, 200);
  assertEquals((await post("task_board")).status, 429);
  assertEquals(limits.unauth.peek("203.0.113.9"), 20, "a signed-in person's 429 is not a refusal of the address");
});

Deno.test("a 404 after sign-in charges the address like a refusal; the public privacy page has its own 60 a minute", async () => {
  const { handle, limits } = setup();
  const res = await handle(
    new Request("https://x.test/functions/v1/office-api/tools/no_such_tool_x", {
      method: "POST",
      headers: { authorization: "Bearer tok", "x-real-ip": "203.0.113.9" },
    }),
  );
  assertEquals(res.status, 404);
  assertEquals(limits.unauth.peek("203.0.113.9"), 19);
  const pub = (ip: string) =>
    handle(new Request("https://x.test/functions/v1/office-api/public/privacy", { headers: { "x-real-ip": ip } }));
  // No settings behind the fake db: a 500 is "answered"; the 61st is refused before it is tried.
  for (let i = 0; i < 60; i++) assertEquals((await pub("192.0.2.1")).status, 500);
  assertEquals((await pub("192.0.2.1")).status, 429);
});

Deno.test("Round 49: the set-password link's public routes: opening checks and never uses; only the save uses; no session asked", async () => {
  const calls: string[] = [];
  const t = { now: 0 };
  const limits: Limits = {
    general: new TokenBuckets({ capacity: 120 }, () => t.now),
    paid: new TokenBuckets({ capacity: 30 }, () => t.now),
    search: new TokenBuckets({ capacity: 90 }, () => t.now),
    unauth: new TokenBuckets({ capacity: 20 }, () => t.now),
    pub: new TokenBuckets({ capacity: 60 }, () => t.now),
  };
  let asked = 0;
  const handle = createHandler({
    db: {} as Db,
    resolvePerson: () => {
      asked += 1;
      return Promise.resolve({ ok: false, status: 401, error: "not_signed_in" });
    },
    mfaRoles: [],
    allowedOrigins: () => ["https://fame-fleet.pages.dev"],
    limits,
    passwordLinks: {
      check: (_db, token) => {
        calls.push(`check ${token}`);
        return Promise.resolve(token === "good" ? { state: "valid", name: "Shashen", email: "s@x.test" } : { state: "used" });
      },
      use: (_db, token, password) => {
        calls.push(`use ${token}`);
        if (token === "used") return Promise.resolve({ ok: false, state: "used" });
        if (password === "short") return Promise.resolve({ ok: false, error: "too_short", message: "Use at least 6 characters." });
        if (password === "weak password!") return Promise.resolve({ ok: false, error: "refused", message: "Password is too weak" });
        return Promise.resolve({ ok: true, email: "s@x.test" });
      },
    },
  });
  const send = (path: string, body: unknown, ip = "198.51.100.7") =>
    handle(
      new Request(`https://x.test/functions/v1/office-api/public/${path}`, {
        method: "POST",
        headers: { "x-real-ip": ip, "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  // Opened three times (a preview, the person, a second tap): three checks, nothing used.
  for (let i = 0; i < 3; i++) {
    const res = await send("password-link", { token: "good" });
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("cache-control"), "no-store");
    assertEquals(await res.json(), { state: "valid", name: "Shashen", email: "s@x.test" });
  }
  assertEquals(calls, ["check good", "check good", "check good"]);
  assertEquals(await (await send("password-link", { token: "old" })).json(), { state: "used" });
  // The save: 200 with the e-mail (the page signs in with it); 409 with the state; 400 the rule; 422 Auth's refusal.
  const ok = await send("password-link/set", { token: "good", password: "A long sentence here" });
  assertEquals([ok.status, await ok.json()], [200, { ok: true, email: "s@x.test" }]);
  const used = await send("password-link/set", { token: "used", password: "A long sentence here" });
  assertEquals([used.status, await used.json()], [409, { ok: false, state: "used" }]);
  assertEquals((await send("password-link/set", { token: "good", password: "short" })).status, 400);
  assertEquals((await send("password-link/set", { token: "good", password: "weak password!" })).status, 422);
  assertEquals((await send("password-link", "not json")).status, 400);
  assertEquals(asked, 0, "no session is asked for: these answers are public");
  // 60 a minute per address, shared with the privacy page.
  for (let i = 0; i < 60; i++) await send("password-link", { token: "x" }, "192.0.2.50");
  assertEquals((await send("password-link", { token: "x" }, "192.0.2.50")).status, 429);
});
