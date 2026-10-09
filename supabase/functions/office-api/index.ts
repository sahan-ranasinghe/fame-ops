// Edge Function office-api: the office web app's way to the same tools the
// connector offers, with the same inputs and the same JSON answers.
//
//   GET  /office-api/me                 who is signed in, their role, whether the second step is done, the tools they may call
//   GET  /office-api/tools              the tools with their input schemas (for the forms)
//   POST /office-api/tools/<name>       body = the tool's arguments; 200 { result } exactly as the connector returns it
//                                       400 { error: "bad_input", issues } · 403 { error } · 404 · 409 { error } (the tool said no)
//                                       429 too many calls · 500 { error }
//
// Who: Authorization: Bearer <Supabase session token>. The token is checked
// with Supabase Auth, the person is their employees row (active, office
// role), and admin, fleet_admin and office must have done the second
// sign-in step (aal2). Every call runs through the shared runner (role
// check, audit with the person's name, channel "web").
//
// Deployed with verify_jwt off (config.toml): the check is done here.
// Secrets: OFFICE_WEB_URL (the web app's origin, for CORS and links).

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { type Actor, adminClient, canCall, isRole, OFFICE_ROLES, runTool, STRONG_ROLES, TOOLS } from "../_shared/fleet/index.ts";

const CALLS_PER_MINUTE = 120;
const db = adminClient();
const calls = new Map<string, number[]>();

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function allowedOrigins(): string[] {
  const configured = (Deno.env.get("OFFICE_WEB_URL") ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  return [...configured, "http://localhost:5173", "http://127.0.0.1:5173"];
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

type Resolved = { ok: true; actor: Actor; email: string; mfa: boolean } | { ok: false; status: number; error: string };

async function resolvePerson(request: Request): Promise<Resolved> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "not_signed_in" };
  const asCaller = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await asCaller.auth.getUser(token);
  if (error || !data.user) return { ok: false, status: 401, error: "not_signed_in" };

  const { data: row, error: lookup } = await db.from("employees").select("id, name, email, role, active").eq("auth_user_id", data.user.id)
    .maybeSingle();
  if (lookup) {
    console.error(`office-api: employee lookup failed: ${lookup.message}`);
    return { ok: false, status: 500, error: "lookup_failed" };
  }
  if (!row || !isRole(row.role) || !OFFICE_ROLES.includes(row.role)) return { ok: false, status: 403, error: "not_an_office_user" };
  if (!row.active) return { ok: false, status: 403, error: "switched_off" };
  const mfa = aalOf(token) === "aal2";
  if (STRONG_ROLES.includes(row.role) && !mfa) return { ok: false, status: 403, error: "mfa_required" };
  return {
    ok: true,
    actor: { employeeId: row.id, name: row.name, role: row.role, channel: "web" },
    email: row.email ?? data.user.email ?? "",
    mfa,
  };
}

function overLimit(employeeId: string): boolean {
  const now = Date.now();
  const recent = (calls.get(employeeId) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  calls.set(employeeId, recent);
  return recent.length > CALLS_PER_MINUTE;
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request.headers.get("origin"));
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const path = new URL(request.url).pathname.replace(/^.*?\/office-api/, "").replace(/\/$/, "");
  const person = await resolvePerson(request);
  if (!person.ok) return json(person.status, { error: person.error }, cors);
  const { actor } = person;

  if (request.method === "GET" && path === "/me") {
    return json(200, {
      name: actor.name,
      email: person.email,
      role: actor.role,
      mfa: person.mfa,
      tools: TOOLS.filter((t) => canCall(actor.role, t.name)).map((t) => t.name),
    }, cors);
  }

  if (request.method === "GET" && path === "/tools") {
    return json(200, {
      tools: TOOLS.filter((t) => canCall(actor.role, t.name)).map((t) => ({
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
  if (!canCall(actor.role, def.name)) return json(403, { error: "forbidden", role: actor.role }, cors);
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
