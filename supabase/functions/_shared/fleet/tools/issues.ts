// The issues centre: list, take, note, resolve, dismiss; the history of one issue.
// The rows come from issues.ts (syncIssues); a person's change writes an event and,
// for a vehicle report, mirrors onto the report (resolved / dismissed = closed,
// in progress = in the garage, open = open).

import { z } from "zod";
import type { Db } from "../db.ts";
import { ToolError, unwrap, unwrapMaybe } from "../db.ts";
import { findVehicle, loadRefs, type Refs } from "../fleet.ts";
import { contactLinks } from "../format.ts";
import {
  ACTIVE,
  type IssueRow,
  type IssueStatus,
  KIND_TEXT,
  scopeOf,
  syncIssues,
  TASK_KINDS,
  writeEvent,
} from "../issues.ts";
import { notifyEvent } from "../notifications.ts";
import { PHOTO_LINK_NOTE, photoLinks } from "../photos.ts";
import type { Actor } from "../roles.ts";
import { colomboDateTime, colomboDayTime } from "../time.ts";
import { tool, zId, zText } from "../tool.ts";

const STATUS = z.enum(["open", "in_progress", "resolved", "dismissed"]);
const KINDS = Object.keys(KIND_TEXT) as [string, ...string[]];

/** With the issues permission everything; with assign_tasks only the task kinds. */
function kindsFor(actor: Actor): "all" | string[] {
  if (actor.permissions.includes("issues")) return "all";
  if (actor.permissions.includes("assign_tasks")) return [...TASK_KINDS];
  return [];
}

function issueCard(i: IssueRow, refs: Refs) {
  const driver = i.employee_id ? refs.emp.get(i.employee_id) : undefined;
  const assignee = i.assigned_to ? refs.emp.get(i.assigned_to) : undefined;
  return {
    id: i.id,
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
    resolution_note: i.resolution_note ?? undefined,
    assigned_to: assignee
      ? { name: assignee.name, email: assignee.email ?? undefined }
      : undefined,
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
  const issue = unwrapMaybe(
    await db.from("issues").select("*").eq("id", id).maybeSingle(),
    "issue",
  );
  if (!issue) {
    throw new ToolError(`No issue has the id ${id}. list_issues shows them.`);
  }
  const kinds = kindsFor(actor);
  if (kinds !== "all" && !kinds.includes(issue.kind)) {
    throw new ToolError(
      "This issue is about the fleet, not a task: it needs the issues permission.",
    );
  }
  return issue;
}

async function personByEmail(
  db: Db,
  email: string,
): Promise<{ id: string; name: string }> {
  const row = unwrapMaybe(
    await db.from("employees").select("id, name, active").eq(
      "email",
      email.trim().toLowerCase(),
    ).maybeSingle(),
    "employee",
  );
  if (!row || !row.active) {
    throw new ToolError(
      `No active office person has the e-mail ${email}. list_office_users shows them.`,
    );
  }
  return row;
}

export const listIssues = tool({
  name: "list_issues",
  title: "Issues",
  description:
    "What needs the office's attention, newest and most urgent first: vehicle problems, odometer checks, km outside tasks, " +
    "service and documents due, licences, km allowance, rental ends, garage bookings, a running task's signal, late starts, running " +
    "late, tasks not accepted or declined, requests waiting, failed pushes or routing calls. Each is opened and auto-resolved by the " +
    "system; the office takes, notes, resolves or dismisses with update_issue. With assign_tasks only (no issues permission) the task " +
    "kinds are listed.",
  readOnly: true,
  input: z.object({
    status: z.enum([
      "active",
      "open",
      "in_progress",
      "resolved",
      "dismissed",
      "all",
    ]).optional().describe(
      "Default active (open + in progress)",
    ),
    kind: z.enum(KINDS).optional(),
    vehicle: zText(20).optional().describe("A number plate"),
    assigned_to: zText(120).optional().describe('An office e-mail, or "me"'),
    limit: z.number().int().min(1).max(200).optional().describe("Default 50"),
  }),
  async run(
    { status = "active", kind, vehicle, assigned_to, limit = 50 },
    { db, actor },
  ) {
    const kinds = kindsFor(actor);
    const refs = await loadRefs(db);
    let q = db.from("issues").select("*");
    if (status === "active") q = q.in("status", ACTIVE);
    else if (status !== "all") q = q.eq("status", status);
    if (kind) q = q.eq("kind", kind);
    if (vehicle) q = q.eq("vehicle_id", findVehicle(refs, vehicle).id);
    if (assigned_to) {
      const id = assigned_to.trim().toLowerCase() === "me"
        ? actor.employeeId
        : (await personByEmail(db, assigned_to)).id;
      if (!id) {
        throw new ToolError(
          '"me" needs a person: the shared connector has none. Give an e-mail.',
        );
      }
      q = q.eq("assigned_to", id);
    }
    if (kinds !== "all") q = q.in("kind", kinds);
    const rows = unwrap(
      await q.order("sort_key").order("opened_at", { ascending: false }).limit(
        limit,
      ),
      "issues",
    );
    // The counts of everything active the person may see, whatever the filters (the bell).
    let countQ = db.from("issues").select("status").in("status", ACTIVE);
    if (kinds !== "all") countQ = countQ.in("kind", kinds);
    const counts = unwrap(await countQ, "issues");
    return {
      result: {
        status,
        count: rows.length,
        open: counts.filter((r) => r.status === "open").length,
        in_progress: counts.filter((r) => r.status === "in_progress").length,
        issues: rows.map((i) => issueCard(i, refs)),
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
  description:
    "Changes one issue: status (open, in_progress, resolved, dismissed), a note, and/or who it is assigned to (an office " +
    'e-mail, "me", or "none"). A vehicle problem issue mirrors onto the driver\'s report: resolved or dismissed closes it, in_progress ' +
    "puts it in the garage, open reopens it. Resolving writes the note as the resolution. Nothing is deleted.",
  readOnly: false,
  input: z.object({
    id: zId,
    status: STATUS.optional(),
    note: zText(500).optional(),
    assign_to: zText(120).optional().describe(
      'An office e-mail, "me" or "none"',
    ),
  }),
  async run({ id, status, note, assign_to }, { db, actor, now }) {
    if (!status && !note && !assign_to) {
      throw new ToolError(
        "Nothing to change: give a status, a note or assign_to.",
      );
    }
    const issue = await getIssue(db, id, actor);
    const nowIso = now.toISOString();
    const actorFields = {
      actor: actor.name,
      actor_employee_id: actor.employeeId ?? null,
      at: now,
    };
    const events: string[] = [];

    if (assign_to) {
      const word = assign_to.trim().toLowerCase();
      let assignee: { id: string | null; name: string } = {
        id: null,
        name: "nobody",
      };
      if (word === "me") {
        if (!actor.employeeId) {
          throw new ToolError(
            '"me" needs a person: the shared connector has none. Give an e-mail.',
          );
        }
        assignee = { id: actor.employeeId, name: actor.name };
      } else if (word !== "none") {
        assignee = await personByEmail(db, assign_to);
      }
      unwrap(
        await db.from("issues").update({
          assigned_to: assignee.id,
          updated_at: nowIso,
        }).eq("id", id),
        "issue",
      );
      await writeEvent(db, id, "assigned", {
        ...actorFields,
        note: assignee.name,
      });
      events.push(`assigned to ${assignee.name}`);
      if (assignee.id) {
        await notifyEvent(db, "issue.assigned", {
          title: `Issue for you · ${issue.title}`,
          body: [issue.detail, `from ${actor.name}`].filter(Boolean).join(
            " · ",
          ),
          url: `/issues/${id}`,
          tag: `issue:${id}`,
        }, { actor: actor.employeeId, assignee: assignee.id });
      }
    }
    if (note && !status) {
      await writeEvent(db, id, "note", { ...actorFields, note });
      unwrap(
        await db.from("issues").update({ updated_at: nowIso }).eq("id", id),
        "issue",
      );
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
            ? {
              resolved_at: nowIso,
              resolved_by: actor.name,
              resolution_note: note ?? null,
            }
            : { resolved_at: null, resolved_by: null, resolution_note: null }),
        }).eq("id", id),
        "issue",
      );
      await writeEvent(db, id, "status", {
        ...actorFields,
        note: note ?? null,
        from_status: issue.status,
        to_status: status,
      });
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
      unwrapMaybe(
        await db.from("issues").select("*").eq("id", id).maybeSingle(),
        "issue",
      ),
      loadRefs(db),
    ]);
    return {
      result: { issue: issueCard(updated ?? issue, refs), changed: events },
      summary: `issue ${id} (${issue.kind}): ${events.join(", ")}`,
    };
  },
});

