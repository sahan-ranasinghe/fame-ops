// Issues: one row per thing that needs the office's attention (docs/dispatch-plan.md,
// section 8). syncIssues computes the wanted set from the data, opens the missing
// ones, updates the existing ones in place and auto-resolves the ones whose
// condition has cleared. A ref_key is unique while open or in progress, so a
// condition never opens twice; after a resolution the same key may open again.
// The reconcile step is pure (issues_test.ts); the rules read the same helpers
// as the rest of the office tools.

import type { Db, Row } from "./db.ts";
import { unwrap } from "./db.ts";
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
export const TASK_KINDS = new Set(["signal", "late_start", "running_late", "not_accepted", "declined"]);
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
    for (const t of tasks.filter((x) => x.status === "assigned")) {
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
      if (!t.accepted_at && t.accept_reminder_sent_at) {
        wanted.push({
          kind: "not_accepted",
          ref_key: `accept:${t.id}`,
          severity: "warning",
          title: "Not accepted yet",
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
        severity: soonLeave ? "critical" : "warning",
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

  // --- Requests nobody has decided ------------------------------------------------------
  if (requestScope) {
    let q = db.from("vehicle_requests").select("*").eq("status", "waiting");
    if (scope.request_id) q = q.eq("id", scope.request_id);
    for (const r of unwrap(await q, "vehicle requests")) {
      if (new Date(r.created_at).getTime() + REQUEST_WAIT_MIN * 60000 > now.getTime()) continue;
      wanted.push({
        kind: "request_waiting",
        ref_key: `request:${r.id}`,
        severity: "warning",
        title: "Vehicle request waiting",
        detail: [r.requested_by_name, [r.route_from, r.route_to].filter(Boolean).join(" → ") || null, colomboDayTime(r.needed_at)].filter(
          Boolean,
        )
          .join(" · "),
        due: `waiting ${ago(r.created_at, now)}`,
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
  }
  for (const { row, patch } of plan.update) {
    unwrap(await db.from("issues").update({ ...patch, updated_at: nowIso }).eq("id", row.id), "issues");
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
  return { opened, updated, resolved, active: active.length + opened - resolved };
}

/** The refs an issue card needs, loaded once per call. */
export type IssueRefs = Pick<Refs, "emp" | "veh">;
