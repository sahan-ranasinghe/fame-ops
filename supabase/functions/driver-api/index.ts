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
// with channel driver. The request handling itself is handler.ts (run with fakes by handler_test.ts); the rate limits
// (60 a minute per driver, 30 on the routes that can cost, 20 refusals a minute per address before Auth) are there too.

import { createClient } from "@supabase/supabase-js";
import { sessionFailure } from "../_shared/fleet/sessionCheck.ts";
import { adminClient } from "../_shared/fleet/db.ts";
import type { Role } from "../_shared/fleet/roles.ts";
import { createHandler, type ResolvedDriver } from "./handler.ts";

const db = adminClient();

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function driverRow(authUserId: string) {
  const { data, error } = await db.from("employees").select("*").eq("auth_user_id", authUserId).maybeSingle();
  if (error) throw new Error(`employee lookup failed: ${error.message}`);
  return data;
}

async function resolveDriver(request: Request): Promise<ResolvedDriver> {
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
  if (!row) return { ok: false, status: 403, error: "not_a_driver" };
  // Round 50: a driver, or an office person who drives their own trips with the app (drives_with_app: can_drive while the
  // switch self_drive_mode is on); the handler keeps the driver-only endpoints for drivers.
  if (row.role !== "driver") {
    const { data: drives, error: drivesError } = await db.rpc("drives_with_app", { p_employee: row.id });
    if (drivesError) throw new Error(`drives_with_app failed: ${drivesError.message}`);
    if (!drives) return { ok: false, status: 403, error: "not_a_driver" };
  }
  if (!row.active) return { ok: false, status: 403, error: "switched_off" };
  return {
    ok: true,
    driver: {
      row,
      actor: {
        employeeId: row.id,
        name: row.name,
        role: row.role === "driver" ? "driver" : row.role as Role,
        permissions: [],
        authUserId: data.user.id,
        channel: "driver",
      },
    },
  };
}

Deno.serve(createHandler({ db, resolveDriver }));
