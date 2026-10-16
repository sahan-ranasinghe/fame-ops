// Issues: one row per thing that needs the office's attention (docs/dispatch-plan.md,
// section 8). syncIssues computes the wanted set from the data, opens the missing
// ones, updates the existing ones in place and auto-resolves the ones whose
// condition has cleared. A ref_key is unique while open or in progress, so a
// condition never opens twice; after a resolution the same key may open again.
// The reconcile step is pure (issues_test.ts); the rules read the same helpers
// as the rest of the office tools.

import type { Db, Row } from "./db.ts";
import { notify, officePeople, recipientsFor } from "./notifications.ts";
import { unwrap, unwrapMaybe } from "./db.ts";
import { DECLINE_TEXT } from "./decline.ts";
import { taskEta } from "./eta.ts";
import {
  GAP_ATTENTION_KM,
  loadGaps,
  loadLatest,
  loadRefs,
  monthKm,
  odometerCheck,
  type Refs,
  service,
  statusOf,
  VEHICLE_DOCS,
  vehicleLabel,
} from "./fleet.ts";
import { thousands } from "./format.ts";
import { loadSettings } from "./settings.ts";
import { needsAttention } from "./status.ts";
import { ago, colomboDate, colomboDayTime, colomboTime, daysBetween, shortDate } from "./time.ts";

export type Severity = "info" | "warning" | "critical";
export type IssueStatus = "open" | "in_progress" | "resolved" | "dismissed";
export type IssueRow = Row<"issues">;
export const ACTIVE: IssueStatus[] = ["open", "in_progress"];

/** The kinds about a task (the dispatcher's business, assign_tasks); the rest is the fleet (issues). */
/** The job_runs row of the full sync, and how long an overview trusts the last one. */
export const SYNC_JOB = "issues";
export const SYNC_FRESH_MS = 60_000;

export const TASK_KINDS = new Set([
  "signal",
  "late_start",
  "running_late",
  "not_accepted",
  "declined",
  "vehicle_conflict",
  "arrival_override",
  "completed_early",
  "vehicle_needed",
]);

/** Kinds whose own push already went to a wider group when they happened (Phase 7, §19): no second "critical issue" push. */
export const TOLD_AT_SOURCE = new Set(["declined", "not_accepted", "vehicle_needed"]);
const TOLD_EVENT: Record<string, string> = {
  declined: "task.declined",
  not_accepted: "task.not_accepted",
  vehicle_needed: "task.vehicle_needed",
};
export const scopeOf = (kind: string): "task" | "fleet" => TASK_KINDS.has(kind) ? "task" : "fleet";

export const KIND_TEXT: Record<string, string> = {
  vehicle_report: "Vehicle problem",
  odometer_flag: "Odometer check",
  km_gap: "Km outside tasks",
  service_due: "Service",
  document: "Vehicle document",
  licence: "Driver licence",
  allowance: "Km allowance",
  rental: "Rental agreement",
  garage_booked: "Garage booked",
  signal: "Driver's signal",
  late_start: "Late start",
  running_late: "Running late",
  not_accepted: "Not accepted",
  declined: "Declined",
  request_waiting: "Request waiting",
  vehicle_conflict: "Vehicle taken",
  app_stopped: "App stopped",
  arrival_override: "Arrived away from the stop",
  completed_early: "Completed early",
  vehicle_needed: "Another vehicle needed",
  push_failed: "Push failed",
  routing_failed: "Routing failed",
};

/** A thing that should be an active issue now. */
export interface Wanted {
  kind: string;
  ref_key: string;
  severity: Severity;
  title: string;
  detail: string | null;
  due: string | null;
  /** Sort order on the overview: negative = overdue / urgent, days until due otherwise. */
  sort_key: number;
  vehicle_id?: string | null;
  employee_id?: string | null;
  task_id?: string | null;
  request_id?: string | null;
  vehicle_report_id?: string | null;
  /** The status the row mirrors (a vehicle report in the garage = in progress). Default open. */
  status?: "open" | "in_progress";
  /** Keeps an active row alive but never opens a new one (odometer flags and km gaps after 7 days). */
  keep_only?: boolean;
}

export type ActiveRow = Pick<IssueRow, "id" | "ref_key" | "kind" | "status" | "severity" | "title" | "detail" | "due" | "sort_key">;
export interface Patch {
  severity?: Severity;
  title?: string;
  detail?: string | null;
  due?: string | null;
  sort_key?: number;
  status?: "open" | "in_progress";
}
export interface Plan {
  open: Wanted[];
  update: { row: ActiveRow; patch: Patch }[];
  resolve: ActiveRow[];
}

const RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

/**
 * What to do with the active rows given the wanted set. `muted` holds keys a person
 * resolved or dismissed recently, with the severity they had then: such a key opens
 * again only when it comes back worse (a dismissed "expires in 20 days" returns at 7).
 */
