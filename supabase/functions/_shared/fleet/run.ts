// Runs one tool call for one person: the role check, the audit row before
// the tool runs (so nothing happens without a record), the tool, and the
// outcome. Both channels (office-mcp, office-api) go through here, so they
// cannot drift apart.

import { auditFinish, auditStart } from "./audit.ts";
import type { Db } from "./db.ts";
import { ToolError } from "./db.ts";
import { prune } from "./format.ts";
import { PERMISSION_TEXT, TOOL_PERMISSION } from "./permissions.ts";
import { type Actor, canCall } from "./roles.ts";
import type { AnyTool } from "./tool.ts";

export interface ToolOutcome {
  /** The tool's result as compact JSON, or the error text. */
  text: string;
  /** "refused" = the tool or the role check said no (the text explains); "error" = a fault in the code. */
  kind: "ok" | "refused" | "error" | "forbidden";
  /** The audit row, when one was written. */
  auditId?: number;
}

const messageOf = (
  error: unknown,
) => (error instanceof Error ? error.message : String(error));

/** Runs one tool call. Arguments are never written to the function log (they can hold a PIN). */
export async function runTool(
  db: Db,
  def: AnyTool,
  args: unknown,
  actor: Actor,
): Promise<ToolOutcome> {
  if (!canCall(actor, def.name)) {
    const needs = (TOOL_PERMISSION[def.name] ?? []).map((p) =>
      PERMISSION_TEXT[p].label
    ).join(" or ");
    return {
      text: `Your account cannot use ${def.name}${
        needs ? ` (it needs the ${needs} permission)` : ""
      }. Ask an admin for access.`,
      kind: "forbidden",
    };
  }

  let auditId: number;
  try {
    auditId = await auditStart(db, def.name, args, actor);
  } catch (error) {
    console.error(`${def.name}: audit log failed: ${messageOf(error)}`);
    return {
      text:
        "The audit log could not be written, so nothing was done. Please try again.",
      kind: "error",
    };
  }

  try {
    const out = await def.run(args, { db, now: new Date(), actor });
    await auditFinish(db, auditId, out.summary);
    return { text: JSON.stringify(prune(out.result)), kind: "ok", auditId };
  } catch (error) {
    if (error instanceof ToolError) {
      await auditFinish(db, auditId, `refused: ${error.message}`);
      return { text: error.message, kind: "refused", auditId };
    }
    console.error(`${def.name} (audit #${auditId}): ${messageOf(error)}`);
    await auditFinish(db, auditId, `error: ${messageOf(error)}`);
    return {
      text:
        `Something went wrong inside the connector (audit #${auditId}). Check the current state before trying again.`,
      kind: "error",
      auditId,
    };
  }
}
