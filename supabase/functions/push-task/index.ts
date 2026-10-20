// Edge Function push-task: sends a push notification about one task change
// to the driver's phone(s), through Expo's push service (which talks to FCM
// with the key uploaded to EAS).
//
//   POST /functions/v1/push-task
//   x-server-key: <SERVER_KEY>            (called by the database trigger tasks_notify_push, through pg_net)
//   { "task_id": "...", "kind": "new" | "changed" | "cancelled" | "removed" | "leave_30" | "leave_now" | "accept_reminder" | "reopened", "employee_id": "...",
//     "changes": { "time": "Thu 15 Oct 09:30", "vehicle": "WP KL-1234", "end_by": "12:00", "title": "…", "stops": true, "passengers": 4, "notes": true } }  (changed only)
//   { "task_id": null, "kind": "vehicle_taken" | "vehicle_moved" | "duty_auto_out" | "duty_office_out", "employee_id": "...",
//     "plate"?: "WP CAB-4521", "name"?: "Kamal", "time"?: "21:00" }   (Phase 7: the driver's day, no task)
//   { "task_id": null, "kind": "ask", "employee_id": "...", "ask_id": "..." }   (Part 3b: a question from the office)
//   200 { "sent": 1, "failed": 0 }   (also 200 with sent 0 when the driver has no registered phone)
//
// The text is in the driver's language (employees.language). Android plays
// the sound of the channel named here (the app creates the channels with the
// bundled sounds): tasks-new for a new task, tasks-changed for a changed or
// cancelled one, general for "no longer yours". Tapping the notification
// opens the task (data.taskId). Tokens Expo reports as DeviceNotRegistered
// are deleted. Every call is written to push_log. leave_30 and leave_now come
// from the pg_cron job task-reminders (queue_task_reminders), accept_reminder
// from the accept rule. Phase 7: reopened (office_reopen_task), and four pushes about
// the driver's day with no task: vehicle_taken (take_vehicle: another driver took
// the vehicle), vehicle_moved (office_move_vehicle), duty_auto_out (duty_jobs at the
// cut-off) and duty_office_out (office_clock_out). data.kind tells the app to refresh
// (and, for the two clock-outs, to stop location).

import { createClient } from "@supabase/supabase-js";
import { channelFor, DAY_KINDS, type DayKind, type Kind, TASK_KINDS, type TaskKind } from "./channels.ts";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const COLOMBO_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Language = "en" | "si";

/** The question in the driver's language: the title by the ask's kind, the line under it. */
const ASK_TEXT: Record<Language, Record<string, { title: string; body: string }>> = {
  en: {
    free_for_trip: { title: "Free for a trip?", body: "{when} · {asker} asks · tap to answer" },
    office_time: { title: "When can you be at the office?", body: "{asker} asks · tap to answer" },
    where_now: { title: "Where are you now?", body: "{asker} asks · tap to share your location once" },
  },
  si: {
    free_for_trip: { title: "ගමනකට නිදහස්ද?", body: "{when} · {asker} අසයි · පිළිතුරු දීමට තට්ටු කරන්න" },
    office_time: { title: "කාර්යාලයට පැමිණිය හැක්කේ කීයටද?", body: "{asker} අසයි · පිළිතුරු දීමට තට්ටු කරන්න" },
    where_now: { title: "ඔබ දැන් කොහෙද?", body: "{asker} අසයි · ඔබේ ස්ථානය එක් වරක් යැවීමට තට්ටු කරන්න" },
  },
};

