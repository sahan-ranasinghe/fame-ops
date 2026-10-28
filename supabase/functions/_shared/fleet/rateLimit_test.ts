// The token buckets (Round 48, item 6b): a burst of capacity, then one a (60 / capacity) seconds; the clock injected;
// the map bounded; the one sentence; the address the platform adds.
import { assert, assertEquals } from "@std/assert";
import { clientIp, PAID_TOOLS, RATE_LIMITED, rateLimitedResponse, TokenBuckets } from "./rateLimit.ts";

function clock(start = 0) {
  const t = { now: start };
  return { t, now: () => t.now };
}

Deno.test("a key gets capacity calls at once, then none until the minute refills them", () => {
  const { t, now } = clock();
  const b = new TokenBuckets({ capacity: 3 }, now);
  assertEquals([b.take("a"), b.take("a"), b.take("a"), b.take("a")], [true, true, true, false]);
  assertEquals(b.peek("a"), 0);
  t.now += 20_000; // a third of a minute: one token back
  assertEquals([b.take("a"), b.take("a")], [true, false]);
  t.now += 60_000;
  assertEquals(b.peek("a"), 3, "never above the capacity");
  assertEquals(b.take("b"), true, "another key is untouched");
});

Deno.test("has looks without taking; charge takes after the fact and never goes below zero", () => {
  const b = new TokenBuckets({ capacity: 2 }, clock().now);
  assert(b.has("ip"));
  b.charge("ip");
  b.charge("ip");
  b.charge("ip");
  assertEquals([b.has("ip"), b.peek("ip")], [false, 0]);
});

Deno.test("the map is bounded: the quiet (full) keys are forgotten first, then the oldest", () => {
  const { t, now } = clock(1);
  const b = new TokenBuckets({ capacity: 2, maxKeys: 3 }, now);
  b.take("busy"); // one token spent: not full
  b.take("quiet-1");
  t.now += 60_000; // quiet-1 is full again
  b.take("quiet-2");
  t.now += 60_000;
  b.take("new"); // the fourth key: quiet-1 and quiet-2 are full (forgotten), busy is too by now
  assert(b.size <= 3);
  // A flood of addresses in the same instant: nothing is full, the oldest goes.
  const c = new TokenBuckets({ capacity: 1, maxKeys: 2 }, clock().now);
  c.take("first");
  c.take("second");
  c.take("third");
  assertEquals(c.size, 2);
  assertEquals(c.has("first"), true, "first was forgotten and starts fresh");
});

Deno.test("the 429 answer carries the one sentence and Retry-After; the paid tools are the ones that can cost", async () => {
  const res = rateLimitedResponse({ "access-control-allow-origin": "https://x" });
  assertEquals(res.status, 429);
  assertEquals(res.headers.get("retry-after"), "60");
  assertEquals(res.headers.get("access-control-allow-origin"), "https://x");
  assertEquals(await res.json(), { error: "rate_limited", code: "rate_limited", message: "Too many requests · try again in a minute" });
  assertEquals(RATE_LIMITED.message, "Too many requests · try again in a minute");
  for (const t of ["search_places", "google_place", "plan_task", "create_task", "driver_route", "register_map_load"]) {
    assert(PAID_TOOLS.has(t), t);
  }
  // task_detail's one Google call (a running task's ETA) is cached 15 minutes: the general limit covers it.
  assert(!PAID_TOOLS.has("live_drivers") && !PAID_TOOLS.has("list_vehicles") && !PAID_TOOLS.has("task_detail"));
});

Deno.test("the caller's address: x-real-ip, else the last x-forwarded-for entry, else unknown", () => {
  assertEquals(clientIp(new Headers({ "x-real-ip": " 203.0.113.9 ", "x-forwarded-for": "1.1.1.1, 2.2.2.2" })), "203.0.113.9");
  assertEquals(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" })), "2.2.2.2");
  assertEquals(clientIp(new Headers()), "unknown");
});
