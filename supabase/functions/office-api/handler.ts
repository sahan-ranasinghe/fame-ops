// office-api's request handling, apart from Deno.serve so it can be run with fakes (handler_test.ts): the person
// resolver, the tool runner and the rate limits are passed in. index.ts builds the real ones.
//
// Rate limits (Round 48, item 6b; _shared/fleet/rateLimit.ts):
//   unauth    20 a minute per address, checked BEFORE Supabase Auth is asked and charged after a 401, 403 or 404:
//             an address guessing tokens costs Auth at most 20 checks a minute
//   general   120 a minute per person (POST /tools/<name> and POST /errors, as before)
//   paid      30 a minute per person for the tools that can make a Google, openrouteservice or Gemini call
//   public    60 a minute per address on GET /public/privacy (the only answer without a session)
// Over any of them: 429 { error: "rate_limited", code, message: "Too many requests · try again in a minute" }.

import { z } from "zod";
import { APP_ERROR_INPUT, saveAppError } from "../_shared/fleet/appErrors.ts";
import { driverPhotoLinks, photoLinksById } from "../_shared/fleet/media.ts";
import { licenceState } from "../_shared/fleet/licence.ts";
import { colomboDate } from "../_shared/fleet/time.ts";
import {
  clientIp,
  GENERAL_PER_MINUTE,
  PAID_PER_MINUTE,
  PAID_TOOLS,
  rateLimitedResponse,
  TokenBuckets,
  UNAUTH_PER_IP_PER_MINUTE,
} from "../_shared/fleet/rateLimit.ts";
import {
  type Actor,
  canCall,
  type Db,
  googleUse,
  loadSettings,
  phoneDisplay,
  type Role,
  runTool,
  TOOL_PERMISSION,
  TOOLS,
} from "../_shared/fleet/index.ts";

/** The public privacy contact: per caller address. */
export const PUBLIC_PER_MINUTE = 60;

export type Resolved = { ok: true; actor: Actor; email: string; mfa: boolean; phone: string | null } | {
  ok: false;
  status: number;
  error: string;
};

export interface Limits {
  general: TokenBuckets;
  paid: TokenBuckets;
  unauth: TokenBuckets;
  pub: TokenBuckets;
}

export function defaultLimits(clock?: () => number): Limits {
  return {
    general: new TokenBuckets({ capacity: GENERAL_PER_MINUTE }, clock),
    paid: new TokenBuckets({ capacity: PAID_PER_MINUTE }, clock),
    unauth: new TokenBuckets({ capacity: UNAUTH_PER_IP_PER_MINUTE }, clock),
    pub: new TokenBuckets({ capacity: PUBLIC_PER_MINUTE }, clock),
  };
}

export interface HandlerDeps {
  db: Db;
  resolvePerson: (request: Request) => Promise<Resolved>;
  /** Roles that must have done the second step (the secret REQUIRE_MFA_ROLES). */
  mfaRoles: Role[];
  /** The web app's origins (OFFICE_WEB_URL) plus the dev servers. */
  allowedOrigins: () => string[];
  limits?: Limits;
  runTool?: typeof runTool;
  loadSettings?: typeof loadSettings;
}

function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const one = origin && allowed.includes(origin) ? origin : allowed[0] ?? "";
  return {
    "access-control-allow-origin": one,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, apikey",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

function json(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8" } });
}

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  const { db } = deps;
  const limits = deps.limits ?? defaultLimits();
  const run = deps.runTool ?? runTool;
  const settings = deps.loadSettings ?? loadSettings;

  return async (request: Request): Promise<Response> => {
    const cors = corsHeaders(request.headers.get("origin"), deps.allowedOrigins());
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const path = new URL(request.url).pathname.replace(/^.*?\/office-api/, "").replace(/\/$/, "");
    // The address the platform adds: x-real-ip, else the last x-forwarded-for entry (a caller can only add entries before it).
    const from = clientIp(request.headers);
    // Part 6: the privacy page opens without signing in and shows the contact from the settings (privacy_email, else the
    // office phone). The only answer without a session.
    if (request.method === "GET" && path === "/public/privacy") {
      if (!limits.pub.take(from)) return rateLimitedResponse(cors);
      try {
        const s = await settings(db);
        const body = {
          ...(s.privacy_email ? { email: s.privacy_email } : {}),
          ...(s.office_phone ? { phone: phoneDisplay(s.office_phone), phone_e164: s.office_phone } : {}),
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
    // An address refused 20 times this minute is answered here, before Supabase Auth is asked (Round 48).
    if (!limits.unauth.has(from)) return rateLimitedResponse(cors);
    const person = await deps.resolvePerson(request);
    if (!person.ok) {
      if (person.status === 401 || person.status === 403 || person.status === 404) limits.unauth.charge(from);
      return json(person.status, { error: person.error }, cors);
    }
    const { actor } = person;

    if (request.method === "GET" && path === "/me") {
      // Which map the web shows (never the key: register_map_load hands it out after counting the load).
      const use = await settings(db).then(googleUse, () => null);
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
        mfa_required: deps.mfaRoles.includes(actor.role),
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
      if (actor.employeeId && !limits.general.take(actor.employeeId)) return rateLimitedResponse(cors);
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
    if (!match) {
      limits.unauth.charge(from);
      return json(404, { error: "not_found" }, cors);
    }
    const def = TOOLS.find((t) => t.name === match[1]);
    if (!def) {
      limits.unauth.charge(from);
      return json(404, { error: "no_such_tool" }, cors);
    }
    if (!canCall(actor, def.name)) {
      return json(403, { error: "forbidden", role: actor.role, needs: TOOL_PERMISSION[def.name] ?? [] }, cors);
    }
    if (actor.employeeId && !limits.general.take(actor.employeeId)) return rateLimitedResponse(cors);
    // The tools that can cost (a Google, openrouteservice or Gemini call): 30 a minute per person on top (Round 48).
    if (actor.employeeId && PAID_TOOLS.has(def.name) && !limits.paid.take(actor.employeeId)) return rateLimitedResponse(cors);

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
          issues: parsed.error.issues.map((i: { path: PropertyKey[]; message: string }) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        cors,
      );
    }

    const out = await run(db, def, parsed.data, actor);
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
  };
}
