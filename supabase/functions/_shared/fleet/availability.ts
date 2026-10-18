// Who is free at a given time: the suggestions shown when a declined task needs
// a new driver (task_detail.suggestions). Same wording as suggest_vehicles.

import type { Db } from "./db.ts";
import { unwrap } from "./db.ts";
import { docChip, loadRefs, openTasksOn, type Task, taskWindow } from "./fleet.ts";
import { overlapping, type Unavailable, unavailableText } from "./presence.ts";
import { colomboDate, colomboTime, dayRange } from "./time.ts";

export interface FreeDriver {
  name: string;
  username: string | null;
  availability: string;
}
export interface FreeVehicle {
  reg_no: string;
  make_model: string | null;
  type: string;
  seats: number | null;
  availability: string;
}

/** Active drivers and vehicles (not in the garage) with no task overlapping the window, free-all-day first. */
export async function freeAt(
  db: Db,
  startAt: string,
  endBy: string | null,
  ignoreTaskId?: string,
): Promise<{ drivers: FreeDriver[]; vehicles: FreeVehicle[] }> {
  const day = colomboDate(startAt);
  const dayEnd = new Date(dayRange(day).to).getTime();
  const from = new Date(startAt).getTime();
  const to = endBy ? new Date(endBy).getTime() : dayEnd;
  const [refs, open, offRes] = await Promise.all([
    loadRefs(db),
    openTasksOn(db, day),
    // Part 3b (H1): a driver who is not available then is not suggested.
    db.from("driver_unavailability").select("employee_id, starts_at, ends_at").is("removed_at", null)
      .lt("starts_at", new Date(to).toISOString()).gt("ends_at", new Date(from).toISOString()),
  ]);
  const away = new Set(unwrap(offRes, "availability").map((u) => u.employee_id));
  const tasks = open.filter((t) => t.id !== ignoreTaskId);
  const busy = (t: Task) => new Date(t.start_at).getTime() < to && from < (t.end_by ? new Date(t.end_by).getTime() : dayEnd);
  const availability = (mine: Task[]): string | null => {
    if (mine.some(busy)) return null;
    return mine.length === 0 ? "free all day" : `free at that time (other task ${taskWindow(mine[0])})`;
  };
  const rank = (a: { availability: string }, b: { availability: string }) =>
    Number(b.availability === "free all day") - Number(a.availability === "free all day");

  const drivers = refs.employees
    .filter((e) => e.role === "driver" && e.active && !away.has(e.id))
    .flatMap((e) => {
      const text = availability(tasks.filter((t) => t.employee_id === e.id));
      return text ? [{ name: e.name, username: e.username, availability: text }] : [];
    })
    .sort(rank);
  const vehicles = refs.vehicles
    .filter((v) => v.active && !v.in_garage)
    .flatMap((v) => {
      const text = availability(tasks.filter((t) => t.vehicle_id === v.id));
      return text ? [{ reg_no: v.reg_no, make_model: v.make_model, type: v.vehicle_type, seats: v.seats, availability: text }] : [];
    })
    .sort(rank);
  return { drivers, vehicles };
}

// ---------------------------------------------------------------------------
// "Who's available" (Phase 6): one row per driver for a time window, with a
// status chip from the duty sessions and the tasks, the counts of the day and
// the licence. Pure: the tool loads, this decides.
// ---------------------------------------------------------------------------

export interface TaskLite {
  title: string;
  status: string;
  start_at: string;
  end_by: string | null;
  /** The last planned departure (or arrival) of the task, when it has a plan. */
  ends_planned?: string | null;
  /** The live ETA at the last stop, for a task under way. */
  ends_live?: string | null;
}

export interface DriverDay {
  name: string;
  username: string | null;
  licence_expiry: string | null;
  /** The open duty session's start, when the driver is on duty. */
  on_duty_since: string | null;
  /** When the last duty session ended, if it ended today. */
  off_duty_since: string | null;
  /** The driver's open tasks on the window's day (assigned, in progress). */
  tasks: TaskLite[];
  /** The task under way right now, whatever its day. */
  running: TaskLite | null;
  accepted_today: number;
  declined_today: number;
  /** Part 3b (H1): the driver's entries on the window's day (not available). */
  unavailable?: Unavailable[];
}

export interface AvailabilityWindow {
  from: string;
  /** null = the rest of the day. */
  to: string | null;
  /** The end of the window's day (the default `to`). */
  day_end: string;
}

export type DriverState = "on_task" | "on_duty" | "off_duty";

export interface DriverAvailability {
  name: string;
  username: string | null;
  state: DriverState;
  /** "On duty since 07:12" · "Off duty since 17:40" · "On a task until ~10:40 (live)". */
  status_text: string;
  on_duty_since?: string;
  off_duty_since?: string;
  current_task?: { title: string; ends_planned?: string; ends_live?: string };
  /** The next task of the day that starts after the window opens, HH:MM. */
  next_task_start?: string;
  accepted_today: number;
  declined_today: number;
  licence: { chip: "ok" | "orange" | "red" | "not set"; expiry?: string };
  /** No task overlaps the window. */
  free: boolean;
  /** The task that makes the driver busy, when one does (or "Not available · …", Part 3b). */
  busy_with?: string;
  /** Part 3b (H1): "Not available · half day, back 13:00" when an entry overlaps the window: never free then. */
  not_available?: string;
}

