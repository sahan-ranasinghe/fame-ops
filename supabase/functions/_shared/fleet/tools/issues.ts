// The issues centre: list, take, note, resolve, dismiss; the history of one issue.
// The rows come from issues.ts (syncIssues); a person's change writes an event and,
// for a vehicle report, mirrors onto the report (resolved / dismissed = closed,
// in progress = in the garage, open = open).

import { z } from "zod";
import type { Db } from "../db.ts";
import { ToolError, unwrap, unwrapMaybe } from "../db.ts";
import { findVehicle, loadRefs, type Refs } from "../fleet.ts";
import { contactLinks } from "../format.ts";
import { ACTIVE, type IssueRow, type IssueStatus, KIND_TEXT, scopeOf, syncIssues, TASK_KINDS, writeEvent } from "../issues.ts";
import { notifyEvent } from "../notifications.ts";
import { PHOTO_LINK_NOTE, photoLinks } from "../photos.ts";
import type { Actor } from "../roles.ts";
import { addDays, colomboDate, colomboDateTime, colomboDayTime, utcIso } from "../time.ts";
import { daySpan, tool, zDate, zId, zPaging, zSearch, zText } from "../tool.ts";
import { pageInfo, pageWindow } from "../paging.ts";
import { driverPhotoLinks } from "../media.ts";

const STATUS = z.enum(["open", "in_progress", "resolved", "dismissed"]);
const KINDS = Object.keys(KIND_TEXT) as [string, ...string[]];

/** With the issues permission everything; with assign_tasks only the task kinds. */
function kindsFor(actor: Actor): "all" | string[] {
  if (actor.permissions.includes("issues")) return "all";
  if (actor.permissions.includes("assign_tasks")) return [...TASK_KINDS];
  return [];
}

/** Who opened and who took an issue, from its events (Phase 7, §9): the opened event, the latest assignment. */
interface WhoDid {
  openedBy?: string;
  takenAt?: string;
}

/** Hotfix 3 (L2): when a snooze ends: 07:00 Colombo tomorrow, or a week from now. */
export function snoozeEnd(word: "tomorrow" | "week", now: Date): string {
  return word === "tomorrow" ? utcIso(addDays(colomboDate(now), 1), "07:00") : new Date(now.getTime() + 7 * 86400_000).toISOString();
}

function issueCard(i: IssueRow, refs: Refs, who?: WhoDid, now = new Date(), photos?: Map<string, string>) {
  const driver = i.employee_id ? refs.emp.get(i.employee_id) : undefined;
  const assignee = i.assigned_to ? refs.emp.get(i.assigned_to) : undefined;
  const snoozed = i.snoozed_until && Date.parse(i.snoozed_until) > now.getTime();
  return {
    id: i.id,
    // Hotfix 3 (L2): snoozed until then, by whom (only while it lasts).
    snoozed_until: snoozed ? colomboDateTime(i.snoozed_until!) : undefined,
    snoozed_by: snoozed ? i.snoozed_by ?? undefined : undefined,
    kind: i.kind,
    kind_text: KIND_TEXT[i.kind] ?? i.kind,
    scope: scopeOf(i.kind),
    severity: i.severity,
    title: i.title,
    detail: i.detail ?? undefined,
    due: i.due ?? undefined,
    status: i.status,
    opened: colomboDateTime(i.opened_at),
    updated: colomboDateTime(i.updated_at),
    resolved: i.resolved_at ? colomboDateTime(i.resolved_at) : undefined,
    resolved_by: i.resolved_by ?? undefined,
    // Phase 7 (§9): "System · Vehicle problem" or the person; who took it and when; when it was resolved or dismissed.
    opened_by: who ? who.openedBy ?? `System · ${KIND_TEXT[i.kind] ?? i.kind}` : undefined,
    taken_by: who && assignee ? { name: assignee.name, at: who.takenAt } : undefined,
    resolved_at: i.resolved_at ? colomboDateTime(i.resolved_at) : undefined,
    resolution_note: i.resolution_note ?? undefined,
    assigned_to: assignee ? { name: assignee.name, email: assignee.email ?? undefined, photo_url: photos?.get(assignee.id) } : undefined,
    vehicle: i.vehicle_id ? refs.veh.get(i.vehicle_id)?.reg_no : undefined,
    driver: driver?.name,
    driver_username: driver?.username ?? undefined,
    task_id: i.task_id ?? undefined,
    request_id: i.request_id ?? undefined,
    vehicle_report_id: i.vehicle_report_id ?? undefined,
    driver_links: driver ? contactLinks(driver.phone) : undefined,
  };
}

