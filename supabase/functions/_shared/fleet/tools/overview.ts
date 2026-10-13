// fleet_overview: the numbers and lists of the Overview / Fleet today screens.

import { needsAttention } from "../status.ts";
import { z } from "zod";
import { unwrap } from "../db.ts";
import {
  GAP_ATTENTION_KM,
  loadGaps,
  loadLatest,
  loadRefs,
  monthKm,
  nearestTown,
  odometerCheck,
  service,
  sharing,
  statusOf,
  VEHICLE_DOCS,
  vehicleLabel,
} from "../fleet.ts";
import { contactLinks, mapsPoint, thousands } from "../format.ts";
import { ago, colomboDate, colomboDateTime, colomboDayTime, dayRange, daysBetween, shortDate } from "../time.ts";
import { realDate, tool, zDate } from "../tool.ts";
import { DECLINE_TEXT } from "./tasks.ts";

const REMINDER_DAYS = 14;
/** Flagged odometer readings and big km gaps stay in "needs attention" this long. */
const ODOMETER_FLAG_DAYS = 7;

interface Attention {
  what: string;
  subject: string;
  due: string;
  level: "red" | "amber";
  /** Days until due; negative = overdue. Used for sorting only. */
  days: number;
  /** task = about a running task (the dispatcher's business); fleet = documents, service, km, reports, readings. */
  scope: "task" | "fleet";
}

function dueText(days: number, date: string): string {
  if (days < 0) return `${-days} d overdue`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return days <= 7 ? `in ${days} days` : shortDate(date);
}

