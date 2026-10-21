// Edge Function office-api: the office web app's way to the same tools the
// connector offers, with the same inputs and the same JSON answers.
//
//   GET  /office-api/me                 who is signed in, their permissions and role, whether the second step is done, the tools they may call,
//                                       and map { package, places } (google: load Google's map after register_map_load; open: OpenFreeMap)
//   GET  /office-api/tools              the tools with their input schemas (for the forms)
//   GET  /office-api/public/privacy     no session (the public privacy page, /privacy): { email?, phone? } from the settings
//                                       privacy_email and office_phone, nothing else; 60 a minute per address
//   POST /office-api/tools/<name>       body = the tool's arguments; 200 { result } exactly as the connector returns it
//                                       400 { error: "bad_input", issues } · 403 { error } · 404 · 409 { error } (the tool said no)
//                                       429 too many calls · 500 { error }
//
// Who: Authorization: Bearer <Supabase session token>. The token is checked
// with Supabase Auth and the person is their employees row (active, office
// role). 2-step sign-in is optional (the person turns it on in Settings and
// the web app then asks for the code); the secret REQUIRE_MFA_ROLES, empty by
// default, names the roles that are refused (403 mfa_required) until their
// session has done the second step (aal2). Every call runs through the shared
// runner (role check, audit with the person's name, channel "web").
//
// Deployed with verify_jwt off (config.toml): the check is done here.
// Secrets: OFFICE_WEB_URL (the web app's origin, for CORS and links),
// REQUIRE_MFA_ROLES (optional, see above).

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { sessionFailure } from "../_shared/fleet/sessionCheck.ts";
import { APP_ERROR_INPUT, saveAppError } from "../_shared/fleet/appErrors.ts";
import { driverPhotoLinks, photoLinksById } from "../_shared/fleet/media.ts";
import { licenceState } from "../_shared/fleet/licence.ts";
import { colomboDate } from "../_shared/fleet/time.ts";
import {
  type Actor,
  adminClient,
  canCall,
  googleUse,
  isRole,
  loadSettings,
  mfaRequiredRoles,
  normalisePermissions,
  OFFICE_ROLES,
  phoneDisplay,
  runTool,
  TOOL_PERMISSION,
  TOOLS,
} from "../_shared/fleet/index.ts";

const CALLS_PER_MINUTE = 120;
/** The public privacy contact: per caller address. */
const PUBLIC_PER_MINUTE = 60;
const db = adminClient();
/** Roles that must have done the second step; empty unless the secret REQUIRE_MFA_ROLES says otherwise. */
const MFA_ROLES = mfaRequiredRoles(Deno.env.get("REQUIRE_MFA_ROLES"));
const calls = new Map<string, number[]>();

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function allowedOrigins(): string[] {
  const configured = (Deno.env.get("OFFICE_WEB_URL") ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  // 5173 = `npm run dev`, 5174 = the end-to-end test's own server.
  return [...configured, "http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"];
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && allowedOrigins().includes(origin) ? origin : allowedOrigins()[0] ?? "";
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, apikey",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

function json(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8" } });
}

/** The aal claim of a token Supabase Auth has just verified. */
function aalOf(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { aal?: string };
    return payload.aal ?? "aal1";
  } catch {
    return "aal1";
  }
}

type Resolved = { ok: true; actor: Actor; email: string; mfa: boolean; phone: string | null } | {
  ok: false;
  status: number;
  error: string;
};

async function resolvePerson(request: Request): Promise<Resolved> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "not_signed_in" };
  const asCaller = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await asCaller.auth.getUser(token);
  // Signed out only when Auth refused the token; Auth not answering is a 503 the app asks again (sessionCheck.ts).
  if (error || !data.user) return { ok: false, ...sessionFailure(error) };

  const { data: row, error: lookup } = await db.from("employees").select("id, name, email, phone, role, permissions, active")
    .eq("auth_user_id", data.user.id).maybeSingle();
  if (lookup) {
    console.error(`office-api: employee lookup failed: ${lookup.message}`);
    return { ok: false, status: 500, error: "lookup_failed" };
  }
  if (!row || !isRole(row.role) || !OFFICE_ROLES.includes(row.role)) return { ok: false, status: 403, error: "not_an_office_user" };
  if (!row.active) return { ok: false, status: 403, error: "switched_off" };
  const mfa = aalOf(token) === "aal2";
  if (MFA_ROLES.includes(row.role) && !mfa) return { ok: false, status: 403, error: "mfa_required" };
  return {
    ok: true,
    actor: {
      employeeId: row.id,
      name: row.name,
      role: row.role,
      permissions: normalisePermissions(row.permissions),
      authUserId: data.user.id,
      channel: "web",
    },
    email: row.email ?? data.user.email ?? "",
    mfa,
    phone: row.phone,
  };
}

