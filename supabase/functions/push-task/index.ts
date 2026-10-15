// Edge Function push-task: sends a push notification about one task change
// to the driver's phone(s), through Expo's push service (which talks to FCM
// with the key uploaded to EAS).
//
//   POST /functions/v1/push-task
//   x-server-key: <SERVER_KEY>            (called by the database trigger tasks_notify_push, through pg_net)
//   { "task_id": "...", "kind": "new" | "changed" | "cancelled" | "removed" | "leave_30" | "leave_now" | "accept_reminder", "employee_id": "...",
//     "changes": { "time": "Thu 15 Oct 09:30", "vehicle": "WP KL-1234", "end_by": "12:00", "title": "…", "stops": true, "passengers": 4, "notes": true } }  (changed only)
//   200 { "sent": 1, "failed": 0 }   (also 200 with sent 0 when the driver has no registered phone)
//
// The text is in the driver's language (employees.language). Android plays
// the sound of the channel named here (the app creates the channels with the
// bundled sounds): tasks-new for a new task, tasks-changed for a changed or
// cancelled one, general for "no longer yours". Tapping the notification
// opens the task (data.taskId). Tokens Expo reports as DeviceNotRegistered
// are deleted. Every call is written to push_log. leave_30 and leave_now come
// from the pg_cron job task-reminders (queue_task_reminders), accept_reminder
// from the accept rule.

import { createClient } from "@supabase/supabase-js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const COLOMBO_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Kind = "new" | "changed" | "cancelled" | "removed" | "leave_30" | "leave_now" | "accept_reminder";
type Language = "en" | "si";

const CHANNEL: Record<Kind, string> = {
  new: "tasks-new",
  changed: "tasks-changed",
  cancelled: "tasks-changed",
  removed: "general",
  leave_30: "tasks-changed",
  leave_now: "tasks-new",
  accept_reminder: "tasks-new",
};

/** The words for each changed field ("Task changed: new time 09:30 · vehicle WP KL-1234"). */
const CHANGE_TEXT: Record<Language, Record<string, string>> = {
  en: {
    time: "new time {time}",
    vehicle: "vehicle {vehicle}",
    end_by: "back by {end_by}",
    title: "now “{title}”",
    stops: "stops changed",
    passengers: "{passengers} passengers",
    notes: "note changed",
  },
  si: {
    time: "නව වේලාව {time}",
    vehicle: "වාහනය {vehicle}",
    end_by: "ආපසු {end_by} ට",
    title: "දැන් “{title}”",
    stops: "නැවතුම් වෙනස් විය",
    passengers: "මගීන් {passengers}",
    notes: "සටහන වෙනස් විය",
  },
};
const CHANGE_ORDER = ["time", "end_by", "vehicle", "stops", "title", "passengers", "notes"];

/** "new time 09:30 · vehicle WP KL-1234", or "" when nothing is named. */
export function changesLine(language: Language, changes: unknown): string {
  if (!changes || typeof changes !== "object") return "";
  const c = changes as Record<string, unknown>;
  return CHANGE_ORDER.filter((k) => c[k] !== undefined && c[k] !== null && c[k] !== false)
    .map((k) => fill(CHANGE_TEXT[language][k], { [k]: String(c[k]) }))
    .join(" · ");
}

const TEXT: Record<Language, Record<Kind, { title: string; body: string }>> = {
  en: {
    new: { title: "New task {when}", body: "{title} · {pickup} → {dropoff}" },
    changed: { title: "Task changed {when}", body: "{title} · {changes}" },
    cancelled: { title: "Task cancelled", body: "{title} · {reason}" },
    removed: { title: "Task reassigned", body: "{title} is no longer yours." },
    leave_30: { title: "Leave by {leave}", body: "{title} · leave in 30 minutes · {pickup} → {dropoff}" },
    leave_now: { title: "Time to leave", body: "{title} · leave by {leave} · {pickup} → {dropoff}" },
    accept_reminder: { title: "Please accept your task", body: "{when} · {title} · open Fame Driver and tap Accept" },
  },
  si: {
    new: { title: "නව කාර්යය {when}", body: "{title} · {pickup} → {dropoff}" },
    changed: { title: "කාර්යය වෙනස් විය {when}", body: "{title} · {changes}" },
    cancelled: { title: "කාර්යය අවලංගු විය", body: "{title} · {reason}" },
    removed: { title: "කාර්යය වෙනත් අයෙකුට පැවරිණි", body: "{title} තවදුරටත් ඔබගේ නොවේ." },
    leave_30: { title: "{leave} ට පිටත් වන්න", body: "{title} · විනාඩි 30 කින් පිටත් වන්න · {pickup} → {dropoff}" },
    leave_now: { title: "පිටත් වීමට වෙලාවයි", body: "{title} · {leave} ට පිටත් වන්න · {pickup} → {dropoff}" },
    accept_reminder: { title: "ඔබේ කාර්යය පිළිගන්න", body: "{when} · {title} · Fame Driver විවෘත කර පිළිගන්න ඔබන්න" },
  },
};