export const fleetOverview = tool({
  name: "fleet_overview",
  title: "Fleet overview",
  description: "The fleet at a glance: vehicles on the road / total / parked, tasks of the day (in progress, done), requests waiting " +
    "(and the oldest), reminders due in the next 14 days, who is on the road now, and what needs attention " +
    "(documents, service, km allowance, rental end, driver licences, open vehicle problems, odometer readings flagged in the last 7 days, " +
    `km outside tasks over ${GAP_ATTENTION_KM} km in the last 7 days). ` +
    "The task counts follow `date`; everything else describes now. needs_attention is answered in full with the issues permission, " +
    "with the task items only (location off / no signal during a task) with assign_tasks, and empty otherwise.",
  readOnly: true,
  input: z.object({ date: zDate.optional().describe("Day for the task counts. Default: today") }),
  async run({ date }, { db, now, actor }) {
    const today = colomboDate(now);
    const day = realDate(date ?? today);
    const { from, to } = dayRange(day);

    const [refs, latest, dayTasks, runningRes, waitingRes, reportsRes, flaggedRes, declinedRes, unacceptedRes] = await Promise.all([
      loadRefs(db),
      loadLatest(db),
      db.from("tasks").select("id, status").gte("start_at", from).lt("start_at", to),
      db.from("tasks").select("id, title, employee_id, vehicle_id, started_at").eq("status", "in_progress").order("started_at"),
      db.from("vehicle_requests").select("id, created_at").eq("status", "waiting").order("created_at"),
      db.from("vehicle_reports").select("id, vehicle_id, employee_id, category, created_at, status").neq("status", "closed").order(
        "created_at",
      ),
      db.from("odometer_logs").select("id, vehicle_id, employee_id, reading_km, ai_value, entry, flag, ai_checked_at, logged_at")
        .not("flag", "is", null).gte("logged_at", new Date(now.getTime() - ODOMETER_FLAG_DAYS * 86400000).toISOString())
        .order("logged_at", { ascending: false }),
      // Declined tasks that nobody has given to another driver yet (yesterday's and later).
      db.from("tasks").select(
        "id, title, employee_id, start_at, leave_by, declined_at, declined_reason, declined_note, declined_after_accept",
      )
        .eq("status", "declined").gte("start_at", new Date(now.getTime() - 86400000).toISOString()).order("start_at"),
      // Reminded to accept, still not accepted, not left yet.
      db.from("tasks").select("id, title, employee_id, start_at, leave_by, sent_at")
        .eq("status", "assigned").is("accepted_at", null).not("accept_reminder_sent_at", "is", null)
        .gte("start_at", now.toISOString()).order("start_at"),
    ]);
    const declined = unwrap(declinedRes, "declined tasks");
    const unaccepted = unwrap(unacceptedRes, "unaccepted tasks");
    const flagged = unwrap(flaggedRes, "odometer logs");
    const tasks = unwrap(dayTasks, "tasks");
    const running = unwrap(runningRes, "tasks");
    const waiting = unwrap(waitingRes, "vehicle requests");
    const reports = unwrap(reportsRes, "vehicle reports");
    const vehicles = refs.vehicles.filter((v) => v.active);

    const weekAgo = new Date(now.getTime() - ODOMETER_FLAG_DAYS * 86400000).toISOString();
    const [km, gaps, stops] = await Promise.all([
      monthKm(db, vehicles.map((v) => v.id), today.slice(0, 7)),
      loadGaps(db, vehicles.map((v) => v.id), weekAgo, now.toISOString()),
      running.length > 0
        ? db.from("task_stops").select("task_id, seq, place_name").in("task_id", running.map((t) => t.id)).order("seq")
        : { data: [], error: null },
    ]);
    const stopRows = unwrap(stops, "stops");

    const onTheRoad = await Promise.all(running.map(async (t) => {
      const driver = refs.emp.get(t.employee_id);
      const pos = latest.get(t.employee_id);
      const hasPosition = pos?.lat != null && pos?.lng != null;
      return {
        driver: driver?.name,
        vehicle: refs.veh.get(t.vehicle_id)?.reg_no,
        task: t.title,
        going_to: stopRows.filter((s) => s.task_id === t.id).at(-1)?.place_name,
        location: sharing(pos, now).text,
        ...statusOf(pos, now).fields,
        near: hasPosition ? await nearestTown(db, pos.lat!, pos.lng!) : undefined,
        links: { maps: hasPosition ? mapsPoint(pos.lat!, pos.lng!) : undefined, ...contactLinks(driver?.phone) },
      };
    }));

    // --- Needs attention ---------------------------------------------------
    const attention: Attention[] = [];
    // A task in progress whose driver has had Location off or no signal for 10 minutes or more.
    for (const t of running) {
      const { result, fields } = statusOf(latest.get(t.employee_id), now);
      if (!needsAttention(result, t.started_at, now)) continue;
      const from = result.since ?? t.started_at;
      attention.push({
        what: result.status === "location_off"
          ? (result.permissionProblem ? "Driver's location permission removed" : "Driver's location is off")
          : "No signal from the driver",
        subject: [refs.emp.get(t.employee_id)?.name, t.title, `last position ${fields.last_position_at ?? "none"}`].filter(Boolean).join(
          " · ",
        ),
        due: from ? `for ${ago(from, now)}` : "",
        level: result.status === "location_off" ? "red" : "amber",
        days: -3,
        scope: "task",
      });
    }
    // A declined task needs a driver; a task nobody accepted needs a word with the driver.
    for (const t of declined) {
      const reason = DECLINE_TEXT[t.declined_reason ?? ""] ?? t.declined_reason ?? "no reason given";
      attention.push({
        what: `Task declined${t.declined_after_accept ? " after accepting" : ""}: ${reason}`,
        subject: [refs.emp.get(t.employee_id)?.name, t.title, t.declined_note].filter(Boolean).join(" · "),
        due: `leave by ${colomboDayTime(t.leave_by ?? t.start_at)} · needs a driver`,
        level: "red",
        days: -2,
        scope: "task",
      });
    }
    for (const t of unaccepted) {
      attention.push({
        what: "Not accepted yet",
        subject: [refs.emp.get(t.employee_id)?.name, t.title, `sent ${ago(t.sent_at, now)} ago`].filter(Boolean).join(" · "),
        due: `leave by ${colomboDayTime(t.leave_by ?? t.start_at)}`,
        level: "amber",
        days: -1,
        scope: "task",
      });
    }
    const soon = (dateText: string | null) => {
      if (!dateText) return null;
      const days = daysBetween(today, dateText);
      return days <= REMINDER_DAYS ? days : null;
    };

    for (const v of vehicles) {
      const label = vehicleLabel(v) ?? v.reg_no;
      for (const doc of VEHICLE_DOCS) {
        const expiry = v[doc.column];
        const days = soon(expiry);
        if (days !== null && expiry) {
          attention.push({
            what: `${doc.name} ${days < 0 ? "expired" : "expires"}`,
            subject: label,
            due: dueText(days, expiry),
            level: days <= 7 ? "red" : "amber",
            days,
            scope: "fleet",
          });
        }
      }
      const svc = service(v, today);
      if (svc.state === "overdue" || svc.state === "due soon") {
        const days = svc.date ? daysBetween(today, svc.date) : 0;
        attention.push({
          what: svc.state === "overdue" ? "Service overdue" : "Service due",
          subject: `${v.reg_no} · ${svc.km_to_go !== null && svc.km_to_go > 0 ? `${thousands(svc.km_to_go)} km to go` : svc.text}`,
          due: svc.state === "overdue" ? "now" : svc.date ? dueText(days, svc.date) : "soon",
          level: svc.state === "overdue" ? "red" : "amber",
          days: svc.state === "overdue" ? -1 : days,
          scope: "fleet",
        });
      }
      const used = km.get(v.id) ?? 0;
      if (v.monthly_km_allowance != null && used > v.monthly_km_allowance) {
        attention.push({
          what: "Over monthly km allowance",
          subject: `${v.reg_no} · ${thousands(used)} of ${thousands(v.monthly_km_allowance)} km`,
          due: "now",
          level: "red",
          days: -1,
          scope: "fleet",
        });
      }
      const rentDays = soon(v.rent_until);
      if (rentDays !== null && v.rent_until) {
        const company = v.rental_company_id ? refs.company.get(v.rental_company_id)?.name : undefined;
        attention.push({
          what: rentDays < 0 ? "Rental agreement ended" : "Rental agreement ends",
          subject: [v.reg_no, company].filter(Boolean).join(" · "),
          due: dueText(rentDays, v.rent_until),
          level: rentDays <= 7 ? "red" : "amber",
          days: rentDays,
          scope: "fleet",
        });
      }
      const garageDays = soon(v.garage_booked_date);
      if (garageDays !== null && garageDays >= 0 && v.garage_booked_date) {
        attention.push({
          what: "Garage booked",
          subject: label,
          due: dueText(garageDays, v.garage_booked_date),
          level: "amber",
          days: garageDays,
          scope: "fleet",
        });
      }
    }
    for (const e of refs.employees) {
      const days = e.role === "driver" && e.active ? soon(e.licence_expiry) : null;
      if (days !== null && e.licence_expiry) {
        attention.push({
          what: `Driver licence ${days < 0 ? "expired" : "expires"}`,
          subject: e.name,
          due: dueText(days, e.licence_expiry),
          level: days <= 7 ? "red" : "amber",
          days,
          scope: "fleet",
        });
      }
    }
    for (const r of reports) {
      attention.push({
        what: `Vehicle problem: ${r.category.replace("_", " ")}${r.status === "in_garage" ? " (in garage)" : ""}`,
        subject: [refs.veh.get(r.vehicle_id)?.reg_no, refs.emp.get(r.employee_id)?.name].filter(Boolean).join(" · "),
        due: `reported ${ago(r.created_at, now)} ago`,
        level: "red",
        days: -2,
        scope: "fleet",
      });
    }
    for (const l of flagged) {
      attention.push({
        what: `Odometer check: ${odometerCheck(l) ?? l.flag}`,
        subject: [
          refs.veh.get(l.vehicle_id)?.reg_no,
          refs.emp.get(l.employee_id)?.name,
          `${thousands(l.reading_km)} km` +
          (l.ai_value !== null ? ` (photo ${thousands(l.ai_value)})` : ""),
        ].filter(Boolean).join(" · "),
        due: `logged ${ago(l.logged_at, now)} ago`,
        level: "amber",
        days: -1,
        scope: "fleet",
      });
    }
    for (const g of gaps) {
      if (g.km <= GAP_ATTENTION_KM) continue;
      attention.push({
        what: `Km outside tasks: ${thousands(g.km)} km ${g.type === "overnight" ? "overnight" : "between tasks"}`,
        subject: [
          refs.veh.get(g.vehicle_id)?.reg_no,
          refs.emp.get(g.from.employee_id)?.name,
          `${colomboDayTime(g.from.logged_at)} → ${colomboDayTime(g.to.logged_at)}`,
        ].filter(Boolean).join(" · "),
        due: `ended ${ago(g.to.logged_at, now)} ago`,
        level: "amber",
        days: -1,
        scope: "fleet",
      });
    }
    attention.sort((a, b) => a.days - b.days);
    // Who sees what needs attention: everything with issues, the task items with assign_tasks, nothing otherwise.
    const shown = actor.permissions.includes("issues")
      ? attention
      : actor.permissions.includes("assign_tasks")
      ? attention.filter((a) => a.scope === "task")
      : [];

    const onRoadVehicles = new Set(running.map((t) => t.vehicle_id)).size;
    const count = (status: string) => tasks.filter((t) => t.status === status).length;
    const result = {
      date: day,
      as_of: colomboDateTime(now),
      vehicles: {
        on_the_road: onRoadVehicles,
        total: vehicles.length,
        parked: vehicles.length - onRoadVehicles,
        in_garage: vehicles.filter((v) => v.in_garage).length,
      },
      tasks: {
        total: tasks.length - count("cancelled"),
        assigned: count("assigned"),
        in_progress: count("in_progress"),
        done: count("completed"),
        cancelled: count("cancelled"),
      },
      requests: { waiting: waiting.length, oldest_waiting: waiting[0] ? ago(waiting[0].created_at, now) : undefined },
      reminders: { count: shown.length, window_days: REMINDER_DAYS, red: shown.filter((a) => a.level === "red").length },
      on_the_road: onTheRoad,
      needs_attention: shown.map(({ days: _days, scope: _scope, ...item }) => item),
    };
    return {
      result,
      summary:
        `${onRoadVehicles}/${vehicles.length} on the road, ${result.tasks.total} tasks, ${waiting.length} requests waiting, ${shown.length} reminders` +
        (shown.length !== attention.length ? ` shown of ${attention.length}` : ""),
    };
  },
});
