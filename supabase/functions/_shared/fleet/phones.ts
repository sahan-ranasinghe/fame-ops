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
  await logChanges(db, employeeId, [{ field: "phone", before, after }], actor);
}

/** Part 3b (G): every field that really changed, one row each (who, from, to, when, the channel). */
export async function logChanges(
  db: Db,
  employeeId: string,
  changes: readonly { field: string; before: string | null | undefined; after: string | null | undefined }[],
  actor: Pick<Actor, "name" | "employeeId" | "channel">,
): Promise<number> {
  const rows = changes
    .filter((c) => (c.before ?? null) !== (c.after ?? null))
    .map((c) => ({
      employee_id: employeeId,
      field: c.field,
      old_value: c.before ?? null,
      new_value: c.after ?? null,
      changed_by_name: actor.name,
      changed_by_employee_id: actor.employeeId,
      channel: actor.channel,
    }));
  if (rows.length) unwrap(await db.from("employee_changes").insert(rows), "change log");
  return rows.length;
}

/** The words for a changed field (Part 3b, G). */
export const CHANGE_FIELD_TEXT: Record<string, string> = {
  phone: "Phone",
  whatsapp: "WhatsApp",
  emergency_name: "Emergency contact",
  emergency_relation: "Relationship",
  emergency_phone: "Emergency phone",
  licence_no: "Licence number",
  licence_expiry: "Licence expiry",
  licence_front_photo: "Licence photo (front)",
  licence_back_photo: "Licence photo (back)",
};

/** The private part of a driver's profile (the emergency contact, the licence): users or vehicles, never a requester. */
export function seesDriverPrivate(actor: Pick<Actor, "permissions">): boolean {
  return ["users", "vehicles"].some((p) => actor.permissions.includes(p as never));
}

/**
 * Who sees the drivers' numbers on the office's lists (Live, Who's available, the drivers, a task): the people who run the
 * trips and the fleet. A requester sees a driver's number only on their own trips (my_trips, the request page).
 */
export function seesDriverPhones(actor: Pick<Actor, "permissions">): boolean {
  return ["approve", "assign_tasks", "vehicles", "issues", "users"].some((p) => actor.permissions.includes(p as never));
}