export function reconcile(active: ActiveRow[], wanted: Wanted[], muted: Map<string, Severity> = new Map()): Plan {
  const byKey = new Map(active.map((r) => [r.ref_key, r]));
  const plan: Plan = { open: [], update: [], resolve: [] };
  const seen = new Set<string>();
  for (const w of wanted) {
    if (seen.has(w.ref_key)) continue;
    seen.add(w.ref_key);
    const row = byKey.get(w.ref_key);
    if (!row) {
      if (w.keep_only) continue;
      const mutedAt = muted.get(w.ref_key);
      if (mutedAt !== undefined && RANK[w.severity] <= RANK[mutedAt]) continue;
      plan.open.push(w);
      continue;
    }
    const patch: Patch = {};
    if (row.severity !== w.severity) patch.severity = w.severity;
    if (row.title !== w.title) patch.title = w.title;
    if ((row.detail ?? null) !== (w.detail ?? null)) patch.detail = w.detail ?? null;
    if ((row.due ?? null) !== (w.due ?? null)) patch.due = w.due ?? null;
    if (row.sort_key !== w.sort_key) patch.sort_key = w.sort_key;
    if (w.status && row.status !== w.status) patch.status = w.status;
    if (Object.keys(patch).length > 0) plan.update.push({ row, patch });
  }
  for (const row of active) if (!seen.has(row.ref_key)) plan.resolve.push(row);
  return plan;
}

/** "3 d overdue", "today", "tomorrow", "in 5 days", "18 Oct". */
export function dueText(days: number, date: string): string {
  if (days < 0) return `${-days} d overdue`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return days <= 7 ? `in ${days} days` : shortDate(date);
}

export interface SyncScope {
  task_id?: string;
  vehicle_id?: string;
  report_id?: string;
  request_id?: string;
}

const DOC_KEY: Record<string, string> = { licence_expiry: "lic", insurance_expiry: "ins", emission_expiry: "emi" };
const KEEP_DAYS = 14;
const OPEN_DAYS = 7;
const REQUEST_WAIT_MIN = 30;
const LATE_START_MIN = 10;
/** Phase 7: the app counts as stopped by the phone from 2 stops a day, or with no GPS fix this long while on duty. */
export const APP_STOPS_PER_DAY = 2;
export const NO_FIX_MIN = 30;

const ms = (days: number) => days * 86400000;

