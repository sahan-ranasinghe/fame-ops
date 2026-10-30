// Part 3b (H1): when a driver is not available for dispatch (not HR leave): the entries, adding or changing one, removing
// one. The driver keeps their own in the app (set_my_unavailability); people with approve or assign_tasks keep anyone's here.
// The rule that turns a day and a part into times is the database's (save_unavailability), the same for both.

import { z } from "zod";
import { ToolError, unwrap } from "../db.ts";
import { archivedDriverText, findDriver, loadRefs } from "../fleet.ts";
import { REASON_TEXT, type UnavailableReason, unavailableText } from "../presence.ts";
import { addDays, colomboDate, colomboDateTime, colomboTime, daysBetween, utcIso } from "../time.ts";
import { realDate, tool, zDate, zId, zText, zTime } from "../tool.ts";

const zPart = z.enum(["full_day", "morning", "afternoon", "hours"]).describe(
  "full_day (also several days with to_date), morning (until 13:00), afternoon (from 13:00) or hours (from–to)",
);
const zReason = z.enum(["leave", "half_day", "personal", "other"]);

/** An entry as the tools answer it. */
export function entryCard(
  u: {
    id: string;
    employee_id: string;
    starts_at: string;
    ends_at: string;
    part: string;
    reason: string;
    note: string | null;
    created_by_name: string;
    channel: string;
    created_at: string;
    updated_by_name?: string | null;
  },
  name?: string,
) {
  return {
    id: u.id,
    driver: name,
    from: colomboDateTime(u.starts_at),
    to: colomboDateTime(u.ends_at),
    day: colomboDate(u.starts_at),
    last_day: u.part === "full_day" ? addDays(colomboDate(u.ends_at), -1) : colomboDate(u.starts_at),
    start_time: u.part === "hours" || u.part === "afternoon" ? colomboTime(u.starts_at) : undefined,
    end_time: u.part === "hours" || u.part === "morning" ? colomboTime(u.ends_at) : undefined,
    part: u.part,
    reason: u.reason,
    reason_text: REASON_TEXT[u.reason as UnavailableReason] ?? u.reason,
    note: u.note ?? undefined,
    text: unavailableText(u),
    added_by: u.channel === "driver" ? `${u.created_by_name} (the driver)` : u.created_by_name,
    added: colomboDateTime(u.created_at),
    changed_by: u.updated_by_name ?? undefined,
  };
}

export const unavailability = tool({
  name: "unavailability",
  title: "When drivers are not available",
  description: "Part 3b (H1): the days and times drivers are not available for dispatch (leave, half day, personal, other), " +
    "from the driver or the office, between two dates (at most 62 days), soonest first. Not HR leave.",
  readOnly: true,
  input: z.object({
    from: zDate.describe("First day, YYYY-MM-DD"),
    to: zDate.describe("Last day, YYYY-MM-DD"),
    driver: zText(80).optional().describe("Only this driver (username, code or name)"),
  }),
  async run({ from, to, driver }, { db }) {
    realDate(from, "from");
    realDate(to, "to");
    if (to < from) throw new ToolError("to must be the same day as from or later.");
    if (daysBetween(from, to) > 61) throw new ToolError("At most 62 days at a time.");
    const refs = await loadRefs(db);
    const only = driver ? findDriver(refs, driver) : null;
    let q = db.from("driver_unavailability").select("*").is("removed_at", null)
      .lt("starts_at", utcIso(addDays(to, 1))).gt("ends_at", utcIso(from));
    if (only) q = q.eq("employee_id", only.id);
    const rows = unwrap(await q.order("starts_at"), "availability");
    const entries = rows.map((u) => ({
      ...entryCard(u, refs.employees.find((e) => e.id === u.employee_id)?.name),
      username: refs.employees.find((e) => e.id === u.employee_id)?.username ?? undefined,
    }));
    return {
      result: { from, to, count: entries.length, entries },
      summary: `${entries.length} not-available entries ${from}..${to}${only ? ` for ${only.name}` : ""}`,
    };
  },
});

export const setUnavailability = tool({
  name: "set_unavailability",
  title: "A driver is not available",
  description: "Part 3b (H1): adds (or, with id, changes) when a driver is not available for dispatch: a day (or full days " +
    "to to_date), the morning, the afternoon or from–to, with a reason. Who's available, the best match and the assign " +
    "warnings use it. The driver sees it in their app.",
  readOnly: false,
  input: z.object({
    driver: zText(80).describe("Username, code or name"),
    date: zDate.describe("The day, YYYY-MM-DD"),
    to_date: zDate.optional().describe("full_day only: the last day, for several days"),
    part: zPart,
    from: zTime.optional().describe("hours only: from HH:MM"),
    to: zTime.optional().describe("hours only: to HH:MM"),
    reason: zReason,
    note: zText(300).optional(),
    id: zId.optional().describe("Change this entry instead of adding one"),
  }),
  async run(args, { db, actor }) {
    realDate(args.date, "date");
    if (args.to_date) realDate(args.to_date, "to_date");
    const driver = findDriver(await loadRefs(db), args.driver);
    if (!driver.active) throw new ToolError(archivedDriverText(driver));
    const saved = unwrap(
      await db.rpc("save_unavailability", {
        p_employee: driver.id,
        p_id: args.id ?? null,
        p_from: args.date,
        p_to: args.to_date ?? null,
        p_part: args.part,
        p_start: args.from ?? null,
        p_end: args.to ?? null,
        p_reason: args.reason,
        p_note: args.note ?? null,
        p_by_name: actor.name,
        p_by_employee: actor.employeeId,
        p_channel: actor.channel === "web" ? "web" : "claude",
      } as never),
      "availability",
    ) as { result: string; id?: string; reason?: string };
    if (saved.result !== "ok" || !saved.id) throw new ToolError(saved.reason ?? "Could not save it.");
    const row = unwrap(await db.from("driver_unavailability").select("*").eq("id", saved.id).single(), "availability");
    const entry = entryCard(row, driver.name);
    return {
      result: { saved: args.id ? "changed" : "added", entry },
      summary: `${driver.name}: ${entry.text} (${entry.day}${entry.last_day !== entry.day ? `..${entry.last_day}` : ""})`,
    };
  },
});

export const removeUnavailability = tool({
  name: "remove_unavailability",
  title: "Remove a not-available entry",
  description: "Part 3b (H1): the driver is available again then. The entry is kept as removed (who and when).",
  readOnly: false,
  input: z.object({ id: zId }),
  async run({ id }, { db, now, actor }) {
    const row = unwrap(await db.from("driver_unavailability").select("*").eq("id", id).maybeSingle(), "availability");
    if (!row || row.removed_at) throw new ToolError("This entry is not there any more.");
    unwrap(
      await db.from("driver_unavailability").update({ removed_at: now.toISOString(), removed_by_name: actor.name }).eq("id", id)
        .select("id"),
      "availability",
    );
    const name = unwrap(await db.from("employees").select("name").eq("id", row.employee_id).single(), "employee").name;
    return { result: { removed: entryCard(row, name) }, summary: `${name}: removed ${unavailableText(row)}` };
  },
});
