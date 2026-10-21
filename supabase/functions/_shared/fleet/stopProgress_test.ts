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

Deno.test("Checkpoint 2 review: a skipped stop is never the anchor and never shows as left", () => {
  const stops = [
    stop(1, "09:00", "09:05"),
    stop(2, "10:30", "10:40", { status: "skipped", done_at: at("09:10") }),
    stop(3, "11:00", "11:30"),
  ];
  const p = stopProgress(stops, new Date(at("09:11")));
  assertEquals(p[1].left, null);
  assertEquals(p[1].leave_delta_min, null);
  assertEquals(p[2].estimate, null); // nothing the driver confirmed yet: the plan stands
  assertEquals(p[0].current, true);
});

Deno.test("Checkpoint 2 review: an estimate is never in the past", () => {
  const stops = [
    stop(1, "09:00", "09:10", { status: "done", arrived_at: at("09:00"), done_at: at("10:00") }),
    stop(2, "10:00", "10:20"),
    stop(3, "11:00", "11:10"),
  ];
  // Left at 10:00, the leg planned 50 min → 10:50; at 11:00 it is still to come: about 11:00, then stop 3 from it.
  const p = stopProgress(stops, new Date(at("11:00")));
  assertEquals(p[1].estimate, { arrive: utc("11:00"), leave: utc("11:20"), updated: utc("11:00") });
  assertEquals(p[2].estimate?.arrive, utc("12:00"));
});

Deno.test("Round 2b: a stop confirmed later with no points: visited, no times, never late or early, passed over", () => {
  const stops = [
    stop(1, "09:00", "10:00", { status: "done", arrived_at: at("09:10"), done_at: at("10:20") }),
    stop(2, "10:30", "10:40", { status: "done", confirmed_later_at: at("11:05") }),
    stop(3, "11:00", "11:30"),
  ];
  const p = stopProgress(stops, new Date(at("10:21")));
  assertEquals([p[1].confirmed_later, p[1].time_not_recorded], [true, true]);
  assertEquals([p[1].arrived, p[1].left, p[1].arrive_delta_min, p[1].leave_delta_min, p[1].estimate], [null, null, null, null, null]);
  // Not the anchor: the estimate runs from stop 1's Left (10:20) over the planned legs, as for a skipped stop.
  assertEquals(p[2].estimate, { arrive: utc("11:20"), leave: utc("11:50"), updated: at("10:20") });
  assertEquals(p[2].current, true);
});

Deno.test("Round 2b: a stop confirmed later with the points' times: its difference, marked confirmed later, the anchor", () => {
  const stops = [
    stop(1, "09:00", "10:00", { status: "done", arrived_at: at("09:10"), done_at: at("10:20") }),
    stop(2, "10:30", "10:40", { status: "done", arrived_at: at("10:38"), done_at: at("10:41"), confirmed_later_at: at("11:05") }),
    stop(3, "11:00", "11:30"),
  ];
  const p = stopProgress(stops, new Date(at("10:45")));
  assertEquals([p[1].confirmed_later, p[1].time_not_recorded, p[1].arrive_delta_min], [true, false, 8]);
  // From 10:41 with the leg planned 10:40 → 11:00: 11:01, stay 30 → 11:31.
  assertEquals(p[2].estimate, { arrive: utc("11:01"), leave: utc("11:31"), updated: at("10:41") });
  assertEquals(p[0].confirmed_later, false);
});
