// Round 48 (28 October 2026), item 1: a change to an existing task proposed by someone without the approve permission.
//
// While the setting tasks_need_approval is on, a person with assign_tasks but not approve (a dispatcher, a coordinator)
// never reaches a driver directly: create_task already waits as a request of kind task (Phase 7 §33); now reassign_task,
// update_task's day, time, end, driver or vehicle, and update_task_stops wait the same way, as a request of kind change
// that names the task (change_task_id) and carries the exact call in proposal_json. The task stays as it is until an
// approver decides the change: decide_request approve runs the same tool as the approver (so the audit and approved_by are
// theirs), decline leaves the task alone; the proposer may withdraw it with cancel_request while it waits. One waiting
// change per task. The pattern is the one the office already knows from a changed booking (update_request → changed →
// redecide_request): a proposal in the queue, the live thing untouched until the decision.

import type { Json } from "../database.types.ts";
import type { Db, Row } from "../db.ts";
import { ToolError, unwrap, unwrapMaybe } from "../db.ts";
import { notifyEvent } from "../notifications.ts";
import type { Actor } from "../roles.ts";
import type { Settings } from "../settings.ts";
import { atText } from "../requests_rules.ts";
import { colomboDayTime, colomboTime } from "../time.ts";
import { logRequestEvent, requester } from "./requestCore.ts";

type Task = Row<"tasks">;
type VehicleRequest = Row<"vehicle_requests">;

/** The tools whose call waits for approval when the caller lacks approve. */
export type ChangeTool = "reassign_task" | "update_task" | "update_task_stops";

export interface FieldChangeLike {
  from: string | number | null;
  to: string | number | null;
}

/** What proposal_json holds for a request of kind change. */
export interface ProposedChange {
  tool: ChangeTool;
  /** The call as made, with its plan_version (re-read at approval). */
  args: Record<string, unknown>;
  /** What changes, field by field (the card's lines). */
  changes: Record<string, FieldChangeLike>;
  /** One line: "driver Kamal instead of Nuwan · time 09:00 → 10:00". */
  summary: string;
  /** The task's plan_version when proposed. */
  plan_version: number;
  /** The task's status when proposed (a declined task needs a driver). */
  task_status: string;
  /** The task as it was when proposed (review L1): the approval refuses when any of these moved since. */
  task_state?: { start_at: string; end_by: string | null; employee_id: string; vehicle_id: string | null };
  /** Review M1: the names sent with the call (passenger_list), kept here and written only when approved. */
  passengers?: { by: string; rows: { employee_id: string | null; name: string; phone: string | null }[] };
}

/** The gate: the setting on and the person without approve. */
export function needsApproval(settings: Pick<Settings, "tasks_need_approval">, actor: Pick<Actor, "permissions">): boolean {
  return settings.tasks_need_approval && !actor.permissions.includes("approve");
}

/** The waiting change on a task, if any. */
export async function waitingChangeFor(db: Db, taskId: string): Promise<VehicleRequest | null> {
  return unwrapMaybe(
    await db.from("vehicle_requests").select("*").eq("kind", "change").eq("change_task_id", taskId).eq("status", "waiting")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    "vehicle request",
  );
}

/** The waiting changes of many tasks, by task id (one query for a board). */
export async function waitingChangesFor(db: Db, taskIds: string[]): Promise<Map<string, VehicleRequest>> {
  const out = new Map<string, VehicleRequest>();
  if (taskIds.length === 0) return out;
  const rows = unwrap(
    await db.from("vehicle_requests").select("*").eq("kind", "change").eq("status", "waiting").in("change_task_id", taskIds)
      .order("created_at"),
    "vehicle requests",
  );
  for (const r of rows) if (r.change_task_id) out.set(r.change_task_id, r);
  return out;
}

