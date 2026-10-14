// "Who's available" (Phase 6, Part 2): every driver for a time window with a
// status chip (on duty since, off duty, on a task until), the day's counts and
// the licence, and the vehicles in suggest_vehicles' four groups. The decide
// page, the request form's "Assign now" and the task form read it.

import { z } from "zod";
import { type AvailabilityWindow, type DriverDay, driverAvailability, rankAvailability, type TaskLite } from "../availability.ts";
import { unwrap } from "../db.ts";
import { ToolError } from "../db.ts";
import { taskEta } from "../eta.ts";
import { loadLatest, loadRefs } from "../fleet.ts";
import type { Plan } from "../plan.ts";
import { loadSettings } from "../settings.ts";
import { colomboDate, colomboDateTime, colomboDayTime, colomboTime, dayRange, utcIso } from "../time.ts";
import { realDate, tool, zVehicleType } from "../tool.ts";
import { availabilityFor } from "./requests.ts";

/** "YYYY-MM-DD HH:MM" (Colombo) or an ISO time. */
function parseAt(value: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (m) {
    realDate(m[1], "at");
    return utcIso(m[1], `${m[2]}:${m[3]}`);
  }
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) throw new ToolError(`at: "${value}" is not a time. Use "YYYY-MM-DD HH:MM" (Colombo) or an ISO time.`);
  return t.toISOString();
}

export const availability = tool({
  name: "availability",
  title: "Who's available",
  description:
    "Every driver for a time window: on duty since when, off duty, or on a task until about when (live or planned), the next task " +
    "of the day, how many tasks accepted and declined today, the licence chip, and whether they are free then (no task overlaps); " +
    "free and on duty first. The vehicles in suggest_vehicles' groups (free pool, assigned to someone, busy, in the garage) for " +
    "the same window.",
  readOnly: true,
  input: z.object({
    at: z.string().min(1).describe('When the vehicle is needed: "YYYY-MM-DD HH:MM" (Colombo) or an ISO time'),
    until: z.string().optional().describe("Until when: HH:MM the same day, or an ISO time. Default: the rest of the day"),
    need_type: zVehicleType.optional(),
    pax: z.number().int().min(0).max(80).optional(),
  }),
  async run(args, { db, now }) {
    const from = parseAt(args.at);
    const day = colomboDate(from);
    const to = args.until ? (/^([01]\d|2[0-3]):[0-5]\d$/.test(args.until.trim()) ? utcIso(day, args.until.trim()) : parseAt(args.until)) : null;
    if (to && to <= from) throw new ToolError("until must be later than at.");
    const w: AvailabilityWindow = { from, to, day_end: dayRange(day).to };
    const today = colomboDate(now);
    const todayStart = dayRange(today).from;

    const [refs, latest, settings] = await Promise.all([loadRefs(db), loadLatest(db), loadSettings(db)]);
    const drivers = refs.employees.filter((e) => e.role === "driver" && e.active);
    const ids = drivers.map((d) => d.id);
    const [dayTasksRes, runningRes, openRes, endedRes, eventsRes] = await Promise.all([
      db.from("tasks").select("*").in("employee_id", ids).in("status", ["assigned", "in_progress"]).gte("start_at", w.day_end < w.from ? w.from : dayRange(day).from).lt("start_at", w.day_end),
      db.from("tasks").select("*").in("employee_id", ids).eq("status", "in_progress"),
      db.from("duty_sessions").select("employee_id, started_at").in("employee_id", ids).is("ended_at", null),
      db.from("duty_sessions").select("employee_id, ended_at").in("employee_id", ids).gte("ended_at", todayStart).order("ended_at", { ascending: false }).limit(2000),
      db.from("task_assignment_events").select("employee_id, action").in("employee_id", ids).in("action", ["accepted", "declined"]).gte("at", todayStart),
    ]);
    const dayTasks = unwrap(dayTasksRes, "tasks");
    const running = unwrap(runningRes, "tasks");
    const open = unwrap(openRes, "duty sessions");
    const ended = unwrap(endedRes, "duty sessions");
    const events = unwrap(eventsRes, "assignment history");
    const runningStops = running.length
      ? unwrap(
        await db.from("task_stops").select("task_id, seq, place_name, type, what, status, lat, lng, dwell_min, arrive_by, planned_depart_at, planned_arrive_at")
          .in("task_id", running.map((t) => t.id)).neq("status", "removed").order("seq"),
        "stops",
      )
      : [];

    const lite = (t: typeof dayTasks[number]): TaskLite => {
      const plan = t.plan_json as Plan | null;
      return { title: t.title, status: t.status, start_at: t.start_at, end_by: t.end_by, ends_planned: plan?.ends_at ?? null };
    };
    const rows = await Promise.all(drivers.map(async (e) => {
      const run = running.find((t) => t.employee_id === e.id);
      let current: TaskLite | null = null;
      if (run) {
        const stops = runningStops.filter((s) => s.task_id === run.id);
        const eta = await taskEta(db, run, stops, latest.get(e.id), settings, now);
        current = { ...lite(run), ends_live: eta?.final_eta_at ?? null };
      }
      const counts = events.filter((ev) => ev.employee_id === e.id);
      const d: DriverDay = {
        name: e.name,
        username: e.username,
        licence_expiry: e.licence_expiry,
        on_duty_since: open.find((s) => s.employee_id === e.id)?.started_at ?? null,
        off_duty_since: ended.find((s) => s.employee_id === e.id)?.ended_at ?? null,
        tasks: dayTasks.filter((t) => t.employee_id === e.id).map(lite),
        running: current,
        accepted_today: counts.filter((ev) => ev.action === "accepted").length,
        declined_today: counts.filter((ev) => ev.action === "declined").length,
      };
      return driverAvailability(d, w, today);
    }));

    const vehicles = await availabilityFor(db, refs, { neededAt: from, backBy: to, need_type: args.need_type ?? null, pax: args.pax ?? null });
    const ranked = rankAvailability(rows);
    return {
      result: {
        as_of: colomboDateTime(now),
        window: { from: colomboDayTime(from), until: to ? colomboTime(to) : "end of the day", day },
        drivers: ranked,
        counts: { free: ranked.filter((r) => r.free).length, on_duty: ranked.filter((r) => r.state !== "off_duty").length, all: ranked.length },
        vehicles: { groups: vehicles.groups, drivers_free: vehicles.drivers_free, self_drive_allowed: vehicles.self_drive_allowed },
      },
      summary: `availability ${colomboDayTime(from)}: ${ranked.filter((r) => r.free).length}/${ranked.length} drivers free, ${vehicles.groups.free_pool.length} vehicles free`,
    };
  },
});