async function getIssue(db: Db, id: string, actor: Actor): Promise<IssueRow> {
  const issue = unwrapMaybe(await db.from("issues").select("*").eq("id", id).maybeSingle(), "issue");
  if (!issue) throw new ToolError(`No issue has the id ${id}. list_issues shows them.`);
  const kinds = kindsFor(actor);
  if (kinds !== "all" && !kinds.includes(issue.kind)) {
    throw new ToolError("This issue is about the fleet, not a task: it needs the issues permission.");
  }
  return issue;
}

async function personByEmail(db: Db, email: string): Promise<{ id: string; name: string }> {
  const row = unwrapMaybe(
    await db.from("employees").select("id, name, active").eq("email", email.trim().toLowerCase()).maybeSingle(),
    "employee",
  );
  if (!row || !row.active) throw new ToolError(`No active office person has the e-mail ${email}. list_office_users shows them.`);
  return row;
}

export const listIssues = tool({
  name: "list_issues",
  title: "Issues",
  description: "What needs the office's attention, newest and most urgent first: vehicle problems, odometer checks, km outside tasks, " +
    "service and documents due, licences, km allowance, rental ends, garage bookings, a running task's signal, late starts, running " +
    "late, tasks not accepted or declined, requests waiting, failed pushes or routing calls. Each is opened and auto-resolved by the " +
    "system; the office takes, notes, resolves or dismisses with update_issue. With assign_tasks only (no issues permission) the task " +
    "kinds are listed.",
  readOnly: true,
  input: z.object({
    status: z.enum(["active", "open", "in_progress", "resolved", "dismissed", "all"]).optional().describe(
      "Default active (open + in progress)",
    ),
    kind: z.enum(KINDS).optional(),
    vehicle: zText(20).optional().describe("A number plate"),
    assigned_to: zText(120).optional().describe('An office e-mail, or "me"'),
    limit: z.number().int().min(1).max(500).optional().describe("Default 50 (the answer has total and next)"),
    cursor: zPaging.cursor,
    // Hotfix 3 (L2, L3).
    severity: z.enum(["critical", "warning", "info"]).optional(),
    snoozed: z.boolean().optional().describe("true = only the snoozed ones; false = leave them out; default both"),
    search: zSearch,
    from: zDate.optional().describe("Opened on or after this Colombo day, YYYY-MM-DD (with to)"),
    to: zDate.optional().describe("Opened on or before this day"),
    sort: z.enum(["urgent", "newest"]).optional().describe("urgent (the default: most urgent, then newest) or newest first"),
  }),
  async run({ status = "active", kind, vehicle, assigned_to, limit = 50, cursor, from, to, sort = "urgent", severity, snoozed, search }, {
    db,
    actor,
    now,
  }) {
    const kinds = kindsFor(actor);
    const span = daySpan(from, to);
    const refs = await loadRefs(db);
    const w = pageWindow(limit, cursor);
    const nowIso = now.toISOString();
    let q = db.from("issues").select("*", { count: "exact" });
    if (severity) q = q.eq("severity", severity);
    if (snoozed === true) q = q.gt("snoozed_until", nowIso);
    if (snoozed === false) q = q.or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`);
    if (search) {
      const words = search.replace(/[%_,()*]/g, " ").trim();
      if (words) q = q.or(`title.ilike.*${words}*,detail.ilike.*${words}*`);
    }
    if (span) q = q.gte("opened_at", span.start).lt("opened_at", span.end);
    if (status === "active") q = q.in("status", ACTIVE);
    else if (status !== "all") q = q.eq("status", status);
    if (kind) q = q.eq("kind", kind);
    if (vehicle) q = q.eq("vehicle_id", findVehicle(refs, vehicle).id);
    if (assigned_to) {
      const id = assigned_to.trim().toLowerCase() === "me" ? actor.employeeId : (await personByEmail(db, assigned_to)).id;
      if (!id) throw new ToolError('"me" needs a person: the shared connector has none. Give an e-mail.');
      q = q.eq("assigned_to", id);
    }
    if (kinds !== "all") q = q.in("kind", kinds);
    const res =
      await (sort === "newest" ? q.order("opened_at", { ascending: false }) : q.order("sort_key").order("opened_at", { ascending: false }))
        .order("id").range(w.offset, w.offset + (w.limit ?? 50) - 1);
    const rows = unwrap(res, "issues");
    const total = res.count ?? rows.length;
    // Who opened and who took each listed issue (one query for all).
    const events = rows.length
      ? unwrap(
        await db.from("issue_events").select("issue_id, action, actor, at").in("issue_id", rows.map((r) => r.id)).in("action", [
          "opened",
          "assigned",
        ])
          .order("at"),
        "issue events",
      )
      : [];
    const whoOf = (id: string): WhoDid => {
      const mine = events.filter((e) => e.issue_id === id);
      const opened = mine.find((e) => e.action === "opened");
      const taken = mine.filter((e) => e.action === "assigned").at(-1);
      return {
        openedBy: opened?.actor && opened.actor !== "system" ? opened.actor : undefined,
        takenAt: taken ? colomboDateTime(taken.at) : undefined,
      };
    };
    // The counts of everything active the person may see, whatever the filters (the bell); a snoozed one is not counted.
    let countQ = db.from("issues").select("status, snoozed_until").in("status", ACTIVE);
    if (kinds !== "all") countQ = countQ.in("kind", kinds);
    const all = unwrap(await countQ, "issues");
    const isSnoozed = (r: { snoozed_until: string | null }) => !!r.snoozed_until && Date.parse(r.snoozed_until) > now.getTime();
    const counts = all.filter((r) => !isSnoozed(r));
    return {
      result: {
        status,
        count: rows.length,
        open: counts.filter((r) => r.status === "open").length,
        in_progress: counts.filter((r) => r.status === "in_progress").length,
        snoozed: all.filter(isSnoozed).length,
        ...pageInfo(w, rows.length, total),
        from: span?.from,
        to: span?.to,
        sort,
        // Round 3: the assignee's photo beside their name.
        issues: await (async () => {
          const assignees = [...new Set(rows.flatMap((i) => i.assigned_to ? [i.assigned_to] : []))]
            .flatMap((id) => refs.emp.get(id) ?? []);
          const photos = assignees.length ? await driverPhotoLinks(db, assignees, now) : new Map<string, string>();
          return rows.map((i) => issueCard(i, refs, whoOf(i.id), now, photos));
        })(),
      },
      summary: `${rows.length} issues (${status}); ${counts.length} active`,
    };
  },
});

const REPORT_STATUS: Record<IssueStatus, "open" | "in_garage" | "closed"> = {
  open: "open",
  in_progress: "in_garage",
  resolved: "closed",
  dismissed: "closed",
};

export const updateIssue = tool({
  name: "update_issue",
  title: "Take, note, resolve or dismiss an issue",
  description: "Changes one issue: status (open, in_progress, resolved, dismissed), a note, and/or who it is assigned to (an office " +
    'e-mail, "me", or "none"). A vehicle problem issue mirrors onto the driver\'s report: resolved or dismissed closes it, in_progress ' +
    "puts it in the garage, open reopens it. Resolving writes the note as the resolution. Nothing is deleted.",
  readOnly: false,
  input: z.object({
    id: zId,
    status: STATUS.optional(),
    note: zText(500).optional(),
    assign_to: zText(120).optional().describe('An office e-mail, "me" or "none"'),
    // Hotfix 3 (L2): out of the Overview and the counts until 07:00 tomorrow or for a week; null wakes it now.
    snooze: z.enum(["tomorrow", "week"]).nullable().optional(),
  }),
  async run({ id, status, note, assign_to, snooze }, { db, actor, now }) {
    if (!status && !note && !assign_to && snooze === undefined) {
      throw new ToolError("Nothing to change: give a status, a note, assign_to or snooze.");
    }
    const issue = await getIssue(db, id, actor);
    const nowIso = now.toISOString();
    const actorFields = { actor: actor.name, actor_employee_id: actor.employeeId ?? null, at: now };
    const events: string[] = [];

    if (assign_to) {
      const word = assign_to.trim().toLowerCase();
      let assignee: { id: string | null; name: string } = { id: null, name: "nobody" };
      if (word === "me") {
        if (!actor.employeeId) throw new ToolError('"me" needs a person: the shared connector has none. Give an e-mail.');
        assignee = { id: actor.employeeId, name: actor.name };
      } else if (word !== "none") {
        assignee = await personByEmail(db, assign_to);
      }
      unwrap(await db.from("issues").update({ assigned_to: assignee.id, updated_at: nowIso }).eq("id", id), "issue");
      await writeEvent(db, id, "assigned", { ...actorFields, note: assignee.name });
      events.push(`assigned to ${assignee.name}`);
      if (assignee.id) {
        await notifyEvent(db, "issue.assigned", {
          title: `Issue for you · ${issue.title}`,
          body: [issue.detail, `from ${actor.name}`].filter(Boolean).join(" · "),
          url: `/issues/${id}`,
          tag: `issue:${id}`,
        }, { actor: actor.employeeId, assignee: assignee.id });
      }
    }
    if (snooze !== undefined) {
      const until = snooze ? snoozeEnd(snooze, now) : null;
      unwrap(
        await db.from("issues").update({ snoozed_until: until, snoozed_by: until ? actor.name : null, updated_at: nowIso }).eq("id", id),
        "issue",
      );
      const text = until ? `Snoozed until ${colomboDayTime(until)}` : "Snooze ended";
      await writeEvent(db, id, "note", { ...actorFields, note: text });
      events.push(text.toLowerCase());
    }
    if (note && !status) {
      await writeEvent(db, id, "note", { ...actorFields, note });
      unwrap(await db.from("issues").update({ updated_at: nowIso }).eq("id", id), "issue");
      events.push("note");
    }
    if (status && status !== issue.status) {
      const closing = status === "resolved" || status === "dismissed";
      unwrap(
        await db.from("issues").update({
          status,
          updated_at: nowIso,
          auto: false,
          ...(closing
            ? { resolved_at: nowIso, resolved_by: actor.name, resolution_note: note ?? null }
            : { resolved_at: null, resolved_by: null, resolution_note: null }),
        }).eq("id", id),
        "issue",
      );
      await writeEvent(db, id, "status", { ...actorFields, note: note ?? null, from_status: issue.status, to_status: status });
      events.push(`${issue.status} → ${status}`);
      if (issue.kind === "vehicle_report" && issue.vehicle_report_id) {
        const target = REPORT_STATUS[status];
        unwrap(
          await db.from("vehicle_reports").update({
            status: target,
            closed_at: target === "closed" ? nowIso : null,
            ...(note && { office_note: note }),
          }).eq("id", issue.vehicle_report_id),
          "vehicle report",
        );
        events.push(`the driver's report is ${target.replace("_", " ")}`);
        await syncIssues(db, now, { report_id: issue.vehicle_report_id });
      }
    } else if (status && note) {
      await writeEvent(db, id, "note", { ...actorFields, note });
      events.push("note");
    }

    const [updated, refs] = await Promise.all([
      unwrapMaybe(await db.from("issues").select("*").eq("id", id).maybeSingle(), "issue"),
      loadRefs(db),
    ]);
    return {
      result: { issue: issueCard(updated ?? issue, refs, undefined, now), changed: events },
      summary: `issue ${id} (${issue.kind}): ${events.join(", ")}`,
    };
  },
});

