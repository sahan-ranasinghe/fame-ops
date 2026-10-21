// Office mode (Phase 8, O2): copied from the office site (apps/office/src/screens/requestLogic.ts at main 03d3538) for the phone's trip editor,
// as Sahan asked for this round (the shared package comes later). Edit the site's file and copy again, never this one alone.

// Vehicle requests: the new-request form, the one-step booking, the decision,
// the requester's edit and the decision on a changed booking, and the
// timeline in words, as the connector expects them. Phase 7: the driver first
// with the vehicle they bring (§3); a request is a whole trip, as a task is
// (§34): the day, the leave-by time (typed, or planned from the stops'
// arrive-by times), the back-by time, Start from with "Passengers get in here"
// and the stops with their times there (the trip editor's fields).
import type { FieldChanges, RequestEditFields, RequestEvent, RequestTimeline, RequestTrip } from '../types';
import { parseDwell } from './stopsLogic';
import { type Base, emptyTrip, type TripFields, tripChanges, tripFromRequest, tripRequestInput, type TripStartStop, tripTitle } from './tripLogic';
// Round 3 (the app's own addition until the site's file is copied again): "Who drives?" (whoDrivesLogic.ts).
import { whoChanges, whoFromFields, whoInput, whoOf, whoProblem, type WhoDrives } from './whoDrivesLogic';

/** The trip (the day, leave-by, back-by as `end`, the start and the stops), then what the request asks for. */
export interface RequestFields extends TripFields {
  /** The person the vehicle is for, when it is not the asker (the request is always in the asker's name). */
  behalf: string;
  project: string;
  need: string;
  pax: string;
  tools: boolean;
  note: string;
  /** Unticked = the vehicle's custodian drives (no driver needed). */
  driver: boolean;
  /** Phase 7 (§4): the phone of the person it is for when they have no office account (approvers fill it): Tell requester. */
  requesterPhone?: string;
  /** Round 3: who drives (a driver, the asker, someone else with a name and a phone; the custodian on an older request).
   *  Absent = `driver` says it (true a driver, false the custodian). */
  who?: WhoDrives;
}

export const emptyRequest = (date: string): RequestFields => ({
  ...emptyTrip(date), behalf: "", project: "", need: "", pax: "", tools: false, note: "", driver: true,
});

/** The time at From / To as sent: minutes, null = not chosen, "bad" = not minutes or h:mm up to 12 h. */
const dwellOf = (s?: string) => parseDwell(s ?? "");

const paxOf = (s: string) => Math.max(0, Math.min(80, parseInt(s.trim(), 10) || 0));

/** What the request asks for besides the trip (create_request and book_vehicle). */
function askInput(f: RequestFields): Record<string, unknown> {
  const t = (s: string) => s.trim();
  const input: Record<string, unknown> = {};
  if (t(f.behalf)) input.on_behalf_of = t(f.behalf);
  if (t(f.project)) input.project = t(f.project);
  if (t(f.need)) input.need_type = t(f.need);
  if (t(f.pax) !== "") input.pax = paxOf(f.pax);
  if (f.tools) input.tools = true;
  if (t(f.note)) input.note = t(f.note);
  Object.assign(input, whoInput(whoOf({ who: f.who, driverRequired: f.driver })));
  if (t(f.requesterPhone ?? "")) input.requester_phone = t(f.requesterPhone ?? "");
  return input;
}

/** create_request: the trip (§34) and what the request asks for. */
export function validateNewRequest(f: RequestFields, base: Base = null): { error: string } | { input: Record<string, unknown> } {
  const trip = tripRequestInput(f, base);
  if ("error" in trip) return trip;
  // Round 3: someone else needs a name and a phone (the approver picks the vehicle).
  const who = whoProblem(whoOf({ who: f.who, driverRequired: f.driver }));
  if (who) return { error: who };
  return { input: { ...trip.input, ...askInput(f) } };
}

/** The day and the leave time (typed, or the plan's) are enough to look for free vehicles (suggest_vehicles without a request). */
export function suggestInput(f: RequestFields, time: string): Record<string, unknown> | null {
  const t = (s: string) => s.trim();
  if (!t(f.date) || !/^\d{2}:\d{2}$/.test(t(time))) return null;
  const input: Record<string, unknown> = { date: t(f.date), time: t(time) };
  if (t(f.end)) input.back_by = t(f.end);
  if (t(f.need)) input.need_type = t(f.need);
  if (t(f.pax) !== "") input.pax = paxOf(f.pax);
  return input;
}

/**
 * book_vehicle: the request with its trip, plus the pick. The driver first: their vehicle fills itself
 * (`defaultVehicle`; the call then names none and the server takes the same one) unless one is picked. No driver only
 * when the custodian drives (driver unticked, vehicle assigned). The task's title is "Trip · <the last stop>".
 */
export function bookInput(
  f: RequestFields,
  pick: { vehicle: string; driver: string; hasCustodian: boolean; defaultVehicle?: string | null },
  base: Base = null,
): { error: string } | { input: Record<string, unknown> } {
  const v = validateNewRequest(f, base);
  if ("error" in v) return v;
  // Round 3: the asker drives, or someone else: no driver, and the plate (no app to choose a vehicle on the day).
  const who = whoOf({ who: f.who, driverRequired: f.driver });
  if (who.choice === "self" || who.choice === "other") {
    const problem = whoProblem(who, { needsPlate: true, plate: pick.vehicle });
    if (problem) return { error: problem };
    const input: Record<string, unknown> = { ...v.input, vehicle: pick.vehicle.trim() };
    const title = tripTitle(f);
    if (title) input.title = title;
    return { input };
  }
  const custodianDrives = !f.driver && pick.hasCustodian && !!pick.vehicle;
  if (!pick.driver && !custodianDrives) {
    // Round 3: no "A driver is needed" switch any more (Who drives? asks it): a driver is picked.
    return { error: "Pick a driver." };
  }
  // The driver's vehicle known to be none (undefined = not known yet: the server decides).
  if (!pick.vehicle && pick.defaultVehicle === null) return { error: "Pick a vehicle: this driver holds none today and has no regular one." };
  const input: Record<string, unknown> = { ...v.input };
  if (pick.vehicle) input.vehicle = pick.vehicle;
  if (pick.driver && !custodianDrives) input.driver = pick.driver;
  const title = tripTitle(f);
  if (title) input.title = title;
  return { input };
}

