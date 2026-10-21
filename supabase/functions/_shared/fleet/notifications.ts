// Office notifications (docs/dispatch-plan.md, section 9): which event goes to
// whom, and the outbox row through queue_notification. Delivery (Web Push) is
// notify-office's job. The database function honours each person's toggles and
// devices at queue time, so a person with no device or the event switched off
// simply gets no row. Best effort: a failure to queue is logged and never fails
// the tool that caused the event. The sender never hears about their own action.
//
// task.declined and task.not_accepted are written in SQL (decline_task and the
// accept reminder) with the same shapes; vehicle.booked comes from saving a task
// on a custodian's vehicle, vehicle.booking_cancelled from cancel_request.
// Phase 6: request.changed (the requester edited an approved booking) goes to the
// approvers, request.redecided to the requester, booking.changed (the office moved
// or re-equipped a booking) to the requester and the custodian.
// Phase 7 (§33): a proposed task is a request (request.created, request.decided); request.not_decided and
// request.late are written in SQL by queue_request_reminders.

import type { Db } from "./db.ts";
import { unwrap } from "./db.ts";
import type { Permission } from "./permissions.ts";
import { OFFICE_ROLES } from "./roles.ts";

export type NotifyEvent =
  | "request.created"
  | "request.decided"
  | "task.declined"
  | "task.not_accepted"
  | "task.stop_skipped"
  | "task.vehicle_needed"
  | "issue.opened"
  | "issue.assigned"
  | "vehicle.booked"
  | "vehicle.booking_cancelled"
  | "request.changed"
  | "request.redecided"
  | "booking.changed"
  | "request.not_decided"
  | "request.late"
  | "request.on_the_way"
  | "request.arrived"
  | "request.stop_arrived"
  | "request.driver_changed"
  | "request.cancelled"
  | "trip.personal"
  | "task.running_late"
  | "ask.answered"
  | "request.running_late";

export interface EventInfo {
  event: NotifyEvent;
  /** The line on the Settings → Notifications page. */
  label: string;
  text: string;
  /** Who can receive it (any one of these); empty = every office person. */
  needs: readonly Permission[];
}

/** The events a person can switch on or off, in the order the page shows them. */
export const EVENTS: readonly EventInfo[] = [
  {
    event: "request.created",
    label: "A vehicle request comes in",
    text: "Someone asks for a vehicle; it waits for your decision",
    needs: ["approve"],
  },
  {
    event: "request.decided",
    label: "Your request is decided",
    text: "A request you made, or a task you proposed, is approved or declined",
    needs: ["request", "assign_tasks"],
  },
  // Phase 7 (§19): the dispatchers, the person who assigned the task and the requester (on their own request's link).
  {
    event: "task.declined",
    label: "A driver can't do a task",
    text: "A driver declines a task: it needs another driver",
    needs: ["approve", "assign_tasks", "request"],
  },
  {
    event: "task.not_accepted",
    label: "A task is not accepted in time",
    text: "The driver has not accepted a task within the accept window: it needs a driver",
    needs: ["approve", "assign_tasks", "request"],
  },
  // Phase 7: written in SQL by the trigger vehicle_reports_need_vehicle ("I need another vehicle" on a breakdown or accident).
  {
    event: "task.vehicle_needed",
    label: "A driver needs another vehicle",
    text: "A breakdown or an accident during a task: the driver asks for another vehicle",
    needs: ["approve", "assign_tasks"],
  },
  // Part 3b (H4, H3): written in SQL by report_running_late and the trigger driver_ask_answers_notify (to the asker only).
  {
    event: "task.running_late",
    label: "A driver is running late",
    text: "A driver says they are running late for a task (10, 15, 30 minutes or more)",
    needs: ["approve", "assign_tasks"],
  },
  {
    event: "ask.answered",
    label: "A driver answers your question",
    text: "A driver answers a question you sent (free for a trip, a time at the office, where they are)",
    needs: ["approve", "assign_tasks"],
  },
  // Phase 7 (§13): a driver starts a personal trip (driver-api); company trips are only tagged on the board.
  {
    event: "trip.personal",
    label: "A driver starts a personal trip",
    text: "A driver starts a personal trip in the app: where to, the vehicle and the time",
    needs: ["approve", "assign_tasks"],
  },
  // Phase 7: written in SQL by the trigger task_stops_skipped (a driver's skip, with the reason).
  {
    event: "task.stop_skipped",
    label: "A driver skips a stop",
    text: "A driver skips a stop of a task, with the reason",
    needs: ["assign_tasks"],
  },
  {
    event: "issue.opened",
    label: "A critical issue opens",
    text: "A breakdown or accident, a document expired, a task far behind",
    needs: ["issues"],
  },
  { event: "issue.assigned", label: "An issue is given to you", text: "Someone assigns an issue to you", needs: ["issues"] },
  {
    event: "vehicle.booked",
    label: "A vehicle you look after is booked",
    text: "The office books a vehicle you are the custodian of",
    needs: [],
  },
  {
    event: "vehicle.booking_cancelled",
    label: "A booking of your vehicle is cancelled",
    text: "A booking of a vehicle you look after is cancelled",
    needs: [],
  },
  {
    event: "request.changed",
    label: "An approved request is changed",
    text: "The person who asked changed an approved booking: it needs re-approval",
    needs: ["approve"],
  },
  {
    event: "request.redecided",
    label: "Your changed request is decided again",
    text: "A booking you changed is kept, changed or declined by the office",
    needs: ["request"],
  },
  {
    event: "booking.changed",
    label: "A booking is changed by the office",
    text: "The time, vehicle or driver of a booking you asked for, or of a vehicle you look after, is changed",
    needs: [],
  },
  // Phase 7 (§33, §35 16 and 18): written in SQL by queue_request_reminders (the minute job).
  {
    event: "request.not_decided",
    label: "A request or a proposed task is not decided 30 minutes before it leaves",
    text: "To the approvers, and to the person who asked or proposed it",
    needs: ["approve", "request", "assign_tasks"],
  },
  {
    event: "request.late",
    label: "A request or a proposed task passes its leave-by undecided",
    text: "It stays waiting until someone decides it; never sent by itself",
    needs: ["approve"],
  },
  // Phase 7 (§4): the person who asked follows their trip (written in SQL by the triggers on tasks and task_stops).
  {
    event: "request.on_the_way",
    label: "Your driver is on the way",
    text: "The driver of a trip you asked for starts it",
    needs: ["request"],
  },
  {
    event: "request.running_late",
    label: "Your driver is running late",
    text: "The driver of a trip you asked for says they are running late",
    needs: ["request"],
  },
  {
    event: "request.arrived",
    label: "Your driver has arrived",
    text: "The driver of a trip you asked for reaches the first pickup",
    needs: ["request", "assign_tasks"],
  },
  // Round 2: each later stop reached, with how late or early ("Kanishka arrived at Wariyapola 10:52, 22 min late").
  {
    event: "request.stop_arrived",
    label: "Your driver reached a stop",
    text: "The driver of a trip you asked for reaches each stop after the first pickup, with how late or early",
    needs: ["request", "assign_tasks"],
  },
  {
    event: "request.driver_changed",
    label: "Your driver is changed",
    text: "A trip you asked for gets another driver",
    needs: ["request", "assign_tasks"],
  },
  {
    event: "request.cancelled",
    label: "Your trip is cancelled",
    text: "The task of a trip you asked for is cancelled by the office",
    needs: ["request", "assign_tasks"],
  },
];

