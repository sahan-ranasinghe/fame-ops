// driver-api's door (Round 48, item 6b): the per-address bucket before Auth, the general and the paid buckets per driver,
// the one 429 sentence. The handler runs with a fake driver resolver, fake work and a clock of its own.
import { assertEquals } from "@std/assert";
import type { Db } from "../_shared/fleet/db.ts";
import { TokenBuckets } from "../_shared/fleet/rateLimit.ts";
import { createHandler, type DriverRow, type Limits, type ResolvedDriver } from "./handler.ts";

const ROW = { id: "d1", name: "Kamal", role: "driver", active: true } as unknown as DriverRow;
const DRIVER = {
  row: ROW,
  actor: { employeeId: "d1", name: "Kamal", role: "driver" as const, permissions: [], authUserId: "u1", channel: "driver" as const },
};

function setup() {
  const t = { now: 0 };
  const clock = () => t.now;
  const limits: Limits = {
    general: new TokenBuckets({ capacity: 60 }, clock),
    paid: new TokenBuckets({ capacity: 30 }, clock),
    unauth: new TokenBuckets({ capacity: 20 }, clock),
  };
  const auth = { asked: 0 };
  const searched = { n: 0 };
  const resolveDriver = (request: Request): Promise<ResolvedDriver> => {
    auth.asked += 1;
    if (!request.headers.get("authorization")) return Promise.resolve({ ok: false, status: 401, error: "not_signed_in" });
    return Promise.resolve({ ok: true, driver: DRIVER });
  };
  const handle = createHandler({
    db: {} as Db,
    resolveDriver,
    limits,
    work: {
      // deno-lint-ignore require-await
      searchPlaces: async () => {
        searched.n += 1;
        return { result: { results: [], text: "" } } as never;
      },
      // deno-lint-ignore require-await
      saveAppError: async () => {},
    },
  });
  const post = (path: string, opts: { token?: string; ip?: string } = { token: "tok" }, body: unknown = { text: "Kandy" }) =>
    handle(
      new Request(`https://x.test/functions/v1/driver-api${path}`, {
        method: "POST",
        headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), "x-real-ip": opts.ip ?? "203.0.113.9" },
        body: JSON.stringify(body),
      }),
    );
  return { t, limits, auth, searched, handle, post };
}

Deno.test("an address refused 20 times a minute is answered 429 before Supabase Auth is asked", async () => {
  const { auth, post, t } = setup();
  for (let i = 0; i < 20; i++) assertEquals((await post("/places/search", { ip: "198.51.100.7" })).status, 401);
  assertEquals(auth.asked, 20);
  const refused = await post("/places/search", { ip: "198.51.100.7" });
  assertEquals(refused.status, 429);
  assertEquals(await refused.json(), { error: "rate_limited", code: "rate_limited", message: "Too many requests · try again in a minute" });
  assertEquals(auth.asked, 20, "the 21st never reached Auth");
  t.now += 60_000;
  assertEquals((await post("/places/search", { ip: "198.51.100.7" })).status, 401);
});

Deno.test("a driver's place search: 30 a minute, the 31st is 429 with the sentence and never searched; /errors goes on under the general 60", async () => {
  const { post, searched, t } = setup();
  for (let i = 0; i < 30; i++) assertEquals((await post("/places/search")).status, 200);
  const refused = await post("/places/search");
  assertEquals([refused.status, ((await refused.json()) as { message: string }).message], [
    429,
    "Too many requests · try again in a minute",
  ]);
  assertEquals(searched.n, 30);
  assertEquals(
    (await post("/errors", { token: "tok" }, { message: "boom", side: "driver" })).status,
    200,
    "a route that costs nothing still answers",
  );
  t.now += 2_000;
  assertEquals((await post("/places/search")).status, 200);
});

Deno.test("the general limit: 60 calls a minute per driver, then 429; an unknown path after sign-in charges the address", async () => {
  const { post, limits } = setup();
  for (let i = 0; i < 60; i++) assertEquals((await post("/errors", { token: "tok" }, { message: "x", side: "driver" })).status, 200);
  assertEquals((await post("/errors", { token: "tok" }, { message: "x", side: "driver" })).status, 429);
  assertEquals(limits.unauth.peek("203.0.113.9"), 20);
  const { post: p2, limits: l2 } = setup();
  assertEquals((await p2("/nowhere")).status, 404);
  assertEquals(l2.unauth.peek("203.0.113.9"), 19);
});
