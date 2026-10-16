// Vehicle requests: the new-request form, the one-step booking, the decision,
// the requester's edit and the decision on a changed booking, and the
// timeline in words, as the connector expects them. Phase 7: the time at the
// From and To places (§17), the driver first with the vehicle they bring (§3),
// and the one-step booking's Start from with "Passengers get in here" (§11).
import type { FieldChanges, RequestEditFields, RequestEvent, RequestTimeline } from "../data/types";
import { parseDwell, type StartFields, startInput } from "./stopsLogic";

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
  /** The time at From and at To (minutes or h:mm); "" = the place's usual time, else the default. */
  fromDwell?: string;
  toDwell?: string;
}

export const emptyRequest = (date: string): RequestFields => ({
  behalf: "", project: "", date, time: "", back: "", need: "", from: "", to: "", pax: "", tools: false, note: "", driver: true, fromDwell: "", toDwell: "",
});

/** The time at From / To as sent: minutes, null = not chosen, "bad" = not minutes or h:mm up to 12 h. */
const dwellOf = (s?: string) => parseDwell(s ?? "");
const DWELL_ERROR = "The time at a stop must be minutes or h:mm, up to 12 h.";

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
  const fd = dwellOf(f.fromDwell), td = dwellOf(f.toDwell);
  if (typeof fd === "number") input.from_dwell_min = fd;
  if (typeof td === "number") input.to_dwell_min = td;
  return input;
}

export function validateNewRequest(f: RequestFields): { error: string } | { input: Record<string, unknown> } {
  const t = (s: string) => s.trim();
  if (!t(f.date) || !t(f.time)) return { error: "Add the day and the time." };
  if (dwellOf(f.fromDwell) === "bad" || dwellOf(f.toDwell) === "bad") return { error: DWELL_ERROR };
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

/**
 * book_vehicle: the request fields plus the pick. The driver first: their vehicle fills itself (`defaultVehicle`;
 * the call then names none and the server takes the same one) unless one is picked. No driver only when the
 * custodian drives (driver unticked, vehicle assigned). `start`: Start from with "Passengers get in here" (the From
 * pickup then goes when it is the same place as the start).
 */
export function bookInput(
  f: RequestFields,
  pick: { vehicle: string; driver: string; hasCustodian: boolean; defaultVehicle?: string | null },
  start?: { fields: StartFields; base: { id: string; name: string } | null; fromIsStart?: boolean },
): { error: string } | { input: Record<string, unknown> } {
  const t = (s: string) => s.trim();
  if (!t(f.date) || !t(f.time)) return { error: "Add the day and the time." };
  if (dwellOf(f.fromDwell) === "bad" || dwellOf(f.toDwell) === "bad") return { error: DWELL_ERROR };
  const custodianDrives = !f.driver && pick.hasCustodian && !!pick.vehicle;
  if (!pick.driver && !custodianDrives) {
    return { error: pick.hasCustodian ? 'Pick a driver, or untick "A driver is needed" so the custodian drives.' : "Pick a driver." };
  }
  // The driver's vehicle known to be none (undefined = not known yet: the server decides).
  if (!pick.vehicle && pick.defaultVehicle === null) return { error: "Pick a vehicle: this driver holds none today and has no regular one." };
  const input: Record<string, unknown> = { ...requestInput(f) };
  if (pick.vehicle) input.vehicle = pick.vehicle;
  if (pick.driver && !custodianDrives) input.driver = pick.driver;
  const s = start ? startInput(start.fields, start.base) : undefined;
  // From is the start (Passengers get in here): its time there is the start stop's, unless one was set at the start.
  const fromDwell = dwellOf(f.fromDwell);
  if (s && start?.fields.startPax && start.fromIsStart && typeof fromDwell === "number" && s.dwell_min === undefined) s.dwell_min = fromDwell;
  if (s) input.start = s;
  if (start?.fields.startPax) {
    // The start is Stop 1 (a pickup); From is a second pickup only when it is somewhere else.
    const stops: Record<string, unknown>[] = [];
    if (t(f.from) && !start.fromIsStart) stops.push({ type: "pickup", place: t(f.from), ...(typeof dwellOf(f.fromDwell) === "number" ? { dwell_min: dwellOf(f.fromDwell) } : {}) });
    stops.push({ type: "drop", place: t(f.to) || "To be confirmed", ...(typeof dwellOf(f.toDwell) === "number" ? { dwell_min: dwellOf(f.toDwell) } : {}) });
    input.stops = stops;
  }
  return { input };
}

/**
 * decide_request: decline with a reason, or approve with a driver (the vehicle fills itself unless one is
 * picked) or, when the custodian drives, the custodian's vehicle.
 */
export function decisionInput(
  d: { id: string; decision: "approve" | "decline"; reason?: string; vehicle?: string; driver?: string; decidedBy?: string; custodianDrives?: boolean; defaultVehicle?: string | null },
): { error: string } | { input: Record<string, unknown> } {
  const input: Record<string, unknown> = { request_id: d.id, decision: d.decision };
  if (d.decidedBy) input.decided_by = d.decidedBy.slice(0, 80);
  if (d.decision === "decline") {
    const r = (d.reason ?? "").trim();
    if (!r) return { error: "Write the reason first. The person who asked will see it." };
    input.reason = r;
  } else {
    if (d.custodianDrives) {
      if (!d.vehicle) return { error: "Pick the vehicle." };
      input.vehicle = d.vehicle;
      return { input };
    }
    if (!d.driver) return { error: "Pick a driver: the vehicle fills itself." };
    if (!d.vehicle && d.defaultVehicle === null) return { error: "Pick a vehicle: this driver holds none today and has no regular one." };
    if (d.vehicle) input.vehicle = d.vehicle;
    input.driver = d.driver;
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
    fromDwell: f?.from_dwell_min == null ? "" : String(f.from_dwell_min),
    toDwell: f?.to_dwell_min == null ? "" : String(f.to_dwell_min),
  };
}

/**
 * The times at From and To as update_request takes them, when they differ from the request's: minutes, or
 * null to go back to the usual time / the default. Null when nothing differs; "bad" when one is not a time.
 */
export function dwellChanges(f: Pick<RequestFields, "fromDwell" | "toDwell">, was: { from_dwell_min?: number; to_dwell_min?: number } | undefined): Record<string, number | null> | null | "bad" {
  const fd = dwellOf(f.fromDwell), td = dwellOf(f.toDwell);
  if (fd === "bad" || td === "bad") return "bad";
  const out: Record<string, number | null> = {};
  if ((fd ?? null) !== (was?.from_dwell_min ?? null)) out.from_dwell_min = fd;
  if ((td ?? null) !== (was?.to_dwell_min ?? null)) out.to_dwell_min = td;
  return Object.keys(out).length ? out : null;
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
  const fd = dwellOf(f.fromDwell), td = dwellOf(f.toDwell);
  if (fd === "bad" || td === "bad") return { error: DWELL_ERROR };
  if ((fd ?? null) !== (dwellOf(was.fromDwell) ?? null)) input.from_dwell_min = fd;
  if ((td ?? null) !== (dwellOf(was.toDwell) ?? null)) input.to_dwell_min = td;
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
