// driver-api (Phase 7, §13): the driver app's own server, for what the phone cannot do with its row-level access alone.
// It checks the driver's session (Supabase Auth) and role on every call, then runs as service role through the shared
// fleet rules:
//   POST /places/search {text, session?}               the office's three layers (our places, used before, the map's;
//                                                       Google's through the counted gate, openrouteservice when refused)
//   POST /trips {id, purpose, destination, note?, vehicle_id?, at?}   Start a trip (idempotent by the phone's id)
//   POST /trips/:id/stops {id, destination}            a stop added on the way (self trips under way)
//   POST /trips/:id/cancel {}                           a trip started by mistake, cancelled before it starts
//   POST /profile {phone?, whatsapp?, emergency_name?, emergency_relation?, emergency_phone?, licence_no?, licence_expiry?}
//                                                       Part 3b (G): the driver's own profile, numbers stored +94…, every
//                                                       change in employee_changes as "changed by the driver"
// Deployed with --no-verify-jwt like office-api: the token is checked here. Every trip call is written to office_audit
// with channel driver.

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { sessionFailure } from "../_shared/fleet/sessionCheck.ts";
import { auditFinish, auditStart } from "../_shared/fleet/audit.ts";
import { adminClient, ToolError } from "../_shared/fleet/db.ts";
import type { Actor } from "../_shared/fleet/roles.ts";
import { searchPlaces } from "../_shared/fleet/tools/places.ts";
import { addTripStop, cancelSelfTrip, createSelfTrip } from "../_shared/fleet/trips.ts";
import { profilePatch, saveProfile } from "../_shared/fleet/tools/drivers.ts";

const CALLS_PER_MINUTE = 60;
const db = adminClient();
const calls = new Map<string, number[]>();

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

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

const INPUTS = {
  search: z.object({ text: z.string().trim().min(1).max(500), session: zSession }),
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

type Driver = { row: Awaited<ReturnType<typeof driverRow>>; actor: Actor };

async function driverRow(authUserId: string) {
  const { data, error } = await db.from("employees").select("*").eq("auth_user_id", authUserId).maybeSingle();
  if (error) throw new Error(`employee lookup failed: ${error.message}`);
  return data;
}

async function resolveDriver(request: Request): Promise<{ ok: true; driver: Driver } | { ok: false; status: number; error: string }> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "not_signed_in" };
  const asCaller = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await asCaller.auth.getUser(token);
  // Signed out only when Auth refused the token; Auth not answering is a 503 the app asks again (sessionCheck.ts).
  if (error || !data.user) return { ok: false, ...sessionFailure(error) };
  const row = await driverRow(data.user.id);
  if (!row || row.role !== "driver") return { ok: false, status: 403, error: "not_a_driver" };
  if (!row.active) return { ok: false, status: 403, error: "switched_off" };
  return {
    ok: true,
    driver: {
      row,
      actor: { employeeId: row.id, name: row.name, role: "driver", permissions: [], authUserId: data.user.id, channel: "driver" },
    },
  };
}

function overLimit(employeeId: string): boolean {
  const now = Date.now();
  const recent = (calls.get(employeeId) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  calls.set(employeeId, recent);
  return recent.length > CALLS_PER_MINUTE;
}

/** The audit log keeps no Google content: a Google pick is written as its id and "Google place" (hard rule 10). */
function auditArgs<T extends { destination: { google_place_id?: string; name?: string } }>(args: T): T {
  const d = args.destination;
  return d.google_place_id ? { ...args, destination: { google_place_id: d.google_place_id, name: "Google place" } } : args;
}

/** A write the office can see in its audit log (channel driver), like the office's own tools. */
async function audited<T>(name: string, args: unknown, actor: Actor, work: () => Promise<T>, summary: (r: T) => string): Promise<T> {
  const id = await auditStart(db, name, args, actor);
  try {
    const out = await work();
    await auditFinish(db, id, summary(out));
    return out;
  } catch (error) {
    await auditFinish(
      db,
      id,
      `${error instanceof ToolError ? "refused" : "error"}: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  const path = new URL(request.url).pathname.replace(/^.*?\/driver-api/, "").replace(/\/$/, "");
  const who = await resolveDriver(request);
  if (!who.ok) return json(who.status, { error: who.error });
  const { row, actor } = who.driver;
  if (overLimit(row!.id)) return json(429, { error: "too_many_calls" });
  let raw: unknown = {};
  try {
    const text = await request.text();
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    return json(400, { error: "bad_json" });
  }
  const bad = (e: z.ZodError) =>
    json(400, { error: "bad_input", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  const now = new Date();
  const ctx = { db, now, actor };
  try {
    if (path === "/places/search") {
      const p = INPUTS.search.safeParse(raw);
      if (!p.success) return bad(p.error);
      // Google's layer whenever the google package is on (the tool asks the gate; at a cap openrouteservice answers). No
      // "Used before" for a driver: it lists other people's typed destinations and requests (the phone keeps its own).
      const out = await searchPlaces.run({ text: p.data.text, session: p.data.session, google: true, map: true, limit: 8 }, ctx);
      const result = out.result as { results?: { layer: string }[] };
      return json(200, { ...result, results: (result.results ?? []).filter((r) => r.layer !== "recent") });
    }
    if (path === "/trips") {
      const p = INPUTS.trip.safeParse(raw);
      if (!p.success) return bad(p.error);
      const out = await audited(
        "start_trip",
        auditArgs(p.data),
        actor,
        () => createSelfTrip(db, now, row!, p.data),
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
        () => addTripStop(db, now, row!, stop[1], p.data),
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
          const updated = await saveProfile(db, row!, patch, actor);
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
        () => cancelSelfTrip(db, row!, cancel[1]),
        (r) => `${r.repeated ? "again: " : ""}${r.trip.title} cancelled before starting`,
      );
      return json(200, out);
    }
    return json(404, { error: "not_found" });
  } catch (error) {
    // A rule the driver can act on (the words go on the phone as they are); anything else is ours.
    if (error instanceof ToolError) return json(409, { error: "refused", message: error.message });
    console.error(`driver-api ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return json(500, { error: "server_error" });
  }
});
