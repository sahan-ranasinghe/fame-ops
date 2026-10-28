// Round 4–7, item 9 (Sahan, 22 October 2026): data retention (Slack / Google Workspace / Samsara retention policies). The
// nightly job (fleet-jobs "retention", pg_cron 02:45 Colombo) and the admin's Run now (run_retention) both call runRetention:
// every rule removes what is older than its period in batches (retention_batch: only its tables; location points only for a
// day that has its summary), one activity-log row says what went, then a couple of driver-days are summarised. The day
// summaries are mostly made by their own job (fleet-jobs "summaries", every 15 minutes, a few days a run: an Edge Function
// has about 2 s of CPU and one busy day costs a few hundred ms), so the rules never wait behind a backlog. A preview (dry)
// only counts. Business records are never removed; the list is said in NEVER for the page and Claude.

import { type Db, fetchAll, unwrap } from "./db.ts";
import { buildRoute, type RouteFix } from "./route.ts";
import { loadSettings, type Retention } from "./settings.ts";
import { colomboDate, dayRange } from "./time.ts";

export interface Rule {
  key: string;
  /** "read notifications" (the activity-log line and the page). */
  what: string;
  period: keyof Retention;
}

/** The order the job runs them (events before their issues). */
export const RULES: readonly Rule[] = [
  { key: "inbox_read", what: "read notifications", period: "inbox_read_days" },
  { key: "inbox_unread", what: "unread notifications", period: "inbox_unread_days" },
  { key: "delivery", what: "notification delivery records", period: "delivery_days" },
  { key: "push_log", what: "driver push records", period: "delivery_days" },
  { key: "audit_routine", what: "routine activity-log entries", period: "audit_routine_days" },
  { key: "audit_changes", what: "activity-log changes", period: "audit_changes_days" },
  { key: "issue_events", what: "resolved issues' history", period: "issues_resolved_days" },
  { key: "issues_resolved", what: "resolved or dismissed issues", period: "issues_resolved_days" },
  { key: "location_points", what: "location points (each day kept as a summary)", period: "location_days" },
  { key: "route_matched", what: "road-snapped route lines (OSRM; Google's are never stored)", period: "location_days" },
  { key: "heartbeats", what: "phone heartbeats", period: "heartbeats_days" },
  { key: "google_calls", what: "Google usage counters", period: "counters_days" },
  { key: "routing_calls", what: "routing usage counters", period: "counters_days" },
  { key: "api_minute_calls", what: "map search counters", period: "counters_days" },
  { key: "app_errors", what: "app errors", period: "app_errors_days" },
];

/** Never removed automatically (the page and Claude say so). */
export const NEVER = [
  "tasks and their stops",
  "requests",
  "odometer and fuel logs and their photos",
  "vehicle reports",
  "vehicle documents",
  "employees",
  "vehicles",
  "places",
  "projects",
  "duty sessions (attendance)",
] as const;

const BATCH = 5000;
/** Driver-days a summaries run makes at most, and the wall time it may spend (the CPU limit is the real bound). */
export const SUMMARY_DAYS = 3;
const SUMMARY_BUDGET_MS = 25_000;

export interface RuleCount {
  key: string;
  what: string;
  days: number;
  /** Older than this Colombo day (the first day kept). */
  before: string;
  count: number;
}

/** "Removed 312 read notifications older than 30 days; 4,210 location points older than 183 days". Pure. */
export function runLine(counts: readonly RuleCount[]): string {
  const done = counts.filter((c) => c.count > 0);
  if (!done.length) return "Nothing was old enough to remove";
  return "Removed " + done.map((c) => `${c.count.toLocaleString("en-US")} ${c.what} older than ${c.days} days`).join("; ");
}

