// Round 4–7, feature 7 (Sahan, 22 October 2026): someone else has that driver or vehicle. "Ask for it" (the holder answers
// Yes or No in one tap from the notification centre; the fleet admins see it and can reassign), the asks, a day's timeline
// per driver or per vehicle with each booking's holder (Google Calendar's resource view), and the conflict cards on the
// tools that change a trip after it is saved. The holder rule: holders.ts.

import { z } from "zod";
import { type Db, type Row, ToolError, unwrap, unwrapMaybe } from "../db.ts";
import { assignCheck, loadRefs, openTasksOn, vehicleLabel } from "../fleet.ts";
import { holderContactOn, holdersOf } from "../holders.ts";
import { notify } from "../notifications.ts";
import { colomboDate, colomboDayTime, colomboTime, dayRange, utcIso } from "../time.ts";
import { type AnyTool, type Ctx, type Out, realDate, tool, zDate, zId, zText } from "../tool.ts";

type Task = Row<"tasks">;

/** "Fri 24 Oct 09:00–12:00" */
const windowWords = (from: string, to: string | null) =>
  `${colomboDayTime(from)}${to ? `–${colomboDate(to) === colomboDate(from) ? colomboTime(to) : colomboDayTime(to)}` : ""}`;

/** The fleet admins (approve) who are told about an ask, but never the person who acts. */
async function fleetAdmins(db: Db, except: (string | null | undefined)[]): Promise<string[]> {
  const rows = unwrap(
    await db.from("employees").select("id, permissions").eq("active", true).eq("demo", false).neq("role", "driver"),
    "employees",
  );
  return rows.filter((e) => (e.permissions ?? []).includes("approve") && !except.includes(e.id)).map((e) => e.id);
}

export const askForIt = tool({
  name: "ask_for_it",
  title: "Ask for it",
  description: "Someone else holds the driver or the vehicle (a busy warning's holder): ask them for it. The holder gets it " +
    "in their notification centre with Yes / No in one tap; the fleet admins see it too and can reassign. Never changes a " +
    "trip by itself. wanted: when it is wanted (default the busy trip's own time).",
  readOnly: false,
  input: z.object({
    task_id: zId.describe("The busy trip (the conflict card's task.id)"),
    resource: z.enum(["driver", "vehicle"]),
    date: zDate.optional().describe("The day it is wanted (with from)"),
    from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().describe("HH:MM"),
    until: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().describe("HH:MM"),
    note: zText(300).optional().describe('Why, in a few words ("site visit, can\'t move it")'),
  }),
  async run(args, { db, now, actor }) {
    if (!actor.employeeId) throw new ToolError("This needs a person (the web app or a personal key): the holder answers them.");
    if (!(await holderContactOn(db))) throw new ToolError("Asking for a busy driver or vehicle is switched off (Settings → Dispatch).");
    const t = unwrapMaybe(await db.from("tasks").select("*").eq("id", args.task_id).maybeSingle(), "task");
    if (!t || !["assigned", "in_progress"].includes(t.status)) throw new ToolError("That trip is not on any more: nothing to ask.");
    const resourceId = args.resource === "driver" ? t.employee_id : t.vehicle_id;
    if (!resourceId) throw new ToolError("That trip has no vehicle yet.");
    const day = args.date ? realDate(args.date) : colomboDate(t.start_at);
    const wantedFrom = args.from ? utcIso(day, args.from) : t.start_at;
    const wantedTo = args.until ? utcIso(day, args.until) : t.end_by;
    const holder = (await holdersOf(db, [t], now, true)).get(t.id);
    if (holder?.employee_id === actor.employeeId) throw new ToolError("You hold it yourself.");
    const ask = unwrap(
      await db.from("holder_asks").insert({
        task_id: t.id,
        resource: args.resource,
        resource_id: resourceId,
        asked_by: actor.employeeId,
        holder_id: holder?.employee_id ?? null,
        wanted_from: wantedFrom,
        wanted_to: wantedTo,
        note: args.note ?? null,
      }).select("id").single(),
      "ask",
    );
    const refs = await loadRefs(db);
    const what = args.resource === "driver"
      ? refs.emp.get(resourceId)?.name ?? "the driver"
      : refs.veh.get(resourceId)?.reg_no ?? "the vehicle";
    const body = [windowWords(wantedFrom, wantedTo), `your trip "${t.title}"`, args.note].filter(Boolean).join(" · ");
    if (holder?.employee_id) {
      await notify(db, "holder.asked", {
        title: `${actor.name} asks for ${what}`,
        body,
        url: `/tasks/${t.id}`,
        tag: `ask:${ask.id}`,
        who: actor.name,
        actions: [
          { label: "Yes", tool: "answer_holder_ask", args: { ask_id: ask.id, answer: "yes" } },
          { label: "No", tool: "answer_holder_ask", args: { ask_id: ask.id, answer: "no" } },
        ],
      }, [holder.employee_id]);
    }
    const admins = await fleetAdmins(db, [actor.employeeId, holder?.employee_id]);
    if (admins.length) {
      await notify(db, "holder.asked", {
        title: `${actor.name} asks ${holder?.name ?? "the holder"} for ${what}`,
        body: `${windowWords(wantedFrom, wantedTo)} · "${t.title}"${args.note ? ` · ${args.note}` : ""}`,
        url: `/tasks/${t.id}`,
        tag: `ask:${ask.id}`,
        who: actor.name,
      }, admins);
    }
    return {
      result: {
        ask_id: ask.id,
        asked: holder?.name ?? null,
        what,
        wanted: windowWords(wantedFrom, wantedTo),
        next: holder?.employee_id
          ? `Asked ${holder.name}. You'll hear their answer; the fleet admin can reassign.`
          : "The holder has no account: the fleet admin is told and can reassign.",
      },
      summary: `asked for ${what} (${args.resource}) on "${t.title}"`,
    };
  },
});