/** The lines a task card or page shows while a change waits ("Change waiting for approval · Sashen · driver Kamal…"). */
export function pendingChangeCard(r: VehicleRequest, now: Date) {
  const p = r.proposal_json as unknown as ProposedChange | null;
  return {
    request_id: r.id,
    by: r.requested_by_name,
    at: atText(r.created_at, now),
    tool: p?.tool,
    summary: p?.summary ?? "",
    changes: p?.changes ?? {},
    text: `Change waiting for approval · ${r.requested_by_name} · ${p?.summary ?? ""}`.replace(/ · $/, ""),
  };
}

/** The proposal as the card and the decide page need it. */
export function changeCardOf(r: VehicleRequest) {
  if (r.kind !== "change") return undefined;
  const p = r.proposal_json as unknown as ProposedChange | null;
  return {
    task_id: r.change_task_id ?? undefined,
    task_title: r.title ?? undefined,
    tool: p?.tool,
    summary: p?.summary ?? "",
    changes: p?.changes ?? {},
    task_was: p?.task_status,
  };
}

/**
 * Rule 10 (review L3): the stops of a proposed update_task_stops keep only Google's place id (the name as "Google place",
 * no address or coordinates), as a task's stop does after 30 days; the pin comes from google_pins when applied.
 */
export function withoutGoogleContent(args: Record<string, unknown>): Record<string, unknown> {
  const strip = (s: unknown) => {
    if (!s || typeof s !== "object" || !(s as { google_place_id?: unknown }).google_place_id) return s;
    const { address: _a, lat: _lat, lng: _lng, ...rest } = s as Record<string, unknown>;
    return { ...rest, place: "Google place" };
  };
  const out: Record<string, unknown> = { ...args };
  if (Array.isArray(out.stops)) out.stops = out.stops.map(strip);
  if (out.start && typeof out.start === "object") out.start = strip(out.start);
  return out;
}

/** The task moved since the change was proposed (review L1): the time, end, driver or vehicle is not what the card says. */
export function taskMovedSince(task: Row<"tasks">, p: ProposedChange): string | null {
  const s = p.task_state;
  if (!s) return null;
  if (s.start_at !== task.start_at) return "its time";
  if ((s.end_by ?? null) !== (task.end_by ?? null)) return "its end time";
  if (s.employee_id !== task.employee_id) return "its driver";
  if ((s.vehicle_id ?? null) !== (task.vehicle_id ?? null)) return "its vehicle";
  return null;
}

/**
 * Sahan (Checkpoint 48): a cancel or a reopen stays direct, but one made by someone without approve while tasks need the
 * fleet admin's OK tells the approvers ("Sashen cancelled Team drop · Galle"), in their notification centre and browser.
 */
export async function tellApproversOfDispatch(
  db: Db,
  settings: Pick<Settings, "tasks_need_approval">,
  actor: Actor,
  task: Pick<Task, "id" | "title" | "start_at">,
  did: "cancelled" | "reopened",
  reason: string,
): Promise<void> {
  if (!needsApproval(settings, actor)) return;
  await notifyEvent(db, "request.created", {
    title: `${actor.name} ${did} ${task.title}`,
    body: [colomboDayTime(task.start_at), reason].filter(Boolean).join(" · "),
    url: `/tasks?task=${task.id}`,
    tag: `task:${task.id}`,
  }, { actor: actor.employeeId });
}

/** "driver Kamal instead of Nuwan · time 09:00 → 10:00 · stops: Stop 2 added: Galle". */
export function changeSummary(changes: Record<string, FieldChangeLike>): string {
  return Object.entries(changes).map(([field, c]) => {
    if (c.from == null && c.to != null) return `${field}: ${c.to}`;
    if (c.to == null) return `${field} cleared`;
    return `${field} ${c.to} instead of ${c.from}`;
  }).join(" · ");
}

/**
 * Writes the change into the queue and tells the approvers. Returns the tool's answer: waiting_for_approval, so the
 * clients say "Sent to the fleet admin for approval" and the task page shows the waiting change.
 */
