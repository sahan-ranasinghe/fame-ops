// driver-api's request handling, apart from Deno.serve so it can be run with fakes (handler_test.ts): the driver
// resolver, the work behind each route and the rate limits are passed in. index.ts builds the real ones.
//
// Rate limits (Round 48, item 6b; _shared/fleet/rateLimit.ts):
//   unauth    20 a minute per address, checked BEFORE Supabase Auth is asked and charged after a 401, 403 or 404
//   general   60 a minute per driver (as before)
//   paid      30 a minute per driver on /places/search and /trips (+ a trip's stops): the routes that can make a
//             Google place search or details call
// Over any of them: 429 { error: "rate_limited", code, message: "Too many requests · try again in a minute" }.

import { z } from "zod";
import { auditFinish, auditStart } from "../_shared/fleet/audit.ts";
import { type Db, type Row, ToolError } from "../_shared/fleet/db.ts";
import { APP_ERROR_INPUT, saveAppError } from "../_shared/fleet/appErrors.ts";
import type { Actor } from "../_shared/fleet/roles.ts";
import { searchPlaces } from "../_shared/fleet/tools/places.ts";
import { addTripStop, cancelSelfTrip, createSelfTrip } from "../_shared/fleet/trips.ts";
import { profilePatch, saveProfile } from "../_shared/fleet/tools/drivers.ts";
import {
  clientIp,
  DRIVER_PER_MINUTE,
  PAID_PER_MINUTE,
  rateLimitedResponse,
  TokenBuckets,
  UNAUTH_PER_IP_PER_MINUTE,
} from "../_shared/fleet/rateLimit.ts";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

const zSession = z.string().regex(/^[A-Za-z0-9_-]{8,36}$/).optional();
const zDestination = z.object({
  place_id: z.string().uuid().optional(),
  google_place_id: z.string().trim().min(1).max(300).optional(),
  name: z.string().trim().max(160).optional(),
  text: z.string().trim().max(160).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  session: zSession,
}).refine((d) => (d.lat === undefined) === (d.lng === undefined), "Give both lat and lng, or neither.");

export const INPUTS = {
  // Round 4–7 (item 10): an empty box (suggest) answers Saved and the driver's own Recent; near = the phone's position.
  search: z.object({
    text: z.string().trim().max(500).optional(),
    session: zSession,
    suggest: z.boolean().optional(),
    near: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
  }),
  trip: z.object({
    id: z.string().uuid(),
    stop_id: z.string().uuid().optional(),
    purpose: z.enum(["company", "personal"]),
    destination: zDestination,
    note: z.string().trim().max(500).optional(),
    vehicle_id: z.string().uuid().optional(),
    at: z.string().datetime({ offset: true }).optional(),
    queued: z.boolean().optional(),
  }),
  stop: z.object({ id: z.string().uuid(), destination: zDestination, queued: z.boolean().optional() }),
  // Part 3b (G): null clears a value (never the phone: the rule refuses it).
  profile: z.object({
    phone: z.string().trim().max(30).nullable().optional(),
    whatsapp: z.string().trim().max(30).nullable().optional(),
    emergency_name: z.string().trim().max(120).nullable().optional(),
    emergency_relation: z.string().trim().max(60).nullable().optional(),
    emergency_phone: z.string().trim().max(30).nullable().optional(),
    licence_no: z.string().trim().max(40).nullable().optional(),
    licence_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }).strict(),
};

export type DriverRow = Row<"employees">;
export type Driver = { row: DriverRow; actor: Actor };
export type ResolvedDriver = { ok: true; driver: Driver } | { ok: false; status: number; error: string };

/** The work behind each route (the real functions by default; fakes in tests). */
export interface Work {
  searchPlaces: typeof searchPlaces.run;
  createSelfTrip: typeof createSelfTrip;
  addTripStop: typeof addTripStop;
  cancelSelfTrip: typeof cancelSelfTrip;
  saveProfile: typeof saveProfile;
  saveAppError: typeof saveAppError;
  auditStart: typeof auditStart;
  auditFinish: typeof auditFinish;
}

export interface Limits {
  general: TokenBuckets;
  paid: TokenBuckets;
  unauth: TokenBuckets;
}

export function defaultLimits(clock?: () => number): Limits {
  return {
    general: new TokenBuckets({ capacity: DRIVER_PER_MINUTE }, clock),
    paid: new TokenBuckets({ capacity: PAID_PER_MINUTE }, clock),
    unauth: new TokenBuckets({ capacity: UNAUTH_PER_IP_PER_MINUTE }, clock),
  };
}

export interface HandlerDeps {
  db: Db;
  resolveDriver: (request: Request) => Promise<ResolvedDriver>;
  limits?: Limits;
  work?: Partial<Work>;
  now?: () => Date;
}

/** The audit log keeps no Google content: a Google pick is written as its id and "Google place" (hard rule 10). */
export function auditArgs<T extends { destination: { google_place_id?: string; name?: string } }>(args: T): T {
  const d = args.destination;
  return d.google_place_id ? { ...args, destination: { google_place_id: d.google_place_id, name: "Google place" } } : args;
}