export const issueHistory = tool({
  name: "issue_history",
  title: "One issue with its history",
  description:
    "One issue: the details, every event (opened, assigned, note, status, auto_resolved) and the linked task, vehicle " +
    "report (with photo links, valid 1 hour) or request.",
  readOnly: true,
  input: z.object({ id: zId }),
  async run({ id }, { db, actor }) {
    const issue = await getIssue(db, id, actor);
    const [refs, eventsRes, taskRes, reportRes, requestRes] = await Promise.all(
      [
        loadRefs(db),
        db.from("issue_events").select("*").eq("issue_id", id).order("at")
          .order("id"),
        issue.task_id
          ? db.from("tasks").select(
            "id, title, status, employee_id, vehicle_id, start_at, leave_by",
          ).eq("id", issue.task_id).maybeSingle()
          : null,
        issue.vehicle_report_id
          ? db.from("vehicle_reports").select("*").eq(
            "id",
            issue.vehicle_report_id,
          ).maybeSingle()
          : null,
        issue.request_id
          ? db.from("vehicle_requests").select(
            "id, requested_by_name, route_from, route_to, needed_at, status, task_id",
          ).eq(
            "id",
            issue.request_id,
          )
            .maybeSingle()
          : null,
      ],
    );
    const task = taskRes ? unwrapMaybe(taskRes, "task") : null;
    const report = reportRes ? unwrapMaybe(reportRes, "vehicle report") : null;
    const request = requestRes
      ? unwrapMaybe(requestRes, "vehicle request")
      : null;
    const links = report
      ? await photoLinks(db, { reportIds: [report.id] })
      : null;
    return {
      result: {
        issue: issueCard(issue, refs),
        events: unwrap(eventsRes, "issue events").map((e) => ({
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
            vehicle: refs.veh.get(task.vehicle_id)?.reg_no,
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
            route: [request.route_from, request.route_to].filter(Boolean).join(
              " → ",
            ) || undefined,
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