interface Ticket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** "Thu 8 Oct 09:00" in Colombo time. */
function when(iso: string): string {
  const d = new Date(new Date(iso).getTime() + COLOMBO_OFFSET_MS);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** "09:00" in Colombo time. */
function clock(iso: string): string {
  return when(iso).slice(-5);
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  const key = request.headers.get("x-server-key") ?? "";
  const expected = Deno.env.get("SERVER_KEY") ?? "";
  if (expected.length < 16 || !constantTimeEqual(key, expected)) return json(401, { error: "bad_server_key" });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "bad_request" });
  }
  const taskId = typeof body.task_id === "string" && body.task_id.length === 36 ? body.task_id : null;
  const employeeId = typeof body.employee_id === "string" && body.employee_id.length === 36 ? body.employee_id : null;
  const kind = (["new", "changed", "cancelled", "removed", "leave_30", "leave_now", "accept_reminder"] as const).find((k) =>
    k === body.kind
  ) ?? null;
  if (!taskId || !employeeId || !kind) return json(400, { error: "bad_request" });

  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const [taskRes, stopsRes, driverRes, tokensRes] = await Promise.all([
    admin.from("tasks").select("id, title, start_at, leave_by, status, cancelled_reason").eq("id", taskId).maybeSingle(),
    admin.from("task_stops").select("seq, place_name").eq("task_id", taskId).neq("status", "removed").order("seq"),
    admin.from("employees").select("id, name, language, active").eq("id", employeeId).maybeSingle(),
    admin.from("device_tokens").select("id, token").eq("employee_id", employeeId),
  ]);
  const task = taskRes.data;
  const driver = driverRes.data;
  if (!task || !driver) return json(404, { error: "task_or_driver_not_found" });
  const stops = stopsRes.data ?? [];
  const tokens = tokensRes.data ?? [];

  const log = { task_id: taskId, employee_id: employeeId, kind, tokens: tokens.length };
  if (tokens.length === 0 || !driver.active) {
    await admin.from("push_log").insert({ ...log, sent: 0, failed: 0, errors: driver.active ? null : [{ error: "driver_inactive" }] });
    return json(200, { sent: 0, failed: 0, reason: driver.active ? "no_token" : "driver_inactive" });
  }

  const language: Language = driver.language === "si" ? "si" : "en";
  const route = [stops[0]?.place_name ?? "", stops.length > 1 ? stops[stops.length - 1].place_name : ""].filter(Boolean).join(" → ");
  const vars = {
    when: when(task.start_at),
    leave: clock(task.leave_by ?? task.start_at),
    title: task.title,
    pickup: stops[0]?.place_name ?? "",
    dropoff: stops.length > 1 ? stops[stops.length - 1].place_name : "",
    reason: task.cancelled_reason ?? "",
    // A changed task names what changed; with nothing named (an older caller) the route is shown as before.
    changes: changesLine(language, body.changes) || route,
  };
  const text = TEXT[language][kind];
  const messages = tokens.map((t) => ({
    to: t.token,
    title: fill(text.title, vars),
    body: fill(text.body, vars).replace(/ · $/, "").replace(/ → $/, ""),
    data: { taskId, kind },
    channelId: CHANNEL[kind],
    priority: "high",
    sound: "default",
    ttl: 3600,
  }));

  let tickets: Ticket[] = [];
  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify(messages),
    });
    const reply = (await response.json()) as { data?: Ticket[]; errors?: unknown[] };
    if (!response.ok || !reply.data) {
      throw new Error(`expo push ${response.status}: ${JSON.stringify(reply.errors ?? reply).slice(0, 300)}`);
    }
    tickets = reply.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`push-task: ${message}`);
    await admin.from("push_log").insert({ ...log, sent: 0, failed: tokens.length, errors: [{ error: message.slice(0, 300) }] });
    return json(502, { error: "push_failed" });
  }

  const errors: { token_id: string; error: string }[] = [];
  const gone: string[] = [];
  tickets.forEach((ticket, i) => {
    const token = tokens[i];
    if (!token || ticket.status === "ok") return;
    const code = ticket.details?.error ?? ticket.message ?? "error";
    errors.push({ token_id: token.id, error: code });
    if (code === "DeviceNotRegistered") gone.push(token.id);
  });
  if (gone.length > 0) await admin.from("device_tokens").delete().in("id", gone);

  const sent = tokens.length - errors.length;
  await admin.from("push_log").insert({ ...log, sent, failed: errors.length, errors: errors.length > 0 ? errors : null });
  return json(200, { sent, failed: errors.length });
});