export const answerHolderAsk = tool({
  name: "answer_holder_ask",
  title: "Answer an ask",
  description: "The holder's Yes or No to an Ask for it (a fleet admin may answer for them). The asker and the fleet admins " +
    "are told; a Yes changes nothing by itself: the fleet admin reassigns. The last answer wins.",
  readOnly: false,
  input: z.object({ ask_id: zId, answer: z.enum(["yes", "no"]) }),
  async run({ ask_id, answer }, { db, now, actor }) {
    const ask = unwrapMaybe(await db.from("holder_asks").select("*").eq("id", ask_id).maybeSingle(), "ask");
    if (!ask) throw new ToolError("No such ask.");
    const admin = actor.permissions.includes("approve");
    if (ask.holder_id !== actor.employeeId && !admin) throw new ToolError("Only the holder (or a fleet admin) answers this.");
    unwrap(
      await db.from("holder_asks").update({ answer, answered_by: actor.employeeId, answered_at: now.toISOString() }).eq("id", ask_id),
      "ask",
    );
    const refs = await loadRefs(db);
    const t = unwrapMaybe(await db.from("tasks").select("id, title").eq("id", ask.task_id).maybeSingle(), "task");
    const what = ask.resource === "driver"
      ? refs.emp.get(ask.resource_id)?.name ?? "the driver"
      : refs.veh.get(ask.resource_id)?.reg_no ?? "the vehicle";
    const said = answer === "yes" ? "Yes" : "No";
    const title = `${actor.name} said ${said}: ${what}`;
    const body = `${windowWords(ask.wanted_from, ask.wanted_to)}${t ? ` · "${t.title}"` : ""}`;
    if (ask.asked_by !== actor.employeeId) {
      await notify(db, "holder.answered", { title, body, url: `/tasks/${ask.task_id}`, tag: `ask:${ask.id}`, who: actor.name }, [ask.asked_by]);
    }
    const admins = await fleetAdmins(db, [actor.employeeId, ask.asked_by]);
    if (admins.length) {
      await notify(db, "holder.answered", {
        title,
        body: `${body}${answer === "yes" ? " · reassign it if it suits" : ""}`,
        url: `/tasks/${ask.task_id}`,
        tag: `ask:${ask.id}`,
        who: actor.name,
      }, admins);
    }
    return {
      result: { ask_id, answer, said: `${said} · ${what}`, next: answer === "yes" ? "The asker and the fleet admin are told." : "The asker is told." },
      summary: `answered ${answer} to ask ${ask_id}`,
    };
  },
});