const hhmm = (iso: string) => colomboTime(iso);

/** True when the task's window and the asked window overlap (a task with no end runs to the end of its day). */
export function taskBusy(t: Pick<TaskLite, "start_at" | "end_by">, w: AvailabilityWindow): boolean {
  const from = new Date(w.from).getTime();
  const to = new Date(w.to ?? w.day_end).getTime();
  const tEnd = t.end_by ? new Date(t.end_by).getTime() : new Date(w.day_end).getTime();
  return new Date(t.start_at).getTime() < to && from < tEnd;
}

/** The status chip and the free flag of one driver. Pure. */
export function driverAvailability(d: DriverDay, w: AvailabilityWindow, today: string): DriverAvailability {
  const busy = d.tasks.find((t) => taskBusy(t, w));
  const away = overlapping(d.unavailable ?? [], w.from, w.to ?? w.day_end)[0];
  const next = d.tasks
    .filter((t) => t.status === "assigned" && new Date(t.start_at).getTime() > new Date(w.from).getTime())
    .sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
  const licence = d.licence_expiry ? docChip(d.licence_expiry, today) : { chip: "not set" as const, expiry: null };

  let state: DriverState;
  let status_text: string;
  if (d.running) {
    state = "on_task";
    const until = d.running.ends_live
      ? `${hhmm(d.running.ends_live)} (live)`
      : d.running.ends_planned
      ? `${hhmm(d.running.ends_planned)} (planned)`
      : null;
    status_text = until ? `On a task until ~${until}` : "On a task · end time not set";
  } else if (d.on_duty_since) {
    state = "on_duty";
    status_text = `On duty since ${hhmm(d.on_duty_since)}`;
  } else {
    state = "off_duty";
    status_text = d.off_duty_since ? `Off duty since ${hhmm(d.off_duty_since)}` : "Off duty";
  }

  return {
    name: d.name,
    username: d.username,
    state,
    status_text,
    on_duty_since: d.on_duty_since ? hhmm(d.on_duty_since) : undefined,
    off_duty_since: !d.on_duty_since && d.off_duty_since ? hhmm(d.off_duty_since) : undefined,
    current_task: d.running
      ? {
        title: d.running.title,
        ends_planned: d.running.ends_planned ? hhmm(d.running.ends_planned) : undefined,
        ends_live: d.running.ends_live ? hhmm(d.running.ends_live) : undefined,
      }
      : undefined,
    next_task_start: next ? hhmm(next.start_at) : undefined,
    accepted_today: d.accepted_today,
    declined_today: d.declined_today,
    licence: { chip: licence.chip, expiry: licence.expiry ?? undefined },
    free: !busy && !away,
    busy_with: busy ? `${busy.title} ${taskWindow(busy)}` : away ? unavailableText(away) : undefined,
    not_available: away ? unavailableText(away) : undefined,
  };
}

/** Free drivers first, then on duty before off duty, then by name. */
export function rankAvailability<T extends DriverAvailability>(rows: T[]): T[] {
  const order: Record<DriverState, number> = { on_duty: 0, on_task: 1, off_duty: 2 };
  return [...rows].sort((a, b) => Number(b.free) - Number(a.free) || order[a.state] - order[b.state] || a.name.localeCompare(b.name));
}

/** A driver as the best-match ranking sees them (Phase 7, §3). */
export interface MatchInput {
  name: string;
  username: string | null;
  state: DriverState;
  free: boolean;
  /** Straight-line km from the last position to the first stop; null when either is unknown. */
  km_to_first: number | null;
  tasks_today: number;
}

export interface BestMatch {
  name: string;
  username: string | null;
  rank: number;
  /** "On duty · free 08:00–12:00 · 3.2 km from the pickup · 1 task today" */
  why: string;
}

/**
 * The best match for a task: drivers on duty with no task overlapping the window, nearest to the first stop by straight
 * line from their last position (those with no position after those with one), then the fewest tasks today. Pure.
 */
export function rankMatches(rows: MatchInput[], windowText: string, firstStopWord = "the first stop"): BestMatch[] {
  return rows
    .filter((r) => r.state === "on_duty" && r.free)
    .sort((a, b) =>
      (a.km_to_first === null ? 1 : 0) - (b.km_to_first === null ? 1 : 0) ||
      (a.km_to_first ?? 0) - (b.km_to_first ?? 0) ||
      a.tasks_today - b.tasks_today ||
      a.name.localeCompare(b.name)
    )
    .map((r, i) => ({
      name: r.name,
      username: r.username,
      rank: i + 1,
      why: [
        "On duty",
        `free ${windowText}`,
        r.km_to_first !== null ? `${Math.round(r.km_to_first * 10) / 10} km from ${firstStopWord}` : null,
        `${r.tasks_today} task${r.tasks_today === 1 ? "" : "s"} today`,
      ].filter(Boolean).join(" · "),
    }));
}
