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
