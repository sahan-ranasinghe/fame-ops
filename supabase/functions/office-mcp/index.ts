// Edge Function office-mcp: the office connector (MCP over Streamable HTTP).
//
//   URL:    https://<project>.supabase.co/functions/v1/office-mcp/<OFFICE_MCP_KEY>/mcp
//   Deploy: with --no-verify-jwt (the key in the path is the protection)
//
// The request URL contains the key, so it is never logged from here.

import { createMcpHandler } from "@modelcontextprotocol/server";
import { adminClient } from "./db.ts";
import { isAuthorized } from "./key.ts";
import { buildServer } from "./server.ts";

const db = adminClient();

// A fresh MCP server per request: the function keeps no session state.
const mcp = createMcpHandler(() => buildServer(db), {
  onerror: (error) => console.error(`mcp: ${error.message}`),
});

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

Deno.serve(async (request) => {
  // A wrong key, a missing key and any other path all get the same 404.
  if (!(await isAuthorized(new URL(request.url).pathname, Deno.env.get("OFFICE_MCP_KEY")))) {
    return notFound();
  }
  try {
    return await mcp.fetch(request);
  } catch (error) {
    console.error(`office-mcp: ${error instanceof Error ? error.message : "unknown error"}`);
    return new Response("Internal error", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
});