/** The words for each changed field ("Task changed: new time 09:30 · vehicle WP KL-1234"). */
const CHANGE_TEXT: Record<Language, Record<string, string>> = {
  en: {
    time: "new time {time}",
    vehicle: "vehicle {vehicle}",
    vehicle_day: "vehicle: yours on the day",
    vehicle_any: "vehicle: any {vehicle_any}",
    end_by: "back by {end_by}",
    title: "now “{title}”",
    stops: "stops changed",
    passengers: "{passengers} passengers",
    notes: "note changed",
  },
  si: {
    time: "නව වේලාව {time}",
    vehicle: "වාහනය {vehicle}",
    vehicle_day: "වාහනය: එදින ඔබ ළඟ ඇති වාහනය",
    vehicle_any: "වාහනය: ඕනෑම {vehicle_any}",
    end_by: "ආපසු {end_by} ට",
    title: "දැන් “{title}”",
    stops: "නැවතුම් වෙනස් විය",
    passengers: "මගීන් {passengers}",
    notes: "සටහන වෙනස් විය",
  },
};
const CHANGE_ORDER = ["time", "end_by", "vehicle", "vehicle_day", "vehicle_any", "stops", "title", "passengers", "notes"];

/** Hotfix 2 (J): the type words for "any van" (the driver app's vehicleType.* keys). */
const TYPE_TEXT: Record<Language, Record<string, string>> = {
  en: { car: "car", van: "van", double_cab: "double cab", lorry: "lorry", other: "vehicle" },
  si: { car: "කාර්", van: "වෑන්", double_cab: "ඩබල් කැබ්", lorry: "ලොරි", other: "වාහන" },
};

/** Phase 7 (§11): a stop that changed, by its place in the order ("Stop 2 added: Kurunegala site"). */
const STOP_CHANGE_TEXT: Record<Language, { line: string; more: string; change: Record<string, string> }> = {
  en: {
    line: "Stop {n} {change}: {place}",
    more: "{more} more",
    change: { added: "added", removed: "removed", moved: "moved", changed: "changed" },
  },
  si: {
    line: "නැවතුම {n} {change}: {place}",
    more: "තවත් {more}",
    change: { added: "එක් කළා", removed: "ඉවත් කළා", moved: "අනුපිළිවෙල වෙනස් විය", changed: "වෙනස් විය" },
  },
};

/** update_task_stops' list of changed stops in the driver's language; null when the stops were not named. */
function stopsText(language: Language, value: unknown): string | null {
  const v = value as { list?: { n?: unknown; place?: unknown; change?: unknown }[]; more?: unknown } | null;
  if (!v || typeof v !== "object" || !Array.isArray(v.list) || v.list.length === 0) return null;
  const words = STOP_CHANGE_TEXT[language];
  const lines = v.list.map((x) =>
    fill(words.line, {
      n: String(x.n ?? ""),
      change: words.change[String(x.change)] ?? String(x.change ?? ""),
      place: String(x.place ?? ""),
    })
  );
  if (typeof v.more === "number" && v.more > 0) lines.push(fill(words.more, { more: String(v.more) }));
  return lines.join(" · ");
}

/** "new time 09:30 · vehicle WP KL-1234", or "" when nothing is named. */
export function changesLine(language: Language, changes: unknown): string {
  if (!changes || typeof changes !== "object") return "";
  const c = changes as Record<string, unknown>;
  return CHANGE_ORDER.filter((k) => c[k] !== undefined && c[k] !== null && c[k] !== false)
    .map((k) =>
      (k === "stops" ? stopsText(language, c[k]) : null) ??
        fill(CHANGE_TEXT[language][k], { [k]: k === "vehicle_any" ? TYPE_TEXT[language][String(c[k])] ?? String(c[k]) : String(c[k]) })
    )
    .join(" · ");
}

