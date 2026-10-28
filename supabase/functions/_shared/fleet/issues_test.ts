// The reconcile step of the issues centre (docs/dispatch-plan.md, section 8), pure.
import { assertEquals } from "@std/assert";
import {
  type ActiveRow,
  dueText,
  mapAlarms,
  reconcile,
  scopeOf,
  syncIsFresh,
  usageCapIssues,
  type UsageCounter,
  usageCounters,
  type Wanted,
} from "./issues.ts";
import type { Db } from "./db.ts";
import { SETTINGS_DEFAULTS } from "./settings.ts";

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

// ---- Round 48 (item 6a): a counter near its cap opens one warning issue per feature, period and day ----

const counter = (over: Partial<UsageCounter> = {}): UsageCounter => ({
  feature: "google_routes",
  text: "Google routes",
  period: "day",
  used: 177,
  cap: 215,
  at_cap: "the open package's road times are used",
  ...over,
});

Deno.test("Round 48: at 82 % of today's cap one warning opens, with the numbers; under 80 % nothing; a cap of 0 never", () => {
  const w = usageCapIssues([counter()], "2026-10-28");
  assertEquals(w.length, 1);
  assertEquals(w[0].kind, "usage_cap");
  assertEquals(w[0].ref_key, "usage:google_routes:day:2026-10-28");
  assertEquals(w[0].severity, "warning");
  assertEquals(w[0].title, "Google routes at 82% of today's cap");
  assertEquals(w[0].detail, "177 of 215 calls today · at the cap the open package's road times are used until tomorrow (Settings → Fleet)");
  assertEquals(w[0].due, "today");
  assertEquals(usageCapIssues([counter({ used: 171 })], "2026-10-28"), [], "79 %: nothing");
  assertEquals(usageCapIssues([counter({ used: 172 })], "2026-10-28").length, 1, "80 %: the warning");
  assertEquals(usageCapIssues([counter({ cap: 0, used: 5 })], "2026-10-28"), [], "a cap of 0 (the feature is off) is never an issue");
  assertEquals(usageCapIssues([counter({ used: 0 })], "2026-10-28"), []);
});

Deno.test("Round 48: at 100 % it is critical; the month's cap has its own key and words", () => {
  const [day] = usageCapIssues([counter({ used: 215 })], "2026-10-28");
  assertEquals([day.severity, day.title, day.sort_key], ["critical", "Google routes at 100% of today's cap", -1]);
  const [month] = usageCapIssues([counter({ period: "month", used: 4040, cap: 4750 })], "2026-10-28");
  assertEquals([month.ref_key, month.title, month.due], [
    "usage:google_routes:month:2026-10",
    "Google routes at 85% of the month's cap",
    "this month",
  ]);
  assertEquals(
    month.detail,
    "4,040 of 4,750 calls this month · at the cap the open package's road times are used until the 1st (Settings → Fleet)",
  );
  const ors = usageCapIssues([
    counter({ feature: "ors_directions", text: "openrouteservice directions", used: 1615, cap: 1900, at_cap: "the legs are estimated" }),
  ], "2026-10-28");
  assertEquals(ors[0].title, "openrouteservice directions at 85% of today's cap");
});

Deno.test("Round 48: a second sync updates the same issue in place as the number grows; the next day resolves it", () => {
  const first = usageCapIssues([counter({ used: 177 })], "2026-10-28");
  const opened = reconcile([], first);
  assertEquals(opened.open.length, 1);
  const active = [
    row({
      ref_key: first[0].ref_key,
      kind: "usage_cap",
      severity: "warning",
      title: first[0].title,
      detail: first[0].detail,
      due: "today",
      sort_key: 0,
    }),
  ];
  const grown = reconcile(active, usageCapIssues([counter({ used: 215 })], "2026-10-28"));
  assertEquals([grown.open.length, grown.update.length, grown.resolve.length], [0, 1, 0]);
  assertEquals(grown.update[0].patch.severity, "critical");
  assertEquals(grown.update[0].patch.title, "Google routes at 100% of today's cap");
  const nextDay = reconcile(active, usageCapIssues([counter({ used: 3 })], "2026-10-29"));
  assertEquals([nextDay.open, nextDay.resolve.map((r) => r.ref_key)], [[], ["usage:google_routes:day:2026-10-28"]]);
  // Two counters near their caps are two issues (one per feature and period), never one.
  const two = usageCapIssues([counter(), counter({ period: "month", used: 4000, cap: 4750 })], "2026-10-28");
  assertEquals(two.map((w) => w.ref_key), ["usage:google_routes:day:2026-10-28", "usage:google_routes:month:2026-10"]);
});

