// notify-office: delivers the office notifications outbox by Web Push
// (docs/dispatch-plan.md, 4.3 and 9).
//
//   POST { "id": <notifications.id> }   one row: the insert trigger, through pg_net
//   POST { "retry": true }              every row that is due: pg_cron notify-retry (5 min)
//
// with the header x-server-key = SERVER_KEY (the key push-task and fleet-jobs check).
// A row is claimed by counting its attempt (so two calls never send it twice), then
// pushed to every device of the recipient: sent when one device took it; a device the
// push service reports gone (404 / 410) is marked removed; failed otherwise, tried again
// after 1, 5, 15 and 60 minutes, dead after 5 attempts. Without VAPID keys every row is
// marked dead (no_vapid_keys) and nothing else breaks; the e-mail channel is not built
// (dead, email_not_implemented). Phase 8 (O1 item 9): an 'expo_push' row goes to the
// recipient's phone(s) through Expo's push service (expo.ts: loud on the Part 6 channels
// for something to decide, a task that needs a driver or a critical issue, a tone for the
// rest); a token Expo reports gone is deleted; failed and dead as the Web Push rows.
//
// Secrets: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (base64url, as `web-push
// generate-vapid-keys` or scripts/make-vapid-keys.mjs print them), VAPID_SUBJECT
// (mailto:<address> or the site; default: the first OFFICE_WEB_URL), OFFICE_WEB_URL
// (makes the notification's link absolute), SERVER_KEY.

import { ApplicationServer, importVapidKeys, PushMessageError, Urgency } from "@negrel/webpush";
import { adminClient, type Db, type Row, type Update } from "../_shared/fleet/db.ts";
import { type DeviceToken, EXPO_PUSH_URL, expoMessagesFor, readTickets, type Ticket } from "./expo.ts";

const BACKOFF_MIN = [1, 5, 15, 60];
const MAX_ATTEMPTS = 5;
const PUSH_TIMEOUT_MS = 10_000;
const RETRY_BATCH = 50;

type Notification = Row<"notifications">;
type Outcome = "sent" | "failed" | "dead" | "skipped";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// --- VAPID keys: the base64url pair the generator prints → JWK → the application server ----
function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The raw P-256 pair (65-byte uncompressed public point, 32-byte private scalar) as JWKs. */
export function vapidJwk(publicKey: string, privateKey: string): { publicKey: JsonWebKey; privateKey: JsonWebKey } {
  const pub = fromBase64Url(publicKey.trim());
  const priv = fromBase64Url(privateKey.trim());
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC_KEY is not a raw P-256 public key (65 bytes, base64url)");
  if (priv.length !== 32) throw new Error("VAPID_PRIVATE_KEY is not a raw P-256 private key (32 bytes, base64url)");
  const x = toBase64Url(pub.slice(1, 33));
  const y = toBase64Url(pub.slice(33, 65));
  return {
    publicKey: { kty: "EC", crv: "P-256", x, y },
    privateKey: { kty: "EC", crv: "P-256", x, y, d: toBase64Url(priv) },
  };
}

function webOrigin(): string | null {
  const first = (Deno.env.get("OFFICE_WEB_URL") ?? "").split(",").map((s) => s.trim()).filter(Boolean)[0];
  if (!first) return null;
  try {
    return new URL(first).origin;
  } catch {
    return null;
  }
}

let serverPromise: Promise<ApplicationServer | null> | null = null;
function appServer(): Promise<ApplicationServer | null> {
  if (!serverPromise) {
    serverPromise = (async () => {
      const pub = Deno.env.get("VAPID_PUBLIC_KEY")?.trim();
      const priv = Deno.env.get("VAPID_PRIVATE_KEY")?.trim();
      const subject = Deno.env.get("VAPID_SUBJECT")?.trim() || webOrigin();
      if (!pub || !priv || !subject) return null;
      const vapidKeys = await importVapidKeys(vapidJwk(pub, priv), { extractable: false });
      return await ApplicationServer.new({ contactInformation: subject, vapidKeys });
    })();
  }
  return serverPromise;
}

