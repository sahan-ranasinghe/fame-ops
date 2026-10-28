// The connector's door (Round 48, item 6b): a wrong key costs the database at most 20 lookups a minute per address (the
// 21st wrong key is 429 before any lookup), 120 calls a minute per key, 30 on the tools that can cost; nothing about the
// key in any answer.
import { assertEquals } from "@std/assert";
import type { Actor } from "../_shared/fleet/index.ts";
import { TokenBuckets } from "../_shared/fleet/rateLimit.ts";
import { gateRequest, type Limits, paidGate } from "./gate.ts";

const SHARED = "0123456789abcdef0123456789abcdef-shared";
const PERSONAL = "pk-0123456789abcdef0123456789abcdef";
const PERSON: Actor = { employeeId: "e1", name: "Dilini", role: "office", permissions: ["view"], channel: "claude" };

function setup() {
  const t = { now: 0 };
  const clock = () => t.now;
  const limits: Limits = {
    keys: new TokenBuckets({ capacity: 120 }, clock),
    paid: new TokenBuckets({ capacity: 30 }, clock),
    unauth: new TokenBuckets({ capacity: 20 }, clock),
  };
  const lookups = { n: 0 };
  const deps = {
    personForKey: (key: string) => {
      lookups.n += 1;
      return Promise.resolve(key === PERSONAL ? PERSON : null);
    },
    sharedKey: SHARED,
    limits,
  };
  const req = (key: string | null, ip = "203.0.113.9") =>
    new Request(`https://x.test/functions/v1/office-mcp/${key ?? ""}${key ? "/mcp" : ""}`, {
      method: "POST",
      headers: { "x-real-ip": ip },
    });
  return { t, limits, lookups, deps, req };
}

Deno.test("a wrong key: 404 after one lookup, 20 times a minute per address; the 21st is 429 with no lookup at all", async () => {
  const { lookups, deps, req, t } = setup();
  for (let i = 0; i < 20; i++) {
    const g = await gateRequest(req(`wrong-${i}-0123456789abcdef0123456789`), deps);
    assertEquals(g.ok, false);
    assertEquals((g as { response: Response }).response.status, 404);
  }
  assertEquals(lookups.n, 20);
  const g = await gateRequest(req("wrong-21-0123456789abcdef0123456789"), deps);
  assertEquals((g as { response: Response }).response.status, 429);
  assertEquals(await (g as { response: Response }).response.json(), {
    error: "rate_limited",
    code: "rate_limited",
    message: "Too many requests · try again in a minute",
  });
  assertEquals(lookups.n, 20, "the database was not asked");
  // Any other path (no key) is a refusal too, and costs no lookup.
  const other = await gateRequest(
    new Request("https://x.test/functions/v1/office-mcp/", { headers: { "x-real-ip": "198.51.100.1" } }),
    deps,
  );
  assertEquals([(other as { response: Response }).response.status, lookups.n], [404, 20]);
  t.now += 60_000;
  assertEquals((await gateRequest(req("wrong-again-0123456789abcdef0123456789"), deps) as { response: Response }).response.status, 404);
});

Deno.test("the right keys pass: the shared key as one caller, a personal key by its hash; 120 a minute each, then 429", async () => {
  const { deps, req, lookups } = setup();
  const shared = await gateRequest(req(SHARED), deps);
  assertEquals(shared.ok, true);
  assertEquals((shared as { actor: Actor; limitKey: string }).limitKey, "shared");
  assertEquals((shared as { actor: Actor }).actor.name, "Office (shared key)");
  const personal = await gateRequest(req(PERSONAL), deps);
  assertEquals(personal.ok, true);
  const limitKey = (personal as { limitKey: string }).limitKey;
  assertEquals(limitKey.startsWith("key:") && !limitKey.includes(PERSONAL), true, "the bucket's key is a hash, never the key");
  assertEquals((personal as { actor: Actor }).actor.name, "Dilini");
  for (let i = 0; i < 119; i++) assertEquals((await gateRequest(req(PERSONAL), deps)).ok, true);
  const over = await gateRequest(req(PERSONAL), deps);
  assertEquals((over as { response: Response }).response.status, 429);
  assertEquals((await gateRequest(req(SHARED), deps)).ok, true, "the shared key's bucket is its own");
  assertEquals(deps.limits.unauth.peek("203.0.113.9"), 20, "a right key never charges the address");
  assertEquals(lookups.n > 0, true);
});

Deno.test("the paid tools: 30 a minute per key as a tool error with the sentence; a free tool and no limits pass", () => {
  const { limits } = setup();
  for (let i = 0; i < 30; i++) assertEquals(paidGate("plan_task", limits, "shared").ok, true);
  assertEquals(paidGate("plan_task", limits, "shared"), { ok: false, text: "Too many requests · try again in a minute" });
  assertEquals(paidGate("task_board", limits, "shared").ok, true);
  assertEquals(paidGate("plan_task", limits, "key:other").ok, true);
  assertEquals(paidGate("plan_task", undefined, "").ok, true);
});
