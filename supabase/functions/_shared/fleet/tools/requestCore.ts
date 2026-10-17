// What both the request tools and create_task (a proposed task is a request, Phase 7 §33) need: the requester's
// timeline rows and who a request is in the name of. Its own module: tasks.ts and requests.ts both import it, and
// requests.ts imports tasks.ts, so these stay out of either.

import type { Json } from "../database.types.ts";
import type { Db, Row } from "../db.ts";
import { unwrap, unwrapMaybe } from "../db.ts";
import { hasAny } from "../permissions.ts";
import type { Actor } from "../roles.ts";

type RequestEvent = Row<"request_events">;
type EventAction = RequestEvent["action"];

/** One row of the requester's timeline. Never fails the tool that writes it. */
export async function logRequestEvent(
  db: Db,
  requestId: string,
  action: EventAction,
  actor: string | null,
  extra: { note?: string | null; changes?: Record<string, unknown> | null; at?: string } = {},
): Promise<void> {
  const { error } = await db.from("request_events").insert({
    request_id: requestId,
    action,
    actor,
    note: extra.note ?? null,
    changes: (extra.changes ?? null) as Json,
    ...(extra.at && { at: extra.at }),
  });
  if (error) console.error(`request_events ${action} for ${requestId}: ${error.message}`);
}

/** The Auth account behind the actor: a web session, or the person behind a personal key. */
export async function actorUserId(db: Db, actor: Actor): Promise<string | null> {
  if (actor.authUserId) return actor.authUserId;
  if (!actor.employeeId) return null;
  const row = unwrapMaybe(await db.from("employees").select("auth_user_id").eq("id", actor.employeeId).maybeSingle(), "employee");
  return row?.auth_user_id ?? null;
}

/** Who the request is for: a staff member always in their own name; the office may name anyone (linked when the name matches). */
export async function requester(
  db: Db,
  actor: Actor,
  typed: string | undefined,
): Promise<{ name: string; employeeId: string | null; userId: string | null }> {
  const userId = await actorUserId(db, actor);
  const staff = !hasAny(actor.permissions, ["approve", "assign_tasks"]);
  if (staff || !typed) return { name: actor.name, employeeId: actor.employeeId, userId };
  const want = typed.toLowerCase();
  const employee = unwrap(await db.from("employees").select("id, name, code").eq("active", true).limit(1000), "employees")
    .find((e) => e.name.toLowerCase() === want || e.code.toLowerCase() === want);
  return { name: typed, employeeId: employee?.id ?? null, userId };
}