/** The wanted set from the data, for everything or for one task / report / request / vehicle. */
export async function computeWanted(db: Db, now: Date, scope: SyncScope = {}): Promise<Wanted[]> {
  const today = colomboDate(now);
  const nowIso = now.toISOString();
  const full = !scope.task_id && !scope.report_id && !scope.request_id && !scope.vehicle_id;
  const fleetScope = full || !!scope.vehicle_id;
  const taskScope = full || !!scope.task_id;
  const reportScope = full || !!scope.report_id || !!scope.vehicle_id;
  const requestScope = full || !!scope.request_id;
  const wanted: Wanted[] = [];

  const [refs, latest, settings] = await Promise.all([loadRefs(db), loadLatest(db), loadSettings(db)]);
  const vehicles = refs.vehicles.filter((v) => v.active && (!scope.vehicle_id || v.id === scope.vehicle_id));
  const vehicleIds = vehicles.map((v) => v.id);
  const soon = (dateText: string | null, within: number) => {
    if (!dateText) return null;
    const days = daysBetween(today, dateText);
    return days <= within ? days : null;
  };

  // --- The fleet: documents, service, km allowance, rental, garage, licences ---------
  if (fleetScope) {
    const km = await monthKm(db, vehicleIds, today.slice(0, 7));
    for (const v of vehicles) {
      const label = vehicleLabel(v) ?? v.reg_no;
      for (const doc of VEHICLE_DOCS) {
        const expiry = v[doc.column];
        const days = soon(expiry, 30);
        if (days === null || !expiry) continue;
        wanted.push({
          kind: "document",
          ref_key: `doc:${v.id}:${DOC_KEY[doc.column] ?? doc.column}`,
          severity: days <= 7 ? "critical" : "warning",
          title: `${doc.name} ${days < 0 ? "expired" : "expires"}`,
          detail: label,
          due: dueText(days, expiry),
          sort_key: days,
          vehicle_id: v.id,
        });
      }
      const svc = service(v, today);
      if (svc.state === "overdue" || svc.state === "due soon") {
        const days = svc.date ? daysBetween(today, svc.date) : 0;
        wanted.push({
          kind: "service_due",
          ref_key: `service:${v.id}`,
          severity: svc.state === "overdue" ? "critical" : "warning",
          title: svc.state === "overdue" ? "Service overdue" : "Service due",
          detail: `${v.reg_no} · ${svc.km_to_go !== null && svc.km_to_go > 0 ? `${thousands(svc.km_to_go)} km to go` : svc.text}`,
          due: svc.state === "overdue" ? "now" : svc.date ? dueText(days, svc.date) : "soon",
          sort_key: svc.state === "overdue" ? -1 : days,
          vehicle_id: v.id,
        });
      }
      const used = km.get(v.id) ?? 0;
      if (v.monthly_km_allowance != null && used > v.monthly_km_allowance) {
        wanted.push({
          kind: "allowance",
          ref_key: `allowance:${v.id}:${today.slice(0, 7)}`,
          severity: "warning",
          title: "Over monthly km allowance",
          detail: `${v.reg_no} · ${thousands(used)} of ${thousands(v.monthly_km_allowance)} km`,
          due: "now",
          sort_key: -1,
          vehicle_id: v.id,
        });
      }
      const rentDays = soon(v.rent_until, 14);
      if (rentDays !== null && v.rent_until) {
        const company = v.rental_company_id ? refs.company.get(v.rental_company_id)?.name : undefined;
        wanted.push({
          kind: "rental",
          ref_key: `rent:${v.id}`,
          severity: rentDays < 0 ? "critical" : "warning",
          title: rentDays < 0 ? "Rental agreement ended" : "Rental agreement ends",
          detail: [v.reg_no, company].filter(Boolean).join(" · "),
          due: dueText(rentDays, v.rent_until),
          sort_key: rentDays,
          vehicle_id: v.id,
        });
      }
      const garageDays = soon(v.garage_booked_date, 14);
      if (garageDays !== null && garageDays >= 0 && v.garage_booked_date) {
        wanted.push({
          kind: "garage_booked",
          ref_key: `garage:${v.id}`,
          severity: "info",
          title: "Garage booked",
          detail: label,
          due: dueText(garageDays, v.garage_booked_date),
          sort_key: garageDays,
          vehicle_id: v.id,
        });
      }
    }
  }
  if (full) {
    for (const e of refs.employees) {
      const days = e.role === "driver" && e.active ? soon(e.licence_expiry, 30) : null;
      if (days === null || !e.licence_expiry) continue;
      wanted.push({
        kind: "licence",
        ref_key: `licence:${e.id}`,
        severity: days <= 7 ? "critical" : "warning",
        title: `Driver licence ${days < 0 ? "expired" : "expires"}`,
        detail: e.name,
        due: dueText(days, e.licence_expiry),
        sort_key: days,
        employee_id: e.id,
      });
    }
  }

  // --- Vehicle problems reported by drivers (the issue mirrors the report) -----------
  if (reportScope) {
    let q = db.from("vehicle_reports").select("*").neq("status", "closed");
    if (scope.report_id) q = q.eq("id", scope.report_id);
    if (scope.vehicle_id) q = q.eq("vehicle_id", scope.vehicle_id);
    for (const r of unwrap(await q, "vehicle reports")) {
      wanted.push({
        kind: "vehicle_report",
        ref_key: `report:${r.id}`,
        severity: r.category === "breakdown" || r.category === "accident" ? "critical" : "warning",
        title: `Vehicle problem: ${r.category.replace("_", " ")}${r.status === "in_garage" ? " (in garage)" : ""}`,
        detail: [refs.veh.get(r.vehicle_id)?.reg_no, refs.emp.get(r.employee_id)?.name, r.note].filter(Boolean).join(" · "),
        due: `reported ${ago(r.created_at, now)} ago`,
        sort_key: -2,
        vehicle_id: r.vehicle_id,
        employee_id: r.employee_id,
        task_id: r.task_id,
        vehicle_report_id: r.id,
        status: r.status === "in_garage" ? "in_progress" : "open",
      });
    }
  }

  // --- Odometer readings flagged, km outside tasks (opened for 7 days, kept 14) ------
  if (fleetScope && vehicleIds.length > 0) {
    const keepFrom = new Date(now.getTime() - ms(KEEP_DAYS)).toISOString();
    const openFrom = now.getTime() - ms(OPEN_DAYS);
    let q = db.from("odometer_logs").select("id, vehicle_id, employee_id, reading_km, ai_value, entry, flag, ai_checked_at, logged_at")
      .not("flag", "is", null).gte("logged_at", keepFrom).in("vehicle_id", vehicleIds);
    if (scope.vehicle_id) q = q.eq("vehicle_id", scope.vehicle_id);
    const [flaggedRes, gaps] = await Promise.all([q, loadGaps(db, vehicleIds, keepFrom, nowIso)]);
    for (const l of unwrap(flaggedRes, "odometer logs")) {
      wanted.push({
        kind: "odometer_flag",
        ref_key: `odometer:${l.id}`,
        severity: "warning",
        title: `Odometer check: ${odometerCheck(l) ?? l.flag}`,
        detail: [
          refs.veh.get(l.vehicle_id)?.reg_no,
          refs.emp.get(l.employee_id)?.name,
          `${thousands(l.reading_km)} km${l.ai_value !== null ? ` (photo ${thousands(l.ai_value)})` : ""}`,
        ].filter(Boolean).join(" · "),
        due: `logged ${ago(l.logged_at, now)} ago`,
        sort_key: -1,
        vehicle_id: l.vehicle_id,
        employee_id: l.employee_id,
        keep_only: new Date(l.logged_at).getTime() < openFrom,
      });
    }
    for (const g of gaps) {
      if (g.km <= GAP_ATTENTION_KM) continue;
      wanted.push({
        kind: "km_gap",
        ref_key: `gap:${g.vehicle_id}:${g.to.id}`,
        severity: "warning",
        title: `Km outside tasks: ${thousands(g.km)} km ${g.type === "overnight" ? "overnight" : "between tasks"}`,
        detail: [
          refs.veh.get(g.vehicle_id)?.reg_no,
          refs.emp.get(g.from.employee_id)?.name,
          `${colomboDayTime(g.from.logged_at)} → ${colomboDayTime(g.to.logged_at)}`,
        ]
          .filter(Boolean).join(" · "),
        due: `ended ${ago(g.to.logged_at, now)} ago`,
        sort_key: -1,
        vehicle_id: g.vehicle_id,
        employee_id: g.from.employee_id,
        keep_only: new Date(g.to.logged_at).getTime() < openFrom,
      });
    }
  }

  // --- Tasks: signal, late start, running late, not accepted, declined ------------------
  if (taskScope) {
    let q = db.from("tasks").select("*").in("status", ["assigned", "in_progress", "declined"]);
    if (scope.task_id) q = q.eq("id", scope.task_id);
    const tasks = unwrap(await q, "tasks");
    const running = tasks.filter((t) => t.status === "in_progress");
    const stops = running.length > 0
      ? unwrap(
        await db.from("task_stops").select("*").in("task_id", running.map((t) => t.id)).neq("status", "removed").order("seq"),
        "stops",
      )
      : [];
    const who = (t: { employee_id: string; title: string }) => [refs.emp.get(t.employee_id)?.name, t.title].filter(Boolean).join(" · ");
    for (const t of running) {
      const pos = latest.get(t.employee_id);
      const { result, fields } = statusOf(pos, now);
      if (needsAttention(result, t.started_at, now)) {
        const from = result.since ?? t.started_at;
        wanted.push({
          kind: "signal",
          ref_key: `signal:${t.id}`,
          severity: result.status === "location_off" ? "critical" : "warning",
          title: result.status === "location_off"
            ? (result.permissionProblem ? "Driver's location permission removed" : "Driver's location is off")
            : "No signal from the driver",
          detail: `${who(t)} · last position ${fields.last_position_at ?? "none"}`,
          due: from ? `for ${ago(from, now)}` : null,
          sort_key: -3,
          vehicle_id: t.vehicle_id,
          employee_id: t.employee_id,
          task_id: t.id,
        });
      }
      const eta = await taskEta(db, t, stops.filter((s) => s.task_id === t.id), pos, settings, now);
      if (eta && eta.late_min > 0) {
        wanted.push({
          kind: "running_late",
          ref_key: `late:${t.id}`,
          severity: "warning",
          title: `Running late by ${eta.late_min} min`,
          detail: who(t),
          due: eta.final_eta_at ? `final ETA ${colomboTime(eta.final_eta_at)}` : null,
          sort_key: -2,
          vehicle_id: t.vehicle_id,
          employee_id: t.employee_id,
          task_id: t.id,
        });
      }
    }
    // A custodian-driven task (its employee is an office person, not a driver) has no app: nothing to start or accept.
    for (const t of tasks.filter((x) => x.status === "assigned" && refs.emp.get(x.employee_id)?.role === "driver")) {
      const leaveBy = t.leave_by ?? t.start_at;
      if (new Date(leaveBy).getTime() + LATE_START_MIN * 60000 < now.getTime()) {
        wanted.push({
          kind: "late_start",
          ref_key: `late_start:${t.id}`,
          severity: "warning",
          title: "Not started yet",
          detail: who(t),
          due: `leave by ${colomboDayTime(leaveBy)} · ${ago(leaveBy, now)} ago`,
          sort_key: -2,
          vehicle_id: t.vehicle_id,
          employee_id: t.employee_id,
          task_id: t.id,
        });
      }
      // Phase 7 (§19): not accepted within the accept window: the task needs a driver (critical, one per task).
      if (!t.accepted_at && t.needs_driver_reason === "not_accepted") {
        wanted.push({
          kind: "not_accepted",
          ref_key: `accept:${t.id}`,
          severity: "critical",
          title: "Not accepted in time · needs a driver",
          detail: `${who(t)} · sent ${ago(t.sent_at, now)} ago`,
          due: `leave by ${colomboDayTime(leaveBy)}`,
          sort_key: -1,
          vehicle_id: t.vehicle_id,
          employee_id: t.employee_id,
          task_id: t.id,
        });
      }
    }
    for (const t of tasks.filter((x) => x.status === "declined")) {
      const leaveBy = t.leave_by ?? t.start_at;
      const soonLeave = new Date(leaveBy).getTime() - now.getTime() < 2 * 3600000;
      const reason = DECLINE_TEXT[t.declined_reason ?? ""] ?? t.declined_reason ?? "no reason given";
      wanted.push({
        kind: "declined",
        ref_key: `declined:${t.id}`,
        // Phase 7 (§19): a task that needs a driver is critical, whenever it leaves.
        severity: "critical",
        title: `Task declined${t.declined_after_accept ? " after accepting" : ""}: ${reason}`,
        detail: [who(t), t.declined_note].filter(Boolean).join(" · "),
        due: `leave by ${colomboDayTime(leaveBy)} · needs a driver`,
        sort_key: soonLeave ? -3 : -2,
        vehicle_id: t.vehicle_id,
        employee_id: t.employee_id,
        task_id: t.id,
      });
    }
  }

  // --- Phase 7: a vehicle taken before a task, arrivals away from the pin, tasks completed early -------
  if (taskScope) {
    const who = (t: { employee_id: string; title: string }) => [refs.emp.get(t.employee_id)?.name, t.title].filter(Boolean).join(" · ");
    const dayStart = new Date(`${today}T00:00:00+05:30`).toISOString();
    const dayEnd = new Date(new Date(dayStart).getTime() + ms(1)).toISOString();
    const keepFrom = new Date(now.getTime() - ms(KEEP_DAYS)).toISOString();
    const openFrom = now.getTime() - ms(OPEN_DAYS);
    let laterQ = db.from("tasks").select("id, title, employee_id, vehicle_id, start_at, leave_by").eq("status", "assigned")
      .gte("start_at", dayStart).lt("start_at", dayEnd);
    let flaggedQ = db.from("tasks").select("id, title, employee_id, vehicle_id, completed_at, finish_flag").not("finish_flag", "is", null)
      .gte("completed_at", keepFrom);
    let stopsQ = db.from("task_stops").select(
      "id, task_id, seq, place_name, arrival_flag, arrival_distance_m, arrived_at, arrival_lat, arrival_lng",
    )
      .in("arrival_flag", ["override", "no_gps"]).gte("arrived_at", keepFrom);
    if (scope.task_id) {
      laterQ = laterQ.eq("id", scope.task_id);
      flaggedQ = flaggedQ.eq("id", scope.task_id);
      stopsQ = stopsQ.eq("task_id", scope.task_id);
    }
    const [laterRes, takenRes, holdersRes, flaggedRes, stopsRes] = await Promise.all([
      laterQ,
      db.from("vehicle_assignments").select("employee_id, vehicle_id, to_at, ended_by_name").eq("ended_how", "taken_over").gte(
        "to_at",
        dayStart,
      ),
      db.from("vehicle_assignments").select("employee_id, vehicle_id").is("to_at", null),
      flaggedQ,
      stopsQ,
    ]);
    const holders = new Map(unwrap(holdersRes, "vehicle holders").map((a) => [a.vehicle_id, a.employee_id]));
    const taken = unwrap(takenRes, "vehicle hand-overs");
    // Today's tasks still to start (the conflict stands past the leave-by too, until the task starts, changes or the day ends).
    for (const t of unwrap(laterRes, "tasks")) {
      const holder = holders.get(t.vehicle_id);
      const lost = taken.filter((a) =>
        a.employee_id === t.employee_id && a.vehicle_id === t.vehicle_id
      ).sort((a, b) => (b.to_at ?? "").localeCompare(a.to_at ?? ""))[0];
      if (!lost || !holder || holder === t.employee_id) {
        continue;
      }
      const plate = vehicleLabel(refs.veh.get(t.vehicle_id));
      wanted.push({
        kind: "vehicle_conflict",
        ref_key: `vehicle_conflict:${t.id}`,
        severity: "warning",
        title: `${plate} was taken before the task`,
        detail: `${refs.emp.get(holder)?.name ?? "Another driver"} has it now (since ${colomboTime(lost.to_at!)}); ${
          refs.emp.get(t.employee_id)?.name ?? "the driver"
        }'s task "${t.title}" at ${colomboTime(t.leave_by ?? t.start_at)} needs it`,
        due: `leave by ${colomboDayTime(t.leave_by ?? t.start_at)}`,
        sort_key: -2,
        vehicle_id: t.vehicle_id,
        employee_id: t.employee_id,
        task_id: t.id,
      });
    }
    for (const t of unwrap(flaggedRes, "tasks")) {
      const f = t.finish_flag as { odometer_km?: number; planned_km?: number; minutes?: number; planned_minutes?: number } | null;
      wanted.push({
        kind: "completed_early",
        ref_key: `early:${t.id}`,
        severity: "warning",
        title: `Completed early: ${f?.odometer_km ?? "?"} km on the odometer for a ${f?.planned_km ?? "?"} km plan`,
        detail: `${who(t)} · ${f?.minutes ?? "?"} min for ${f?.planned_minutes ?? "?"} min of planned driving`,
        due: t.completed_at ? `completed ${colomboDayTime(t.completed_at)}` : null,
        sort_key: -1,
        vehicle_id: t.vehicle_id,
        employee_id: t.employee_id,
        task_id: t.id,
        keep_only: !t.completed_at || new Date(t.completed_at).getTime() < openFrom,
      });
    }
    const flaggedStops = unwrap(stopsRes, "stops");
    const stopTasks = flaggedStops.length
      ? unwrap(
        await db.from("tasks").select("id, title, employee_id, vehicle_id").in("id", [...new Set(flaggedStops.map((x) => x.task_id))]),
        "tasks",
      )
      : [];
    const order = flaggedStops.length
      ? unwrap(
        await db.from("task_stops").select("id, task_id, seq").in("task_id", stopTasks.map((t) => t.id)).neq("status", "removed"),
        "stops",
      )
      : [];
    for (const st of flaggedStops) {
      const t = stopTasks.find((x) => x.id === st.task_id);
      if (!t) continue;
      const n = order.filter((o) => o.task_id === st.task_id && o.seq <= st.seq).length;
      const far = st.arrival_distance_m != null
        ? (st.arrival_distance_m >= 1000 ? `${Math.round(st.arrival_distance_m / 100) / 10} km` : `${st.arrival_distance_m} m`) +
          " from the pin"
        : null;
      wanted.push({
        kind: "arrival_override",
        ref_key: `arrival:${st.id}`,
        severity: "warning",
        title: st.arrival_flag === "no_gps" ? "Arrived with no GPS fix" : "Arrived away from the stop",
        detail: [
          who(t),
          `Stop ${n} · ${st.place_name}`,
          far,
          st.arrival_lat != null && st.arrival_lng != null ? `the phone was at ${st.arrival_lat}, ${st.arrival_lng}` : null,
        ].filter(Boolean).join(" · "),
        due: st.arrived_at ? `arrived ${colomboDayTime(st.arrived_at)}` : null,
        sort_key: -1,
        vehicle_id: t.vehicle_id,
        employee_id: t.employee_id,
        task_id: t.id,
        keep_only: !st.arrived_at || new Date(st.arrived_at).getTime() < openFrom,
      });
    }
  }

  // --- Phase 7: "I need another vehicle" (a breakdown or accident during a task) ------------------------
  if (taskScope) {
    let q = db.from("vehicle_reports").select("id, vehicle_id, employee_id, task_id, category, note, created_at").eq("needs_vehicle", true)
      .not("task_id", "is", null).gte("created_at", new Date(now.getTime() - ms(2)).toISOString());
    if (scope.task_id) q = q.eq("task_id", scope.task_id);
    const asks = unwrap(await q, "vehicle reports");
    const asked = asks.length
      ? unwrap(await db.from("tasks").select("id, title, status, vehicle_id, employee_id").in("id", asks.map((a) => a.task_id!)), "tasks")
      : [];
    for (const a of asks) {
      const t = asked.find((x) => x.id === a.task_id);
      // Until the task has another vehicle (the swap) or is no longer running.
      if (!t || t.status !== "in_progress" || t.vehicle_id !== a.vehicle_id) continue;
      wanted.push({
        kind: "vehicle_needed",
        ref_key: `vehicle_needed:${a.id}`,
        severity: "critical",
        title: `Another vehicle needed: ${vehicleLabel(refs.veh.get(a.vehicle_id))}`,
        detail: [refs.emp.get(a.employee_id)?.name, t.title, a.category.replace("_", " "), a.note].filter(Boolean).join(" · "),
        due: `since ${colomboTime(a.created_at)}`,
        sort_key: -4,
        vehicle_id: a.vehicle_id,
        employee_id: a.employee_id,
        task_id: t.id,
        vehicle_report_id: a.id,
      });
    }
  }

  // --- Phase 7: the app stopped by the phone (drivers on duty) ------------------------------------
  if (full) {
    const dayStart = new Date(`${today}T00:00:00+05:30`).toISOString();
    const [stopsRes, sessionsRes] = await Promise.all([
      db.rpc("app_stops", { p_from: dayStart, p_to: nowIso }),
      db.from("duty_sessions").select("employee_id, started_at, ended_at, device_info").or(`ended_at.is.null,started_at.gte.${dayStart}`)
        .order("started_at", { ascending: false }),
    ]);
    const stops = new Map(unwrap(stopsRes, "app stops").map((r) => [r.employee_id, r.stops]));
    const sessions = unwrap(sessionsRes, "duty sessions");
    const drivers = refs.employees.filter((e) => e.role === "driver" && e.active);
    for (const e of drivers) {
      const count = stops.get(e.id) ?? 0;
      const open = sessions.find((x) => x.employee_id === e.id && x.ended_at === null);
      const pos = latest.get(e.id);
      const lastFix = pos?.recorded_at ?? null;
      const since = open ? (lastFix && lastFix > open.started_at ? lastFix : open.started_at) : null;
      const noFixMin = since ? Math.floor((now.getTime() - new Date(since).getTime()) / 60000) : 0;
      // A fresh heartbeat that says the phone has a recent fix means the points are only waiting (queued or
      // refused), not missing: that is not "no GPS fix".
      const beatFresh = pos?.hb_at != null && now.getTime() - new Date(pos.hb_at).getTime() < 3 * 60000;
      const phoneHasFix = beatFresh && pos?.hb_fix_age_s != null && pos.hb_fix_age_s < NO_FIX_MIN * 60;
      const noFix = open !== undefined && noFixMin >= NO_FIX_MIN && !phoneHasFix;
      if (count < APP_STOPS_PER_DAY && !noFix) continue;
      const device = (sessions.find((x) => x.employee_id === e.id)?.device_info ?? {}) as { brand?: string; model?: string };
      const phone = [device.brand, device.model].filter(Boolean).join(" ");
      wanted.push({
        kind: "app_stopped",
        ref_key: `app_stopped:${e.id}:${today}`,
        severity: "warning",
        title: [
          count >= APP_STOPS_PER_DAY ? `App stopped by the phone ${count}× today` : null,
          noFix ? `no GPS fix for ${noFixMin} min on duty` : null,
        ]
          .filter(Boolean).join(" · ").replace(/^n/, "N"),
        detail: `${e.name}${phone ? ` · ${phone}` : ""} · the phone's settings: Me → Phone setup in the app`,
        due: "today",
        sort_key: -1,
        employee_id: e.id,
      });
    }
  }

  // --- Requests nobody has decided ------------------------------------------------------
  if (requestScope) {
    let q = db.from("vehicle_requests").select("*").in("status", ["waiting", "changed"]);
    if (scope.request_id) q = q.eq("id", scope.request_id);
    for (const r of unwrap(await q, "vehicle requests")) {
      // A changed booking waits from its edit, not from the day it was first asked.
      const since = r.status === "changed" ? r.changed_at ?? r.created_at : r.created_at;
      if (new Date(since).getTime() + REQUEST_WAIT_MIN * 60000 > now.getTime()) continue;
      wanted.push({
        kind: "request_waiting",
        ref_key: `request:${r.id}`,
        severity: "warning",
        title: r.status === "changed" ? "Changed booking needs re-approval" : "Vehicle request waiting",
        detail: [r.requested_by_name, [r.route_from, r.route_to].filter(Boolean).join(" → ") || null, colomboDayTime(r.needed_at)].filter(
          Boolean,
        )
          .join(" · "),
        due: `waiting ${ago(since, now)}`,
        sort_key: -1,
        request_id: r.id,
        employee_id: r.requested_by_employee_id,
      });
    }
  }

  // --- The system itself: pushes and routing calls that failed today --------------------
  if (full) {
    const dayStart = new Date(now.getTime() - ms(1)).toISOString();
    const [pushRes, routingRes] = await Promise.all([
      db.from("push_log").select("failed, errors").gt("failed", 0).gte("created_at", dayStart),
      db.from("routing_calls").select("provider, calls, errors").eq("day", today).gt("errors", 0),
    ]);
    const pushes = unwrap(pushRes, "push log");
    if (pushes.length > 0) {
      wanted.push({
        kind: "push_failed",
        ref_key: `push:${today}`,
        severity: "info",
        title: `Push notifications failed: ${pushes.length} today`,
        detail: "Some drivers' phones did not get a task notification (expired tokens are removed by themselves).",
        due: "today",
        sort_key: 0,
      });
    }
    for (const r of unwrap(routingRes, "routing calls")) {
      wanted.push({
        kind: "routing_failed",
        ref_key: `routing:${r.provider}:${today}`,
        severity: "info",
        title: `Routing calls failed: ${r.errors} of ${r.calls} (${r.provider})`,
        detail: "Those legs were estimated instead.",
        due: "today",
        sort_key: 0,
      });
    }
  }
  return wanted;
}