export const holderAsks = tool({
  name: "holder_asks",
  title: "Asks for a driver or vehicle",
  description: "Asks for a busy driver or vehicle: the ones to the person, by the person, or (approve) all of the last 14 days; " +
    "each with what, when, the note and the answer.",
  readOnly: true,
  input: z.object({ which: z.enum(["to_me", "by_me", "all"]).optional().describe("Default to_me") }),
  async run({ which = "to_me" }, { db, now, actor }) {
    if (which === "all" && !actor.permissions.includes("approve")) throw new ToolError("All asks need the approve permission.");
    if (which !== "all" && !actor.employeeId) throw new ToolError("This is personal: it needs a signed-in person.");
    let q = db.from("holder_asks").select("*").gte("created_at", new Date(now.getTime() - 14 * 86400000).toISOString())
      .order("created_at", { ascending: false }).limit(200);
    if (which === "to_me") q = q.eq("holder_id", actor.employeeId!);
    if (which === "by_me") q = q.eq("asked_by", actor.employeeId!);
    const rows = unwrap(await q, "asks");
    const refs = await loadRefs(db);
    const titles = new Map(
      rows.length
        ? unwrap(await db.from("tasks").select("id, title").in("id", [...new Set(rows.map((r) => r.task_id))]), "tasks").map((
          t,
        ) => [t.id, t.title])
        : [],
    );
    return {
      result: {
        which,
        count: rows.length,
        asks: rows.map((a) => ({
          id: a.id,
          task_id: a.task_id,
          trip: titles.get(a.task_id),
          resource: a.resource,
          what: a.resource === "driver" ? refs.emp.get(a.resource_id)?.name : refs.veh.get(a.resource_id)?.reg_no,
          wanted: windowWords(a.wanted_from, a.wanted_to),
          asked_by: refs.emp.get(a.asked_by)?.name,
          holder: a.holder_id ? refs.emp.get(a.holder_id)?.name : undefined,
          note: a.note ?? undefined,
          answer: a.answer ?? undefined,
          answered_by: a.answered_by ? refs.emp.get(a.answered_by)?.name : undefined,
          answered_at: a.answered_at ? colomboDayTime(a.answered_at) : undefined,
          asked_at: colomboDayTime(a.created_at),
        })),
      },
      summary: `${rows.length} asks (${which})`,
    };
  },
});

