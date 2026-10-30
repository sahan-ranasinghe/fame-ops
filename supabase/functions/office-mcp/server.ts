// The MCP server for one person: the tools their permissions allow, each going
// through the shared runner (permission check, audit row, the tool, the outcome).

import { McpServer } from "@modelcontextprotocol/server";
import { type Actor, canCall, type Db, INSTRUCTIONS, runTool, TOOLS, WEB_ONLY_TOOLS } from "../_shared/fleet/index.ts";
import type { TokenBuckets } from "../_shared/fleet/rateLimit.ts";
import { paidGate } from "./gate.ts";

interface ToolReply {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

function reply(text: string, isError = false): ToolReply {
  return { content: [{ type: "text", text }], ...(isError && { isError: true }) };
}

/**
 * The paid tools' bucket and this caller's key in it (Round 48: 30 a minute per key on the tools that can cost); the place
 * search's own bucket (90 a minute, 30 October 2026).
 */
export interface PaidLimit {
  paid: TokenBuckets;
  search: TokenBuckets;
  key: string;
}

export function buildServer(db: Db, actor: Actor, limit?: PaidLimit): McpServer {
  const server = new McpServer({ name: "fame-fleet-office", version: "1.1.0" }, { instructions: INSTRUCTIONS });
  for (const def of TOOLS) {
    // The upload tools are the web app's: no file goes through chat (Phase 7, §28).
    if (!canCall(actor, def.name) || WEB_ONLY_TOOLS.has(def.name)) continue;
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.input,
        annotations: {
          readOnlyHint: def.readOnly,
          destructiveHint: false,
          idempotentHint: def.readOnly,
          openWorldHint: false,
        },
      },
      async (args: unknown) => {
        // A tool that can cost, over its minute's budget: the one sentence, as a tool error (nothing is run or audited).
        const gate = paidGate(def.name, limit ? { paid: limit.paid, search: limit.search } : undefined, limit?.key ?? "");
        if (!gate.ok) return reply(gate.text, true);
        const out = await runTool(db, def, args, actor);
        return reply(out.text, out.kind !== "ok");
      },
    );
  }
  return server;
}