/** The "notified" line of an issue told at its source: who got the push (the outbox) and when. */
async function noteWhoWasTold(db: Db, issueId: string, w: Wanted, now: Date): Promise<void> {
  const event = TOLD_EVENT[w.kind];
  if (!event || !w.task_id) return;
  const rows = unwrap(
    await db.from("notifications").select("recipient_employee_id, created_at").eq("event", event).eq("payload->>task_id", w.task_id)
      .order("created_at"),
    "notifications",
  );
  const names = [...new Set(rows.map((r) => r.recipient_employee_id))].filter(Boolean);
  const people = names.length ? unwrap(await db.from("employees").select("id, name").in("id", names), "employees").map((e) => e.name) : [];
  await writeEvent(db, issueId, "notified", {
    actor: "system",
    note: people.length
      ? `Told by web push ${colomboTime(rows[0].created_at)}: ${people.join(", ")}`
      : "Nobody with a browser for notifications to tell (the issue and the board show it)",
    at: now,
  });
}

export interface SyncResult {
  opened: number;
  updated: number;
  resolved: number;
  active: number;
}

export type EventFields = {
  actor?: string | null;
  actor_employee_id?: string | null;
  note?: string | null;
  from_status?: string | null;
  to_status?: string | null;
  at?: Date;
};

