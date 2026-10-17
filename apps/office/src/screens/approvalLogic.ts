// Tasks go to the fleet admin first (Phase 7, §33) and requests carry their
// trip (§34): the approver's side. Which decide page a request gets, how a
// proposed task reads on the list, the board and the detail, who sees the
// proposed driver, vehicle and conflicts (§35 19), what decide_request is sent
// (only what the approver changed: the server keeps the plan and the proposal
// otherwise) and the words on its button. Pure; the pages are TripDecide,
// RequestDetail, Requests and Tasks.
import type { RequestCard, WaitingApprovalCard } from "../data/types";
import { joinDots } from "../lib/format";
import type { Me } from "../transport/types";

/** A waiting proposal or request past its leave-by (§35 18): it stays in the queue, never sent by itself. */
export const LATE_TEXT = "Leave-by passed · not decided";
/** The same as a badge on a list row or a board card. */
export const LATE_BADGE = "Leave-by passed";

/** A task proposed by someone without the approve permission. */
export const isProposal = (q: Pick<RequestCard, "kind">) => q.kind === "task";

/** A waiting proposal, or a waiting request planned with its stops: the trip decide page (the stops as asked, nothing retyped). */
export function decidesTrip(q: Pick<RequestCard, "status" | "kind" | "trip">): boolean {
  return q.status === "waiting" && (q.kind === "task" || !!q.trip?.stops.length);
}

/** "Task for Kamal Perera · WP CAB-4521 · proposed by Nimal Fernando" */
export function proposalLine(q: Pick<RequestCard, "proposed" | "requested_by">): string {
  return joinDots([`Task for ${q.proposed?.driver ?? "a driver"}`, q.proposed?.vehicle, `proposed by ${q.requested_by}`]);
}

/** What a person sees of a request or a proposal (§35 19). */
export interface RequestView {
  /** The proposed driver and vehicle ("Task for Kamal · WP CAB-4521 · proposed by Nimal"). */
  proposal: boolean;
  /** The proposal's warnings and conflicts. */
  conflicts: boolean;
  /** Withdraw (cancel_request) on one's own waiting request or proposal, without the approve permission. */
  withdraw: boolean;
}

/**
 * Approvers see everything. Without approve, list_requests answers the person's own requests only, so a card they see is
 * theirs: a proposer sees the driver, the vehicle and the conflicts they proposed with; someone who asked for a vehicle sees
 * no driver, vehicle or conflict until it is decided (their card carries none).
 */
export function requestView(q: Pick<RequestCard, "kind" | "status" | "requested_by">, me: Pick<Me, "permissions" | "tools" | "name">): RequestView {
  const approver = me.permissions.includes("approve");
  const own = !approver || q.requested_by === me.name;
  const task = isProposal(q);
  return {
    proposal: task && (approver || own),
    conflicts: task && (approver || (own && me.permissions.includes("assign_tasks"))),
    withdraw: !approver && own && q.status === "waiting" && me.tools.includes("cancel_request"),
  };
}

/** Where a card of the board's "Waiting for approval" opens: the decide page, one's own proposal, or nowhere. */
export function waitingTarget(card: Pick<WaitingApprovalCard, "request_id" | "proposed_by">, me: Pick<Me, "tools" | "name">): string | null {
  if (me.tools.includes("decide_request")) return `/requests/${card.request_id}/decide`;
  if (me.tools.includes("list_requests") && card.proposed_by === me.name) return `/requests/${card.request_id}`;
  return null;
}

/** The trip decide page's choices; "" = as asked or as proposed. Kept as a draft. */
export interface TripDecision {
  /** The driver picked; "" = the proposed one, else the best match. */
  driver: string;
  /** The vehicle picked; "" = the driver's (the proposed one with the proposed driver). */
  vehicle: string;
  date: string;
  leaveBy: string;
  back: string;
  reason: string;
}

export const emptyTripDecision = (): TripDecision => ({ driver: "", vehicle: "", date: "", leaveBy: "", back: "", reason: "" });

export interface AskedTimes {
  date: string;
  leaveBy: string;
  back: string;
}

/** The day and the times as asked: the request's day, its leave-by (the planned one, else the time needed), its back-by. */
export function askedTimes(q: Pick<RequestCard, "fields" | "trip">): AskedTimes {
  return { date: q.fields?.date ?? "", leaveBy: q.trip?.leave_by ?? q.fields?.time ?? "", back: q.fields?.back_by ?? "" };
}

/** The times as the fields show them: the one typed, else as asked. */
export function shownTimes(f: Pick<TripDecision, "date" | "leaveBy" | "back">, was: AskedTimes): AskedTimes {
  return { date: f.date || was.date, leaveBy: f.leaveBy || was.leaveBy, back: f.back || was.back };
}

