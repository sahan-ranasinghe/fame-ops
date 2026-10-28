// "Who's available" (Phase 6, Part 2): every driver for a time window with a
// status chip (on duty since, off duty, on a task until), the day's counts and
// the licence, and the vehicles in suggest_vehicles' four groups. The decide
// page, the request form's "Assign now" and the task form read it.

import { z } from "zod";
import { type AvailabilityWindow, taskBusy, tripWindow } from "../availability.ts";
import { ToolError } from "../db.ts";
import { loadRefs, openTasksOn } from "../fleet.ts";
import { holdersOf } from "../holders.ts";
import { personLinks } from "../format.ts";
import { findPlace } from "./places.ts";
import { colomboDate, colomboDateTime, colomboDayTime, colomboTime, dayRange, utcIso } from "../time.ts";
import { realDate, tool, zText, zVehicleType } from "../tool.ts";
import { driverRows } from "./driverRows.ts";
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
    until: z.string().optional().describe("Until when: HH:MM the same day, or an ISO time. Default: the plan's end (planned_end), else the rest of the day"),
    planned_end: z.string().optional().describe(
      "Round 48: the plan's end (HH:MM the same day, or an ISO time) when the trip has no end time: the window ends there",
    ),
    need_type: zVehicleType.optional(),
    pax: z.number().int().min(0).max(80).optional(),
    first_stop: zText(160).optional().describe("The first stop (a saved place or site id): the best match is the nearest free driver"),
    lat: z.number().min(-90).max(90).optional().describe("Or the first stop's pin"),
    lng: z.number().min(-180).max(180).optional(),
  }),
  async run(args, { db, now }) {
    const from = parseAt(args.at);
    const day = colomboDate(from);
    const to = args.until
      ? (/^([01]\d|2[0-3]):[0-5]\d$/.test(args.until.trim()) ? utcIso(day, args.until.trim()) : parseAt(args.until))
      : null;
    if (to && to <= from) throw new ToolError("until must be later than at.");
    const plannedEnd = args.planned_end
      ? (/^([01]\d|2[0-3]):[0-5]\d$/.test(args.planned_end.trim()) ? utcIso(day, args.planned_end.trim()) : parseAt(args.planned_end))
      : null;
    // Round 48: one rule for the window (the end asked, else the plan's end, else the rest of the day). `to` stays null
    // for the rest of the day, as before, so the rows' words and the contract do not change.
    const tw = tripWindow({ start: from, endBy: to, plannedEnd, dayEnd: dayRange(day).to });
    const w: AvailabilityWindow = { from, to: tw.end_source === "day_end" ? null : tw.to, day_end: dayRange(day).to };

    const refs = await loadRefs(db);
    const place = args.lat !== undefined && args.lng !== undefined
      ? { lat: args.lat, lng: args.lng }
      : args.first_stop
      ? await findPlace(db, args.first_stop).then((p) => (p?.lat != null && p?.lng != null ? { lat: p.lat, lng: p.lng } : null))
      : null;
    const { rows: ranked, best, window_words, soon } = await driverRows(db, refs, w, now, place, undefined, { presence: true });

    const dayTasks = await openTasksOn(db, day);
    const holders = await holdersOf(db, dayTasks.filter((t) => taskBusy(t, w)));
    const vehicles = await availabilityFor(db, refs, {
      neededAt: from,
      backBy: w.to,
      need_type: args.need_type ?? null,
      pax: args.pax ?? null,
    });
    return {
      result: {
        as_of: colomboDateTime(now),
        window: {
          from: colomboDayTime(from),
          until: w.to ? colomboTime(w.to) : "end of the day",
          day,
          // Round 48: the window in words, where its end came from, and whether the best match is "on duty now" (soon)
          // or "free then".
          words: window_words,
          end_source: tw.end_source,
          soon,
        },
        // Hotfix 2 (F): Call and WhatsApp per driver (the people who approve or assign tasks).
        // Part 3b (G): WhatsApp to the driver's WhatsApp number when they gave one.
        drivers: ranked.map((r) => {
          const e = refs.employees.find((x) => x.username === r.username);
          // Round 4–7 (7): a busy driver's holder (the trip that makes them busy).
          const holding = !r.free && e ? dayTasks.find((t) => t.employee_id === e.id && taskBusy(t, w)) : undefined;
          return { ...r, phone: personLinks(e?.phone, e?.whatsapp), holder: holding ? holders.get(holding.id) : undefined };
        }),
        // Phase 7 (§3): the best match (drivers on duty and free, nearest to the first stop, then the fewest tasks today).
        best,
        counts: {
          free: ranked.filter((r) => r.free).length,
          on_duty: ranked.filter((r) => r.state !== "off_duty").length,
          all: ranked.length,
        },
        vehicles: { groups: vehicles.groups, drivers_free: vehicles.drivers_free, self_drive_allowed: vehicles.self_drive_allowed },
      },
      summary: `availability ${colomboDayTime(from)}: ${
        ranked.filter((r) => r.free).length
      }/${ranked.length} drivers free, ${vehicles.groups.free_pool.length} vehicles free`,
    };
  },
});