export async function writeEvent(db: Db, issueId: string, action: Row<"issue_events">["action"], f: EventFields = {}): Promise<void> {
  unwrap(
    await db.from("issue_events").insert({
      issue_id: issueId,
      action,
      actor: f.actor ?? null,
      actor_employee_id: f.actor_employee_id ?? null,
      note: f.note ?? null,
      from_status: f.from_status ?? null,
      to_status: f.to_status ?? null,
      ...(f.at && { at: f.at.toISOString() }),
    }),
    "issue events",
  );
}

/** Which active rows a scope may touch (task issues belong to their task, not to the vehicle's scope). */
function scoped<Q extends { eq: (c: string, v: string) => Q; not: (c: string, op: string, v: string) => Q }>(q: Q, scope: SyncScope): Q {
  if (scope.task_id) return q.eq("task_id", scope.task_id);
  if (scope.report_id) return q.eq("vehicle_report_id", scope.report_id);
  if (scope.request_id) return q.eq("request_id", scope.request_id);
  if (scope.vehicle_id) return q.eq("vehicle_id", scope.vehicle_id).not("kind", "in", `(${[...TASK_KINDS].join(",")})`);
  return q;
}

/** Brings the issues table in line with the data; returns what changed. */
export async function syncIssues(db: Db, now: Date, scope: SyncScope = {}): Promise<SyncResult> {
  const full = !scope.task_id && !scope.report_id && !scope.request_id && !scope.vehicle_id;
  if (full) unwrap(await db.from("job_runs").upsert({ job: SYNC_JOB, started_at: now.toISOString() }, { onConflict: "job" }), "job runs");
  const mutedSince = new Date(now.getTime() - ms(30)).toISOString();
  const [wanted, activeRes, mutedRes] = await Promise.all([
    computeWanted(db, now, scope),
    scoped(db.from("issues").select("id, ref_key, kind, status, severity, title, detail, due, sort_key").in("status", ACTIVE), scope),
    scoped(
      db.from("issues").select("ref_key, severity, resolved_at").in("status", ["resolved", "dismissed"]).neq("resolved_by", "system").gte(
        "resolved_at",
        mutedSince,
      ).order("resolved_at", { ascending: false }),
      scope,
    ),
  ]);
  const active = unwrap(activeRes, "issues") as ActiveRow[];
  const muted = new Map<string, Severity>();
  for (const r of unwrap(mutedRes, "issues")) if (!muted.has(r.ref_key)) muted.set(r.ref_key, r.severity as Severity);

  const plan = reconcile(active, wanted, muted);
  const nowIso = now.toISOString();
  let opened = 0;
  let updated = 0;
  let resolved = 0;
  const critical: { id: string; title: string; detail: string | null }[] = [];
  for (const w of plan.open) {
    const { data, error } = await db.from("issues").insert({
      kind: w.kind,
      severity: w.severity,
      title: w.title,
      detail: w.detail,
      due: w.due,
      sort_key: w.sort_key,
      vehicle_id: w.vehicle_id ?? null,
      employee_id: w.employee_id ?? null,
      task_id: w.task_id ?? null,
      request_id: w.request_id ?? null,
      vehicle_report_id: w.vehicle_report_id ?? null,
      ref_key: w.ref_key,
      status: w.status ?? "open",
      opened_at: nowIso,
      updated_at: nowIso,
    }).select("id").single();
    if (error) {
      if (error.code === "23505") continue; // opened by a parallel sync just now
      throw new Error(`issues: ${error.message}`);
    }
    await writeEvent(db, data.id, "opened", { actor: "system", to_status: w.status ?? "open", at: now });
    opened += 1;
    if (TOLD_AT_SOURCE.has(w.kind)) {
      // Phase 7 (§19): the push went out when it happened; the issue's history says who was told and when.
      await noteWhoWasTold(db, data.id, w, now);
    } else if (w.severity === "critical") critical.push({ id: data.id, title: w.title, detail: w.detail ?? null });
  }
  for (const { row, patch } of plan.update) {
    unwrap(await db.from("issues").update({ ...patch, updated_at: nowIso }).eq("id", row.id), "issues");
    if (patch.severity === "critical" && !TOLD_AT_SOURCE.has(row.kind)) {
      critical.push({ id: row.id, title: patch.title ?? row.title, detail: patch.detail ?? row.detail });
    }
    if (patch.status) {
      await writeEvent(db, row.id, "status", {
        actor: "system",
        from_status: row.status,
        to_status: patch.status,
        note: "the vehicle report changed",
        at: now,
      });
    }
    updated += 1;
  }
  for (const row of plan.resolve) {
    const done = unwrap(
      await db.from("issues").update({ status: "resolved", resolved_at: nowIso, resolved_by: "system", updated_at: nowIso })
        .eq("id", row.id).in("status", ACTIVE).select("id"),
      "issues",
    );
    if (done.length === 0) continue;
    await writeEvent(db, row.id, "auto_resolved", { actor: "system", from_status: row.status, to_status: "resolved", at: now });
    resolved += 1;
  }
  // A critical issue (opened so, or raised to it) tells the people with the issues permission.
  if (critical.length > 0) {
    try {
      const people = await officePeople(db);
      const to = recipientsFor("issue.opened", people);
      for (const c of critical) {
        await notify(db, "issue.opened", { title: c.title, body: c.detail ?? "", url: `/issues/${c.id}`, tag: `issue:${c.id}` }, to);
      }
    } catch (error) {
      console.error(`issue.opened: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const result = { opened, updated, resolved, active: active.length + opened - resolved };
  if (full) {
    unwrap(
      await db.from("job_runs").upsert({ job: SYNC_JOB, finished_at: new Date().toISOString(), result }, { onConflict: "job" }),
      "job runs",
    );
  }
  return result;
}

/**
 * fleet_overview's own sync: skipped when a full sync (the job's or another overview's)
 * finished under maxAgeMs ago, or started under maxAgeMs ago and is still running, so
 * several people with Overview open do not run the rules every few seconds. Pure.
 */
export function syncIsFresh(run: { started_at: string; finished_at: string | null } | null, now: Date, maxAgeMs = SYNC_FRESH_MS): boolean {
  if (!run) return false;
  const finished = run.finished_at ? Date.parse(run.finished_at) : NaN;
  if (!Number.isNaN(finished) && now.getTime() - finished < maxAgeMs) return true;
  const started = Date.parse(run.started_at);
  if (Number.isNaN(started)) return false;
  const running = Number.isNaN(finished) || started > finished;
  return running && now.getTime() - started < maxAgeMs;
}

/** A full sync unless one is fresh (see syncIsFresh); null when skipped. */
export async function syncIssuesIfStale(db: Db, now: Date, maxAgeMs = SYNC_FRESH_MS): Promise<SyncResult | null> {
  const run = unwrapMaybe(await db.from("job_runs").select("started_at, finished_at").eq("job", SYNC_JOB).maybeSingle(), "job runs");
  if (syncIsFresh(run, now, maxAgeMs)) return null;
  return await syncIssues(db, now);
}

/** The refs an issue card needs, loaded once per call. */
export type IssueRefs = Pick<Refs, "emp" | "veh">;
