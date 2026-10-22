// Round 2b (21 October 2026): the Activity log (Google Workspace's admin audit log): who changed what and when, from
// office_audit, for the people who look after the accounts (users). Only changes: the tools that write (every read is
// audited too, but a log of every page view hides the changes) and the driver app's own events (a task started or
// finished, a vehicle problem reported). In words, never the record's internals: the action by its tool's title, the
// thing it was about (a name, an e-mail, a plate, a title from the call's own arguments), the channel, and whether it was
// done, refused (with the refusal's sentence, which is written for people) or failed.

import { z } from "zod";

import { unwrap } from "../db.ts";
import { pageInfo, pageWindow } from "../paging.ts";
import { addDays, colomboDate, colomboDateTime, dayRange } from "../time.ts";
import { type AnyTool, tool, zDate, zPaging, zText } from "../tool.ts";

/** The driver app's events (written by triggers, and driver-api's own calls): their words. */
const DRIVER_EVENTS: Record<string, string> = {
  driver_task_in_progress: "Driver started a task",
  driver_task_completed: "Driver finished a task",
  driver_report: "Driver reported a vehicle problem",
  // Round 3: the trips a driver starts in the app, and their profile (driver-api).
  start_trip: "Driver started a trip",
  add_trip_stop: "Driver added a stop to a trip",
  cancel_trip: "Driver cancelled a trip",
  update_my_profile_driver: "Driver changed their profile",
};

/**
 * Round 3 (Google Workspace / GitHub audit log): routine actions, repeated with no real change: watching drivers,
 * "reviewing" a request, collapsing a section, loading a map, reading a notification, a browser's push, a Google pick,
 * an upload's ticket. Hidden unless asked for (include_routine); one that was refused or failed always shows.
 */
export const ROUTINE: ReadonlySet<string> = new Set([
  "watch_drivers",
  "reviewing",
  "set_my_prefs",
  "register_map_load",
  "mark_inbox_read",
  "register_web_push",
  "remove_web_push",
  "google_place",
  "photo_upload_url",
  "vehicle_document_upload_url",
]);

const CHANNEL_WORDS: Record<string, string> = { claude: "Claude", web: "Website or app", driver: "Driver app" };

/** The keys of a call's arguments that name what it was about, in this order. */
const TARGET_KEYS = ["name", "email", "username", "reg_no", "title", "driver", "vehicle", "place", "label"] as const;

/** "Kasun Silva · WP CAB-4521": what the call was about, from its own (redacted) arguments; empty when nothing names it. */
export function targetOf(argsSummary: string | null): string {
  if (!argsSummary) return "";
  try {
    const args = JSON.parse(argsSummary) as Record<string, unknown>;
    const parts = TARGET_KEYS.map((k) => args[k]).filter((v): v is string =>
      typeof v === "string" && v.trim() !== "" && !v.startsWith("[")
    );
    return [...new Set(parts)].slice(0, 2).join(" · ");
  } catch {
    return "";
  }
}

/** done | refused | failed (a call still running says done once it finishes; "started" is shown as in progress). */
export function outcomeOf(resultSummary: string | null): { outcome: "done" | "refused" | "failed" | "running"; reason?: string } {
  const s = resultSummary ?? "";
  if (s === "started") return { outcome: "running" };
  if (s.startsWith("refused: ")) return { outcome: "refused", reason: s.slice("refused: ".length) };
  if (s.startsWith("error: ")) return { outcome: "failed" };
  return { outcome: "done" };
}

/** Every tool (for their titles and which of them write): handed over by index.ts, which owns the list. */
let allTools: () => readonly AnyTool[] = () => [];
export function setActivityTools(list: () => readonly AnyTool[]): void {
  allTools = list;
}

/** Round 4–7 (item 9): the activity log's routine entries: every read and the routine writes (kept 30 days, not 2 years). */
export function routineToolNames(): string[] {
  return [...new Set([...ROUTINE, ...allTools().filter((t) => t.readOnly).map((t) => t.name)])];
}