/**
 * The times the approver changed, as decide_request takes them: only those that differ from the request's (a new day or
 * leave-by plans the trip again; the same values would ask for a plan for nothing). A back-by cannot be cleared here.
 */
export function timeChanges(f: Pick<TripDecision, "date" | "leaveBy" | "back">, was: AskedTimes): { date?: string; leave_by?: string; back_by?: string } {
  const t = (s: string) => s.trim();
  const out: { date?: string; leave_by?: string; back_by?: string } = {};
  if (t(f.date) && t(f.date) !== was.date) out.date = t(f.date);
  if (t(f.leaveBy) && t(f.leaveBy) !== was.leaveBy) out.leave_by = t(f.leaveBy);
  if (t(f.back) && t(f.back) !== was.back) out.back_by = t(f.back);
  return out;
}

export interface TripPick {
  /** The decision's form: the choices and the times. */
  f: TripDecision;
  was: AskedTimes;
  /** The driver shown: picked, or the default (the proposed one, else the best match); "" = none. */
  driver: string;
  /** A proposal's driver (username) and vehicle (plate); absent for a request. */
  proposed?: { username?: string; vehicle?: string };
  /** The vehicle the shown driver brings: a plate, null = known to be none, undefined = not known yet (the server decides). */
  driverVehicle?: string | null;
  /** The request says no driver is needed: the custodian of the vehicle picked drives. */
  noDriverNeeded?: boolean;
}

/** The pick as decide_request takes it: the driver and the vehicle only when they differ from the proposal's, and the times changed. */
export function tripPick(p: TripPick): { driver?: string; vehicle?: string; times: ReturnType<typeof timeChanges>; asProposed: boolean; vehicleDefault: string | null | undefined } {
  const proposal = !!p.proposed?.username;
  const driverChanged = proposal ? !!p.driver && p.driver !== p.proposed!.username : !!p.driver;
  // The proposed driver brings the proposed vehicle; another driver brings their own.
  const vehicleDefault = proposal && !driverChanged ? p.proposed!.vehicle ?? p.driverVehicle : p.driverVehicle;
  const vehicle = p.f.vehicle && p.f.vehicle !== vehicleDefault ? p.f.vehicle : undefined;
  const times = timeChanges(p.f, p.was);
  return {
    driver: driverChanged ? p.driver : undefined,
    vehicle,
    times,
    vehicleDefault,
    asProposed: proposal && !driverChanged && !vehicle && Object.keys(times).length === 0,
  };
}

/** The primary button: "Send as proposed" for a proposal left as it is, else "Approve and send" (no driver: "Approve"). */
export function decideLabel(p: { proposal: boolean; asProposed: boolean; custodianDrives?: boolean }): string {
  if (p.proposal && p.asProposed) return "Send as proposed";
  return p.custodianDrives ? "Approve" : "Approve and send";
}

/** decide_request on the trip decide page: decline with a reason, or approve with only what changed. */
export function tripDecideInput(
  d: TripPick & { id: string; decision: "approve" | "decline"; decidedBy?: string },
): { error: string } | { input: Record<string, unknown>; asProposed: boolean } {
  const input: Record<string, unknown> = { request_id: d.id, decision: d.decision };
  if (d.decidedBy) input.decided_by = d.decidedBy.slice(0, 80);
  if (d.decision === "decline") {
    const r = d.f.reason.trim();
    if (!r) return { error: "Write the reason first. The person who asked will see it." };
    return { input: { ...input, reason: r }, asProposed: false };
  }
  const pick = tripPick(d);
  if (!d.driver && !(d.noDriverNeeded && d.f.vehicle)) {
    return { error: d.noDriverNeeded ? "Pick a driver, or the vehicle whose custodian drives." : "Pick a driver: the vehicle fills itself." };
  }
  if (d.driver && !pick.vehicle && pick.vehicleDefault === null) return { error: "Pick a vehicle: this driver holds none today and has no regular one." };
  // A request names its driver; a proposal only a changed one. No driver: the custodian's vehicle.
  const vehicle = pick.vehicle ?? (d.driver ? undefined : d.f.vehicle);
  return {
    input: { ...input, ...(pick.driver ? { driver: pick.driver } : {}), ...(vehicle ? { vehicle } : {}), ...pick.times },
    asProposed: pick.asProposed,
  };
}

/** cancel_request for one's own waiting request or proposal (§35 17): the reason is required. */
export function withdrawInput(id: string, reason: string): { error: string } | { input: { request_id: string; reason: string } } {
  const r = reason.trim();
  if (!r) return { error: "Write why you withdraw it. It stays on the request." };
  return { input: { request_id: id, reason: r } };
}
