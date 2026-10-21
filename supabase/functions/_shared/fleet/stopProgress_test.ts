import { assertEquals } from "jsr:@std/assert";
import { deltaKind, type ProgressStopIn, stopProgress } from "./stopProgress.ts";

const at = (hhmm: string) => `2026-10-21T${hhmm}:00+05:30`;
const utc = (hhmm: string) => new Date(at(hhmm)).toISOString();
const stop = (seq: number, pa: string, pd: string, extra: Partial<ProgressStopIn> = {}): ProgressStopIn => ({
  id: `s${seq}`,
  seq,
  status: "pending",
  planned_arrive_at: at(pa),
  planned_depart_at: at(pd),
  arrived_at: null,
  done_at: null,
  ...extra,
});

Deno.test("nothing confirmed: the plan only, no estimate; the first stop is current", () => {
  const p = stopProgress([stop(1, "09:00", "09:05"), stop(2, "10:30", "11:30")], new Date(at("08:00")));
  assertEquals(p.map((x) => x.estimate), [null, null]);
  assertEquals(p.map((x) => x.current), [true, false]);
});

Deno.test("arrived 22 min late: the delta, and the next stops move by the planner's own leg times", () => {
  const stops = [
    stop(1, "09:00", "09:05", { status: "done", arrived_at: at("09:00"), done_at: at("09:05") }),
    stop(2, "10:30", "11:30", { status: "arrived", arrived_at: at("10:52") }),
    stop(3, "12:00", "12:10"),
  ];
  const p = stopProgress(stops, new Date(at("10:55")));
  assertEquals(p[1].arrive_delta_min, 22);
  // Still there: arrived 10:52 + the planned hour = 11:52; the leg to stop 3 was planned 30 min → 12:22, stay 10 → 12:32.
  assertEquals(p[2].estimate, { arrive: utc("12:22"), leave: utc("12:32"), updated: at("10:52") });
  assertEquals(p.map((x) => x.current), [false, true, false]);
});

Deno.test("left: the leave time is the anchor; a skipped stop is passed over", () => {
  const stops = [
    stop(1, "09:00", "10:00", { status: "done", arrived_at: at("09:10"), done_at: at("10:20") }),
    stop(2, "10:30", "10:40", { status: "skipped" }),
    stop(3, "11:00", "11:30"),
  ];
  const p = stopProgress(stops, new Date(at("10:21")));
  assertEquals(p[0].leave_delta_min, 20);
  // From 10:20 with the leg planned from 10:00 (stop 1's planned leave) to 11:00: 60 min → 11:20, stay 30 → 11:50.
  assertEquals(p[2].estimate, { arrive: utc("11:20"), leave: utc("11:50"), updated: at("10:20") });
  assertEquals(p[1].estimate, null);
  assertEquals(p[2].current, true);
});

Deno.test("still there past the planned stay: now is the leave time", () => {
  const stops = [stop(1, "09:00", "09:10", { status: "arrived", arrived_at: at("09:00") }), stop(2, "09:40", "09:50")];
  const p = stopProgress(stops, new Date(at("09:30")));
  assertEquals(p[1].estimate?.arrive, utc("10:00"));
});

Deno.test("removed stops are left out; no planned times: no estimate", () => {
  const stops = [
    stop(1, "09:00", "09:05", { status: "done", done_at: at("09:05"), arrived_at: at("09:01") }),
    { ...stop(2, "09:30", "09:40"), status: "removed" },
    { ...stop(3, "10:00", "10:05"), planned_arrive_at: null },
  ];
  const p = stopProgress(stops, new Date(at("09:06")));
  assertEquals(p.length, 2);
  assertEquals(p[1].estimate, null);
});

Deno.test("the delta in words: late, early, on time within 2 minutes", () => {
  assertEquals(deltaKind(22), { kind: "late", min: 22 });
  assertEquals(deltaKind(-8), { kind: "early", min: 8 });
  assertEquals(deltaKind(2), { kind: "on_time", min: 0 });
  assertEquals(deltaKind(null), null);
});