/**
 * Hotfix 2 (A, B): how the office site shows a new item of the notification centre: urgent (something to approve, a task
 * that needs a driver), alert (a decision about your own request or booking, an issue given to you), soft (your driver on
 * the way or arrived, a skipped stop), alarm (a critical issue); info = no sound (a personal trip).
 */
export type InboxKind = "urgent" | "alert" | "soft" | "alarm" | "info";

const INBOX_KIND: Record<NotifyEvent, InboxKind> = {
  "request.created": "urgent",
  "request.changed": "urgent",
  "request.not_decided": "urgent",
  "request.late": "urgent",
  "task.declined": "urgent",
  "task.not_accepted": "urgent",
  "task.vehicle_needed": "urgent",
  "request.decided": "alert",
  "request.redecided": "alert",
  "request.driver_changed": "alert",
  "request.cancelled": "alert",
  "booking.changed": "alert",
  "vehicle.booked": "alert",
  "vehicle.booking_cancelled": "alert",
  "issue.assigned": "alert",
  "task.running_late": "alert",
  "ask.answered": "alert",
  "request.on_the_way": "soft",
  "request.running_late": "soft",
  "request.arrived": "soft",
  "request.stop_arrived": "soft",
  "task.stop_skipped": "soft",
  "issue.opened": "alarm",
  "trip.personal": "info",
};

/** The sound and the banner of an event (an unknown one: info). Pure. */
export function inboxKind(event: string): InboxKind {
  return INBOX_KIND[event as NotifyEvent] ?? "info";
}

export interface Message {
  title: string;
  body: string;
  /** A path in the web app (/requests, /issues/<id>, /tasks?task=<id>); notify-office makes it absolute. */
  url: string;
  /** Replaces an earlier notification about the same thing on the device. */
  tag?: string;
  /** Hotfix 2 (A): who did it, shown in the notification centre ("Palitha"). */
  who?: string;
  /** Phase 7 (§4): the driver's photo (icon) and the vehicle's (image) as storage paths; notify-office signs them. */
  icon_path?: { bucket: "driver-photos"; path: string };
  image_path?: { bucket: "vehicle-photos"; path: string };
}

export interface Person {
  id: string;
  permissions: readonly string[];
}

export interface RecipientContext {
  /** The person who caused the event: never told about their own action. */
  actor?: string | null;
  /** request.decided, task.declined / task.not_accepted: who asked. */
  requester?: string | null;
  /** task.declined / task.not_accepted: who assigned the task. */
  assigner?: string | null;
  /** issue.assigned: who got it. */
  assignee?: string | null;
  /** vehicle.* and booking.changed: who looks after the vehicle. */
  custodian?: string | null;
}

