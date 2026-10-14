// Vehicle requests: the new-request form, the one-step booking and the
// decision, as the connector expects them.

export interface RequestFields {
  by: string;
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
  by: "", project: "", date, time: "", back: "", need: "", from: "", to: "", pax: "", tools: false, note: "", driver: true,
});

/** The fields both create_request and book_vehicle take. */
function requestInput(f: RequestFields, by: string | undefined): Record<string, unknown> {
  const t = (s: string) => s.trim();
  const input: Record<string, unknown> = { date: t(f.date), time: t(f.time) };
  if (by) input.requested_by = by;
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

export function validateNewRequest(f: RequestFields, staffName?: string): { error: string } | { input: Record<string, unknown> } {
  const t = (s: string) => s.trim();
  const by = staffName ?? t(f.by);
  if (!by || !t(f.date) || !t(f.time)) return { error: "Add who needs it, the day and the time." };
  return { input: requestInput(f, by) };
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
  const input: Record<string, unknown> = { ...requestInput(f, t(f.by) || undefined), vehicle: pick.vehicle };
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

/** The requester's timeline in words: sent → seen → decided / cancelled. */
export function timelineSteps(q: { status: string; decided?: string; decline_reason?: string; timeline?: { sent?: string; seen?: string; decided?: string; decided_by?: string; cancelled?: string } }): { label: string; at?: string; done: boolean }[] {
  const t = q.timeline ?? {};
  const steps = [
    { label: "Sent", at: t.sent, done: true },
    { label: "Seen by the office", at: t.seen, done: !!t.seen },
  ];
  if (q.status === "approved" || q.status === "declined" || (q.status === "cancelled" && t.decided)) {
    steps.push({ label: q.status === "declined" ? "Declined" : "Approved", at: [t.decided, t.decided_by ? `by ${t.decided_by}` : ""].filter(Boolean).join(" "), done: true });
  } else if (q.status === "waiting") {
    steps.push({ label: "Decision", at: undefined, done: false });
  }
  if (q.status === "cancelled") steps.push({ label: "Cancelled", at: t.cancelled, done: true });
  return steps;
}
