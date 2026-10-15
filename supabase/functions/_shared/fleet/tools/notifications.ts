// The person's own notification settings and devices (Settings → Notifications
// in the web app). Personal: a signed-in person or a personal connector key; the
// shared key has no person and is refused. Any office permission may call them.
import { z } from "zod";
import { ToolError, unwrap } from "../db.ts";
import type { Db } from "../db.ts";
import { deviceLabel, EVENTS, relevantEvents } from "../notifications.ts";
import type { Actor } from "../roles.ts";
import { colomboDateTime } from "../time.ts";
import { tool, zId, zText } from "../tool.ts";

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
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(endpoint),
  );
  return [...new Uint8Array(digest)].slice(0, 8).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

async function settingsOf(
  db: Db,
  employeeId: string,
  permissions: readonly string[],
) {
  const [rowsRes, subsRes] = await Promise.all([
    db.from("notification_settings").select("event, enabled").eq(
      "employee_id",
      employeeId,
    ),
    db.from("web_push_subscriptions").select(
      "id, endpoint, user_agent, created_at, last_ok_at",
    ).eq("employee_id", employeeId)
      .is("removed_at", null).order("created_at"),
  ]);
  const off = new Set(
    unwrap(rowsRes, "notification settings").filter((r) => !r.enabled).map((
      r,
    ) => r.event),
  );
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
  const configured = publicKey.length > 0 &&
    (Deno.env.get("VAPID_PRIVATE_KEY")?.trim() ?? "").length > 0;
  return {
    events: relevantEvents(permissions).map((e) => ({
      event: e.event,
      label: e.label,
      text: e.text,
      enabled: !off.has(e.event),
    })),
    devices,
    push: { configured, public_key: configured ? publicKey : undefined },
  };
}

export const myNotificationSettings = tool({
  name: "my_notification_settings",
  title: "My notification settings",
  description:
    "The events this person is told about (on or off, only those their permissions can bring), the browsers they turned " +
    "notifications on in (devices), and whether web push is set up on the server (push.configured, push.public_key for the browser).",
  readOnly: true,
  input: z.object({}),
  async run(_args, { db, actor }) {
    const id = person(actor);
    return {
      result: await settingsOf(db, id, actor.permissions),
      summary: `settings of ${actor.name}`,
    };
  },
});

export const setMyNotificationSettings = tool({
  name: "set_my_notification_settings",
  title: "Switch my notifications on or off",
  description:
    'Per event, true or false: {"request.created": false}. Events not named keep their setting. Answers like my_notification_settings.',
  readOnly: false,
  input: z.object({
    events: z.record(z.string(), z.boolean()).describe("event → enabled"),
  }),
  async run({ events }, { db, actor, now }) {
    const id = person(actor);
    const names = Object.keys(events);
    if (names.length === 0) {
      throw new ToolError("Nothing to change: name at least one event.");
    }
    const known = new Set(EVENTS.map((e) => e.event));
    const bad = names.filter((n) =>
      !known.has(n as typeof EVENTS[number]["event"])
    );
    if (bad.length > 0) {
      throw new ToolError(
        `Unknown event: ${bad.join(", ")}. The events are ${
          [...known].join(", ")
        }.`,
      );
    }
    unwrap(
      await db.from("notification_settings").upsert(
        names.map((event) => ({
          employee_id: id,
          event,
          enabled: events[event],
          updated_at: now.toISOString(),
        })),
        { onConflict: "employee_id,event" },
      ),
      "notification settings",
    );
    return {
      result: await settingsOf(db, id, actor.permissions),
      summary: names.map((n) => `${n}=${events[n] ? "on" : "off"}`).join(", "),
    };
  },
});

export const registerWebPush = tool({
  name: "register_web_push",
  title: "Turn notifications on in this browser",
  description:
    "Saves the browser's push subscription (from pushManager.subscribe) for this person. The same endpoint registered again " +
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
        {
          employee_id: id,
          endpoint,
          p256dh,
          auth,
          user_agent: user_agent ?? null,
          removed_at: null,
          removed_reason: null,
        },
        { onConflict: "endpoint" },
      ).select("id, user_agent").single(),
      "device",
    );
    const settings = await settingsOf(db, id, actor.permissions);
    return {
      result: {
        registered: {
          id: saved.id,
          device: deviceLabel(saved.user_agent),
          endpoint_hash: await endpointHash(endpoint),
        },
        ...settings,
      },
      summary: `${
        deviceLabel(user_agent)
      } registered for ${actor.name} at ${now.toISOString()}`,
    };
  },
});

export const removeWebPush = tool({
  name: "remove_web_push",
  title: "Turn notifications off in a browser",
  description:
    "Removes this person's push subscription: by endpoint (the browser's own, after pushManager.unsubscribe) or by the " +
    "device id my_notification_settings lists (another browser). Answers like my_notification_settings, plus how many were removed.",
  readOnly: false,
  input: z.object({
    endpoint: z.string().trim().url().max(2000).optional(),
    id: zId.optional().describe("A device id from my_notification_settings"),
  }),
  async run({ endpoint, id: deviceId }, { db, actor, now }) {
    const id = person(actor);
    if (!endpoint && !deviceId) {
      throw new ToolError("Give the endpoint or the device id.");
    }
    let q = db.from("web_push_subscriptions").update({
      removed_at: now.toISOString(),
      removed_reason: "user",
    })
      .eq("employee_id", id).is("removed_at", null);
    q = endpoint ? q.eq("endpoint", endpoint) : q.eq("id", deviceId!);
    const gone = unwrap(await q.select("id"), "device");
    return {
      result: {
        removed: gone.length,
        ...(await settingsOf(db, id, actor.permissions)),
      },
      summary: `${gone.length} device(s) removed for ${actor.name}`,
    };
  },
});
