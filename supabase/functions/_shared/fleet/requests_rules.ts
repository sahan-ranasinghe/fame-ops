// The rules behind editing a request and deciding it again (Phase 6, Part 2):
// which fields an edit may touch, what changed in the office's words, what the
// status becomes, and the version check. Pure: tools/requests.ts loads and saves.

import { ToolError } from "./db.ts";
import { colomboDate, colomboDayTime, colomboTime } from "./time.ts";

/** The fields a requester may edit, as stored. */
export interface RequestFields {
  needed_at: string;
  back_by: string | null;
  route_from: string | null;
  route_to: string | null;
  need_type: string | null;
  pax: number | null;
  tools: boolean;
  note: string | null;
  driver_required: boolean;
}

export const REQUEST_FIELDS: (keyof RequestFields)[] = [
  "needed_at",
  "back_by",
  "route_from",
  "route_to",
  "need_type",
  "pax",
  "tools",
  "note",
  "driver_required",
];

export function snapshot(r: RequestFields): RequestFields {
  return Object.fromEntries(REQUEST_FIELDS.map((k) => [k, r[k]])) as unknown as RequestFields;
}

export interface Change {
  from: string | null;
  to: string | null;
}
export type Changes = Record<string, Change>;

const TYPE_NAME: Record<string, string> = { car: "Car", van: "Van", double_cab: "Double cab", lorry: "Lorry", other: "Other" };

/** The words for one field's value. */
function word(key: keyof RequestFields, r: RequestFields): string | null {
  switch (key) {
    case "needed_at":
      return colomboDayTime(r.needed_at);
    case "back_by":
      return r.back_by ? (colomboDate(r.back_by) === colomboDate(r.needed_at) ? colomboTime(r.back_by) : colomboDayTime(r.back_by)) : null;
    case "need_type":
      return r.need_type ? TYPE_NAME[r.need_type] ?? r.need_type : null;
    case "pax":
      return r.pax == null ? null : String(r.pax);
    case "tools":
      return r.tools ? "yes" : "no";
    case "driver_required":
      return r.driver_required ? "a driver" : "the custodian drives";
    default:
      return r[key] ?? null;
  }
}

/** The names the office reads. */
export const FIELD_LABEL: Record<keyof RequestFields, string> = {
  needed_at: "time",
  back_by: "back by",
  route_from: "from",
  route_to: "to",
  need_type: "vehicle",
  pax: "passengers",
  tools: "tools",
  note: "note",
  driver_required: "driver",
};

/** What changed between two versions of a request, by label, in words. Pure. */
export function requestDiff(before: RequestFields, after: RequestFields): Changes {
  const out: Changes = {};
  for (const key of REQUEST_FIELDS) {
    const a = word(key, before);
    const b = word(key, after);
    if (a !== b) out[FIELD_LABEL[key]] = { from: a, to: b };
  }
  return out;
}

/** "time Thu 15 Oct 09:00 → Thu 15 Oct 09:30, to Galle → Matara" */
export function diffText(changes: Changes): string {
  return Object.entries(changes).map(([label, c]) => `${label} ${c.from ?? "—"} → ${c.to ?? "—"}`).join(", ");
}

export type RequestStatus = "waiting" | "approved" | "changed" | "declined" | "cancelled";

/** What an edit does to a request in each state. */
export function statusAfterEdit(status: string): { status: "waiting" | "changed"; event: "edited" | "changed"; needs_reapproval: boolean } {
  switch (status) {
    case "waiting":
      return { status: "waiting", event: "edited", needs_reapproval: false };
    case "approved":
      return { status: "changed", event: "changed", needs_reapproval: true };
    case "changed":
      return { status: "changed", event: "edited", needs_reapproval: true };
    default:
      throw new ToolError(`This request is ${status}; it cannot be changed any more.`);
  }
}

/** The version the caller loaded must be the current one, as with plan_version. */
export function checkVersion(current: number, sent: number): void {
  if (current !== sent) {
    throw new ToolError(`This request changed since you loaded it (version ${current}, you have ${sent}). Reload it and try again.`);
  }
}

/** "10:42" today, "Sat 17 Oct 10:42" another day. */
export function atText(iso: string, now: Date): string {
  return colomboDate(iso) === colomboDate(now) ? colomboTime(iso) : colomboDayTime(iso);
}

/**
 * Hotfix 2 (K): what a second approver is told when the request was decided (or changed) since they opened it, with who did
 * it and when: "Already approved by Palitha at 10:42." `again` = redecide_request (the request was approved before).
 */
export function alreadyDecidedText(
  r: {
    status: string;
    decided_by: string | null;
    decided_at: string | null;
    decline_reason: string | null;
    cancelled_by: string | null;
    cancelled_at: string | null;
    changed_by: string | null;
    changed_at: string | null;
  },
  now: Date,
  again = false,
): string {
  const at = (iso: string | null) => iso ? ` at ${atText(iso, now)}` : "";
  switch (r.status) {
    case "approved":
      return `Already ${again ? "decided again" : "approved"} by ${r.decided_by ?? "another approver"}${at(r.decided_at)}.`;
    case "declined":
      return `Already declined by ${r.decided_by ?? "another approver"}${at(r.decided_at)}${
        r.decline_reason ? `: ${r.decline_reason}` : ""
      }.`;
    case "cancelled":
      return `Already cancelled by ${r.cancelled_by ?? "someone"}${at(r.cancelled_at)}.`;
    case "changed":
      return again
        ? `Changed again by ${r.changed_by ?? "the person who asked"}${at(r.changed_at)} since you opened it: open it again.`
        : `Changed by ${r.changed_by ?? "the person who asked"}${
          at(r.changed_at)
        } after it was approved: decide it again (redecide_request).`;
    default:
      return "This request was edited since you opened it: open it again to see the change.";
  }
}

/** Which decisions a request in a state allows (decide_request handles waiting; redecide_request the rest). */
export function canRedecide(status: string): void {
  if (status === "waiting") throw new ToolError("This request is still waiting for its first decision: use decide_request.");
  if (status !== "approved" && status !== "changed") throw new ToolError(`This request is ${status}; there is nothing to decide again.`);
}
