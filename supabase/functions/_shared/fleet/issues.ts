// Issues: one row per thing that needs the office's attention (docs/dispatch-plan.md,
// section 8). syncIssues computes the wanted set from the data, opens the missing
// ones, updates the existing ones in place and auto-resolves the ones whose
// condition has cleared. A ref_key is unique while open or in progress, so a
// condition never opens twice; after a resolution the same key may open again.
// The reconcile step is pure (issues_test.ts); the rules read the same helpers
// as the rest of the office tools.

import type { Db, Row } from "./db.ts";
import { notify, officePeople, recipientsFor } from "./notifications.ts";
import { fetchAll, inChunks, unwrap, unwrapMaybe } from "./db.ts";
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
import { GOOGLE_FEATURES, type GoogleFeature, loadSettings, type Settings } from "./settings.ts";
import { ORS_DAILY_BUDGET } from "./routing.ts";
import { ODOMETER_DRIVER_DAILY_CAP } from "./odometerGate.ts";
import { needsAttention } from "./status.ts";
import { colomboDate, colomboDayTime, colomboTime, daysBetween, minutesSince, shortDate } from "./time.ts";
import { duration, whenText } from "./durations.ts";
import { missingText, requiredKinds } from "./docs.ts";

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
  "missed_task",
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
  documents_missing: "Documents missing",
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
  missed_task: "Missed task",
  push_failed: "Push failed",
  routing_failed: "Routing failed",
  map_fallback: "Google map failed",
  trip_not_confirmed: "Trip not confirmed",
  usage_cap: "Usage near its cap",
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
  /** Round 4–7 (4a): already told when it happened (a vehicle check's problem): the notifications with this tag. */
  told_tag?: string;
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
/** Hotfix 3 (L2): a missed task keeps its issue this long (a person resolving it quiets it for 30 days). */
const MISSED_KEEP_DAYS = 30;
/** Round 4–7 (item 8): information closes by itself after this many days ("closed automatically"), unless someone took it. */
export const AUTO_CLOSE_DAYS = 7;
export const AUTO_CLOSED_NOTE = "closed automatically";
/** An issue about a task that is over (completed, cancelled, missed) expires this long after its leave-by. */
const EXPIRE_AFTER_MS = 24 * 3600_000;
const OVER = new Set(["completed", "cancelled", "missed"]);
/** "1 h 15 min", or "?" when the number is missing. */
const minText = (minutes: number | null | undefined) => (minutes == null ? "?" : duration(minutes));

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
    const docKinds = new Map<string, Set<string>>();
    if (vehicleIds.length > 0) {
      for (
        const d of unwrap(
          await db.from("vehicle_documents").select("vehicle_id, kind").in("vehicle_id", vehicleIds).is("removed_at", null).limit(5000),
          "vehicle documents",
        )
      ) docKinds.set(d.vehicle_id, (docKinds.get(d.vehicle_id) ?? new Set()).add(d.kind));
    }
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
      // Phase 7 (§28): the papers an active vehicle should have and has not got: one row per vehicle, not one each.
      const missing = requiredKinds(v).filter((k) => !(docKinds.get(v.id) ?? new Set()).has(k));
      if (missing.length > 0) {
        wanted.push({
          kind: "documents_missing",
          ref_key: `docs-missing:${v.id}`,
          severity: "info",
          title: `${missing.length} document${missing.length === 1 ? "" : "s"} missing: ${missingText(missing)}`,
          detail: label,
          due: null,
          sort_key: 900,
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
      // Hotfix 3 (L2): no allowance set (null or 0) means no check.
      if (v.monthly_km_allowance != null && v.monthly_km_allowance > 0 && used > v.monthly_km_allowance) {
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
    let q = db.from("vehicle_reports").select("*").neq("status", "closed").eq("demo", false);
    if (scope.report_id) q = q.eq("id", scope.report_id);
    if (scope.vehicle_id) q = q.eq("vehicle_id", scope.vehicle_id);
    for (const r of unwrap(await q, "vehicle reports")) {
      wanted.push({
        kind: "vehicle_report",
        ref_key: `report:${r.id}`,
        severity: r.category === "breakdown" || r.category === "accident" ? "critical" : "warning",
        // Round 4–7 (4a): a problem found by a vehicle check before work is a pre-trip one; its check told the office.
        title: `${r.check_id ? "Pre-trip check" : "Vehicle problem"}: ${r.category.replace("_", " ")}${
          r.status === "in_garage" ? " (in garage)" : ""
        }`,
        detail: [refs.veh.get(r.vehicle_id)?.reg_no, refs.emp.get(r.employee_id)?.name, r.note].filter(Boolean).join(" · "),
        due: `reported ${whenText(r.created_at, now)}`,
        sort_key: -2,
        vehicle_id: r.vehicle_id,
        employee_id: r.employee_id,
        task_id: r.task_id,
        vehicle_report_id: r.id,
        status: r.status === "in_garage" ? "in_progress" : "open",
        ...(r.check_id && { told_tag: `check:${r.check_id}` }),
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
        // Round 4–7 (item 8): typed because the photo could not be read is information; a reading that disagrees with its
        // photo, or was changed, is a warning.
        severity: l.flag === "typed_unreadable" || l.flag === "ai_failed" || !l.flag ? "info" : "warning",
        title: `Odometer check: ${odometerCheck(l) ?? l.flag}`,
        detail: [
          refs.veh.get(l.vehicle_id)?.reg_no,
          refs.emp.get(l.employee_id)?.name,
          `${thousands(l.reading_km)} km${l.ai_value !== null ? ` (photo ${thousands(l.ai_value)})` : ""}`,
        ].filter(Boolean).join(" · "),
        due: `logged ${whenText(l.logged_at, now)}`,
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
        due: `ended ${whenText(g.to.logged_at, now)}`,
        sort_key: -1,
        vehicle_id: g.vehicle_id,
        employee_id: g.from.employee_id,
        keep_only: new Date(g.to.logged_at).getTime() < openFrom,
      });
    }
  }

  // --- Tasks: signal, late start, running late, not accepted, declined ------------------
  if (taskScope) {
    let q = db.from("tasks").select("*").in("status", ["assigned", "in_progress", "declined"]).eq("demo", false);
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
          due: from ? `for ${duration(minutesSince(from, now))}` : null,
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
          title: `Running late by ${duration(eta.late_min)}`,
          detail: who(t),
          due: eta.final_eta_at ? `final ETA ${colomboTime(eta.final_eta_at)}` : null,
          sort_key: -2,
          vehicle_id: t.vehicle_id,
          employee_id: t.employee_id,
          task_id: t.id,
        });
      }
    }
    // A custodian-driven task (its employee is an office person, not a driver) has no app: nothing to start or accept. A trip
    // the driver started (Phase 7, §13) is accepted when it is made and has no leave-by of the office's: no late start
    // (a queued one arrives with its past time just before its start).
    for (const t of tasks.filter((x) => x.status === "assigned" && x.kind !== "self" && refs.emp.get(x.employee_id)?.role === "driver")) {
      const leaveBy = t.leave_by ?? t.start_at;
      if (new Date(leaveBy).getTime() + LATE_START_MIN * 60000 < now.getTime()) {
        wanted.push({
          kind: "late_start",
          ref_key: `late_start:${t.id}`,
          severity: "warning",
          title: "Not started yet",
          detail: who(t),
          due: `leave by ${colomboDayTime(leaveBy)} · ${whenText(leaveBy, now)}`,
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
          detail: `${who(t)} · sent ${t.sent_at ? whenText(t.sent_at, now) : "?"}`,
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

  // --- Hotfix 3 (L2): a task never started, its leave-by over a day ago, is missed: one issue until someone resolves it --
  if (taskScope) {
    let q = db.from("tasks").select("id, title, employee_id, vehicle_id, leave_by, start_at, missed_at").eq("status", "missed")
      .gte("missed_at", new Date(now.getTime() - ms(MISSED_KEEP_DAYS)).toISOString()).eq("demo", false);
    if (scope.task_id) q = q.eq("id", scope.task_id);
    for (const t of unwrap(await q, "missed tasks")) {
      const leaveBy = t.leave_by ?? t.start_at;
      // Round 4–7 (item 8): one specific line; a warning for 7 days, then information (closed by itself unless taken).
      const missedDays = t.missed_at ? (now.getTime() - new Date(t.missed_at).getTime()) / ms(1) : 0;
      wanted.push({
        kind: "missed_task",
        ref_key: `missed:${t.id}`,
        severity: missedDays >= AUTO_CLOSE_DAYS ? "info" : "warning",
        title: `${refs.emp.get(t.employee_id)?.name ?? "The driver"} missed "${t.title}"`,
        detail: [refs.emp.get(t.employee_id)?.name, t.title].filter(Boolean).join(" · "),
        due: `was to leave ${colomboDayTime(leaveBy)}`,
        sort_key: -1,
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
      .gte("start_at", dayStart).lt("start_at", dayEnd).eq("demo", false);
    let flaggedQ = db.from("tasks").select("id, title, employee_id, vehicle_id, completed_at, finish_flag, driven_by, driver_name")
      .not("finish_flag", "is", null)
      .gte("completed_at", keepFrom).eq("demo", false);
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
      // A task whose vehicle is chosen on the day (Hotfix 2, J) has none to lose yet.
      if (!t.vehicle_id) continue;
      const vehicleId = t.vehicle_id;
      const holder = holders.get(vehicleId);
      const lost = taken.filter((a) =>
        a.employee_id === t.employee_id && a.vehicle_id === vehicleId
      ).sort((a, b) => (b.to_at ?? "").localeCompare(a.to_at ?? ""))[0];
      if (!lost || !holder || holder === t.employee_id) {
        continue;
      }
      const plate = vehicleLabel(refs.veh.get(vehicleId));
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
      const f = t.finish_flag as
        | { kind?: string; odometer_km?: number; planned_km?: number; minutes?: number; planned_minutes?: number }
        | null;
      if (f?.kind === "not_confirmed") {
        // Round 4–7 (4b): a self-drive or someone-else trip nobody closed by 09:00 the day after; the odometer entered
        // later confirms it and this resolves by itself.
        const plate = vehicleLabel(refs.veh.get(t.vehicle_id ?? ""));
        const person = refs.emp.get(t.employee_id)?.name ?? "the person";
        wanted.push({
          kind: "trip_not_confirmed",
          ref_key: `unconfirmed:${t.id}`,
          severity: "warning",
          title: `Trip not confirmed: ${t.title}`,
          detail: [plate, t.driven_by === "other" && t.driver_name ? `${t.driver_name} drove · booked by ${person}` : `${person} drove`]
            .filter(Boolean).join(" · "),
          due: t.completed_at ? `ended ${colomboDayTime(t.completed_at)}` : null,
          sort_key: -1,
          vehicle_id: t.vehicle_id,
          employee_id: t.employee_id,
          task_id: t.id,
          keep_only: !t.completed_at || new Date(t.completed_at).getTime() < openFrom,
        });
        continue;
      }
      wanted.push({
        kind: "completed_early",
        ref_key: `early:${t.id}`,
        severity: "warning",
        title: `Completed early: ${f?.odometer_km ?? "?"} km on the odometer for a ${f?.planned_km ?? "?"} km plan`,
        detail: `${who(t)} · ${minText(f?.minutes)} for ${minText(f?.planned_minutes)} of planned driving`,
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
        await db.from("tasks").select("id, title, employee_id, vehicle_id").in("id", [...new Set(flaggedStops.map((x) => x.task_id))])
          .eq("demo", false),
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
        severity: "info",
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
      .not("task_id", "is", null).gte("created_at", new Date(now.getTime() - ms(2)).toISOString()).eq("demo", false);
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
        .eq("demo", false).order("started_at", { ascending: false }),
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
          noFix ? `no GPS fix for ${duration(noFixMin)} on duty` : null,
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
        title: r.status === "changed"
          ? "Changed booking needs re-approval"
          : r.kind === "change"
          ? "Proposed task change waiting for approval"
          : "Vehicle request waiting",
        detail: [r.requested_by_name, [r.route_from, r.route_to].filter(Boolean).join(" → ") || null, colomboDayTime(r.needed_at)].filter(
          Boolean,
        )
          .join(" · "),
        due: `waiting ${duration(minutesSince(since, now))}`,
        sort_key: -1,
        request_id: r.id,
        employee_id: r.requested_by_employee_id,
      });
    }
  }

  // --- Google's map failed on a phone (Part 6): the phone shows the free map until Google's loads again -------
  // The phone reports each try that fails (report_map_state: no "map loaded" within phone_map_wait_s while online, or an
  // error). The office hears of it only when it is not one weak-signal trip (Sahan, 19 October): the same phone failed
  // again on its next try (failures ≥ 2), or two phones failed within an hour (mapAlarms). While the map package is open no
  // phone asks Google, so nothing is open then. Resolved by the phone's next good load.
  if (full && settings.map_package === "google") {
    const drivers = new Map(refs.employees.filter((e) => e.active).map((e) => [e.id, e]));
    // Read on its own: a functions deploy ahead of the migration (no table yet) must not stop the whole sync.
    const res = await db.from("driver_map_state").select("employee_id, reason, google_failed_at, last_failed_at, failures, app_version")
      .eq("google_ok", false);
    if (res.error) console.error(`issues: map reports skipped: ${res.error.message}`);
    const rows = (res.data ?? []).filter((r) => drivers.has(r.employee_id));
    for (const { row: r, why } of mapAlarms(rows, now)) {
      const e = drivers.get(r.employee_id)!;
      wanted.push({
        kind: "map_fallback",
        ref_key: `map_fallback:${e.id}`,
        // Item 8: one phone failing again falls back to the free map by itself (info); two phones within the hour point at
        // the key or billing, which someone must act on (warning).
        severity: why === "again" ? "info" : "warning",
        title: `Google map failed on ${e.name}'s phone; using the free map`,
        detail: [
          r.reason === "timeout" ? "Google's map did not finish loading while the phone was online" : "Google's map reported an error",
          why === "again" ? `${r.failures} tries in a row` : "another phone too, within the hour",
          r.google_failed_at ? `since ${colomboDayTime(r.google_failed_at)}` : null,
          r.app_version ? `app ${r.app_version}` : null,
          "if more phones show this, check the Android key and billing (docs/google-maps-setup.md)",
        ].filter(Boolean).join(" · "),
        due: null,
        sort_key: 0,
        employee_id: e.id,
      });
    }
  }

  // --- The system itself: pushes and routing calls that failed today --------------------
  if (full) {
    const dayStart = new Date(now.getTime() - ms(1)).toISOString();
    const [pushRes, routingRes] = await Promise.all([
      db.from("push_log").select("employee_id, failed, tokens, errors").or("failed.gt.0,tokens.eq.0").gte("created_at", dayStart),
      db.from("routing_calls").select("provider, calls, errors").eq("day", today).gt("errors", 0),
    ]);
    const pushes = pushIssueRows(unwrap(pushRes, "push log"));
    if (pushes.failed + pushes.noPhone.length > 0) {
      const names = pushes.noPhone.map((id) => refs.emp.get(id)?.name).filter((n): n is string => !!n);
      wanted.push({
        kind: "push_failed",
        ref_key: `push:${today}`,
        severity: "info",
        title: `Push notifications failed: ${pushes.failed + pushes.noPhoneSends} today`,
        detail: [
          pushes.failed ? "Some drivers' phones did not get a task notification (expired tokens are removed by themselves)." : null,
          names.length
            ? `No phone registered for notifications: ${
              names.join(", ")
            }. They get no task notification until they open Fame Fleet on their phone.`
            : null,
        ].filter(Boolean).join(" "),
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
    // Round 48 (6a): every capped counter (Google, openrouteservice, Gemini) at 80 % of its day or month cap.
    wanted.push(...usageCapIssues(await usageCounters(db, settings, today, (id) => refs.emp.get(id)?.name ?? null), today));
  }
  return wanted;
}

// ---- Round 48 (item 6a): the counters near their caps ---------------------------------------------------------------

/** From this share of a cap on, one warning issue per feature and period; at the cap it is critical. */
export const USAGE_WARN_PCT = 80;

export interface UsageCounter {
  /** The ref_key's feature part (one issue per feature, period and day). */
  feature: string;
  /** The words of the title: "Google routes", "openrouteservice directions", "Odometer checks (server)". */
  text: string;
  period: "day" | "month";
  used: number;
  cap: number;
  /** What happens at the cap, for the detail ("the open package takes over"). */
  at_cap: string;
  employee_id?: string | null;
  /** Round 48 snap hotfix: an info issue only once the cap is reached (a per-driver budget, not the fleet's cap). */
  info?: boolean;
}

/** The ref_key of a counter's issue: a new one each day or month, so the old one resolves by itself when the period rolls over. */
export const usageRefKey = (c: Pick<UsageCounter, "feature" | "period">, today: string): string =>
  `usage:${c.feature}:${c.period}:${c.period === "day" ? today : today.slice(0, 7)}`;

/** The issues the counters want now (pure): one per feature and period from 80 % of the cap, critical at 100 %. */
/**
 * Round 53, from the review (2 November): the day's push records that need the office. A failed send counts as before; a
 * push to an app driver with no phone token left (no_token: Expo's dead tokens are removed now) names the driver, so a phone
 * that lost its token is not silent. A push skipped for someone who is not an app driver, or archived, is not a failure.
 */
export function pushIssueRows(rows: { employee_id: string | null; failed: number; tokens: number; errors: unknown }[]): {
  failed: number;
  noPhone: string[];
  noPhoneSends: number;
} {
  const noToken = (r: { errors: unknown }) =>
    Array.isArray(r.errors) && r.errors.some((e) => (e as { error?: string })?.error === "no_token");
  const failed = rows.filter((r) => r.failed > 0).length;
  const quiet = rows.filter((r) => r.failed === 0 && r.tokens === 0 && noToken(r));
  return { failed, noPhone: [...new Set(quiet.map((r) => r.employee_id).filter((id): id is string => !!id))], noPhoneSends: quiet.length };
}

export function usageCapIssues(counters: readonly UsageCounter[], today: string): Wanted[] {
  const out: Wanted[] = [];
  for (const c of counters) {
    if (c.cap <= 0 || c.used <= 0) continue;
    const pct = Math.floor((c.used / c.cap) * 100);
    if (pct < (c.info ? 100 : USAGE_WARN_PCT)) continue;
    const period = c.period === "day" ? "today's" : "the month's";
    out.push({
      kind: "usage_cap",
      ref_key: usageRefKey(c, today),
      severity: c.info ? "info" : pct >= 100 ? "critical" : "warning",
      title: c.info ? `${c.text} paused today: ${c.used} of ${c.cap} calls` : `${c.text} at ${pct}% of ${period} cap`,
      detail: `${thousands(c.used)} of ${thousands(c.cap)} calls ${
        c.period === "day" ? "today" : "this month"
      } · at the cap ${c.at_cap} until ${c.period === "day" ? "tomorrow" : "the 1st"} (Settings → Fleet)`,
      due: c.period === "day" ? "today" : "this month",
      sort_key: pct >= 100 ? -1 : 0,
      ...(c.employee_id ? { employee_id: c.employee_id } : {}),
    });
  }
  return out;
}

const GOOGLE_WORDS: Record<GoogleFeature, string> = {
  map_loads: "Google map loads",
  places_autocomplete: "Google place search",
  places_details: "Google place details",
  routes: "Google routes",
  roads: "Google snap to roads",
};
const GOOGLE_AT_CAP: Record<GoogleFeature, string> = {
  map_loads: "the free map shows",
  places_autocomplete: "openrouteservice's search answers",
  places_details: "a Google place is refused",
  routes: "the open package's road times are used",
  roads: "the raw GPS line is drawn",
};

/**
 * Every capped counter as it stands (google_calls this month, routing_calls and odometer_calls today). Each table is
 * read on its own: one that cannot be read (a deploy ahead of its migration, a dropped query) is logged and skipped,
 * never the whole sync stopped.
 */
export async function usageCounters(
  db: Db,
  settings: Pick<
    Settings,
    "google_caps" | "ors_gap_daily_cap" | "ors_autocomplete_daily_cap" | "odometer_server_daily_cap" | "roads_trip_daily_cap"
  >,
  today: string,
  nameOf: (employeeId: string) => string | null = () => null,
): Promise<UsageCounter[]> {
  const out: UsageCounter[] = [];
  const monthStart = `${today.slice(0, 7)}-01`;
  const [google, routing, odometer, roads] = await Promise.all([
    db.from("google_calls").select("feature, day, calls").gte("day", monthStart).lte("day", today),
    db.from("routing_calls").select("provider, calls").eq("day", today),
    db.from("odometer_calls").select("mode, scope, calls").eq("day", today),
    db.from("roads_day_calls").select("employee_id, calls").eq("day", today),
  ]);
  // Round 48 snap hotfix: a driver's day at its Roads budget shows the GPS line; the office hears it once, as info.
  if (roads.error) console.error(`issues: roads_day_calls skipped: ${roads.error.message}`);
  else {
    for (const r of roads.data ?? []) {
      out.push({
        feature: `roads_trip:${r.employee_id}`,
        text: `Snap to roads for ${nameOf(r.employee_id) ?? "a driver"}`,
        period: "day",
        used: r.calls,
        cap: settings.roads_trip_daily_cap,
        at_cap: "that driver's route shows the GPS line",
        employee_id: r.employee_id,
        info: true,
      });
    }
  }
  if (google.error) console.error(`issues: google_calls skipped: ${google.error.message}`);
  else {
    for (const f of GOOGLE_FEATURES) {
      const rows = (google.data ?? []).filter((r) => r.feature === f);
      const day = rows.filter((r) => r.day === today).reduce((n, r) => n + r.calls, 0);
      const month = rows.reduce((n, r) => n + r.calls, 0);
      const cap = settings.google_caps[f];
      out.push({ feature: `google_${f}`, text: GOOGLE_WORDS[f], period: "day", used: day, cap: cap.day, at_cap: GOOGLE_AT_CAP[f] });
      out.push({ feature: `google_${f}`, text: GOOGLE_WORDS[f], period: "month", used: month, cap: cap.month, at_cap: GOOGLE_AT_CAP[f] });
    }
  }
  if (routing.error) console.error(`issues: routing_calls skipped: ${routing.error.message}`);
  else {
    const calls = (p: string) => (routing.data ?? []).filter((r) => r.provider === p).reduce((n, r) => n + r.calls, 0);
    out.push({
      feature: "ors_directions",
      text: "openrouteservice directions",
      period: "day",
      used: calls("ors") + calls("ors_gap"),
      cap: ORS_DAILY_BUDGET,
      at_cap: "the legs are estimated and the gaps stay straight",
    });
    out.push({
      feature: "ors_gap",
      text: "openrouteservice estimated lines",
      period: "day",
      used: calls("ors_gap"),
      cap: settings.ors_gap_daily_cap,
      at_cap: "the gaps stay straight",
    });
    out.push({
      feature: "ors_autocomplete",
      text: "openrouteservice map search",
      period: "day",
      used: calls("ors_autocomplete"),
      cap: settings.ors_autocomplete_daily_cap,
      at_cap: "only our own places show",
    });
  }
  if (odometer.error) console.error(`issues: odometer_calls skipped: ${odometer.error.message}`);
  else {
    for (const r of odometer.data ?? []) {
      if (r.mode === "server") {
        out.push({
          feature: "odometer_server",
          text: "Odometer checks (server)",
          period: "day",
          used: r.calls,
          cap: settings.odometer_server_daily_cap,
          at_cap: "the checks wait",
        });
      } else {
        out.push({
          feature: `odometer_driver:${r.scope}`,
          text: `Odometer reads by ${nameOf(r.scope) ?? "a driver"}`,
          period: "day",
          used: r.calls,
          cap: ODOMETER_DRIVER_DAILY_CAP,
          at_cap: "the phone reads no more photos",
          employee_id: r.scope,
        });
      }
    }
  }
  return out;
}

/** A phone's map report that the office hears of (Part 6): the same phone failed twice in a row, or two phones within an hour. Pure. */
export interface MapReportRow {
  employee_id: string;
  failures: number;
  last_failed_at: string | null;
  google_failed_at: string | null;
  reason?: string | null;
  app_version?: string | null;
}
export const MAP_ALARM_WINDOW_MS = 60 * 60_000;

export function mapAlarms<R extends MapReportRow>(rows: readonly R[], now: Date): { row: R; why: "again" | "two_phones" }[] {
  const recent = rows.filter((r) => {
    const at = Date.parse(r.last_failed_at ?? r.google_failed_at ?? "");
    return Number.isFinite(at) && now.getTime() - at <= MAP_ALARM_WINDOW_MS;
  });
  const twoPhones = recent.length >= 2 ? new Set(recent.map((r) => r.employee_id)) : new Set<string>();
  return rows.flatMap((r): { row: R; why: "again" | "two_phones" }[] =>
    (r.failures ?? 1) >= 2 ? [{ row: r, why: "again" }] : twoPhones.has(r.employee_id) ? [{ row: r, why: "two_phones" }] : []
  );
}

/** The "notified" line of an issue told at its source: who got the push (the outbox) and when. */
async function noteWhoWasTold(db: Db, issueId: string, w: Wanted, now: Date): Promise<void> {
  const told = db.from("notifications").select("recipient_employee_id, created_at");
  let query;
  if (w.told_tag) {
    // Round 4–7 (4a): a vehicle check's problem, told by its own notification (urgent or normal) under the check's tag.
    query = told.in("event", ["vehicle.check_urgent", "vehicle.check_problem"]).eq("payload->>tag", w.told_tag);
  } else {
    const event = TOLD_EVENT[w.kind];
    if (!event || !w.task_id) return;
    // This time's pushes only: a vehicle request by its report's tag; a task that needs a driver from the moment it did
    // (a task declined, given back and declined again has two rounds).
    query = told.eq("event", event).eq("payload->>task_id", w.task_id);
    if (w.kind === "vehicle_needed" && w.vehicle_report_id) query = query.eq("payload->>tag", `vehicle-needed:${w.vehicle_report_id}`);
    else {
      const since = unwrapMaybe(await db.from("tasks").select("needs_driver_since").eq("id", w.task_id).maybeSingle(), "task")
        ?.needs_driver_since;
      if (since) query = query.gte("created_at", since);
    }
  }
  const rows = unwrap(await query.order("created_at"), "notifications");
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
  // Hotfix 3 (L2): tasks never started whose leave-by passed over a day ago become missed (no push), first.
  if (full) {
    const { error } = await db.rpc("mark_missed_tasks");
    if (error) console.error(`mark_missed_tasks: ${error.message}`);
  }
  const mutedSince = new Date(now.getTime() - ms(30)).toISOString();
  const [wantedAll, activeRes, mutedRes] = await Promise.all([
    computeWanted(db, now, scope),
    scoped(
      db.from("issues").select("id, ref_key, kind, status, severity, title, detail, due, sort_key, task_id").in("status", ACTIVE),
      scope,
    ),
    scoped(
      db.from("issues").select("ref_key, severity, resolved_at").in("status", ["resolved", "dismissed"]).neq("resolved_by", "system").gte(
        "resolved_at",
        mutedSince,
      ).order("resolved_at", { ascending: false }),
      scope,
    ),
  ]);
  // Round 4–7 (item 8): information closed automatically stays closed (unless it comes back worse), with no time limit:
  // every one of them, page by page (one read stops at 1,000 rows, and a key left out would open again).
  const autoClosed = await fetchAll(
    (from, to) =>
      scoped(
        db.from("issues").select("ref_key, severity").eq("status", "resolved").eq("resolved_by", "system")
          .eq("resolution_note", AUTO_CLOSED_NOTE),
        scope,
      ).order("id").range(from, to),
    "issues",
    200000,
  );
  const active = unwrap(activeRes, "issues") as (ActiveRow & { task_id: string | null })[];
  // Hotfix 3 (L2): an issue about a task that is over and left over a day ago expires (resolved by the system, "Expired"):
  // the task kinds only (a vehicle problem reported during a task, an odometer check, stay until a person closes them),
  // and never the missed-task issue itself, which waits for a person.
  const expired = await expiredTasks(db, [...active.map((r) => r.task_id), ...wantedAll.map((w) => w.task_id)], now);
  const wanted = wantedAll.filter((w) => !(w.task_id && expired.has(w.task_id) && expiresWithTask(w.kind)));
  const muted = new Map<string, Severity>();
  for (const r of unwrap(mutedRes, "issues")) if (!muted.has(r.ref_key)) muted.set(r.ref_key, r.severity as Severity);
  for (const r of autoClosed) if (!muted.has(r.ref_key)) muted.set(r.ref_key, r.severity as Severity);

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
    if (TOLD_AT_SOURCE.has(w.kind) || w.told_tag) {
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
    const taskId = (row as ActiveRow & { task_id?: string | null }).task_id;
    const note = taskId && expired.has(taskId) && expiresWithTask(row.kind) ? EXPIRED_NOTE : null;
    const done = unwrap(
      await db.from("issues").update({
        status: "resolved",
        resolved_at: nowIso,
        resolved_by: "system",
        updated_at: nowIso,
        ...(note && { resolution_note: note }),
      })
        .eq("id", row.id).in("status", ACTIVE).select("id"),
      "issues",
    );
    if (done.length === 0) continue;
    await writeEvent(db, row.id, "auto_resolved", {
      actor: "system",
      from_status: row.status,
      to_status: "resolved",
      at: now,
      ...(note && { note }),
    });
    resolved += 1;
  }
  // Round 4–7 (item 8): information open for 7 days that nobody took closes by itself ("closed automatically", listed
  // under Resolved); it stays closed unless it comes back worse.
  if (full) {
    const cut = new Date(now.getTime() - ms(AUTO_CLOSE_DAYS)).toISOString();
    const stale = unwrap(
      await db.from("issues").select("id").eq("status", "open").eq("severity", "info").is("assigned_to", null).lt("opened_at", cut),
      "issues",
    );
    for (const row of stale) {
      const done = unwrap(
        await db.from("issues").update({
          status: "resolved",
          resolved_at: nowIso,
          resolved_by: "system",
          resolution_note: AUTO_CLOSED_NOTE,
          updated_at: nowIso,
        }).eq("id", row.id).eq("status", "open").select("id"),
        "issues",
      );
      if (!done.length) continue;
      await writeEvent(db, row.id, "auto_resolved", {
        actor: "system",
        from_status: "open",
        to_status: "resolved",
        note: AUTO_CLOSED_NOTE,
        at: now,
      });
      resolved += 1;
    }
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

/** The kinds that expire with their task (Hotfix 3, L2): the task's own, and a plan that could not be routed. */
export const expiresWithTask = (kind: string): boolean => kind !== "missed_task" && (TASK_KINDS.has(kind) || kind === "routing_failed");

/** The note on an issue that expired with its task. */
export const EXPIRED_NOTE = "Expired: the task is over and its leave-by passed over 24 hours ago";

/** The tasks among these that are over (completed, cancelled, missed) and left over a day ago. */
async function expiredTasks(db: Db, ids: (string | null | undefined)[], now: Date): Promise<Set<string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Set<string>();
  if (unique.length === 0) return out;
  const rows = (await Promise.all(
    inChunks(unique).map(async (chunk) => unwrap(await db.from("tasks").select("id, status, leave_by, start_at").in("id", chunk), "tasks")),
  )).flat();
  for (const t of rows) {
    if (OVER.has(t.status) && Date.parse(t.leave_by ?? t.start_at) < now.getTime() - EXPIRE_AFTER_MS) out.add(t.id);
  }
  return out;
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
