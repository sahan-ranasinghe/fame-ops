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
import { type BoardStatus, lastSeenText, notAvailableNow, overlapping, type Unavailable, usualStart } from "../presence.ts";
import { loadSettings } from "../settings.ts";
import { driverPhotoLinks } from "../media.ts";
import { colomboDate, colomboDayTime, colomboTime, dayRange } from "../time.ts";

/** Part 3b (H2): the row's status now, one line. */
export interface NowStatus {
  kind: BoardStatus;
  text: string;
}

/**
 * Part 3b (H2): what every dispatch list says about a driver beside the window's answer: the status now, last seen (time and
 * town), the next task, the usual start. Loaded once for a list of drivers.
 */
export async function presenceOf(
  db: Db,
  ids: string[],
  now: Date,
  latest: Map<string, { lat: number | null; lng: number | null; recorded_at: string | null }>,
  withTowns = true,
) {
  if (ids.length === 0) return new Map<string, { last_seen?: string; usual_start?: string; next_task?: { title: string; when: string } }>();
  const since = new Date(now.getTime() - 40 * 86400000).toISOString();
  const week = new Date(now.getTime() + 7 * 86400000).toISOString();
  const [startsRes, nextRes] = await Promise.all([
    db.from("duty_sessions").select("employee_id, started_at").in("employee_id", ids).gte("started_at", since).limit(5000),
    db.from("tasks").select("employee_id, title, start_at, leave_by").in("employee_id", ids).eq("status", "assigned")
      .gte("start_at", now.toISOString()).lt("start_at", week).order("start_at"),
  ]);
  const starts = unwrap(startsRes, "duty sessions");
  const next = unwrap(nextRes, "tasks");
  // One call for every driver's nearest town (the database picks it; only the names come back).
  const placed = withTowns ? ids.filter((id) => latest.get(id)?.lat != null && latest.get(id)?.lng != null) : [];
  const towns = new Map<string, string>();
  if (placed.length) {
    const found = unwrap(
      await db.rpc("nearest_towns", {
        p_lat: placed.map((id) => latest.get(id)!.lat!),
        p_lng: placed.map((id) => latest.get(id)!.lng!),
      }),
      "towns",
    ) as { i: number; name: string }[];
    for (const f of found) towns.set(placed[f.i - 1], f.name);
  }
  return new Map(ids.map((id) => {
    const n = next.find((t) => t.employee_id === id);
    const at = n ? n.leave_by ?? n.start_at : null;
    return [id, {
      last_seen: lastSeenText(latest.get(id)?.recorded_at, towns.get(id), now) ?? undefined,
      usual_start: usualStart(starts.filter((s) => s.employee_id === id).map((s) => s.started_at)) ?? undefined,
      next_task: n && at
        ? { title: n.title, when: colomboDate(at) === colomboDate(now) ? colomboTime(at) : colomboDayTime(at) }
        : undefined,
    }];
  }));
}

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
  /** Part 3b (H2): the rows' last seen, usual start and next task, for the lists that show them (Who's available, the
   * board). The needs-a-driver list and the asks only need free or busy: they leave it out (it costs a town each). */
  opts: { presence?: boolean } = {},
) {
  const day = colomboDate(w.from);
  const today = colomboDate(now);
  const todayStart = dayRange(today).from;
  const [latest, settings] = await Promise.all([loadLatest(db), loadSettings(db)]);
  const drivers = refs.employees.filter((e) => e.role === "driver" && e.active && e.id !== exclude);
  const ids = drivers.map((d) => d.id);
  const dayRangeOf = dayRange(day);
  const [dayTasksRes, runningRes, openRes, endedRes, eventsRes, offRes] = await Promise.all([
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
    // Part 3b (H1): not available on the window's day, or now.
    db.from("driver_unavailability").select("id, employee_id, starts_at, ends_at, part, reason, note").in("employee_id", ids)
      .is("removed_at", null)
      .lt("starts_at", dayRangeOf.to > now.toISOString() ? dayRangeOf.to : new Date(now.getTime() + 1000).toISOString())
      .gt("ends_at", dayRangeOf.from < now.toISOString() ? dayRangeOf.from : now.toISOString()),
  ]);
  const off = unwrap(offRes, "availability") as Unavailable[];
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
      unavailable: overlapping(off.filter((u) => u.employee_id === e.id), dayRangeOf.from, dayRangeOf.to),
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
    // Hotfix 2 (J): information only, never a block (a task may take the driver's vehicle on the day).
    const vehicle_note = held ? undefined : regular ? `no vehicle yet · regular: ${regular.reg_no}` : "no vehicle yet";
    // Part 3b (H2): the status now: on a task, not available (an entry covers now), on duty, off duty.
    const awayNow = overlapping(
      off.filter((u) => u.employee_id === e.id),
      now.toISOString(),
      new Date(now.getTime() + 1000).toISOString(),
    )[0];
    const now_status: NowStatus = row.state === "on_task"
      ? { kind: "on_task", text: row.status_text }
      : awayNow
      ? { kind: "not_available", text: notAvailableNow(awayNow, now) }
      : { kind: row.state, text: row.status_text };
    return { ...row, duty: row.state, vehicle, vehicle_note, now_status, employee_id: e.id };
  }));
  const windowText = `${colomboTime(w.from)}–${w.to ? colomboTime(w.to) : "end of day"}`;
  const ranked: BestMatch[] = rankMatches(matches, windowText, firstStop ? "the pickup" : "the first stop");
  const rankOf = new Map(ranked.map((m) => [m.username ?? m.name, m]));
  const kmOf = new Map(matches.map((m) => [m.username ?? m.name, m.km_to_first]));
  // A ranked row carries its km to the first stop (0.1 km) and its reasons, so the web can hold its order while two
  // drivers are within half a kilometre of each other and still re-rank when one really moves (hotfix, 17 October).
  const withRank = rows.map((r) => {
    const m = rankOf.get(r.username ?? r.name);
    const km = kmOf.get(r.username ?? r.name);
    return m
      ? { ...r, rank: m.rank, match_why: m.why, ...(km != null ? { km_to_first: Math.round(km * 10) / 10 } : {}) }
      : { ...r, rank: undefined };
  });
  const top = ranked[0];
  const bestRow = top ? withRank.find((r) => (r.username ?? r.name) === (top.username ?? top.name)) : undefined;
  // Phase 7 (§5): each driver's photo (Who's available on Approve and Assign); Part 3b (H2): last seen, usual start, next task.
  const [photos, presence] = await Promise.all([
    driverPhotoLinks(db, drivers, now),
    opts.presence ? presenceOf(db, ids, now, latest) : Promise.resolve(null),
  ]);
  return {
    rows: rankAvailability(withRank.map(({ employee_id, ...r }) => {
      const photo = photos.get(employee_id);
      return { ...r, ...presence?.get(employee_id), ...(photo ? { photo_url: photo } : {}) };
    })),
    best: top ? { name: top.name, username: top.username, vehicle: bestRow?.vehicle, why: top.why } : undefined,
  };
}
