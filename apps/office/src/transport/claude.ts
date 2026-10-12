// The artifact build: the page talks to the viewer's "Fame Fleet" connector
// through the Claude artifact runtime. No key lives in the page.
import connector from "../connector.json";
import { asFleetError } from "./errors";
import { ALL_TOOLS, type Me, type Transport, type WatchEvent } from "./types";

/**
 * The connector's name as claude.ai shows it ("Fame Fleet"). One source for
 * the page's calls AND the capability declaration the artifact is published
 * with (scripts/artifact-declaration.mjs reads the same file), so the two
 * can never drift: a declaration naming anything else makes every call
 * fail with not_in_manifest ("turned off for this page").
 */
export const SERVER: string = connector.server;

interface McpResult {
  payload?: unknown;
  cache?: { storedAt?: number };
}
interface McpWatchEvent {
  type: "data" | "error";
  result?: McpResult;
  error?: unknown;
}
interface McpRuntime {
  callTool(server: string, tool: string, input: Record<string, unknown>): Promise<McpResult | unknown>;
  watchTool(
    server: string,
    tool: string,
    input: Record<string, unknown>,
    cb: (ev: McpWatchEvent) => void,
    opts: { refetchInterval: number },
  ): () => void;
  invalidate(server: string): Promise<void>;
}
interface UserRuntime {
  me(): Promise<{ name?: string } | null>;
}
interface PermissionsRuntime {
  manage(): Promise<void>;
}

const payloadOf = (res: unknown) => {
  const r = res as McpResult | null;
  return r && typeof r === "object" && r.payload !== undefined ? r.payload : res;
};

export class ClaudeTransport implements Transport {
  readonly kind = "claude" as const;
  constructor(private mcp: McpRuntime, private use: (capability: string) => Promise<unknown>) {}

  async me(): Promise<Me> {
    let name = "";
    try {
      const u = (await this.use("user")) as UserRuntime | null;
      const me = u ? await u.me() : null;
      name = me?.name ?? "";
    } catch {
      /* no name: the chrome shows "Fleet office" */
    }
    return { name, role: "admin", tools: ALL_TOOLS };
  }

  async call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    try {
      return payloadOf(await this.mcp.callTool(SERVER, tool, args)) as T;
    } catch (e) {
      throw asFleetError(e);
    }
  }

  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void, intervalMs: number): () => void {
    try {
      return this.mcp.watchTool(SERVER, tool, args, (ev) => {
        if (ev.type === "data") {
          cb({ type: "data", data: payloadOf(ev.result) as T, at: ev.result?.cache?.storedAt || Date.now() });
        } else {
          cb({ type: "error", error: asFleetError(ev.error ?? {}) });
        }
      }, { refetchInterval: intervalMs });
    } catch (e) {
      cb({ type: "error", error: { code: "bad_request", message: String((e as Error)?.message || e) } });
      return () => {};
    }
  }

  async invalidate(): Promise<void> {
    try {
      await this.mcp.invalidate(SERVER);
    } catch {
      /* nothing cached */
    }
  }

  /** Claude's permissions sheet for this page (the "Open permissions" button). */
  async managePermissions(): Promise<boolean> {
    try {
      const pm = (await this.use("permissions")) as PermissionsRuntime | null;
      if (!pm) return false;
      await pm.manage();
      return true;
    } catch {
      return false;
    }
  }
}

/** null when the page is not open inside Claude. */
export async function connectClaude(): Promise<ClaudeTransport | null> {
  const use = window.claude?.use;
  if (!use) return null;
  const mcp = (await use("mcp")) as McpRuntime | null;
  if (!mcp) return null;
  return new ClaudeTransport(mcp, use);
}