export const dayTimeline = tool({
  name: "day_timeline",
  title: "Day timeline",
  description: "A day as Google Calendar's resource view: one row per driver or per vehicle, each booking (assigned, under " +
    "way, done) with its time, title, state and holder (who asked, else who assigned it; not while holder_contact is off), " +
    "and a driver's not-available entries. Free rows too, so a gap is seen at a glance.",
  readOnly: true,
  input: z.object({
    date: zDate.optional().describe("Default today"),
    kind: z.enum(["drivers", "vehicles"]).optional().describe("Default drivers"),
  }),
  async run({ date, kind = "drivers" }, { db, now }) {
    const day = realDate(date ?? colomboDate(now));
    const span = dayRange(day);
    const refs = await loadRefs(db);
    const tasks = unwrap(
      await db.from("tasks").select("*").in("status", ["assigned", "in_progress", "completed"]).gte("start_at", span.from)
        .lt("start_at", span.to).eq("demo", false).order("start_at"),
      "tasks",
    );
    const holders = await holdersOf(db, tasks, now);
    const off = kind === "drivers"
      ? unwrap(
        await db.from("driver_unavailability").select("employee_id, starts_at, ends_at, part, reason").is("removed_at", null)
          .lt("starts_at", span.to).gt("ends_at", span.from),
        "availability",
      )
      : [];
    const booking = (t: Task) => {
      const end = t.end_by ?? (t.plan_json as { ends_at?: string } | null)?.ends_at ?? null;
      const h = holders.get(t.id);
      return {
        task_id: t.id,
        title: t.title,
        from: colomboTime(t.started_at ?? t.start_at),
        to: t.completed_at ? colomboTime(t.completed_at) : end ? colomboTime(end) : undefined,
        status: t.status,
        driver: kind === "vehicles" ? refs.emp.get(t.employee_id)?.name : undefined,
        vehicle: kind === "drivers" && t.vehicle_id ? refs.veh.get(t.vehicle_id)?.reg_no : undefined,
        holder: h ? { name: h.name, label: h.label, photo_url: h.photo_url, by: h.by } : undefined,
      };
    };
    const rows = kind === "drivers"
      ? refs.employees.filter((e) => e.role === "driver" && e.active).map((e) => ({
        id: e.id,
        name: e.name,
        username: e.username ?? undefined,
        bookings: tasks.filter((t) => t.employee_id === e.id).map(booking),
        not_available: off.filter((u) => u.employee_id === e.id).map((u) => ({
          from: colomboTime(u.starts_at < span.from ? span.from : u.starts_at),
          to: colomboTime(u.ends_at > span.to ? span.to : u.ends_at),
          part: u.part,
          reason: u.reason ?? undefined,
        })),
      }))
      : refs.vehicles.filter((v) => v.active).map((v) => ({
        id: v.id,
        name: v.reg_no,
        label: vehicleLabel(v) ?? undefined,
        in_garage: v.in_garage || undefined,
        bookings: tasks.filter((t) => t.vehicle_id === v.id).map(booking),
      }));
    return {
      result: { date: day, kind, count: rows.length, busy: rows.filter((r) => r.bookings.length).length, rows },
      summary: `${kind} timeline ${day}: ${tasks.length} bookings`,
    };
  },
});

/**
 * The conflict cards (with the holder) on a tool that saves a trip and answered only words (book_vehicle, update_task,
 * reassign_task): the saved task is checked against the day's other trips. `taskOf`: the task id from the args or the answer.
 */
export function withConflicts<T extends AnyTool>(
  t: T,
  taskOf: (args: Record<string, unknown>, result: Record<string, unknown>) => string | undefined,
): T {
  return {
    ...t,
    async run(args: Record<string, unknown>, ctx: Ctx): Promise<Out> {
      const out = await t.run(args, ctx);
      const result = (out.result ?? {}) as Record<string, unknown>;
      const id = taskOf(args, result);
      if (!id || result.conflicts !== undefined) return out;
      const task = unwrapMaybe(await ctx.db.from("tasks").select("*").eq("id", id).maybeSingle(), "task");
      if (!task || !["assigned", "in_progress"].includes(task.status)) return out;
      const refs = await loadRefs(ctx.db);
      const { conflicts } = await assignCheck(ctx.db, {
        driver: task.driven_by === "driver" ? refs.emp.get(task.employee_id) ?? null : null,
        vehicle: task.vehicle_id ? refs.veh.get(task.vehicle_id) ?? null : null,
        startAt: task.start_at,
        endBy: task.end_by,
        plannedEnd: (task.plan_json as { ends_at?: string } | null)?.ends_at ?? null,
        ignoreTaskId: task.id,
      });
      return conflicts.length ? { ...out, result: { ...result, conflicts } } : out;
    },
  } as T;
}

export { openTasksOn };
