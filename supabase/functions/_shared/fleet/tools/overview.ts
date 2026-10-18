// fleet_overview: the numbers and lists of the Overview / Fleet today screens.
// needs_attention is the list of active issues (issues.ts): the overview brings
// it in line with the data first (skipped when a sync finished under 60 s ago), then reads it.

import { z } from "zod";
import { unwrap } from "../db.ts";
import { loadLatest, loadRefs, nearestTown, sharing, statusOf } from "../fleet.ts";
import { contactLinks, mapsPoint } from "../format.ts";
import { ACTIVE, scopeOf, syncIssuesIfStale } from "../issues.ts";
import { ago, colomboDate, colomboDateTime, dayRange } from "../time.ts";
import { realDate, tool, zDate } from "../tool.ts";
import { hasAny } from "../permissions.ts";
import { needsDriverList } from "./tasks.ts";

const REMINDER_DAYS = 14;

export const fleetOverview = tool({
  name: "fleet_overview",
  title: "Fleet overview",
  description: "The fleet at a glance: vehicles on the road / total / parked, tasks of the day (in progress, done), requests waiting " +
    "(and the oldest), who is on the road now, and what needs attention: the active issues (vehicle problems, odometer checks, km " +
    "outside tasks, service and documents due, licences, km allowance, rental ends, garage bookings, a running task's signal, late " +
    "starts, running late, tasks not accepted or declined, requests waiting, failed pushes or routing calls), each with its issue_id for " +
    "update_issue. The task counts follow `date`; everything else describes now. needs_attention is answered in full with the issues " +
    "permission, with the task items only with assign_tasks, and empty otherwise. First, for approve or assign_tasks, needs_driver: the " +
    "tasks declined or not accepted in time, with the reason, the minutes to the start and the best free driver.",
  readOnly: true,
  input: z.object({ date: zDate.optional().describe("Day for the task counts. Default: today") }),
  async run({ date }, { db, now, actor }) {
    const today = colomboDate(now);
    const day = realDate(date ?? today);
    const { from, to } = dayRange(day);

    const [refs, latest, dayTasks, runningRes, waitingRes] = await Promise.all([
      loadRefs(db),
      loadLatest(db),
      db.from("tasks").select("id, status").gte("start_at", from).lt("start_at", to),
      db.from("tasks").select("id, title, employee_id, vehicle_id, started_at").eq("status", "in_progress").order("started_at"),
      db.from("vehicle_requests").select("id, created_at").in("status", ["waiting", "changed"]).order("created_at"),
    ]);
    const tasks = unwrap(dayTasks, "tasks");
    const running = unwrap(runningRes, "tasks");
    const waiting = unwrap(waitingRes, "vehicle requests");
    const vehicles = refs.vehicles.filter((v) => v.active);

    const stops = running.length > 0
      ? unwrap(
        await db.from("task_stops").select("task_id, seq, place_name").in("task_id", running.map((t) => t.id)).neq("status", "removed")
          .order("seq"),
        "stops",
      )
      : [];

    const onTheRoad = await Promise.all(running.map(async (t) => {
      const driver = refs.emp.get(t.employee_id);
      const pos = latest.get(t.employee_id);
      const hasPosition = pos?.lat != null && pos?.lng != null;
      return {
        driver: driver?.name,
        vehicle: refs.veh.get(t.vehicle_id ?? "")?.reg_no,
        task: t.title,
        going_to: stops.filter((s) => s.task_id === t.id).at(-1)?.place_name,
        location: sharing(pos, now).text,
        ...statusOf(pos, now).fields,
        near: hasPosition ? await nearestTown(db, pos.lat!, pos.lng!) : undefined,
        links: { maps: hasPosition ? mapsPoint(pos.lat!, pos.lng!) : undefined, ...contactLinks(driver?.phone) },
      };
    }));

    // --- Needs attention: the active issues, brought in line with the data first (unless a sync is under a minute old) ---
    await syncIssuesIfStale(db, now);
    const issues = unwrap(
      await db.from("issues").select("id, kind, severity, title, detail, due, sort_key, vehicle_id").in("status", ACTIVE)
        .order("sort_key").order("opened_at"),
      "issues",
    );
    const attention = issues.map((i) => ({
      what: i.title,
      subject: i.detail ?? "",
      // Phase 7 (§16): the plate of the vehicle it is about, for the Reminders list.
      vehicle: i.vehicle_id ? refs.veh.get(i.vehicle_id)?.reg_no : undefined,
      due: i.due ?? "",
      level: i.severity === "critical" ? "red" : "amber",
      issue_id: i.id,
      kind: i.kind,
      severity: i.severity,
      scope: scopeOf(i.kind),
    }));
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
      needs_attention: shown.map(({ scope: _scope, ...item }) => item),
    };
    // Phase 7 (§19): the tasks that need a driver, for the people who can give them one (the red block at the top).
    const needsDriver = hasAny(actor.permissions, ["approve", "assign_tasks"]) ? await needsDriverList(db, refs, now) : [];
    return {
      result: needsDriver.length ? { needs_driver: { count: needsDriver.length, tasks: needsDriver }, ...result } : result,
      summary:
        `${onRoadVehicles}/${vehicles.length} on the road, ${result.tasks.total} tasks, ${waiting.length} requests waiting, ${shown.length} reminders` +
        (shown.length !== attention.length ? ` shown of ${attention.length}` : ""),
    };
  },
});