function overLimit(key: string, perMinute = CALLS_PER_MINUTE): boolean {
  const now = Date.now();
  // The public page's callers are many addresses: forget the quiet ones now and then.
  if (calls.size > 2000) { for (const [k, v] of calls) if (v.every((t) => now - t >= 60_000)) calls.delete(k); }
  // Still crowded (many addresses in one minute): the public page's counters start again; a person's stay.
  if (calls.size > 10000) { for (const k of calls.keys()) if (k.startsWith("public:")) calls.delete(k); }
  const recent = (calls.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  calls.set(key, recent);
  return recent.length > perMinute;
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request.headers.get("origin"));
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const path = new URL(request.url).pathname.replace(/^.*?\/office-api/, "").replace(/\/$/, "");
  // Part 6: the privacy page opens without signing in and shows the contact from the settings (privacy_email, else the
  // office phone). The only answer without a session.
  if (request.method === "GET" && path === "/public/privacy") {
    // The address the platform adds: x-real-ip, else the last x-forwarded-for entry (a caller can only add entries before it).
    const from = request.headers.get("x-real-ip")?.trim() || (request.headers.get("x-forwarded-for") ?? "").split(",").pop()?.trim() ||
      "unknown";
    if (overLimit(`public:${from}`, PUBLIC_PER_MINUTE)) return json(429, { error: "too_many_calls" }, cors);
    try {
      const settings = await loadSettings(db);
      const body = {
        ...(settings.privacy_email ? { email: settings.privacy_email } : {}),
        ...(settings.office_phone ? { phone: phoneDisplay(settings.office_phone), phone_e164: settings.office_phone } : {}),
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    } catch (e) {
      console.error(`office-api: privacy contact: ${e instanceof Error ? e.message : String(e)}`);
      return json(500, { error: "settings_failed" }, cors);
    }
  }
  const person = await resolvePerson(request);
  if (!person.ok) return json(person.status, { error: person.error }, cors);
  const { actor } = person;

  if (request.method === "GET" && path === "/me") {
    // Which map the web shows (never the key: register_map_load hands it out after counting the load).
    const use = await loadSettings(db).then(googleUse, () => null);
    // Round 3: the person's own photo (initials until there is one) and driving licence (A5: for the trips they drive
    // themselves); a failed link is no photo, never a failed /me.
    const mine = actor.employeeId
      ? await (async () => {
        const { data } = await db.from("employees").select(
          "id, photo_id, licence_no, licence_expiry, licence_front_photo_id, licence_back_photo_id",
        ).eq("id", actor.employeeId!).maybeSingle();
        if (!data) return undefined;
        const [photos, licence] = await Promise.all([
          driverPhotoLinks(db, [data]),
          photoLinksById(db, [data.licence_front_photo_id, data.licence_back_photo_id]),
        ]);
        return {
          photo: photos.get(data.id),
          licence: {
            number: data.licence_no ?? undefined,
            expiry: data.licence_expiry ?? undefined,
            state: licenceState(data, colomboDate(new Date())),
            front_url: data.licence_front_photo_id ? licence.get(data.licence_front_photo_id) : undefined,
            back_url: data.licence_back_photo_id ? licence.get(data.licence_back_photo_id) : undefined,
          },
        };
      })().catch(() => undefined)
      : undefined;
    const photo = mine?.photo;
    return json(200, {
      name: actor.name,
      email: person.email,
      photo_url: photo,
      licence: mine?.licence,
      role: actor.role,
      permissions: actor.permissions,
      mfa: person.mfa,
      mfa_required: MFA_ROLES.includes(actor.role),
      tools: TOOLS.filter((t) => canCall(actor, t.name)).map((t) => t.name),
      map: { package: use?.map ? "google" : "open", places: use?.places ?? false },
      // Hotfix 2 (F): the person's own number; approvers and dispatchers without one see the banner until it is filled.
      phone: person.phone ?? undefined,
      phone_display: phoneDisplay(person.phone),
      phone_required: !person.phone && (actor.permissions.includes("approve") || actor.permissions.includes("assign_tasks"))
        ? true
        : undefined,
    }, cors);
  }

  // Hotfix O2-H2: the app's crash report (Office mode's crash screen or an error it survived): one row in app_errors with
  // this person; scrubbed on the phone and again here; never an error back to the app beyond a refusal.
  if (request.method === "POST" && path === "/errors") {
    if (actor.employeeId && overLimit(actor.employeeId)) return json(429, { error: "too_many_calls" }, cors);
    let raw: unknown = null;
    try {
      raw = JSON.parse(await request.text());
    } catch {
      return json(400, { error: "bad_json" }, cors);
    }
    const p = APP_ERROR_INPUT.safeParse(raw);
    if (!p.success) return json(400, { error: "bad_input" }, cors);
    try {
      await saveAppError(db, p.data, "office", actor.employeeId);
      return json(200, { ok: true }, cors);
    } catch (e) {
      console.error(`office-api: app error report: ${e instanceof Error ? e.message : String(e)}`);
      return json(500, { error: "not_saved" }, cors);
    }
  }

  if (request.method === "GET" && path === "/tools") {
    return json(200, {
      tools: TOOLS.filter((t) => canCall(actor, t.name)).map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        read_only: t.readOnly,
        input: z.toJSONSchema(t.input),
      })),
    }, cors);
  }

  const match = request.method === "POST" ? path.match(/^\/tools\/([a-z_]+)$/) : null;
  if (!match) return json(404, { error: "not_found" }, cors);
  const def = TOOLS.find((t) => t.name === match[1]);
  if (!def) return json(404, { error: "no_such_tool" }, cors);
  if (!canCall(actor, def.name)) {
    return json(403, { error: "forbidden", role: actor.role, needs: TOOL_PERMISSION[def.name] ?? [] }, cors);
  }
  if (actor.employeeId && overLimit(actor.employeeId)) return json(429, { error: "too_many_calls" }, cors);

  let raw: unknown = {};
  const text = await request.text();
  if (text.trim() !== "") {
    try {
      raw = JSON.parse(text);
    } catch {
      return json(400, { error: "bad_json" }, cors);
    }
  }
  const parsed = def.input.safeParse(raw ?? {});
  if (!parsed.success) {
    return json(
      400,
      {
        error: "bad_input",
        issues: parsed.error.issues.map((i: { path: PropertyKey[]; message: string }) => ({ path: i.path.join("."), message: i.message })),
      },
      cors,
    );
  }

  const out = await runTool(db, def, parsed.data, actor);
  switch (out.kind) {
    case "ok":
      return json(200, { result: JSON.parse(out.text) }, cors);
    case "forbidden":
      return json(403, { error: out.text }, cors);
    case "refused":
      return json(409, { error: out.text }, cors);
    default:
      return json(500, { error: out.text }, cors);
  }
});
