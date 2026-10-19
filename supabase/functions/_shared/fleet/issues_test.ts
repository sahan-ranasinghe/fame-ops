// The reconcile step of the issues centre (docs/dispatch-plan.md, section 8), pure.
import { assertEquals } from "@std/assert";
import { type ActiveRow, dueText, mapAlarms, reconcile, scopeOf, syncIsFresh, type Wanted } from "./issues.ts";

const row = (over: Partial<ActiveRow> & { ref_key: string }): ActiveRow => ({
  id: `id-${over.ref_key}`,
  kind: "document",
  status: "open",
  severity: "warning",
  title: "Revenue licence expires",
  detail: "WP CAB-4521",
  due: "in 5 days",
  sort_key: 5,
  ...over,
});
const want = (over: Partial<Wanted> & { ref_key: string }): Wanted => ({
  kind: "document",
  severity: "warning",
  title: "Revenue licence expires",
  detail: "WP CAB-4521",
  due: "in 5 days",
  sort_key: 5,
  ...over,
});

Deno.test("a wanted key with no active row opens; an active one with nothing changed is left alone", () => {
  const plan = reconcile([row({ ref_key: "doc:v1:lic" })], [
    want({ ref_key: "doc:v1:lic" }),
    want({ ref_key: "doc:v1:ins", title: "Insurance expires" }),
  ]);
  assertEquals(plan.open.map((w) => w.ref_key), ["doc:v1:ins"]);
  assertEquals(plan.update, []);
  assertEquals(plan.resolve, []);
});

Deno.test("the same key is never opened twice while it is active, even when wanted twice", () => {
  const plan = reconcile([row({ ref_key: "doc:v1:lic" })], [
    want({ ref_key: "doc:v1:lic" }),
    want({ ref_key: "doc:v1:lic", severity: "critical" }),
  ]);
  assertEquals(plan.open, []);
  assertEquals(plan.update.length, 0);
  const fresh = reconcile([], [want({ ref_key: "doc:v1:lic" }), want({ ref_key: "doc:v1:lic" })]);
  assertEquals(fresh.open.length, 1);
});

Deno.test("a condition that comes back after a resolution opens as a new row (the resolved row is not active)", () => {
  // The resolved row is simply absent from the active set: a new row opens.
  const plan = reconcile([], [want({ ref_key: "service:v1", kind: "service_due" })]);
  assertEquals(plan.open.length, 1);
});

Deno.test("severity, title, detail, due and sort order change in place", () => {
  const plan = reconcile([row({ ref_key: "doc:v1:lic" })], [
    want({ ref_key: "doc:v1:lic", severity: "critical", due: "in 3 days", sort_key: 3 }),
  ]);
  assertEquals(plan.open, []);
  assertEquals(plan.update.length, 1);
  assertEquals(plan.update[0].patch, { severity: "critical", due: "in 3 days", sort_key: 3 });
});

Deno.test("an active row whose condition cleared is resolved", () => {
  const plan = reconcile([row({ ref_key: "doc:v1:lic" }), row({ ref_key: "service:v1", kind: "service_due" })], [
    want({ ref_key: "doc:v1:lic" }),
  ]);
  assertEquals(plan.resolve.map((r) => r.ref_key), ["service:v1"]);
});

Deno.test("odometer flags and km gaps older than a week are kept alive but never opened", () => {
  const old = want({ ref_key: "odometer:l1", kind: "odometer_flag", keep_only: true });
  assertEquals(reconcile([], [old]).open, []);
  const kept = reconcile([row({ ref_key: "odometer:l1", kind: "odometer_flag" })], [old]);
  assertEquals(kept.resolve, []);
  assertEquals(kept.open, []);
});

Deno.test("a key a person dismissed stays quiet until it comes back worse", () => {
  const muted = new Map([["doc:v1:lic", "warning" as const]]);
  assertEquals(reconcile([], [want({ ref_key: "doc:v1:lic" })], muted).open, []);
  assertEquals(reconcile([], [want({ ref_key: "doc:v1:lic", severity: "critical" })], muted).open.length, 1);
  const mutedCritical = new Map([["doc:v1:lic", "critical" as const]]);
  assertEquals(reconcile([], [want({ ref_key: "doc:v1:lic", severity: "critical" })], mutedCritical).open, []);
});