/** Who an event goes to, from the active office people. Pure. */
export function recipientsFor(event: NotifyEvent, people: readonly Person[], ctx: RecipientContext = {}): string[] {
  const holders = (...perms: string[]) => people.filter((p) => perms.some((x) => p.permissions.includes(x))).map((p) => p.id);
  let ids: string[];
  switch (event) {
    case "request.created":
      ids = holders("approve");
      break;
    case "request.decided":
      ids = ctx.requester ? [ctx.requester] : [];
      break;
    case "request.not_decided":
      // The approvers, plus the person who asked or proposed it (the SQL writes them; listed here for the rule).
      ids = [...holders("approve"), ...(ctx.requester ? [ctx.requester] : [])];
      break;
    case "request.late":
      ids = holders("approve");
      break;
    case "request.on_the_way":
    case "request.running_late":
    case "request.arrived":
    case "request.driver_changed":
    case "request.cancelled":
      ids = ctx.requester ? [ctx.requester] : [];
      break;
    case "task.running_late":
      // Part 3b (H4): the dispatchers and the person who assigned it (written in SQL by report_running_late).
      ids = [...holders("approve", "assign_tasks"), ...(ctx.assigner ? [ctx.assigner] : [])];
      break;
    case "ask.answered":
      // Part 3b (H3): only the person who asked (the SQL trigger writes it).
      ids = ctx.assignee ? [ctx.assignee] : [];
      break;
    case "task.declined":
    case "task.not_accepted":
      // The dispatchers, plus the person who assigned it and the requester (the SQL writes them; listed here for the rule).
      ids = [...holders("approve", "assign_tasks"), ...[ctx.assigner, ctx.requester].flatMap((id) => id ? [id] : [])];
      break;
    case "task.vehicle_needed":
    case "trip.personal":
      ids = holders("approve", "assign_tasks");
      break;
    case "task.stop_skipped":
      ids = holders("assign_tasks");
      break;
    case "issue.opened":
      ids = holders("issues");
      break;
    case "issue.assigned":
      ids = ctx.assignee ? [ctx.assignee] : [];
      break;
    case "vehicle.booked":
    case "vehicle.booking_cancelled":
      ids = ctx.custodian ? [ctx.custodian] : [];
      break;
    case "request.changed":
      ids = holders("approve");
      break;
    case "request.redecided":
      ids = ctx.requester ? [ctx.requester] : [];
      break;
    case "booking.changed":
      ids = [ctx.requester, ctx.custodian].flatMap((id) => id ? [id] : []);
      break;
  }
  const known = new Set(people.map((p) => p.id));
  return [...new Set(ids)].filter((id) => id !== ctx.actor && known.has(id));
}

/** The events a person can receive, by their permissions (the Settings page). Pure. */
export function relevantEvents(permissions: readonly string[]): EventInfo[] {
  return EVENTS.filter((e) => e.needs.length === 0 || e.needs.some((p) => permissions.includes(p)));
}

/** "Chrome on Android", "Safari on iPhone", "Edge on Windows"… from a browser's user agent. Pure. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (!ua) return "A browser";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
    ? "iPad"
    : /Android/.test(ua)
    ? "Android"
    : /Windows/.test(ua)
    ? "Windows"
    : /Mac OS X|Macintosh/.test(ua)
    ? "Mac"
    : /CrOS/.test(ua)
    ? "Chromebook"
    : /Linux/.test(ua)
    ? "Linux"
    : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
    ? "Opera"
    : /SamsungBrowser/.test(ua)
    ? "Samsung Internet"
    : /Firefox\//.test(ua)
    ? "Firefox"
    : /Chrome\/|CriOS\//.test(ua)
    ? "Chrome"
    : /Safari\//.test(ua)
    ? "Safari"
    : "A browser";
  return os ? `${browser} on ${os}` : browser;
}

/** The active office people with their permissions. */
export async function officePeople(db: Db): Promise<Person[]> {
  const rows = unwrap(
    await db.from("employees").select("id, permissions").eq("active", true).in("role", [...OFFICE_ROLES]).limit(2000),
    "employees",
  );
  return rows.map((e) => ({ id: e.id, permissions: e.permissions ?? [] }));
}

/** Writes the outbox rows (one per recipient the database function accepts). Never throws. */
export async function notify(db: Db, event: NotifyEvent, message: Message, recipients: string[]): Promise<number> {
  if (recipients.length === 0) return 0;
  const { data, error } = await db.rpc("queue_notification", { p_event: event, p_payload: { ...message }, p_recipients: recipients });
  if (error) {
    console.error(`notify ${event}: ${error.message}`);
    return 0;
  }
  return data ?? 0;
}

/** The people, the recipients, the rows: one call from a tool. */
export async function notifyEvent(db: Db, event: NotifyEvent, message: Message, ctx: RecipientContext = {}): Promise<number> {
  try {
    const people = await officePeople(db);
    return await notify(db, event, message, recipientsFor(event, people, ctx));
  } catch (error) {
    console.error(`notify ${event}: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}
