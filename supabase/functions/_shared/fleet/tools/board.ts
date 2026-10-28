// Part 3b (H5): the Drivers board: every active driver as one row (H2: the status now, last seen, the next task, the usual
// start, Call and WhatsApp), filters, and the week view of their tasks and when they are not available.

import { z } from "zod";
import { type AvailabilityWindow, tripWindow } from "../availability.ts";
import { ToolError, unwrap } from "../db.ts";
import { loadRefs } from "../fleet.ts";
import { personLinks, plain } from "../format.ts";
import { addDays, colomboDate, colomboDateTime, colomboTime, dayRange, utcIso } from "../time.ts";
import { realDate, tool, zDate, zSearch, zTime } from "../tool.ts";
import { driverRows } from "./driverRows.ts";
import { entryCard } from "./unavailability.ts";

const FILTERS = ["all", "free_now", "on_task", "off_duty", "not_available"] as const;
type Filter = typeof FILTERS[number];

export const driversBoard = tool({
  name: "drivers_board",
  title: "Drivers board",
  description: "Part 3b (H5): every active driver now: the status (on a task until, on duty, off duty, not available and " +
    "until when), last seen with the time and the town, the next task, the usual start time, the vehicle, Call and WhatsApp; " +
    "filter free_now, on_task, off_duty or not_available; with week_from the week view (7 days: each day's tasks and when " +
    "the driver is not available).",
  readOnly: true,
  input: z.object({
    filter: z.enum(FILTERS).optional().describe("Default all"),
    search: zSearch,
    week_from: zDate.optional().describe("The week view's first day, YYYY-MM-DD"),
    // Round 48: a question about a trip (Ask drivers): every row also says free or busy for THAT window.
    trip_date: zDate.optional().describe("Round 48: the trip's day the rows are also judged for (with trip_from)"),
    trip_from: zTime.optional().describe("Round 48: the trip's start, HH:MM"),
    trip_to: zTime.optional().describe("Round 48: the trip's end, HH:MM; default the rest of the day"),
  }),
  async run({ filter = "all", search, week_from, trip_date, trip_from, trip_to }, { db, now }) {
    const refs = await loadRefs(db);
    const today = colomboDate(now);
    const w: AvailabilityWindow = {
      from: now.toISOString(),
      to: new Date(now.getTime() + 60_000).toISOString(),
      day_end: dayRange(today).to,
    };
    const { rows } = await driverRows(db, refs, w, now, null, undefined, { presence: true });
    // Round 48 (Google Calendar's attendee picker): with a trip given, each row's free or busy for the trip's window.
    let trip: { date: string; from: string; to?: string; words: string } | undefined;
    const forTrip = new Map<string, { trip_free: boolean; free_text?: string; busy_text?: string; busy_from?: string; busy_to?: string; busy_title?: string }>();
    if (trip_date && trip_from) {
      realDate(trip_date, "trip_date");
      const tw = tripWindow({ start: utcIso(trip_date, trip_from), endBy: trip_to ? utcIso(trip_date, trip_to) : null });
      if (tw.end_source === "end_by" && tw.to <= tw.from) throw new ToolError("trip_to must be later than trip_from.");
      const tripRows = await driverRows(db, refs, { from: tw.from, to: tw.end_source === "day_end" ? null : tw.to, day_end: tw.day_end }, now, null);
      for (const r of tripRows.rows) {
        forTrip.set(r.username ?? r.name, {
          trip_free: r.free,
          free_text: r.free_text,
          busy_text: r.busy_text,
          busy_from: r.busy_from,
          busy_to: r.busy_to,
          busy_title: r.busy_title,
        });
      }
      trip = { date: trip_date, from: trip_from, to: trip_to, words: tripRows.window_words };
    }
    const byName = new Map(refs.employees.map((e) => [e.username ?? e.name, e]));
    // Round 2b: today's attendance from the duty sessions (no new tracking): the first start, the last finish.
    const dayStart = dayRange(today).from;
    const sessions = unwrap(
      await db.from("duty_sessions").select("employee_id, started_at, ended_at")
        .or(`started_at.gte.${dayStart},ended_at.is.null,ended_at.gte.${dayStart}`).order("started_at").limit(5000),
      "duty sessions",
    );
    const all = rows.map((r) => {
      const e = byName.get(r.username ?? r.name);
      return {
        name: r.name,
        username: r.username ?? undefined,
        photo_url: r.photo_url,
        status: r.now_status,
        free_now: r.free && r.now_status.kind === "on_duty",
        last_seen: r.last_seen,
        next_task: r.next_task,
        usual_start: r.usual_start,
        vehicle: r.vehicle,
        current_task: r.current_task,
        licence: r.licence,
        links: personLinks(e?.phone, e?.whatsapp),
        attendance: attendanceOf(sessions.filter((x) => x.employee_id === e?.id), r.now_status.kind === "not_available", dayStart),
        // Round 48: free or busy for the trip asked about (only with trip_date and trip_from).
        ...(forTrip.get(r.username ?? r.name) ?? {}),
      };
    });
    const matches = (row: typeof all[number], f: Filter) =>
      f === "all" ||
      (f === "free_now" && row.free_now) ||
      (f === "on_task" && row.status.kind === "on_task") ||
      (f === "off_duty" && row.status.kind === "off_duty") ||
      (f === "not_available" && row.status.kind === "not_available");
    const key = search ? plain(search) : "";
    const shown = all.filter((r) => matches(r, filter) && (!key || plain(`${r.name} ${r.username ?? ""}`).includes(key)));
    const counts = Object.fromEntries(FILTERS.map((f) => [f, all.filter((r) => matches(r, f)).length]));

    let week;
    if (week_from) {
      realDate(week_from, "week_from");
      const days = Array.from({ length: 7 }, (_, i) => addDays(week_from, i));
      const span = { from: utcIso(days[0]), to: utcIso(addDays(days[6], 1)) };
      const ids = refs.employees.filter((e) => e.role === "driver" && e.active).map((e) => e.id);
      const [tasksRes, offRes] = await Promise.all([
        db.from("tasks").select("id, employee_id, title, start_at, leave_by, end_by, status").in("employee_id", ids)
          .in("status", ["assigned", "in_progress", "completed"]).gte("start_at", span.from).lt("start_at", span.to).order("start_at"),
        db.from("driver_unavailability").select("*").in("employee_id", ids).is("removed_at", null)
          .lt("starts_at", span.to).gt("ends_at", span.from).order("starts_at"),
      ]);
      const tasks = unwrap(tasksRes, "tasks");
      const off = unwrap(offRes, "availability");
      week = {
        from: days[0],
        to: days[6],
        days,
        drivers: shown.map((r) => {
          const e = byName.get(r.username ?? r.name);
          return {
            name: r.name,
            username: r.username,
            days: days.map((day) => {
              const range = dayRange(day);
              const mine = tasks.filter((t) => t.employee_id === e?.id && colomboDate(t.start_at) === day);
              // Times compared as times: the database's "+00:00" and our ".000Z" do not compare as strings.
              const from = Date.parse(range.from);
              const to = Date.parse(range.to);
              const away = off.filter((u) => u.employee_id === e?.id && Date.parse(u.starts_at) < to && Date.parse(u.ends_at) > from);
              return {
                date: day,
                tasks: mine.map((t) => ({
                  id: t.id,
                  title: t.title,
                  time: colomboTime(t.leave_by ?? t.start_at),
                  end: t.end_by ? colomboTime(t.end_by) : undefined,
                  status: t.status,
                })),
                not_available: away.map((u) => entryCard(u, r.name)),
              };
            }),
          };
        }),
      };
    }
    return {
      result: { as_of: colomboDateTime(now), filter, counts, count: shown.length, drivers: shown, week, trip },
      summary: `drivers board: ${shown.length} (${filter})${week ? `, week from ${week.from}` : ""}`,
    };
  },
});

