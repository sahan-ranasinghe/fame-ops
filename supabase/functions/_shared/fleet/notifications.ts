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

import type { Db } from "./db.ts";
import { unwrap } from "./db.ts";
import type { Permission } from "./permissions.ts";
import { OFFICE_ROLES } from "./roles.ts";

export type NotifyEvent =
  | "request.created"
  | "request.decided"
  | "task.declined"
  | "task.not_accepted"
  | "issue.opened"
  | "issue.assigned"
  | "vehicle.booked"
  | "vehicle.booking_cancelled"
  | "request.changed"
  | "request.redecided"
  | "booking.changed";

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
    text: "A request you made is approved or declined",
    needs: ["request"],
  },
  {
    event: "task.declined",
    label: "A driver can't do a task",
    text: "A driver declines a task: it needs another driver",
    needs: ["approve", "assign_tasks"],
  },
  {
    event: "task.not_accepted",
    label: "A task is not accepted in time",
    text: "The driver has not accepted a task that leaves soon",
    needs: ["approve", "assign_tasks"],
  },
  {
    event: "issue.opened",
    label: "A critical issue opens",
    text: "A breakdown or accident, a document expired, a task far behind",
    needs: ["issues"],
  },
  {
    event: "issue.assigned",
    label: "An issue is given to you",
    text: "Someone assigns an issue to you",
    needs: ["issues"],
  },
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
    text:
      "The person who asked changed an approved booking: it needs re-approval",
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
    text:
      "The time, vehicle or driver of a booking you asked for, or of a vehicle you look after, is changed",
    needs: [],
  },
];

export interface Message {
  title: string;
  body: string;
  /** A path in the web app (/requests, /issues/<id>, /tasks?task=<id>); notify-office makes it absolute. */
  url: string;
  /** Replaces an earlier notification about the same thing on the device. */
  tag?: string;
}

export interface Person {
  id: string;
  permissions: readonly string[];
}

export interface RecipientContext {
  /** The person who caused the event: never told about their own action. */
  actor?: string | null;
  /** request.decided: who asked. */
  requester?: string | null;
  /** issue.assigned: who got it. */
  assignee?: string | null;
  /** vehicle.* and booking.changed: who looks after the vehicle. */
  custodian?: string | null;
}

/** Who an event goes to, from the active office people. Pure. */
export function recipientsFor(
  event: NotifyEvent,
  people: readonly Person[],
  ctx: RecipientContext = {},
): string[] {
  const holders = (...perms: string[]) =>
    people.filter((p) => perms.some((x) => p.permissions.includes(x))).map((
      p,
    ) => p.id);
  let ids: string[];
  switch (event) {
    case "request.created":
      ids = holders("approve");
      break;
    case "request.decided":
      ids = ctx.requester ? [ctx.requester] : [];
      break;
    case "task.declined":
    case "task.not_accepted":
      ids = holders("approve", "assign_tasks");
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
  return EVENTS.filter((e) =>
    e.needs.length === 0 || e.needs.some((p) => permissions.includes(p))
  );
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
    await db.from("employees").select("id, permissions").eq("active", true).in(
      "role",
      [...OFFICE_ROLES],
    ).limit(2000),
    "employees",
  );
  return rows.map((e) => ({ id: e.id, permissions: e.permissions ?? [] }));
}

/** Writes the outbox rows (one per recipient the database function accepts). Never throws. */
export async function notify(
  db: Db,
  event: NotifyEvent,
  message: Message,
  recipients: string[],
): Promise<number> {
  if (recipients.length === 0) return 0;
  const { data, error } = await db.rpc("queue_notification", {
    p_event: event,
    p_payload: { ...message },
    p_recipients: recipients,
  });
  if (error) {
    console.error(`notify ${event}: ${error.message}`);
    return 0;
  }
  return data ?? 0;
}

/** The people, the recipients, the rows: one call from a tool. */
export async function notifyEvent(
  db: Db,
  event: NotifyEvent,
  message: Message,
  ctx: RecipientContext = {},
): Promise<number> {
  try {
    const people = await officePeople(db);
    return await notify(db, event, message, recipientsFor(event, people, ctx));
  } catch (error) {
    console.error(
      `notify ${event}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 0;
  }
}
