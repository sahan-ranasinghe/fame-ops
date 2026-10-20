// The person's own notification settings and devices (Settings → Notifications
// in the web app). Personal: a signed-in person or a personal connector key; the
// shared key has no person and is refused. Any office permission may call them.
import { z } from "zod";
import { ToolError, unwrap, unwrapMaybe } from "../db.ts";
import type { Db } from "../db.ts";
import type { Json } from "../database.types.ts";
import { deviceLabel, EVENTS, inboxKind, relevantEvents } from "../notifications.ts";
import type { Actor } from "../roles.ts";
import { colomboDateTime } from "../time.ts";
import { whenText } from "../durations.ts";
import { pageInfo, pageWindow } from "../paging.ts";
import { tool, zId, zPaging, zSearch, zText } from "../tool.ts";

function person(actor: Actor): string {
  if (!actor.employeeId) {
    throw new ToolError(
      "This is personal: it needs a signed-in person (the web app) or a personal connector key. The shared key has no person.",
    );
  }
  return actor.employeeId;
}

/** The first 16 hex characters of the endpoint's SHA-256: the page tells its own device apart without the endpoint leaving the server. */
async function endpointHash(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The office site's sounds when the person never changed them (Hotfix 2, B). */
const SOUND_DEFAULT = { on: true, volume: 70 };

async function settingsOf(db: Db, employeeId: string, permissions: readonly string[]) {
  const [rowsRes, subsRes, prefsRes] = await Promise.all([
    db.from("notification_settings").select("event, enabled").eq("employee_id", employeeId),
    db.from("web_push_subscriptions").select("id, endpoint, user_agent, created_at, last_ok_at").eq("employee_id", employeeId)
      .is("removed_at", null).order("created_at"),
    db.from("notification_prefs").select("sound_on, volume").eq("employee_id", employeeId).maybeSingle(),
  ]);
  const prefs = unwrapMaybe(prefsRes, "sound settings");
  const off = new Set(unwrap(rowsRes, "notification settings").filter((r) => !r.enabled).map((r) => r.event));
  const devices = await Promise.all(
    unwrap(subsRes, "devices").map(async (s) => ({
      id: s.id,
      device: deviceLabel(s.user_agent),
      since: colomboDateTime(s.created_at),
      last_ok: s.last_ok_at ? colomboDateTime(s.last_ok_at) : undefined,
      endpoint_hash: await endpointHash(s.endpoint),
    })),
  );
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY")?.trim() ?? "";
  const configured = publicKey.length > 0 && (Deno.env.get("VAPID_PRIVATE_KEY")?.trim() ?? "").length > 0;
  return {
    events: relevantEvents(permissions).map((e) => ({ event: e.event, label: e.label, text: e.text, enabled: !off.has(e.event) })),
    devices,
    push: { configured, public_key: configured ? publicKey : undefined },
    sound: prefs ? { on: prefs.sound_on, volume: prefs.volume } : SOUND_DEFAULT,
  };
}

export const myNotificationSettings = tool({
  name: "my_notification_settings",
  title: "My notification settings",
  description: "The events this person is told about (on or off, only those their permissions can bring), the browsers they turned " +
    "notifications on in (devices), and whether web push is set up on the server (push.configured, push.public_key for the browser).",
  readOnly: true,
  input: z.object({}),
  async run(_args, { db, actor }) {
    const id = person(actor);
    return { result: await settingsOf(db, id, actor.permissions), summary: `settings of ${actor.name}` };
  },
});

export const setMyNotificationSettings = tool({
  name: "set_my_notification_settings",
  title: "Switch my notifications on or off",
  description: 'Per event, true or false: {"request.created": false}. Events not named keep their setting. sound: the office ' +
    "site's sounds for new notifications (on, volume 0–100). Answers like my_notification_settings.",
  readOnly: false,
  input: z.object({
    events: z.record(z.string(), z.boolean()).optional().describe("event → enabled"),
    sound: z.object({
      on: z.boolean().optional(),
      volume: z.number().int().min(0).max(100).optional(),
    }).optional().describe("Hotfix 2: the office site's sounds (default on, volume 70)"),
  }),
  async run({ events = {}, sound }, { db, actor, now }) {
    const id = person(actor);
    const names = Object.keys(events);
    if (names.length === 0 && sound?.on === undefined && sound?.volume === undefined) {
      throw new ToolError("Nothing to change: name at least one event, or the sound.");
    }
    const known = new Set(EVENTS.map((e) => e.event));
    const bad = names.filter((n) => !known.has(n as typeof EVENTS[number]["event"]));
    if (bad.length > 0) throw new ToolError(`Unknown event: ${bad.join(", ")}. The events are ${[...known].join(", ")}.`);
    if (names.length > 0) {
      unwrap(
        await db.from("notification_settings").upsert(
          names.map((event) => ({ employee_id: id, event, enabled: events[event], updated_at: now.toISOString() })),
          { onConflict: "employee_id,event" },
        ),
        "notification settings",
      );
    }
    if (sound && (sound.on !== undefined || sound.volume !== undefined)) {
      const before = unwrapMaybe(
        await db.from("notification_prefs").select("sound_on, volume").eq("employee_id", id).maybeSingle(),
        "sound settings",
      );
      unwrap(
        await db.from("notification_prefs").upsert({
          employee_id: id,
          sound_on: sound.on ?? before?.sound_on ?? SOUND_DEFAULT.on,
          volume: sound.volume ?? before?.volume ?? SOUND_DEFAULT.volume,
          updated_at: now.toISOString(),
        }, { onConflict: "employee_id" }),
        "sound settings",
      );
    }
    return {
      result: await settingsOf(db, id, actor.permissions),
      summary: [
        ...names.map((n) => `${n}=${events[n] ? "on" : "off"}`),
        ...(sound?.on !== undefined ? [`sound=${sound.on ? "on" : "off"}`] : []),
        ...(sound?.volume !== undefined ? [`volume=${sound.volume}`] : []),
      ].join(", "),
    };
  },
});

export const registerWebPush = tool({
  name: "register_web_push",
  title: "Turn notifications on in this browser",
  description: "Saves the browser's push subscription (from pushManager.subscribe) for this person. The same endpoint registered again " +
    "is updated, not duplicated. Answers like my_notification_settings, plus the registered device.",
  readOnly: false,
  input: z.object({
    endpoint: z.string().trim().url().max(2000),
    p256dh: zText(200),
    auth: zText(100),
    user_agent: zText(400).optional(),
  }),
  async run({ endpoint, p256dh, auth, user_agent }, { db, actor, now }) {
    const id = person(actor);
    const saved = unwrap(
      await db.from("web_push_subscriptions").upsert(
        { employee_id: id, endpoint, p256dh, auth, user_agent: user_agent ?? null, removed_at: null, removed_reason: null },
        { onConflict: "endpoint" },
      ).select("id, user_agent").single(),
      "device",
    );
    const settings = await settingsOf(db, id, actor.permissions);
    return {
      result: {
        registered: { id: saved.id, device: deviceLabel(saved.user_agent), endpoint_hash: await endpointHash(endpoint) },
        ...settings,
      },
      summary: `${deviceLabel(user_agent)} registered for ${actor.name} at ${now.toISOString()}`,
    };
  },
});

export const removeWebPush = tool({
  name: "remove_web_push",
  title: "Turn notifications off in a browser",
  description: "Removes this person's push subscription: by endpoint (the browser's own, after pushManager.unsubscribe) or by the " +
    "device id my_notification_settings lists (another browser). Answers like my_notification_settings, plus how many were removed.",
  readOnly: false,
  input: z.object({
    endpoint: z.string().trim().url().max(2000).optional(),
    id: zId.optional().describe("A device id from my_notification_settings"),
  }),
  async run({ endpoint, id: deviceId }, { db, actor, now }) {
    const id = person(actor);
    if (!endpoint && !deviceId) throw new ToolError("Give the endpoint or the device id.");
    let q = db.from("web_push_subscriptions").update({ removed_at: now.toISOString(), removed_reason: "user" })
      .eq("employee_id", id).is("removed_at", null);
    q = endpoint ? q.eq("endpoint", endpoint) : q.eq("id", deviceId!);
    const gone = unwrap(await q.select("id"), "device");
    return {
      result: { removed: gone.length, ...(await settingsOf(db, id, actor.permissions)) },
      summary: `${gone.length} device(s) removed for ${actor.name}`,
    };
  },
});

/** Hotfix 3 (L4): read items older than this leave the tray (they stay in the page's history). */
const ARCHIVE_AFTER_DAYS = 30;

/** One item of the notification centre as the page shows it. */
function inboxItem(
  r: {
    id: number;
    event: string;
    title: string;
    body: string | null;
    url: string | null;
    who: string | null;
    created_at: string;
    read_at: string | null;
  },
  now: Date,
) {
  return {
    id: r.id,
    event: r.event,
    title: r.title,
    body: r.body ?? undefined,
    url: r.url ?? undefined,
    who: r.who ?? undefined,
    at: colomboDateTime(r.created_at),
    ago: whenText(r.created_at, now),
    read: r.read_at !== null,
    kind: inboxKind(r.event),
  };
}

async function unreadCount(db: Db, employeeId: string): Promise<number> {
  const { count, error } = await db.from("office_inbox").select("id", { count: "exact", head: true }).eq("employee_id", employeeId)
    .is("read_at", null);
  if (error) throw new Error(`notification centre: ${error.message}`);
  return count ?? 0;
}

export const myInbox = tool({
  name: "my_inbox",
  title: "My notifications",
  description: "The person's notification centre (Hotfix 2): everything they were told about (a request to approve, a decision, " +
    "a driver on the way, a task that needs a driver, a critical issue…), newest first, with who did it, when (at, and ago as " +
    "words), the page it links to (url), read or not, and its kind for the sound (urgent, alert, soft, alarm, info). unread = " +
    "how many are unread in all. Kept 90 days once read.",
  readOnly: true,
  input: z.object({
    limit: z.number().int().min(1).max(500).optional().describe("Default 30 (the answer has total and next)"),
    cursor: zPaging.cursor,
    unread: z.boolean().optional().describe("Only the unread ones"),
    // Hotfix 3 (L4): the tray shows the last 30 days; read items older than that are archived (the page's history).
    archived: z.boolean().optional().describe("true = also the archived ones (read over 30 days ago)"),
    // Hotfix 3 (L3): the notifications page's search box (the title, the text, who).
    search: zSearch,
  }),
  async run({ limit = 30, cursor, unread, archived, search }, { db, actor, now }) {
    const id = person(actor);
    const w = pageWindow(limit, cursor);
    let q = db.from("office_inbox").select("id, event, title, body, url, who, created_at, read_at", { count: "exact" }).eq(
      "employee_id",
      id,
    );
    if (unread) q = q.is("read_at", null);
    const words = search?.replace(/[%_,()*]/g, " ").trim();
    if (words) q = q.or(`title.ilike.*${words}*,body.ilike.*${words}*,who.ilike.*${words}*`);
    if (!archived) {
      const cut = new Date(now.getTime() - ARCHIVE_AFTER_DAYS * 86400_000).toISOString();
      q = q.or(`read_at.is.null,created_at.gte.${cut}`);
    }
    const [res, count] = await Promise.all([
      q.order("created_at", { ascending: false }).order("id", { ascending: false }).range(w.offset, w.offset + (w.limit ?? 30) - 1),
      unreadCount(db, id),
    ]);
    const items = unwrap(res, "notification centre").map((r) => inboxItem(r, now));
    return {
      result: { unread: count, ...pageInfo(w, items.length, res.count ?? items.length), items },
      summary: `${items.length} notifications, ${count} unread`,
    };
  },
});

export const markInboxRead = tool({
  name: "mark_inbox_read",
  title: "Mark notifications read",
  description: "Marks the person's notifications read: the ids given (opening one), or all of them (Mark all read). Answers how " +
    "many were marked and how many are still unread.",
  readOnly: false,
  input: z.object({
    ids: z.array(z.number().int().positive()).min(1).max(200).optional(),
    all: z.boolean().optional(),
  }),
  async run({ ids, all }, { db, actor, now }) {
    const id = person(actor);
    if (!all && !ids?.length) throw new ToolError("Give the ids, or all: true.");
    let q = db.from("office_inbox").update({ read_at: now.toISOString() }).eq("employee_id", id).is("read_at", null);
    if (!all) q = q.in("id", ids!);
    const marked = unwrap(await q.select("id"), "notification centre").length;
    return { result: { marked, unread: await unreadCount(db, id) }, summary: `${marked} marked read` };
  },
});

/** The page preferences a person may keep (Hotfix 3, L1 and L5): the collapsed sections; Hotfix O2-H2 (Part 2): the
 * notification pause (Instagram's "Pause all"): when it began and what each event was before it, so Resume on any device
 * puts them back; null clears it. */
const PREF_KEYS = ["overview_collapsed", "menu_collapsed", "notifications_paused"] as const;
const zSections = z.array(z.string().trim().min(1).max(40)).max(30);
const zPause = z.object({ at: z.string().max(40), saved: z.record(z.string().max(60), z.boolean()) }).nullable();

async function prefsOf(db: Db, employeeId: string): Promise<Record<string, unknown>> {
  const row = unwrapMaybe(await db.from("office_prefs").select("prefs").eq("employee_id", employeeId).maybeSingle(), "preferences");
  return (row?.prefs as Record<string, unknown> | null) ?? {};
}

export const myPrefs = tool({
  name: "my_prefs",
  title: "My page preferences",
  description: "The person's own page preferences (Hotfix 3): the Overview's collapsed sections (overview_collapsed) and the side " +
    "menu's (menu_collapsed), and the notification pause (notifications_paused: when it began and what each event was). " +
    "Personal: a signed-in person or a personal key.",
  readOnly: true,
  input: z.object({}),
  async run(_args, { db, actor }) {
    const id = person(actor);
    return { result: { prefs: await prefsOf(db, id) }, summary: `preferences of ${actor.name}` };
  },
});

export const setMyPrefs = tool({
  name: "set_my_prefs",
  title: "Keep my page preferences",
  description: "Keeps the person's page preferences: the fields given replace those fields (overview_collapsed, menu_collapsed: lists " +
    "of section names; notifications_paused: {at, saved} or null to clear it); the others stay. Answers the preferences as kept.",
  readOnly: false,
  input: z.object({
    prefs: z.object({ overview_collapsed: zSections.optional(), menu_collapsed: zSections.optional(), notifications_paused: zPause.optional() }),
  }),
  async run({ prefs }, { db, actor, now }) {
    const id = person(actor);
    const given = Object.fromEntries(PREF_KEYS.flatMap((k) => (prefs[k] !== undefined ? [[k, prefs[k]]] : [])));
    if (Object.keys(given).length === 0) throw new ToolError("Nothing to keep: give overview_collapsed, menu_collapsed or notifications_paused.");
    const merged = { ...(await prefsOf(db, id)), ...given };
    unwrap(
      await db.from("office_prefs").upsert({ employee_id: id, prefs: merged as NonNullable<Json>, updated_at: now.toISOString() }, {
        onConflict: "employee_id",
      }),
      "preferences",
    );
    return { result: { prefs: merged }, summary: `${actor.name} kept ${Object.keys(given).join(", ")}` };
  },
});
