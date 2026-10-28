// The Gemini odometer gate (Round 48, item 6a): counted before the call, refused at the cap and on any counter error.
import { assertEquals } from "@std/assert";
import { gatedOdometerRead, ODOMETER_DRIVER_DAILY_CAP, takeOdometerCall } from "./odometerGate.ts";

type Mode = "ok" | "error" | "throw" | "shape";

/** odometer_take as the database does it (per mode, scope and day), or broken. */
function fakeDb(mode: Mode = "ok") {
  const counts = new Map<string, { calls: number; refused: number }>();
  const state = { rpcs: 0 };
  const db = {
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcs += 1;
      if (name !== "odometer_take") throw new Error(`unexpected rpc ${name}`);
      if (mode === "throw") throw new Error("connection reset");
      if (mode === "error") return Promise.resolve({ data: null, error: { message: "permission denied" } });
      if (mode === "shape") return Promise.resolve({ data: { ok: true }, error: null });
      const key = `${args.p_mode}|${args.p_scope}`;
      const c = counts.get(key) ?? { calls: 0, refused: 0 };
      counts.set(key, c);
      const cap = args.p_day_cap as number;
      if (c.calls >= cap) {
        c.refused += 1;
        return Promise.resolve({ data: { allowed: false, reason: "day", day: c.calls, day_cap: cap }, error: null });
      }
      c.calls += 1;
      return Promise.resolve({ data: { allowed: true, day: c.calls, day_cap: cap }, error: null });
    },
  };
  return { db, counts, state };
}

Deno.test("a driver's 60 reads are allowed, the 61st refused; another driver and the server count apart", async () => {
  const { db, counts } = fakeDb();
  let allowed = 0;
  for (let i = 0; i < 61; i++) if ((await takeOdometerCall(db, "driver", "d1", ODOMETER_DRIVER_DAILY_CAP)).allowed) allowed += 1;
  assertEquals(allowed, 60);
  assertEquals(counts.get("driver|d1"), { calls: 60, refused: 1 });
  assertEquals(await takeOdometerCall(db, "driver", "d1", 60), { allowed: false, reason: "day", day: 60, day_cap: 60 });
  assertEquals((await takeOdometerCall(db, "driver", "d2", 60)).day, 1);
  assertEquals((await takeOdometerCall(db, "server", "server", 500)).day, 1);
});

Deno.test("a counter error refuses the read: an error answer, a throw, an answer of the wrong shape (fail closed)", async () => {
  for (const mode of ["error", "throw", "shape"] as const) {
    const { db, state } = fakeDb(mode);
    assertEquals(await takeOdometerCall(db, "driver", "d1", 60), { allowed: false, reason: "counter" }, mode);
    assertEquals(state.rpcs, 1);
  }
});

Deno.test("the order: the counter first, the model only when allowed; refused or broken, the model is never asked", async () => {
  const { db, state } = fakeDb();
  const order: string[] = [];
  const spy = { rpc: (n: string, a: Record<string, unknown>) => (order.push("count"), db.rpc(n, a)) };
  const read = () => (order.push("model"), Promise.resolve("195061"));
  const r = await gatedOdometerRead(spy, "driver", "d1", 1, read);
  assertEquals([r.ok, order], [true, ["count", "model"]]);
  order.length = 0;
  const refused = await gatedOdometerRead(spy, "driver", "d1", 1, read);
  assertEquals([refused.ok, refused.gate.reason, order], [false, "day", ["count"]]);
  const broken = fakeDb("error");
  let asked = 0;
  const b = await gatedOdometerRead(broken.db, "server", "server", 500, () => (asked++, Promise.resolve("x")));
  assertEquals([b.ok, b.gate.reason, asked, state.rpcs > 0], [false, "counter", 0, true]);
});
