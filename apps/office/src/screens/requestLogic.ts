// Vehicle requests: the new-request form, the one-step booking, the decision,
// the requester's edit and the decision on a changed booking, and the
// timeline in words, as the connector expects them.
import type { FieldChanges, RequestEditFields, RequestEvent, RequestTimeline } from "../data/types";

export interface RequestFields {
  /** The person the vehicle is for, when it is not the asker (the request is always in the asker's name). */
  behalf: string;
  project: string;
  date: string;
  time: string;
  back: string;
  need: string;
  from: string;
  to: string;
  pax: string;
  tools: boolean;
  note: string;
  /** Unticked = the vehicle's custodian drives (no driver needed). */
  driver: boolean;
}

export const emptyRequest = (date: string): RequestFields => ({
  behalf: "", project: "", date, time: "", back: "", need: "", from: "", to: "", pax: "", tools: false, note: "", driver: true,
});

/** The fields both create_request and book_vehicle take. */
function requestInput(f: RequestFields): Record<string, unknown> {
  const t = (s: string) => s.trim();
  const input: Record<string, unknown> = { date: t(f.date), time: t(f.time) };
  if (t(f.behalf)) input.on_behalf_of = t(f.behalf);
  if (t(f.project)) input.project = t(f.project);
  if (t(f.back)) input.back_by = t(f.back);
  if (t(f.need)) input.need_type = t(f.need);
  if (t(f.from)) input.route_from = t(f.from);
  if (t(f.to)) input.route_to = t(f.to);
  if (t(f.pax) !== "") input.pax = Math.max(0, Math.min(80, parseInt(t(f.pax), 10) || 0));
  if (f.tools) input.tools = true;
  if (t(f.note)) input.note = t(f.note);
  if (!f.driver) input.driver_required = false;
  return input;
}

export function validateNewRequest(f: RequestFields): { error: string } | { input: Record<string, unknown> } {
  const t = (s: string) => s.trim();
  if (!t(f.date) || !t(f.time)) return { error: "Add the day and the time." };
  return { input: requestInput(f) };
}

/** The day and time are enough to look for free vehicles (suggest_vehicles without a request). */
export function suggestInput(f: RequestFields): Record<string, unknown> | null {
  const t = (s: string) => s.trim();
  if (!t(f.date) || !t(f.time)) return null;
  const input: Record<string, unknown> = { date: t(f.date), time: t(f.time) };
  if (t(f.back)) input.back_by = t(f.back);
  if (t(f.need)) input.need_type = t(f.need);
  if (t(f.pax) !== "") input.pax = Math.max(0, Math.min(80, parseInt(t(f.pax), 10) || 0));
  return input;
}

/** book_vehicle: the request fields plus the pick. A driver is needed unless the custodian drives (driver unticked, vehicle assigned). */
export function bookInput(
  f: RequestFields,
  pick: { vehicle: string; driver: string; hasCustodian: boolean },
): { error: string } | { input: Record<string, unknown> } {
  const t = (s: string) => s.trim();
  if (!t(f.date) || !t(f.time)) return { error: "Add the day and the time." };
  if (!pick.vehicle) return { error: "Pick a vehicle." };
  const custodianDrives = !f.driver && pick.hasCustodian;
  if (!pick.driver && !custodianDrives) {
    return { error: pick.hasCustodian ? 'Pick a driver, or untick "A driver is needed" so the custodian drives.' : "Pick a driver." };
  }
  const input: Record<string, unknown> = { ...requestInput(f), vehicle: pick.vehicle };
  if (pick.driver && !custodianDrives) input.driver = pick.driver;
  return { input };
}

export function decisionInput(
  d: { id: string; decision: "approve" | "decline"; reason?: string; vehicle?: string; driver?: string; decidedBy?: string; custodianDrives?: boolean },
): { error: string } | { input: Record<string, unknown> } {
  const input: Record<string, unknown> = { request_id: d.id, decision: d.decision };
  if (d.decidedBy) input.decided_by = d.decidedBy.slice(0, 80);
  if (d.decision === "decline") {
    const r = (d.reason ?? "").trim();
    if (!r) return { error: "Write the reason first. The person who asked will see it." };
    input.reason = r;
  } else {
    if (!d.vehicle || (!d.driver && !d.custodianDrives)) return { error: "Pick a vehicle and a driver." };
    input.vehicle = d.vehicle;
    if (d.driver && !d.custodianDrives) input.driver = d.driver;
  }
  return { input };
}

export interface TimelineStep {
  label: string;
  at?: string;
  done: boolean;
  /** The diff of an edit, in lines ("time 09:00 → 09:30"). */
  lines?: string[];
}

const EVENT_LABEL: Record<string, string> = {
  created: "Sent",
  seen: "Seen by the office",
  edited: "Changed by the requester",
  approved: "Approved",
  declined: "Declined",
  changed: "Changed · needs re-approval",
  redecided: "Decided again",
  postponed: "Postponed",
  cancelled: "Cancelled",
};

/** "time 09:00 → 09:30" per changed field. */
export function diffLines(changes?: FieldChanges | null): string[] {
  if (!changes) return [];
  return Object.entries(changes).map(([label, c]) => `${label} ${c.from ?? "—"} → ${c.to ?? "—"}`);
}

/**
 * The requester's timeline in words. From the events when the card has them
 * (Phase 6: sent → seen → approved → changed → decided again / cancelled), else
 * from the older timeline fields: sent → seen → decided / cancelled.
 */