// --- The outbox -------------------------------------------------------------------------
/** A photo's path in the payload ({ bucket, path }) as a link for one hour, or nothing (never fails the push). */
async function signedFile(db: Db, file: unknown): Promise<string | undefined> {
  const f = file as { bucket?: unknown; path?: unknown } | null;
  if (!f || typeof f.bucket !== "string" || typeof f.path !== "string") return undefined;
  if (f.bucket !== "driver-photos" && f.bucket !== "vehicle-photos") return undefined;
  const { data, error } = await db.storage.from(f.bucket).createSignedUrl(f.path, 3600);
  return error || !data ? undefined : data.signedUrl;
}

/** Counts the attempt on a row that is still queued or failed; null when another call has it. */
async function claim(db: Db, row: Notification): Promise<Notification | null> {
  const { data, error } = await db.from("notifications").update({ attempts: row.attempts + 1 })
    .eq("id", row.id).in("status", ["queued", "failed"]).eq("attempts", row.attempts).select("*").maybeSingle();
  if (error) throw new Error(`notifications: ${error.message}`);
  return data ?? null;
}

async function finish(db: Db, id: number, patch: Update<"notifications">): Promise<void> {
  const { error } = await db.from("notifications").update(patch).eq("id", id);
  if (error) throw new Error(`notifications: ${error.message}`);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no answer from the push service in ${ms / 1000} s`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }, (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

async function deliver(db: Db, server: ApplicationServer | null, row: Notification, now: Date): Promise<Outcome> {
  const claimed = await claim(db, row);
  if (!claimed) return "skipped";
  const nowIso = now.toISOString();
  const dead = async (error: string): Promise<Outcome> => {
    await finish(db, claimed.id, { status: "dead", error });
    return "dead";
  };
  if (claimed.channel === "expo_push") return deliverExpo(db, claimed, now);
  if (claimed.channel !== "web_push") return dead("email_not_implemented");
  if (!server) return dead("no_vapid_keys");

  const { data: subs, error } = await db.from("web_push_subscriptions").select("id, endpoint, p256dh, auth")
    .eq("employee_id", claimed.recipient_employee_id).is("removed_at", null);
  if (error) throw new Error(`devices: ${error.message}`);
  if (!subs || subs.length === 0) return dead("no_subscription");

  const payload = (claimed.payload ?? {}) as Record<string, unknown>;
  const path = typeof payload.url === "string" ? payload.url : "/";
  const origin = webOrigin();
  const text = JSON.stringify({
    title: typeof payload.title === "string" ? payload.title : "Fame Fleet",
    body: typeof payload.body === "string" ? payload.body : "",
    url: origin && path.startsWith("/") ? origin + path : path,
    tag: typeof payload.tag === "string" ? payload.tag : undefined,
    // Phase 7 (§4): the driver's photo as the icon and the vehicle's as the image, signed now for an hour.
    icon: await signedFile(db, payload.icon_path),
    image: await signedFile(db, payload.image_path),
  });

  let ok = 0;
  const errors: string[] = [];
  for (const s of subs) {
    try {
      const subscriber = server.subscribe({ endpoint: s.endpoint, keys: { auth: s.auth, p256dh: s.p256dh } });
      await withTimeout(subscriber.pushTextMessage(text, { ttl: 3600, urgency: Urgency.High }), PUSH_TIMEOUT_MS);
      ok += 1;
      await db.from("web_push_subscriptions").update({ last_ok_at: nowIso }).eq("id", s.id);
    } catch (e) {
      if (e instanceof PushMessageError && e.isGone()) {
        await db.from("web_push_subscriptions").update({ removed_at: nowIso, removed_reason: "gone" }).eq("id", s.id);
        errors.push("gone");
      } else {
        errors.push(e instanceof PushMessageError ? `push service answered ${e.response.status}` : messageOf(e));
      }
    }
  }

  if (ok > 0) {
    await finish(db, claimed.id, { status: "sent", sent_at: nowIso, error: errors.length > 0 ? errors.join("; ") : null });
    return "sent";
  }
  if (errors.every((e) => e === "gone")) return dead("subscription_gone");
  if (claimed.attempts >= MAX_ATTEMPTS) return dead(errors.join("; "));
  const minutes = BACKOFF_MIN[Math.min(claimed.attempts, BACKOFF_MIN.length) - 1];
  await finish(db, claimed.id, {
    status: "failed",
    error: errors.join("; "),
    next_try_at: new Date(now.getTime() + minutes * 60_000).toISOString(),
  });
  return "failed";
}

/** Phase 8 (O1 item 9): one expo_push row to every phone of the recipient. */
async function deliverExpo(db: Db, claimed: Notification, now: Date): Promise<Outcome> {
  const nowIso = now.toISOString();
  const dead = async (error: string): Promise<Outcome> => {
    await finish(db, claimed.id, { status: "dead", error });
    return "dead";
  };
  const { data: tokens, error } = await db.from("device_tokens").select("id, token, channels").eq(
    "employee_id",
    claimed.recipient_employee_id,
  );
  if (error) throw new Error(`device_tokens: ${error.message}`);
  if (!tokens || tokens.length === 0) return dead("no_device");
  const messages = expoMessagesFor(claimed.event, (claimed.payload ?? {}) as Record<string, unknown>, tokens as DeviceToken[]);
  let tickets: Ticket[];
  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      body: JSON.stringify(messages),
    });
    const reply = (await response.json()) as { data?: Ticket[]; errors?: unknown[] };
    if (!response.ok || !reply.data) {
      throw new Error(`expo push ${response.status}: ${JSON.stringify(reply.errors ?? reply).slice(0, 200)}`);
    }
    tickets = reply.data;
  } catch (e) {
    // Expo did not answer: the row waits for the retry job like a Web Push that failed.
    if (claimed.attempts >= MAX_ATTEMPTS) return dead(messageOf(e));
    const minutes = BACKOFF_MIN[Math.min(claimed.attempts, BACKOFF_MIN.length) - 1];
    await finish(db, claimed.id, {
      status: "failed",
      error: messageOf(e),
      next_try_at: new Date(now.getTime() + minutes * 60_000).toISOString(),
    });
    return "failed";
  }
  const r = readTickets(tickets, tokens as DeviceToken[]);
  if (r.gone.length > 0) await db.from("device_tokens").delete().in("id", r.gone);
  if (r.sent > 0) {
    await finish(db, claimed.id, { status: "sent", sent_at: nowIso, error: r.errors.length > 0 ? r.errors.join("; ") : null });
    return "sent";
  }
  return dead(r.errors.join("; ") || "no_ticket");
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

  const db = adminClient();
  const now = new Date();
  let rows: Notification[];
  if (body.retry === true) {
    const { data, error } = await db.from("notifications").select("*").in("status", ["queued", "failed"]).lt("attempts", MAX_ATTEMPTS)
      .lte("next_try_at", now.toISOString()).order("id").limit(RETRY_BATCH);
    if (error) return json(500, { error: "db_error", message: error.message });
    rows = data ?? [];
  } else if (Number.isInteger(body.id) && (body.id as number) > 0) {
    const { data, error } = await db.from("notifications").select("*").eq("id", body.id as number).maybeSingle();
    if (error) return json(500, { error: "db_error", message: error.message });
    if (!data) return json(404, { error: "not_found" });
    rows = [data];
  } else {
    return json(400, { error: "bad_request", message: "give id or retry: true" });
  }

  const started = Date.now();
  let server: ApplicationServer | null;
  try {
    server = await appServer();
  } catch (e) {
    // Keys set but not usable: a configuration mistake. The rows stay queued for the retry job; the log says why.
    serverPromise = null;
    console.error("notify-office: the VAPID keys could not be loaded", messageOf(e));
    return json(500, { error: "vapid_keys_invalid", message: messageOf(e) });
  }
  const counts: Record<Outcome, number> = { sent: 0, failed: 0, dead: 0, skipped: 0 };
  try {
    for (const row of rows) counts[await deliver(db, server, row, now)] += 1;
  } catch (e) {
    console.error("notify-office failed", e);
    return json(500, { error: "delivery_failed", message: messageOf(e), ...counts });
  }
  return json(200, { processed: rows.length, ...counts, vapid: server !== null, ms: Date.now() - started });
});