Deno.test("the vehicle report mirror: the issue follows the report's status both ways in the plan", () => {
  // report open -> in_garage: the issue goes in progress
  const toGarage = reconcile(
    [row({ ref_key: "report:r1", kind: "vehicle_report" })],
    [want({ ref_key: "report:r1", kind: "vehicle_report", status: "in_progress", title: "Vehicle problem: breakdown (in garage)" })],
  );
  assertEquals(toGarage.update[0].patch.status, "in_progress");
  // report in_garage -> open again
  const back = reconcile(
    [row({ ref_key: "report:r1", kind: "vehicle_report", status: "in_progress" })],
    [want({ ref_key: "report:r1", kind: "vehicle_report", status: "open" })],
  );
  assertEquals(back.update[0].patch.status, "open");
  // report closed: not wanted any more, the issue resolves
  const closed = reconcile([row({ ref_key: "report:r1", kind: "vehicle_report", status: "in_progress" })], []);
  assertEquals(closed.resolve.length, 1);
  // a non-report issue never has its status touched by the sync
  const plain = reconcile([row({ ref_key: "doc:v1:lic", status: "in_progress" })], [want({ ref_key: "doc:v1:lic" })]);
  assertEquals(plain.update, []);
});

Deno.test("task kinds belong to the dispatcher, the rest to the fleet", () => {
  assertEquals(scopeOf("declined"), "task");
  assertEquals(scopeOf("signal"), "task");
  assertEquals(scopeOf("vehicle_report"), "fleet");
  assertEquals(scopeOf("document"), "fleet");
});

Deno.test("due text", () => {
  assertEquals(dueText(-3, "2026-10-11"), "3 d overdue");
  assertEquals(dueText(0, "2026-10-14"), "today");
  assertEquals(dueText(1, "2026-10-15"), "tomorrow");
  assertEquals(dueText(5, "2026-10-19"), "in 5 days");
  assertEquals(dueText(12, "2026-10-26"), "26 Oct");
});

Deno.test("an overview trusts a full sync that finished under 60 s ago, or one still running since under 60 s", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 14, 8, 0, s)).toISOString();
  const now = new Date(Date.UTC(2026, 9, 14, 8, 1, 0));
  assertEquals(syncIsFresh(null, now), false);
  assertEquals(syncIsFresh({ started_at: at(0), finished_at: at(5) }, now), true, "finished 55 s ago");
  assertEquals(syncIsFresh({ started_at: at(0), finished_at: at(0) }, now), false, "finished 60 s ago");
  assertEquals(syncIsFresh({ started_at: at(30), finished_at: null }, now), true, "running for 30 s");
  assertEquals(syncIsFresh({ started_at: at(0), finished_at: null }, now), false, "a run that never finished, 60 s old");
  assertEquals(syncIsFresh({ started_at: at(50), finished_at: at(0) }, now), true, "a new run started 10 s ago after an old finish");
  assertEquals(syncIsFresh({ started_at: at(50), finished_at: at(0) }, now, 5_000), false, "with a 5 s window nothing is fresh");
});

Deno.test("Part 6: the office hears of a Google map failure only on a second try in a row, or two phones within an hour", () => {
  const now = new Date("2026-10-19T08:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
  const row = (id: string, failures: number, min: number) => ({
    employee_id: id,
    failures,
    last_failed_at: ago(min),
    google_failed_at: ago(min),
  });
  assertEquals(mapAlarms([row("a", 1, 5)], now), [], "one phone, one weak-signal try: nothing");
  assertEquals(mapAlarms([row("a", 2, 300)], now).map((x) => x.why), ["again"], "the same phone failed again on its next try");
  assertEquals(mapAlarms([row("a", 1, 10), row("b", 1, 50)], now).map((x) => `${x.row.employee_id}:${x.why}`), [
    "a:two_phones",
    "b:two_phones",
  ], "two phones within the hour");
  assertEquals(mapAlarms([row("a", 1, 10), row("b", 1, 70)], now), [], "two phones, but not within the hour");
});
