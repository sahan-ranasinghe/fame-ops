// Edge Function office-mcp: the office connector (MCP over Streamable HTTP).
//
//   URL:    https://<project>.supabase.co/functions/v1/office-mcp/<KEY>/mcp
//   Deploy: with --no-verify-jwt (the key in the path is the protection)
//
// The key names the person: a personal key (office_keys, made with
// create_office_key) runs the tools as that person with their permissions
// and puts their name in the audit log; the shared OFFICE_MCP_KEY still works
// as an admin key (every permission) during the switch. The request URL
// contains the key, so it is never logged from here.

import { createMcpHandler } from "@modelcontextprotocol/server";
import { type Actor, adminClient, isRole, normalisePermissions, OFFICE_ROLES, PERMISSIONS } from "../_shared/fleet/index.ts";
import { isAuthorized, keyFromPath, sha256Hex } from "./key.ts";
import { buildServer } from "./server.ts";

const db = adminClient();

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/** The person behind a personal key, or null. */
async function personForKey(key: string): Promise<Actor | null> {
  const { data } = await db.from("office_keys")
    .select("id, employee_id, employees:employee_id (name, role, permissions, active)")
    .eq("key_hash", await sha256Hex(key)).is("revoked_at", null).maybeSingle();
  const employee = (data?.employees ?? null) as { name: string; role: string; permissions: string[]; active: boolean } | null;
  if (!data || !employee || !employee.active || !isRole(employee.role) || !OFFICE_ROLES.includes(employee.role)) return null;
  // Fire and forget: when the key was last used.
  void db.from("office_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id).then(() => undefined, () => undefined);
  // The owner's live permissions: a change on the Users page applies to the next call.
  return {
    employeeId: data.employee_id,
    name: employee.name,
    role: employee.role,
    permissions: normalisePermissions(employee.permissions),
    channel: "claude",
  };
}

Deno.serve(async (request) => {
  const pathname = new URL(request.url).pathname;
  const key = keyFromPath(pathname);
  // A wrong key, a missing key and any other path all get the same 404.
  let actor: Actor | null = key ? await personForKey(key) : null;
  if (!actor && (await isAuthorized(pathname, Deno.env.get("OFFICE_MCP_KEY")))) {
    actor = { employeeId: null, name: "Office (shared key)", role: "admin", permissions: [...PERMISSIONS], channel: "claude" };
  }
  if (!actor) return notFound();

  try {
    // A fresh MCP server per request, for this person: the function keeps no session state.
    const mcp = createMcpHandler(() => buildServer(db, actor), {
      onerror: (error) => console.error(`mcp: ${error.message}`),
    });
    return await mcp.fetch(request);
  } catch (error) {
    console.error(`office-mcp: ${error instanceof Error ? error.message : "unknown error"}`);
    return new Response("Internal error", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
});