/** A driver's day as its summary, from its points and heartbeats (the same rules as driver_route). */
export async function summariseDay(db: Db, employeeId: string, day: string): Promise<boolean> {
  const span = dayRange(day);
  const rows = await fetchAll(
    (a, b) =>
      db.from("location_points").select("recorded_at, lat, lng, speed_mps, accuracy_m, received_at").eq("employee_id", employeeId)
        .gte("recorded_at", span.from).lt("recorded_at", span.to).order("recorded_at").range(a, b),
    "location points",
    40000,
  );
  if (!rows.length) {
    // On duty with no point stored (the phone off, no signal all day): an empty summary, so the day is not asked again.
    unwrap(
      await db.from("driver_day_summaries").upsert({ employee_id: employeeId, day, points: 0, computed_at: new Date().toISOString() }, {
        onConflict: "employee_id,day",
      }),
      "day summary",
    );
    return false;
  }
  const beats = await fetchAll(
    (a, b) => db.from("driver_heartbeats").select("at").eq("employee_id", employeeId).gte("at", span.from).lt("at", span.to).range(a, b),
    "heartbeats",
    5000,
  );
  const fixes: RouteFix[] = rows.map((r) => ({
    at: new Date(r.recorded_at).getTime(),
    lat: r.lat,
    lng: r.lng,
    speedMps: r.speed_mps,
    accuracyM: r.accuracy_m,
    receivedAt: r.received_at ? new Date(r.received_at).getTime() : null,
  }));
  const route = buildRoute(fixes, { heartbeats: beats.map((b) => new Date(b.at).getTime()) });
  unwrap(
    await db.from("driver_day_summaries").upsert({
      employee_id: employeeId,
      day,
      km: route.km,
      driving_min: Math.round(route.drivingMinutes),
      stopped_min: Math.round(route.stoppedMinutes),
      stops: route.stopsCount,
      first_at: route.firstAt ? new Date(route.firstAt).toISOString() : null,
      last_at: route.lastAt ? new Date(route.lastAt).toISOString() : null,
      points: rows.length,
      computed_at: new Date().toISOString(),
    }, { onConflict: "employee_id,day" }),
    "day summary",
  );
  return true;
}

/**
 * A few driver-days kept as summaries (days_without_summary: yesterday first, then the oldest, the next to lose its points;
 * a recent day once more after 03:00 for late uploads), stopping at `maxDays` or the time budget. Returns how many days had
 * points.
 */
export async function summariseSome(db: Db, now: Date, maxDays = SUMMARY_DAYS, budgetMs = SUMMARY_BUDGET_MS): Promise<number> {
  const started = Date.now();
  const { data, error } = await db.rpc("days_without_summary", { p_now: now.toISOString(), p_limit: maxDays });
  if (error) throw new Error(`days without a summary: ${error.message}`);
  let done = 0;
  for (const d of (data ?? []) as { employee_id: string; day: string }[]) {
    if (Date.now() - started > budgetMs) break;
    if (await summariseDay(db, d.employee_id, d.day)) done += 1;
  }
  return done;
}

export interface RetentionRun {
  dry: boolean;
  counts: RuleCount[];
  summarised: number;
  line: string;
}

/**
 * One run: each rule in batches, the one activity-log row, then a couple of driver-days summarised (never on a preview).
 * `routine`: the activity log's routine tools (reads and routine writes). `by`: who ran it ("System" at night, the admin
 * for Run now).
 */
export async function runRetention(
  db: Db,
  now: Date,
  opts: { dry: boolean; routine: readonly string[]; by: string; byEmployee?: string | null },
): Promise<RetentionRun> {
  const settings = await loadSettings(db);
  const counts: RuleCount[] = [];
  for (const rule of RULES) {
    const days = settings.retention[rule.period];
    const before = new Date(now.getTime() - days * 86400_000);
    let count = 0;
    if (opts.dry) {
      const { data, error } = await db.rpc("retention_batch", {
        p_rule: rule.key,
        p_before: before.toISOString(),
        p_limit: BATCH,
        p_dry: true,
        p_tools: [...opts.routine],
      });
      if (error) throw new Error(`retention ${rule.key}: ${error.message}`);
      count = data ?? 0;
    } else {
      for (;;) {
        const { data, error } = await db.rpc("retention_batch", {
          p_rule: rule.key,
          p_before: before.toISOString(),
          p_limit: BATCH,
          p_dry: false,
          p_tools: [...opts.routine],
        });
        if (error) throw new Error(`retention ${rule.key}: ${error.message}`);
        count += data ?? 0;
        if ((data ?? 0) < BATCH) break;
      }
    }
    counts.push({ key: rule.key, what: rule.what, days, before: colomboDate(before), count });
  }
  const line = runLine(counts);
  if (!opts.dry) {
    unwrap(
      await db.from("office_audit").insert({
        tool: "retention",
        args_summary: JSON.stringify(Object.fromEntries(counts.map((c) => [c.key, c.count]))),
        result_summary: line,
        actor_employee_id: opts.byEmployee ?? null,
        actor_name: opts.by,
        channel: opts.byEmployee ? "web" : "system",
      }),
      "activity log",
    );
  }
  // After the rules, so they never wait behind the summaries' backlog (their own job does most of them).
  const summarised = opts.dry ? 0 : await summariseSome(db, now, 2, 10_000);
  return { dry: opts.dry, counts, summarised, line };
}