const TEXT: Record<Language, Record<Kind, { title: string; body: string }>> = {
  en: {
    new: { title: "New task {when}", body: "{title} · {pickup} → {dropoff}" },
    changed: { title: "Task changed {when}", body: "{title} · {changes}" },
    cancelled: { title: "Task cancelled", body: "{title} · {reason}" },
    removed: { title: "Task reassigned", body: "{title} is no longer yours." },
    leave_30: { title: "Leave by {leave}", body: "{title} · leave in 30 min · {pickup} → {dropoff}" },
    leave_now: { title: "Time to leave", body: "{title} · leave by {leave} · {pickup} → {dropoff}" },
    // Phase 7 (§19): one reminder 5 minutes after sending; the office is told when the accept window ends.
    accept_reminder: { title: "Accept or decline: {title} {leave}", body: "{pickup} → {dropoff} · open the app" },
    reopened: { title: "Task reopened", body: "{title} · finish it again in the app" },
    vehicle_taken: { title: "Your vehicle was taken", body: "{plate} is now with {name} · choose your vehicle" },
    vehicle_moved: { title: "The office changed your vehicle", body: "Your vehicle is now {plate}" },
    duty_auto_out: { title: "You were clocked out", body: "Clocked out at {time} (end of the day)." },
    duty_office_out: { title: "You were clocked out", body: "The office clocked you out at {time}." },
    ask: { title: "{question}", body: "{detail}" },
  },
  si: {
    new: { title: "නව කාර්යය {when}", body: "{title} · {pickup} → {dropoff}" },
    changed: { title: "කාර්යය වෙනස් විය {when}", body: "{title} · {changes}" },
    cancelled: { title: "කාර්යය අවලංගු විය", body: "{title} · {reason}" },
    removed: { title: "කාර්යය වෙනත් අයෙකුට පැවරිණි", body: "{title} තවදුරටත් ඔබගේ නොවේ." },
    leave_30: { title: "{leave} ට පිටත් වන්න", body: "{title} · මිනිත්තු 30 කින් පිටත් වන්න · {pickup} → {dropoff}" },
    leave_now: { title: "පිටත් වීමට වෙලාවයි", body: "{title} · {leave} ට පිටත් වන්න · {pickup} → {dropoff}" },
    accept_reminder: { title: "පිළිගන්න හෝ ප්‍රතික්ෂේප කරන්න: {title} {leave}", body: "{pickup} → {dropoff} · යෙදුම විවෘත කරන්න" },
    reopened: { title: "කාර්යය නැවත විවෘත කළා", body: "{title} · යෙදුමෙන් නැවත අවසන් කරන්න" },
    vehicle_taken: { title: "ඔබේ වාහනය වෙනත් අයෙකු ගත්තා", body: "{plate} දැන් {name} ළඟ · ඔබේ වාහනය තෝරන්න" },
    vehicle_moved: { title: "කාර්යාලය ඔබේ වාහනය වෙනස් කළා", body: "ඔබේ වාහනය දැන් {plate}" },
    duty_auto_out: { title: "ඔබව රාජකාරියෙන් ඉවත් කළා", body: "{time} ට රාජකාරියෙන් ඉවත් කළා (දවසේ අවසානය)." },
    duty_office_out: { title: "ඔබව රාජකාරියෙන් ඉවත් කළා", body: "කාර්යාලය {time} ට ඔබව රාජකාරියෙන් ඉවත් කළා." },
    ask: { title: "{question}", body: "{detail}" },
  },
};