export const issueHistory = tool({
  name: "issue_history",
  title: "One issue with its history",
  description: "One issue: the details, every event (opened, assigned, note, status, auto_resolved) and the linked task, vehicle " +
    "report (with photo links, valid 1 hour) or request.",
  readOnly: true,
  input: z.object({ id: zId }),
  async run({ id }, { db, actor }) {
    const issue = await getIssue(db, id, actor);
    const [refs, eventsRes, taskRes, reportRes, requestRes] = await Promise.all([
      loadRefs(db),
      db.from("issue_events").select("*").eq("issue_id", id).order("at").order("id"),
      issue.task_id
        ? db.from("tasks").select("id, title, status, employee_id, vehicle_id, start_at, leave_by").eq("id", issue.task_id).maybeSingle()
        : null,
      issue.vehicle_report_id ? db.from("vehicle_reports").select("*").eq("id", issue.vehicle_report_id).maybeSingle() : null,
      issue.request_id
        ? db.from("vehicle_requests").select("id, requested_by_name, route_from, route_to, needed_at, status, task_id").eq(
          "id",
          issue.request_id,
        )
          .maybeSingle()
        : null,
    ]);
    const task = taskRes ? unwrapMaybe(taskRes, "task") : null;
    const report = reportRes ? unwrapMaybe(reportRes, "vehicle report") : null;
    const request = requestRes ? unwrapMaybe(requestRes, "vehicle request") : null;
    const links = report ? await photoLinks(db, { reportIds: [report.id] }) : null;
    const events = unwrap(eventsRes, "issue events");
    const opened = events.find((e) => e.action === "opened");
    const taken = events.filter((e) => e.action === "assigned").at(-1);
    const who: WhoDid = {
      openedBy: opened?.actor && opened.actor !== "system" ? opened.actor : undefined,
      takenAt: taken ? colomboDateTime(taken.at) : undefined,
    };
    return {
      result: {
        issue: issueCard(issue, refs, who),
        events: events.map((e) => ({
          at: colomboDateTime(e.at),
          actor: e.actor ?? undefined,
          action: e.action,
          note: e.note ?? undefined,
          from: e.from_status ?? undefined,
          to: e.to_status ?? undefined,
        })),
        task: task
          ? {
            id: task.id,
            title: task.title,
            status: task.status,
            driver: refs.emp.get(task.employee_id)?.name,
            vehicle: refs.veh.get(task.vehicle_id ?? "")?.reg_no,
            leave_by: colomboDayTime(task.leave_by ?? task.start_at),
          }
          : undefined,
        report: report
          ? {
            id: report.id,
            category: report.category,
            note: report.note,
            status: report.status,
            office_note: report.office_note,
            reported: colomboDateTime(report.created_at),
            driver: refs.emp.get(report.employee_id)?.name,
            vehicle: refs.veh.get(report.vehicle_id)?.reg_no,
            task_id: report.task_id ?? undefined,
            photos: links?.byReport.get(report.id) ?? [],
            photo_links: PHOTO_LINK_NOTE,
          }
          : undefined,
        request: request
          ? {
            id: request.id,
            requested_by: request.requested_by_name,
            route: [request.route_from, request.route_to].filter(Boolean).join(" → ") || undefined,
            when: colomboDayTime(request.needed_at),
            status: request.status,
            task_id: request.task_id ?? undefined,
          }
          : undefined,
      },
      summary: `issue ${id} (${issue.kind}, ${issue.status})`,
    };
  },
});