/** The routes that can make a paid call (a Google place search or a Google place's details). */
export const PAID_PATHS = (path: string): boolean =>
  path === "/places/search" || path === "/trips" || /^\/trips\/[0-9a-f-]{36}\/stops$/.test(path);

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  const { db } = deps;
  const limits = deps.limits ?? defaultLimits();
  const work: Work = {
    searchPlaces: (args, ctx) => searchPlaces.run(args, ctx),
    createSelfTrip,
    addTripStop,
    cancelSelfTrip,
    saveProfile,
    saveAppError,
    auditStart,
    auditFinish,
    ...deps.work,
  };

  /** A write the office can see in its audit log (channel driver), like the office's own tools. */
  async function audited<T>(name: string, args: unknown, actor: Actor, run: () => Promise<T>, summary: (r: T) => string): Promise<T> {
    const id = await work.auditStart(db, name, args, actor);
    try {
      const out = await run();
      await work.auditFinish(db, id, summary(out));
      return out;
    } catch (error) {
      await work.auditFinish(
        db,
        id,
        `${error instanceof ToolError ? "refused" : "error"}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    const path = new URL(request.url).pathname.replace(/^.*?\/driver-api/, "").replace(/\/$/, "");
    // An address refused 20 times this minute is answered here, before Supabase Auth is asked (Round 48).
    const from = clientIp(request.headers);
    if (!limits.unauth.has(from)) return rateLimitedResponse();
    const who = await deps.resolveDriver(request);
    if (!who.ok) {
      if (who.status === 401 || who.status === 403 || who.status === 404) limits.unauth.charge(from);
      return json(who.status, { error: who.error });
    }
    const { row, actor } = who.driver;
    // Round 50: an office person driving their own trip with the app reaches the place search and the crash report; the
    // trips a driver starts in the app (and their stops, their cancel) and the driver's profile stay drivers only.
    if (row.role !== "driver" && path !== "/places/search" && path !== "/errors") return json(403, { error: "drivers_only" });
    if (!limits.general.take(row.id)) return rateLimitedResponse();
    if (PAID_PATHS(path) && !limits.paid.take(row.id)) return rateLimitedResponse();
    let raw: unknown = {};
    try {
      const text = await request.text();
      raw = text.trim() ? JSON.parse(text) : {};
    } catch {
      return json(400, { error: "bad_json" });
    }
    const bad = (e: z.ZodError) =>
      json(400, { error: "bad_input", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    const now = deps.now ? deps.now() : new Date();
    const ctx = { db, now, actor };
    try {
      // Hotfix O2-H2: the app's crash report from the driver side (one row in app_errors with this driver).
      if (path === "/errors") {
        const p = APP_ERROR_INPUT.safeParse(raw);
        if (!p.success) return bad(p.error);
        await work.saveAppError(db, p.data, "driver", row.id);
        return json(200, { ok: true });
      }
      if (path === "/places/search") {
        const p = INPUTS.search.safeParse(raw);
        if (!p.success) return bad(p.error);
        // Google's layer whenever the google package is on (the tool asks the gate; at a cap openrouteservice answers). Round
        // 4–7 (item 10): "Recent" is the driver's own (the trips they drove, personal ones too), never anyone else's.
        const out = await work.searchPlaces({
          text: p.data.text ?? "",
          session: p.data.session,
          suggest: p.data.suggest ?? false,
          near: p.data.near,
          google: true,
          map: true,
          limit: 8,
        }, ctx);
        return json(200, out.result);
      }
      if (path === "/trips") {
        const p = INPUTS.trip.safeParse(raw);
        if (!p.success) return bad(p.error);
        const out = await audited(
          "start_trip",
          auditArgs(p.data),
          actor,
          () => work.createSelfTrip(db, now, row, p.data),
          (r) => `${r.repeated ? "again: " : ""}${r.trip.title}`,
        );
        return json(out.repeated ? 200 : 201, out);
      }
      const stop = path.match(/^\/trips\/([0-9a-f-]{36})\/stops$/);
      if (stop) {
        const p = INPUTS.stop.safeParse(raw);
        if (!p.success) return bad(p.error);
        const out = await audited(
          "add_trip_stop",
          { task_id: stop[1], ...auditArgs(p.data) },
          actor,
          () => work.addTripStop(db, now, row, stop[1], p.data),
          (r) => `${r.repeated ? "again: " : ""}${r.trip.title}: ${r.trip.stops.length} stops`,
        );
        return json(out.repeated ? 200 : 201, out);
      }
      if (path === "/profile") {
        const p = INPUTS.profile.safeParse(raw);
        if (!p.success) return bad(p.error);
        const out = await audited(
          "update_my_profile_driver",
          // The audit line names the fields, never the numbers.
          { fields: Object.keys(p.data) },
          actor,
          async () => {
            const patch = profilePatch(p.data);
            const updated = await work.saveProfile(db, row, patch, actor);
            return {
              saved: Object.keys(patch),
              profile: {
                phone: updated.phone,
                whatsapp: updated.whatsapp,
                emergency_name: updated.emergency_name,
                emergency_relation: updated.emergency_relation,
                emergency_phone: updated.emergency_phone,
                licence_no: updated.licence_no,
                licence_expiry: updated.licence_expiry,
              },
            };
          },
          (r) => `profile: ${r.saved.join(", ")}`,
        );
        return json(200, out);
      }
      const cancel = path.match(/^\/trips\/([0-9a-f-]{36})\/cancel$/);
      if (cancel) {
        const out = await audited(
          "cancel_trip",
          { task_id: cancel[1] },
          actor,
          () => work.cancelSelfTrip(db, row, cancel[1]),
          (r) => `${r.repeated ? "again: " : ""}${r.trip.title} cancelled before starting`,
        );
        return json(200, out);
      }
      limits.unauth.charge(from);
      return json(404, { error: "not_found" });
    } catch (error) {
      // A rule the driver can act on (the words go on the phone as they are); anything else is ours.
      if (error instanceof ToolError) return json(409, { error: "refused", message: error.message });
      console.error(`driver-api ${path}: ${error instanceof Error ? error.message : String(error)}`);
      return json(500, { error: "server_error" });
    }
  };
}