export function timelineSteps(q: { status: string; decided?: string; decline_reason?: string; timeline?: RequestTimeline; events?: RequestEvent[] }): TimelineStep[] {
  if (q.events?.length) {
    const steps: TimelineStep[] = q.events.map((e) => ({
      label: e.action === "redecided" && e.note?.startsWith("kept") ? "Kept as asked" : EVENT_LABEL[e.action] ?? e.action,
      at: [e.at, e.actor ? `by ${e.actor}` : ""].filter(Boolean).join(" "),
      done: true,
      lines: e.action === "edited" || e.action === "changed" || e.action === "redecided" || e.action === "postponed" ? diffLines(e.changes) : undefined,
    }));
    if (!q.events.some((e) => e.action === "seen") && q.status === "waiting") steps.push({ label: "Seen by the office", done: false });
    if (q.status === "waiting") steps.push({ label: "Decision", done: false });
    if (q.status === "changed") steps.push({ label: "Decision on the change", done: false });
    return steps;
  }
  const t = q.timeline ?? {};
  const steps: TimelineStep[] = [
    { label: "Sent", at: t.sent, done: true },
    { label: "Seen by the office", at: t.seen, done: !!t.seen },
  ];
  if (q.status === "approved" || q.status === "declined" || q.status === "changed" || (q.status === "cancelled" && t.decided)) {
    steps.push({ label: q.status === "declined" ? "Declined" : "Approved", at: [t.decided, t.decided_by ? `by ${t.decided_by}` : ""].filter(Boolean).join(" "), done: true });
  } else if (q.status === "waiting") {
    steps.push({ label: "Decision", at: undefined, done: false });
  }
  if (q.status === "changed") {
    steps.push({ label: "Changed · needs re-approval", at: t.changed, done: true }, { label: "Decision on the change", done: false });
  }
  if (q.status === "cancelled") steps.push({ label: "Cancelled", at: t.cancelled, done: true });
  return steps;
}

/** The edit form's fields, from the card. */
export function editFields(q: { fields?: RequestEditFields; note?: string }): RequestFields {
  const f = q.fields;
  return {
    behalf: f?.on_behalf_of ?? "",
    project: "",
    date: f?.date ?? "",
    time: f?.time ?? "",
    back: f?.back_by ?? "",
    need: f?.need_type ?? "",
    from: f?.route_from ?? "",
    to: f?.route_to ?? "",
    pax: f?.pax == null ? "" : String(f.pax),
    tools: !!f?.tools,
    note: f?.note ?? q.note ?? "",
    driver: f?.driver_required !== false,
  };
}

/** update_request: only the fields that differ from the loaded ones, with the version. */
export function updateRequestInput(id: string, version: number, f: RequestFields, was: RequestFields): { error: string } | { input: Record<string, unknown> } {
  const t = (s: string) => s.trim();
  if (!t(f.date) || !t(f.time)) return { error: "Add the day and the time." };
  const input: Record<string, unknown> = { request_id: id, version };
  if (t(f.date) !== was.date) input.date = t(f.date);
  if (t(f.time) !== was.time) input.time = t(f.time);
  if (t(f.back) !== t(was.back)) input.back_by = t(f.back) || null;
  if (t(f.from) !== t(was.from) && t(f.from)) input.route_from = t(f.from);
  if (t(f.to) !== t(was.to) && t(f.to)) input.route_to = t(f.to);
  if (t(f.need) !== t(was.need)) input.need_type = t(f.need) || null;
  if (t(f.pax) !== t(was.pax)) input.pax = t(f.pax) === "" ? null : Math.max(0, Math.min(80, parseInt(t(f.pax), 10) || 0));
  if (f.tools !== was.tools) input.tools = f.tools;
  if (t(f.note) !== t(was.note)) input.note = t(f.note) || null;
  if (f.driver !== was.driver) input.driver_required = f.driver;
  if (t(f.behalf) !== t(was.behalf)) input.on_behalf_of = t(f.behalf) || null;
  if (Object.keys(input).length === 2) return { error: "Nothing changed." };
  return { input };
}

export type Redecision = "keep" | "change" | "decline";

/** redecide_request: keep as asked, change (vehicle, driver, day, time, back-by), or decline with a reason. */
export function redecideInput(
  d: { id: string; version: number; decision: Redecision; reason?: string; vehicle?: string; driver?: string; date?: string; time?: string; back?: string; was?: { date?: string; time?: string; back?: string } },
): { error: string } | { input: Record<string, unknown> } {
  const t = (s?: string) => (s ?? "").trim();
  const input: Record<string, unknown> = { request_id: d.id, version: d.version, decision: d.decision };
  if (d.decision === "decline") {
    if (!t(d.reason)) return { error: "Write the reason first. The person who asked will see it." };
    input.reason = t(d.reason);
    return { input };
  }
  if (d.decision === "change") {
    if (t(d.vehicle)) input.vehicle = t(d.vehicle);
    if (t(d.driver)) input.driver = t(d.driver);
    if (t(d.date) && t(d.date) !== t(d.was?.date)) input.date = t(d.date);
    if (t(d.time) && t(d.time) !== t(d.was?.time)) input.time = t(d.time);
    if (t(d.back) !== t(d.was?.back)) input.back_by = t(d.back) || null;
    if (Object.keys(input).length === 3) return { error: "Pick what to change: the vehicle, the driver, the day, the time or the back-by time." };
  }
  return { input };
}