/**
 * decide_request: decline with a reason, or approve with a driver (the vehicle fills itself unless one is
 * picked) or, when the custodian drives, the custodian's vehicle.
 */
export function decisionInput(
  d: {
    id: string;
    /** Hotfix 2 (K): the card's version; a second approver's decision is refused ("Already approved by Palitha at 10:42"). */
    version?: number;
    decision: "approve" | "decline";
    reason?: string;
    vehicle?: string;
    driver?: string;
    decidedBy?: string;
    custodianDrives?: boolean;
    defaultVehicle?: string | null;
  },
): { error: string } | { input: Record<string, unknown> } {
  const input: Record<string, unknown> = { request_id: d.id, decision: d.decision };
  if (d.version != null) input.version = d.version;
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

/**
 * The edit form's fields, from the card: the trip from its stops and start (the start stop's what, note and time
 * there from the card's trip), or an older request's From and To as two stops; then what it asks for.
 */
export function editFields(q: { fields?: RequestEditFields; note?: string; requester_phone?: string; trip?: { stops: (TripStartStop & { is_start?: boolean })[] } }): RequestFields {
  const f = q.fields;
  return {
    ...(q.requester_phone ? { requesterPhone: q.requester_phone } : {}),
    ...tripFromRequest(f, q.trip?.stops.find((s) => s.is_start)),
    behalf: f?.on_behalf_of ?? "",
    project: "",
    need: f?.need_type ?? "",
    pax: f?.pax == null ? "" : String(f.pax),
    tools: !!f?.tools,
    note: f?.note ?? q.note ?? "",
    driver: f?.driver_required !== false,
    who: whoFromFields(f),
  };
}

/**
 * The times at From and To as update_request takes them, when they differ from the request's: minutes, or
 * null to go back to the usual time / the default. Null when nothing differs; "bad" when one is not a time.
 */
export function dwellChanges(f: { fromDwell?: string; toDwell?: string }, was: { from_dwell_min?: number; to_dwell_min?: number } | undefined): Record<string, number | null> | null | "bad" {
  const fd = dwellOf(f.fromDwell), td = dwellOf(f.toDwell);
  if (fd === "bad" || td === "bad") return "bad";
  const out: Record<string, number | null> = {};
  if ((fd ?? null) !== (was?.from_dwell_min ?? null)) out.from_dwell_min = fd;
  if ((td ?? null) !== (was?.to_dwell_min ?? null)) out.to_dwell_min = td;
  return Object.keys(out).length ? out : null;
}

/**
 * update_request: only what differs from the request as loaded, with the version. The trip as tripChanges sends it
 * (`time` null = planned from the arrive-by times; a changed route sends the stops with the start).
 */
export function updateRequestInput(id: string, version: number, f: RequestFields, was: RequestFields, base: Base = null): { error: string } | { input: Record<string, unknown> } {
  const t = (s: string) => s.trim();
  const trip = tripChanges(f, was, base);
  if ("error" in trip) return trip;
  const input: Record<string, unknown> = { request_id: id, version, ...trip.input };
  if (t(f.need) !== t(was.need)) input.need_type = t(f.need) || null;
  if (t(f.pax) !== t(was.pax)) input.pax = t(f.pax) === "" ? null : paxOf(f.pax);
  if (f.tools !== was.tools) input.tools = f.tools;
  if (t(f.note) !== t(was.note)) input.note = t(f.note) || null;
  // Round 3: who drives, only when it changed (a driver again, self, someone else with the name and phone).
  if (f.who || was.who) {
    const now = whoOf({ who: f.who, driverRequired: f.driver });
    const problem = whoProblem(now);
    if (problem) return { error: problem };
    Object.assign(input, whoChanges(now, whoOf({ who: was.who, driverRequired: was.driver })));
  } else if (f.driver !== was.driver) input.driver_required = f.driver;
  if (t(f.behalf) !== t(was.behalf)) input.on_behalf_of = t(f.behalf) || null;
  // Undefined = not on the form (someone who does not approve, or a draft from before the field): left as it is.
  if (f.requesterPhone !== undefined && t(f.requesterPhone) !== t(was.requesterPhone ?? "")) input.requester_phone = t(f.requesterPhone) || null;
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

/**
 * What a request's page shows of its trip, the road lines aside: the start, the leave time, each stop with its times
 * and state, the office's change. The trip with its lines (asked once) is shown only while this matches the card's
 * trip; an office edit to the task moves the card's trip on without a new request version.
 */
export function tripKey(t: RequestTrip | undefined): string {
  if (!t) return "";
  return JSON.stringify([
    t.start?.name ?? null,
    t.leave_by ?? null,
    t.stops.map((s) => [s.type, s.place ?? null, s.planned_arrive ?? null, s.planned_depart ?? null, s.arrive_by ?? null, s.status ?? null]),
    t.changed?.text ?? null,
  ]);
}
