// Part 3b (H5): the Drivers board: every active driver as one row (H2: the status now, last seen, the next task, the usual
// start, Call and WhatsApp), filters, and the week view of their tasks and when they are not available.

import { z } from "zod";
import type { AvailabilityWindow } from "../availability.ts";
import { unwrap } from "../db.ts";
import { loadRefs } from "../fleet.ts";
import { personLinks, plain } from "../format.ts";
import { addDays, colomboDate, colomboDateTime, colomboTime, dayRange, utcIso } from "../time.ts";
import { realDate, tool, zDate, zSearch } from "../tool.ts";
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
  }),
  async run({ filter = "all", search, week_from }, { db, now }) {
    const refs = await loadRefs(db);
    const today = colomboDate(now);
    const w: AvailabilityWindow = {
      from: now.toISOString(),
      to: new Date(now.getTime() + 60_000).toISOString(),
      day_end: dayRange(today).to,
    };
    const { rows } = await driverRows(db, refs, w, now, null);
    const byName = new Map(refs.employees.map((e) => [e.username ?? e.name, e]));
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
      result: { as_of: colomboDateTime(now), filter, counts, count: shown.length, drivers: shown, week },
      summary: `drivers board: ${shown.length} (${filter})${week ? `, week from ${week.from}` : ""}`,
    };
  },
});
