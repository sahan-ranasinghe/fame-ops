// Phase 8, O1 item 9: the office's notifications on the phone (the expo_push rows of the outbox), delivered through Expo's
// push service like push-task's. Pure: the channel a kind goes on for a phone with these channels, and the messages
// for a row's tokens (expo_test.ts). Sending and the outcome are in index.ts.

import { type InboxKind, inboxKind } from "../_shared/fleet/notifications.ts";

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** The 1.3.0 channels (push-task/channels.ts): a new task rings on task-ring; a change on task-updates; before 1.3.0, the 1.2.0 ones. */
const RING = "task-ring";
const UPDATES = "task-updates";
const OLD_LOUD = "tasks-new";
const OLD_SOFT = "general";

/** Loud (the 30 s ring) for something to decide or a task that needs a driver, and for a critical issue; the rest a tone. */
export function officeChannelFor(kind: InboxKind, channels: readonly string[]): string {
  const has = (c: string) => channels.includes(c);
  if (kind === "urgent" || kind === "alarm") return has(RING) ? RING : OLD_LOUD;
  return has(UPDATES) ? UPDATES : OLD_SOFT;
}

export interface DeviceToken {
  id: string;
  token: string;
  channels?: string[] | null;
}

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: { kind: "office"; event: string; url?: string; inbox?: InboxKind };
  channelId: string;
  priority: "high";
  sound: "default";
  ttl: number;
}

/** The messages for one outbox row: the title and body as the site shows them, the link the app opens, the channel per phone. */
export function expoMessagesFor(event: string, payload: Record<string, unknown>, tokens: readonly DeviceToken[]): ExpoMessage[] {
  const kind = inboxKind(event);
  const title = typeof payload.title === "string" && payload.title ? payload.title : "Fame Fleet";
  const body = typeof payload.body === "string" ? payload.body : "";
  const url = typeof payload.url === "string" && payload.url ? payload.url : undefined;
  return tokens.map((t) => ({
    to: t.token,
    title,
    body,
    data: { kind: "office", event, ...(url ? { url } : {}), inbox: kind },
    channelId: officeChannelFor(kind, t.channels ?? []),
    priority: "high",
    sound: "default",
    ttl: 3600,
  }));
}

export interface Ticket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

/** What the tickets say: how many took it, the errors, and the tokens Expo says are gone (to delete). */
export function readTickets(
  tickets: readonly Ticket[],
  tokens: readonly DeviceToken[],
): { sent: number; errors: string[]; gone: string[] } {
  const errors: string[] = [];
  const gone: string[] = [];
  tokens.forEach((token, i) => {
    const ticket = tickets[i];
    if (!ticket || ticket.status === "ok") return;
    const code = ticket.details?.error ?? ticket.message ?? "error";
    errors.push(code);
    if (code === "DeviceNotRegistered") gone.push(token.id);
  });
  return { sent: tokens.length - errors.length, errors, gone };
}
