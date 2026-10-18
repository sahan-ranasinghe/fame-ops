// Hotfix 2 (F): phone numbers as stored (E.164, +94…) and the log of every change (employee_changes: who, from, to, when),
// for the office people's own numbers, the ones an admin edits and the drivers'.
import type { Db } from "./db.ts";
import { ToolError, unwrap } from "./db.ts";
import { phoneE164 } from "./format.ts";
import type { Actor } from "./roles.ts";

/** A typed number as stored: E.164, null to clear, undefined = not given; anything else is refused. */
export function storedPhone(typed: string | null | undefined, what = "phone"): string | null | undefined {
  if (typed === undefined) return undefined;
  if (typed === null || typed.trim() === "") return null;
  const e164 = phoneE164(typed);
  if (!e164) throw new ToolError(`${what}: a Sri Lankan number such as 077 123 4567 or 011 234 5678.`);
  return e164;
}

/** Writes the change to the log when the number really changed. */
export async function logPhoneChange(
  db: Db,
  employeeId: string,
  before: string | null,
  after: string | null,
  actor: Actor,
): Promise<void> {
  if ((before ?? null) === (after ?? null)) return;
  unwrap(
    await db.from("employee_changes").insert({
      employee_id: employeeId,
      field: "phone",
      old_value: before,
      new_value: after,
      changed_by_name: actor.name,
      changed_by_employee_id: actor.employeeId,
      channel: actor.channel,
    }),
    "change log",
  );
}

/**
 * Who sees the drivers' numbers on the office's lists (Live, Who's available, the drivers, a task): the people who run the
 * trips and the fleet. A requester sees a driver's number only on their own trips (my_trips, the request page).
 */
export function seesDriverPhones(actor: Pick<Actor, "permissions">): boolean {
  return ["approve", "assign_tasks", "vehicles", "issues", "users"].some((p) => actor.permissions.includes(p as never));
}
