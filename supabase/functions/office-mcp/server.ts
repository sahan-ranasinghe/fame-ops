// The MCP server for one person: the tools their permissions allow, each going
// through the shared runner (permission check, audit row, the tool, the outcome).

import { McpServer } from "@modelcontextprotocol/server";
import {
  type Actor,
  canCall,
  type Db,
  INSTRUCTIONS,
  runTool,
  TOOLS,
} from "../_shared/fleet/index.ts";

interface ToolReply {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

function reply(text: string, isError = false): ToolReply {
  return {
    content: [{ type: "text", text }],
    ...(isError && { isError: true }),
  };
}

export function buildServer(db: Db, actor: Actor): McpServer {
  const server = new McpServer(
    { name: "fame-fleet-office", version: "1.1.0" },
    { instructions: INSTRUCTIONS },
  );
  for (const def of TOOLS) {
    if (!canCall(actor, def.name)) continue;
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
        const out = await runTool(db, def, args, actor);
        return reply(out.text, out.kind !== "ok");
      },
    );
  }
  return server;
}