/**
 * Round 2b: a driver's attendance today (Today's attendance for the coordinators): on duty (a duty session is open),
 * finished (worked today and clocked out), on leave (not available now), or not started yet; with the first start and the
 * last finish of the day (Colombo HH:MM).
 */
export function attendanceOf(
  sessions: readonly { started_at: string; ended_at: string | null }[],
  onLeave: boolean,
  dayStart: string,
): { state: "on_duty" | "finished" | "on_leave" | "not_started"; started?: string; finished?: string } {
  const from = Date.parse(dayStart);
  const today = sessions.filter((x) => x.ended_at === null || Date.parse(x.ended_at) >= from);
  const open = today.some((x) => x.ended_at === null);
  const firstStart = today.length ? today.map((x) => Math.max(Date.parse(x.started_at), from)).reduce((a, b) => Math.min(a, b)) : null;
  const started = firstStart !== null ? colomboTime(new Date(firstStart).toISOString()) : undefined;
  if (open) return { state: "on_duty", started };
  if (today.length) {
    const lastEnd = today.map((x) => Date.parse(x.ended_at!)).reduce((a, b) => Math.max(a, b));
    return { state: "finished", started, finished: colomboTime(new Date(lastEnd).toISOString()) };
  }
  return { state: onLeave ? "on_leave" : "not_started" };
}