export const activityLog = tool({
  name: "activity_log",
  title: "Activity log",
  description: "Who changed what and when (the office's audit log): every change made through the website, the app or Claude, " +
    "and the driver app's own events, newest first. Filter by person and by days (default the last 7). Each entry: when, " +
    "who, through which channel, the action, what it was about, and done / refused (with the reason) / failed. Reads are " +
    "not listed; routine actions (watching drivers, reading notifications, loading a map and the like) only with include_routine, " +
    "unless they were refused or failed. For the people who look after the accounts.",
  readOnly: true,
  input: z.object({
    from: zDate.optional().describe("First day, YYYY-MM-DD (default 6 days before to)"),
    to: zDate.optional().describe("Last day, YYYY-MM-DD (default today)"),
    person: zText(120).optional().describe("A person's name or e-mail (office) or username (driver)"),
    include_routine: z.boolean().optional().describe("Also the routine actions (default false: changes, refusals and failures only)"),
    ...zPaging,
  }),
  async run({ from, to, person, include_routine = false, limit = 50, cursor }, { db, now }) {
    const titles = new Map(allTools().map((t) => [t.name, t]));
    const writes = [...allTools().filter((t) => !t.readOnly).map((t) => t.name), ...Object.keys(DRIVER_EVENTS)];
    const changes = writes.filter((t) => !ROUTINE.has(t));
    const routine = writes.filter((t) => ROUTINE.has(t));
    const last = to ?? colomboDate(now);
    const first = from ?? addDays(last, -6);
    const span = { from: dayRange(first).from, to: dayRange(last).to };
    let personId: string | null | undefined;
    if (person) {
      const p = person.trim().toLowerCase();
      const rows = unwrap(await db.from("employees").select("id, name, email, username").limit(2000), "people");
      const hit = rows.find((e) => [e.name, e.email ?? "", e.username ?? ""].some((x) => x.toLowerCase() === p)) ??
        rows.find((e) => e.name.toLowerCase().includes(p));
      personId = hit?.id ?? null;
      if (personId === null) {
        return { result: { from: first, to: last, count: 0, total: 0, entries: [] }, summary: `activity log: nobody called ${person}` };
      }
    }
    const w = pageWindow(limit, cursor);
    let q = db.from("office_audit").select("id, at, tool, args_summary, result_summary, actor_name, channel", { count: "exact" })
      .gte("at", span.from).lt("at", span.to);
    q = include_routine ? q.in("tool", writes) : q.or(
      `tool.in.(${changes.join(",")}),and(tool.in.(${
        routine.join(",")
      }),or(result_summary.like."refused:*",result_summary.like."error:*"))`,
    );
    if (personId) q = q.eq("actor_employee_id", personId);
    const res = await q.order("at", { ascending: false }).order("id", { ascending: false }).range(
      w.offset,
      w.offset + (w.limit ?? 50) - 1,
    );
    const rows = unwrap(res, "activity");
    return {
      result: {
        from: first,
        to: last,
        count: rows.length,
        ...pageInfo(w, rows.length, res.count ?? rows.length),
        entries: rows.map((r) => {
          const o = outcomeOf(r.result_summary);
          return {
            id: r.id,
            at: colomboDateTime(r.at),
            person: r.actor_name ?? undefined,
            channel: CHANNEL_WORDS[r.channel ?? ""] ?? undefined,
            action: DRIVER_EVENTS[r.tool] ?? titles.get(r.tool)?.title ?? "A change",
            about: targetOf(r.args_summary) || undefined,
            routine: ROUTINE.has(r.tool) || undefined,
            outcome: o.outcome,
            reason: o.reason,
          };
        }),
      },
      summary: `activity log ${first} – ${last}: ${rows.length}${person ? ` by ${person}` : ""}`,
    };
  },
});
