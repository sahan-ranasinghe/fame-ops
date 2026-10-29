// Edge Function office-api: the office web app's way to the same tools the
// connector offers, with the same inputs and the same JSON answers.
//
//   GET  /office-api/me                 who is signed in, their permissions and role, whether the second step is done, the tools they may call,
//                                       and map { package, places } (google: load Google's map after register_map_load; open: OpenFreeMap)
//   GET  /office-api/tools              the tools with their input schemas (for the forms)
//   GET  /office-api/public/privacy     no session (the public privacy page, /privacy): { email?, phone? } from the settings
//                                       privacy_email and office_phone, nothing else; 60 a minute per address
//   POST /office-api/public/password-link       no session (Round 49, the set-password page): { token } → { state, name?, email? };
//                                               opening a link never uses it
//   POST /office-api/public/password-link/set   no session: { token, password } → 200 { ok, email } · 409 { state } (the link
//                                               can no longer be used) · 400 / 422 { error, message }; the only call that uses a link
//   POST /office-api/tools/<name>       body = the tool's arguments; 200 { result } exactly as the connector returns it
//                                       400 { error: "bad_input", issues } · 403 { error } · 404 · 409 { error } (the tool said no)
//                                       429 { error: "rate_limited", message } (handler.ts: the limits) · 500 { error }
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
// REQUIRE_MFA_ROLES (optional, see above). The request handling itself is
// handler.ts (run with fakes by handler_test.ts).

import { createClient } from "@supabase/supabase-js";
import { sessionFailure } from "../_shared/fleet/sessionCheck.ts";
import { adminClient, isRole, mfaRequiredRoles, normalisePermissions, OFFICE_ROLES } from "../_shared/fleet/index.ts";
import { createHandler, type Resolved } from "./handler.ts";

const db = adminClient();
/** Roles that must have done the second step; empty unless the secret REQUIRE_MFA_ROLES says otherwise. */
const MFA_ROLES = mfaRequiredRoles(Deno.env.get("REQUIRE_MFA_ROLES"));

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

/** The aal claim of a token Supabase Auth has just verified. */
function aalOf(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { aal?: string };
    return payload.aal ?? "aal1";
  } catch {
    return "aal1";
  }
}

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

Deno.serve(createHandler({ db, resolvePerson, mfaRoles: MFA_ROLES, allowedOrigins }));