Deno.test("Round 48: the counters are read from the three tables; a table that cannot be read is skipped, never the sync stopped", async () => {
  const tables: Record<string, { data: unknown[] | null; error: { message: string } | null }> = {
    google_calls: {
      data: [
        { feature: "routes", day: "2026-10-28", calls: 180 },
        { feature: "routes", day: "2026-10-27", calls: 200 },
        { feature: "map_loads", day: "2026-10-28", calls: 1 },
      ],
      error: null,
    },
    routing_calls: {
      data: [{ provider: "ors", calls: 1500 }, { provider: "ors_gap", calls: 250 }, { provider: "ors_autocomplete", calls: 10 }],
      error: null,
    },
    odometer_calls: { data: [{ mode: "server", scope: "server", calls: 410 }, { mode: "driver", scope: "e1", calls: 50 }], error: null },
    // Round 48 snap hotfix: a driver's day at its Roads budget (20) is an info issue; one under it is nothing.
    roads_day_calls: { data: [{ employee_id: "e1", calls: 20 }, { employee_id: "e2", calls: 3 }], error: null },
  };
  const chain = (table: string) => {
    const q = {
      select: () => q,
      gte: () => q,
      lte: () => q,
      eq: () => q,
      then: (r: (v: unknown) => unknown) => Promise.resolve(tables[table]).then(r),
    };
    return q;
  };
  const db = { from: chain } as unknown as Db;
  const settings = {
    google_caps: SETTINGS_DEFAULTS.google_caps,
    ors_gap_daily_cap: 300,
    ors_autocomplete_daily_cap: 2500,
    odometer_server_daily_cap: 500, roads_trip_daily_cap: 20,
  };
  const all = await usageCounters(db, settings, "2026-10-28", (id) => (id === "e1" ? "Kamal Perera" : null));
  const by = (f: string, p: string) => all.find((c) => c.feature === f && c.period === p)!;
  assertEquals([by("google_routes", "day").used, by("google_routes", "day").cap], [180, 215]);
  assertEquals([by("google_routes", "month").used, by("google_routes", "month").cap], [380, 4750]);
  assertEquals([by("ors_directions", "day").used, by("ors_directions", "day").cap], [1750, 1900]);
  assertEquals([by("ors_gap", "day").used, by("ors_autocomplete", "day").used], [250, 10]);
  assertEquals([by("odometer_server", "day").used, by("odometer_server", "day").cap], [410, 500]);
  assertEquals([by("odometer_driver:e1", "day").text, by("odometer_driver:e1", "day").cap, by("odometer_driver:e1", "day").employee_id], [
    "Odometer reads by Kamal Perera",
    60,
    "e1",
  ]);
  const issues = usageCapIssues(all, "2026-10-28");
  assertEquals(issues.map((w) => w.title).sort(), [
    "Google routes at 83% of today's cap",
    "Odometer checks (server) at 82% of today's cap",
    "Odometer reads by Kamal Perera at 83% of today's cap",
    "Snap to roads for Kamal Perera paused today: 20 of 20 calls",
    "openrouteservice directions at 92% of today's cap",
    "openrouteservice estimated lines at 83% of today's cap",
  ]);
  assertEquals(issues.find((w) => w.ref_key.startsWith("usage:odometer_driver:e1"))?.employee_id, "e1");
  // Round 48 snap hotfix: a driver's Roads budget is an info issue at the cap only (e2 at 3 of 20: nothing).
  const budget = issues.find((w) => w.ref_key.startsWith("usage:roads_trip:e1"));
  assertEquals([budget?.severity, budget?.employee_id], ["info", "e1"]);
  assertEquals(issues.some((w) => w.ref_key.startsWith("usage:roads_trip:e2")), false);
  // odometer_calls missing (a deploy ahead of its migration): the other counters still come.
  tables.odometer_calls = { data: null, error: { message: "relation does not exist" } };
  const some = await usageCounters(db, settings, "2026-10-28");
  assertEquals([some.some((c) => c.feature.startsWith("odometer")), some.some((c) => c.feature === "ors_directions")], [false, true]);
});
