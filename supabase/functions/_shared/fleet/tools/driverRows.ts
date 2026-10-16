// Every active driver for a time window, with the best match (Phase 7, §3). Its own module: the task tools read it
// for the needs-a-driver list and the availability tool for "Who's available" (tools/availability.ts imports
// requests.ts, which imports tasks.ts: keeping this apart keeps the modules free of a cycle).

import {
  type AvailabilityWindow,
  type BestMatch,
  driverAvailability,
  type DriverDay,
  rankAvailability,
  rankMatches,
  type TaskLite,
} from "../availability.ts";
import type { Db } from "../db.ts";
import { unwrap } from "../db.ts";
import { taskEta } from "../eta.ts";
import { loadLatest, type Refs } from "../fleet.ts";
import { haversineKm } from "../geo.ts";
import type { Plan } from "../plan.ts";
import { loadSettings } from "../settings.ts";
import { colomboDate, colomboTime, dayRange } from "../time.ts";

/**
 * Every active driver for a window (the status chip, free or busy, the vehicle they hold today or their regular one) and
 * the best-match ranking (Phase 7, §3) when a first stop is known. Shared by availability and the needs-a-driver list.
 */
export async function driverRows(
  db: Db,
  refs: Refs,
  w: AvailabilityWindow,
  now: Date,
  firstStop: { lat: number; lng: number } | null,
  exclude?: string,
) {
  const day = colomboDate(w.from);
  const today = colomboDate(now);
  const todayStart = dayRange(today).from;
  const [latest, settings] = await Promise.all([loadLatest(db), loadSettings(db)]);
  const drivers = refs.employees.filter((e) => e.role === "driver" && e.active && e.id !== exclude);
  const ids = drivers.map((d) => d.id);
  const [dayTasksRes, runningRes, openRes, endedRes, eventsRes] = await Promise.all([
    db.from("tasks").select("*").in("employee_id", ids).in("status", ["assigned", "in_progress"]).gte(
      "start_at",
      w.day_end < w.from ? w.from : dayRange(day).from,
    ).lt("start_at", w.day_end),
    db.from("tasks").select("*").in("employee_id", ids).eq("status", "in_progress"),
    db.from("duty_sessions").select("employee_id, started_at").in("employee_id", ids).is("ended_at", null),
    db.from("duty_sessions").select("employee_id, ended_at").in("employee_id", ids).gte("ended_at", todayStart).order("ended_at", {
      ascending: false,
    }).limit(2000),
    db.from("task_assignment_events").select("employee_id, action").in("employee_id", ids).in("action", ["accepted", "declined"]).gte(
      "at",
      todayStart,
    ),
  ]);
  const dayTasks = unwrap(dayTasksRes, "tasks");
  const running = unwrap(runningRes, "tasks");
  const open = unwrap(openRes, "duty sessions");
  const ended = unwrap(endedRes, "duty sessions");
  const events = unwrap(eventsRes, "assignment history");
  const runningStops = running.length
    ? unwrap(
      await db.from("task_stops").select(
        "task_id, seq, place_name, type, what, status, lat, lng, dwell_min, arrive_by, planned_depart_at, planned_arrive_at",
      )
        .in("task_id", running.map((t) => t.id)).neq("status", "removed").order("seq"),
      "stops",
    )
    : [];

  const lite = (t: typeof dayTasks[number]): TaskLite => {
    const plan = t.plan_json as Plan | null;
    return { title: t.title, status: t.status, start_at: t.start_at, end_by: t.end_by, ends_planned: plan?.ends_at ?? null };
  };
  const matches: Parameters<typeof rankMatches>[0] = [];
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
    // Phase 7: the vehicle the driver holds today (on duty), else their regular one.
    const held = d.on_duty_since && e.current_vehicle_id ? refs.veh.get(e.current_vehicle_id) : undefined;
    const regular = held ? undefined : refs.vehicles.find((v) => v.active && v.regular_driver_id === e.id);
    const vehicle = held
      ? { reg_no: held.reg_no, source: "on_duty" as const }
      : regular
      ? { reg_no: regular.reg_no, source: "regular" as const }
      : undefined;
    const row = driverAvailability(d, w, today);
    const pos = latest.get(e.id);
    matches.push({
      name: e.name,
      username: e.username,
      state: row.state,
      free: row.free,
      km_to_first: firstStop && pos?.lat != null && pos?.lng != null ? haversineKm({ lat: pos.lat, lng: pos.lng }, firstStop) : null,
      tasks_today: d.tasks.length,
    });
    return { ...row, duty: row.state, vehicle };
  }));
  const windowText = `${colomboTime(w.from)}–${w.to ? colomboTime(w.to) : "end of day"}`;
  const ranked: BestMatch[] = rankMatches(matches, windowText, firstStop ? "the pickup" : "the first stop");
  const rankOf = new Map(ranked.map((m) => [m.username ?? m.name, m.rank]));
  const withRank = rows.map((r) => ({ ...r, rank: rankOf.get(r.username ?? r.name) }));
  const top = ranked[0];
  const bestRow = top ? withRank.find((r) => (r.username ?? r.name) === (top.username ?? top.name)) : undefined;
  return {
    rows: rankAvailability(withRank),
    best: top ? { name: top.name, username: top.username, vehicle: bestRow?.vehicle, why: top.why } : undefined,
  };
}