const NO_VEHICLE: Record<Language, string> = { en: "You have no vehicle now.", si: "ඔබට දැන් වාහනයක් නැත." };

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
  const kind: Kind | null = [...TASK_KINDS, ...DAY_KINDS].find((k) => k === body.kind) ?? null;
  const dayKind = kind !== null && (DAY_KINDS as string[]).includes(kind);
  if (!employeeId || !kind || (!taskId && !dayKind)) return json(400, { error: "bad_request" });

  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const askId = kind === "ask" && typeof body.ask_id === "string" && body.ask_id.length === 36 ? body.ask_id : null;
  if (kind === "ask" && !askId) return json(400, { error: "bad_request" });
  const [taskRes, stopsRes, driverRes, tokensRes, askRes] = await Promise.all([
    taskId
      ? admin.from("tasks").select("id, title, start_at, leave_by, status, cancelled_reason").eq("id", taskId).maybeSingle()
      : Promise.resolve({ data: null }),
    taskId
      ? admin.from("task_stops").select("seq, place_name").eq("task_id", taskId).neq("status", "removed").order("seq")
      : Promise.resolve({ data: [] as { seq: number; place_name: string }[] }),
    admin.from("employees").select("id, name, language, active, role").eq("id", employeeId).maybeSingle(),
    admin.from("device_tokens").select("id, token, channels").eq("employee_id", employeeId),
    askId
      ? admin.from("driver_asks").select("id, kind, trip_from, trip_to, note, asked_by_name").eq("id", askId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const ask = askRes.data;
  if (kind === "ask" && !ask) return json(404, { error: "ask_not_found" });
  const task = taskRes.data;
  const driver = driverRes.data;
  if (!driver || (!dayKind && !task)) return json(404, { error: "task_or_driver_not_found" });
  const stops = stopsRes.data ?? [];
  const tokens = tokensRes.data ?? [];

  const log = { task_id: taskId, employee_id: employeeId, kind, tokens: tokens.length };
  // Phase 8 (O1 item 9): an office person who drives a custodian's vehicle holds a token for the office's notifications,
  // never for the driver's task pushes.
  if (driver.role !== "driver") {
    await admin.from("push_log").insert({ ...log, sent: 0, failed: 0, errors: [{ error: "not_a_driver" }] });
    return json(200, { sent: 0, failed: 0, reason: "not_a_driver" });
  }
  if (tokens.length === 0 || !driver.active) {
    await admin.from("push_log").insert({ ...log, sent: 0, failed: 0, errors: driver.active ? null : [{ error: "driver_inactive" }] });
    return json(200, { sent: 0, failed: 0, reason: driver.active ? "no_token" : "driver_inactive" });
  }

  const language: Language = driver.language === "si" ? "si" : "en";
  const route = [stops[0]?.place_name ?? "", stops.length > 1 ? stops[stops.length - 1].place_name : ""].filter(Boolean).join(" → ");
  const text_ = (v: unknown) => (typeof v === "string" ? v : "");
  const vars = {
    when: task ? when(task.start_at) : "",
    leave: task ? clock(task.leave_by ?? task.start_at) : "",
    title: task?.title ?? "",
    pickup: stops[0]?.place_name ?? "",
    dropoff: stops.length > 1 ? stops[stops.length - 1].place_name : "",
    reason: task?.cancelled_reason ?? "",
    // A changed task names what changed; with nothing named (an older caller) the route is shown as before.
    changes: changesLine(language, body.changes) || route,
    // The driver's day (Phase 7).
    plate: text_(body.plate),
    name: text_(body.name),
    time: text_(body.time),
    question: "",
    detail: "",
  };
  // Part 3b (H3): the office's question ("Free for a trip?" · "Mon 20 Oct 09:00–12:00 · Palitha asks · tap to answer").
  if (ask) {
    const words = ASK_TEXT[language][ask.kind] ?? ASK_TEXT[language].office_time;
    const tripWhen = ask.trip_from ? `${when(ask.trip_from)}${ask.trip_to ? `–${clock(ask.trip_to)}` : ""}` : "";
    vars.question = words.title;
    vars.detail = [fill(words.body, { when: tripWhen, asker: ask.asked_by_name.split(" ")[0] }), ask.note ?? ""]
      .filter(Boolean).join(" · ");
  }
  // Moved to no vehicle: say so instead of an empty plate.
  const text = kind === "vehicle_moved" && !vars.plate ? { ...TEXT[language][kind], body: NO_VEHICLE[language] } : TEXT[language][kind];
  const messages = tokens.map((t) => ({
    to: t.token,
    title: fill(text.title, vars),
    body: fill(text.body, vars).replace(/ · $/, "").replace(/ → $/, ""),
    // A changed task carries what changed: the app highlights it on the task's preview (Hotfix 2, I).
    data: taskId
      ? { taskId, kind, ...(kind === "changed" && body.changes ? { changes: body.changes } : {}) }
      : askId
      ? { kind, askId }
      : { kind },
    channelId: channelFor(kind, t.channels ?? []),
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