export async function proposeChange(
  db: Db,
  now: Date,
  actor: Actor,
  task: Task,
  p: {
    tool: ChangeTool;
    args: Record<string, unknown>;
    changes: Record<string, FieldChangeLike>;
    /** The driver and vehicle the task would have (for the card's proposed block). */
    proposedDriverId: string | null;
    proposedVehicleId: string | null;
    /** The task's start and end as proposed (the queue is ordered by them). */
    startAt: string;
    endBy: string | null;
    /** Review M1: the names sent with the call, kept with the proposal (never written to the task now). */
    passengers?: ProposedChange["passengers"];
  },
) {
  const waiting = await waitingChangeFor(db, task.id);
  if (waiting) {
    const w = pendingChangeCard(waiting, now);
    throw new ToolError(
      `A change to this task is already waiting for approval: ${w.by} proposed ${w.summary || "a change"} ${w.at}. ` +
        "Cancel it first (cancel_request) or wait for the fleet admin's decision.",
    );
  }
  if (Object.keys(p.changes).length === 0) throw new ToolError("Nothing to change.");
  const summary = changeSummary(p.changes);
  const who = await requester(db, actor, undefined);
  // The route words for the card: the task's first and last stop as they are now.
  const stops = unwrap(
    await db.from("task_stops").select("place_name").eq("task_id", task.id).neq("status", "removed").order("seq"),
    "stops",
  );
  const routeFrom = stops[0]?.place_name ?? task.start_name ?? null;
  const routeTo = stops.length > 1 ? stops[stops.length - 1].place_name : null;
  const proposal: ProposedChange = {
    tool: p.tool,
    // Rule 10 (review L3): a Google pick's name, address and pin are never stored with the proposal; only the place id
    // (the pin is read again from google_pins when the change is applied).
    args: withoutGoogleContent(p.args),
    changes: p.changes,
    summary,
    plan_version: task.plan_version,
    task_status: task.status,
    task_state: { start_at: task.start_at, end_by: task.end_by, employee_id: task.employee_id, vehicle_id: task.vehicle_id },
    ...(p.passengers && { passengers: p.passengers }),
  };
  const inserted = await db.from("vehicle_requests").insert({
      kind: "change",
      change_task_id: task.id,
      requested_by_name: who.name,
      requested_by_employee_id: who.employeeId,
      requested_by_user_id: who.userId,
      project_label: task.label,
      needed_at: p.startAt,
      back_by: p.endBy,
      route_from: routeFrom,
      route_to: routeTo,
      pax: task.passengers,
      driver_required: true,
      proposed_employee_id: p.proposedDriverId,
      proposed_vehicle_id: p.proposedVehicleId,
      title: task.title,
      label: task.label,
      proposal_json: proposal as unknown as Json,
    }).select("*").single();
  // Review L2: two proposals sent at once: the unique index (one waiting change per task) refuses the second.
  if (inserted.error?.code === "23505") {
    throw new ToolError("A change to this task is already waiting for approval. Wait for the fleet admin's decision or cancel it first.");
  }
  const row = unwrap(inserted, "vehicle request");
  await logRequestEvent(db, row.id, "created", actor.name, { at: row.created_at, note: `Proposed change: ${summary}` });
  await notifyEvent(db, "request.created", {
    title: `Change to approve · ${actor.name} proposes ${summary}`,
    body: [task.title, colomboDayTime(p.startAt)].join(" · "),
    url: `/requests/${row.id}/decide`,
    tag: `request:${row.id}`,
  }, { actor: actor.employeeId });
  return {
    result: {
      waiting_for_approval: true,
      request_id: row.id,
      task_id: task.id,
      request: { id: row.id, kind: "change", status: "waiting", when: colomboDayTime(p.startAt), title: task.title },
      title: task.title,
      when: colomboDayTime(p.startAt),
      until: p.endBy ? colomboTime(p.endBy) : undefined,
      changes: p.changes,
      summary,
      task_unchanged: true,
      next: "Waiting for the fleet admin's OK · you'll be notified. The task stays as it is until then.",
    },
    summary: `proposed change to task ${task.id} (request ${row.id}): ${summary}: waiting for approval`,
  };
}
