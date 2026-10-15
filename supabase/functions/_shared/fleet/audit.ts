// office_audit: one row per tool call. The row is written before the tool
// runs (so nothing happens without a record) and completed when it finishes.

import type { Db } from "./db.ts";
import { unwrap } from "./db.ts";
import type { Actor } from "./roles.ts";

const HIDDEN_KEYS = new Set(["pin", "password"]);
const MAX_TEXT = 1000;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.length > 5 ? `[${value.length} items]` : value.map(redact);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = HIDDEN_KEYS.has(key.toLowerCase()) ? "[hidden]" : redact(v);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 200) {
    return `${value.slice(0, 200)}…`;
  }
  return value;
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

/** The arguments as short JSON, with PINs removed. */
export function summariseArgs(args: unknown): string {
  return clip(JSON.stringify(redact(args ?? {})));
}

/** Records the call with the person and the channel. Throws if the row cannot be written: then the tool must not run. */
export async function auditStart(
  db: Db,
  toolName: string,
  args: unknown,
  actor: Actor,
): Promise<number> {
  const row = unwrap(
    await db.from("office_audit")
      .insert({
        tool: toolName,
        args_summary: summariseArgs(args),
        result_summary: "started",
        actor_employee_id: actor.employeeId,
        actor_name: actor.name,
        channel: actor.channel,
      })
      .select("id")
      .single(),
    "audit log",
  );
  return row.id;
}

/** Records how the call ended. Never throws: the tool's own result still goes back. */
export async function auditFinish(
  db: Db,
  id: number,
  summary: string,
): Promise<void> {
  const { error } = await db.from("office_audit").update({
    result_summary: clip(summary),
  }).eq("id", id);
  if (error) {
    console.error(
      `audit #${id}: could not record the result: ${error.message}`,
    );
  }
}
