// Office mode (Phase 8, O1): Approve a request (design 10), the pure rules, tested in scripts/test-office.ts: the trip's
// rows from the request's plan, the summary line, Who's available's arguments, which driver is picked first, the decide
// input (decide_request for a waiting request, redecide_request with the version for a changed booking), the button's
// label, and what the server's "already decided" refusal means.

import type { AvailableDriver, Availability, FleetError, RequestCard, TimelineItem } from './types';

/** One row of the trip card: the mark (S, 1, 2 …, B), the place and its line. */
export interface TripRow {
  mark: string;
  kind: 'start' | 'stop' | 'back';
  place: string;
  /** The parts of the line ("arrive by 10:30", "1 h 30 there", "leave 11:45"): joined with " · " by the screen. */
  parts: string[];
}

export interface TripView {
  date?: string;
  leaveBy?: string;
  rows: TripRow[];
  /** "94 km · 2 h 51 min" from the timeline's totals, when planned. */
  totals?: { km: number; driveMin: number; ends?: string };
}

/** The trip as the request's plan shows it (Phase 7 §34), else the old From → To fields. */
export function tripView(q: Pick<RequestCard, 'trip' | 'fields' | 'route' | 'when' | 'back_by'>, words: {
  passengersHere: string;
  arriveBy: (t: string) => string;
  there: (min: number) => string;
  leave: (t: string) => string;
  about: (t: string) => string;
  backBy: (t: string) => string;
  backAt: (place: string) => string;
}): TripView {
  const f = q.fields;
  const trip = q.trip;
  const rows: TripRow[] = [];
  if (trip && trip.stops.length > 0) {
    if (trip.start && !trip.stops.some((s) => s.is_start)) rows.push({ mark: 'S', kind: 'start', place: trip.start.name, parts: trip.leave_by ? [words.leave(trip.leave_by)] : [] });
    let n = 0;
    for (const s of trip.stops) {
      if (s.is_start) {
        rows.push({ mark: 'S', kind: 'start', place: s.place ?? '', parts: [s.what === 'people' ? words.passengersHere : '', s.planned_leave ?? s.planned_depart ?? trip.leave_by ?? ''].filter(Boolean) });
        continue;
      }
      n += 1;
      const parts: string[] = [];
      if (s.arrive_by) parts.push(words.arriveBy(s.arrive_by));
      else if (s.planned_arrive) parts.push(words.about(s.planned_arrive));
      if (s.dwell_min) parts.push(words.there(s.dwell_min));
      const leave = s.planned_leave ?? s.planned_depart;
      if (leave) parts.push(words.leave(leave));
      rows.push({ mark: String(s.n ?? n), kind: 'stop', place: s.place ?? '', parts });
    }
    const ends = trip.timeline?.totals.ends;
    if (trip.return_to_base && trip.start) {
      const parts: string[] = [];
      if (ends) parts.push(words.about(ends));
      if (f?.back_by ?? q.back_by) parts.push(words.backBy((f?.back_by ?? q.back_by) as string));
      rows.push({ mark: 'B', kind: 'back', place: words.backAt(trip.start.name), parts });
    }
    return {
      date: f?.date,
      leaveBy: trip.leave_by ?? f?.time,
      rows,
      totals: trip.timeline ? { km: trip.timeline.totals.km, driveMin: trip.timeline.totals.drive_min, ends } : undefined,
    };
  }
  // The old shape: From → To with the asked time and back-by.
  if (f?.route_from) rows.push({ mark: 'S', kind: 'start', place: f.route_from, parts: f.time ? [words.leave(f.time)] : [] });
  if (f?.route_to) rows.push({ mark: '1', kind: 'stop', place: f.route_to, parts: [] });
  if (f?.back_by) rows.push({ mark: 'B', kind: 'back', place: f.route_from ? words.backAt(f.route_from) : '', parts: [words.backBy(f.back_by)] });
  return { date: f?.date, leaveBy: f?.time, rows };
}

/** The legs' km and minutes added up, for "94 km · 2 h 51 min" when the timeline has no totals. */
export function legTotals(items: readonly TimelineItem[]): { km: number; driveMin: number } {
  let km = 0, driveMin = 0;
  for (const it of items) if (it.kind === 'leg') {
    km += it.km;
    driveMin += it.minutes;
  }
  return { km: Math.round(km), driveMin: Math.round(driveMin) };
}

/** The availability call's arguments from the request's fields (the site's availabilityArgs); null until the day and time are known. */
export function availabilityArgs(q: Pick<RequestCard, 'fields' | 'trip'>): Record<string, unknown> | null {
  const f = q.fields;
  const date = f?.date?.trim() ?? '';
  const time = (q.trip?.leave_by ?? f?.time ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const args: Record<string, unknown> = { at: `${date} ${time}` };
  const until = f?.back_by?.trim();
  if (until && /^\d{2}:\d{2}$/.test(until) && until > time) args.until = until;
  if (f?.need_type?.trim()) args.need_type = f.need_type.trim();
  if (typeof f?.pax === 'number') args.pax = Math.max(0, Math.min(80, f.pax));
  const first = q.trip?.stops.find((s) => !s.is_start) ?? q.trip?.stops[0];
  if (first && first.lat !== undefined && first.lng !== undefined) {
    args.lat = first.lat;
    args.lng = first.lng;
  } else if (first?.place) args.first_stop = first.place.slice(0, 160);
  else if (f?.route_to?.trim()) args.first_stop = f.route_to.trim().slice(0, 160);
  return args;
}

/** The driver picked when the page opens: the proposal's driver (a proposed task), else the best match, else nobody. */
export function firstPick(q: Pick<RequestCard, 'proposed'>, avail: Pick<Availability, 'best' | 'drivers'> | null): string {
  if (q.proposed?.username) return q.proposed.username;
  if (q.proposed?.driver) {
    const d = avail?.drivers.find((x) => x.name === q.proposed?.driver);
    if (d?.username) return d.username;
  }
  if (avail?.best?.username) return avail.best.username;
  if (avail?.best?.name) return avail.drivers.find((x) => x.name === avail.best?.name)?.username ?? '';
  return '';
}

/** The rows in the design's order: free first by the ranking, then busy, then off duty. */
export function rankedDrivers(drivers: readonly AvailableDriver[]): AvailableDriver[] {
  const order = (d: AvailableDriver) => (d.free ? 0 : d.state === 'on_task' || d.state === 'on_duty' ? 1 : 2);
  return [...drivers].sort((a, b) => order(a) - order(b) || (a.rank ?? 99) - (b.rank ?? 99) || a.name.localeCompare(b.name));
}

/** "On duty · free all day · WP CAB-4521 HiAce · 1.7 km away": the parts the screen joins. */
export function driverParts(d: AvailableDriver): string[] {
  const parts: string[] = [];
  if (d.not_available) parts.push(d.not_available);
  else if (d.match_why) parts.push(d.match_why);
  else {
    parts.push(d.status_text);
    if (d.current_task) parts.push(d.current_task.title);
  }
  if (d.vehicle_note) parts.push(d.vehicle_note);
  return parts.filter(Boolean);
}

/** The pill on a row: best match, busy, off duty, not available, or nothing for a free driver. */
export function driverPill(d: AvailableDriver, bestUsername: string): 'best' | 'busy' | 'off_duty' | 'not_available' | null {
  if (d.not_available) return 'not_available';
  if (d.username && d.username === bestUsername && d.free) return 'best';
  if (d.free) return null;
  return d.state === 'off_duty' ? 'off_duty' : 'busy';
}

export type Decision = 'approve' | 'decline';

export interface DecideCall {
  tool: 'decide_request' | 'redecide_request';
  input: Record<string, unknown>;
}

/**
 * The call for a decision. A waiting request: decide_request. An approved booking the requester changed (status
 * changed): redecide_request with the version the page loaded (the server refuses a stale one: "already decided").
 */
export function decideCall(q: Pick<RequestCard, 'id' | 'status' | 'version' | 'driver_required'>, decision: Decision, pick: { driver?: string; vehicle?: string; reason?: string }): DecideCall {
  if (q.status === 'changed') {
    const input: Record<string, unknown> = { request_id: q.id, version: q.version ?? 0 };
    if (decision === 'decline') return { tool: 'redecide_request', input: { ...input, decision: 'decline', reason: pick.reason ?? '' } };
    if (pick.driver || pick.vehicle) return { tool: 'redecide_request', input: { ...input, decision: 'change', ...(pick.driver ? { driver: pick.driver } : {}), ...(pick.vehicle ? { vehicle: pick.vehicle } : {}) } };
    return { tool: 'redecide_request', input: { ...input, decision: 'keep' } };
  }
  const input: Record<string, unknown> = { request_id: q.id, decision };
  if (q.version !== undefined) input.version = q.version;
  if (decision === 'decline') input.reason = pick.reason ?? '';
  else {
    if (pick.driver) input.driver = pick.driver;
    if (pick.vehicle) input.vehicle = pick.vehicle;
  }
  return { tool: 'decide_request', input };
}

/** May Approve be pressed: a driver is picked, or the custodian drives (driver_required false). */
export const canApprove = (q: Pick<RequestCard, 'driver_required'>, driver: string): boolean => driver !== '' || q.driver_required === false;

/** The server refused because the request is decided already (its words say by whom): the card is read again. */
export const alreadyDecided = (e: FleetError | null | undefined): boolean =>
  e?.code === 'tool_error' && /already|decided|just now|opened it|edited|changed again/i.test(e.message);

/** The decline reasons' words for the office (the site and Claude read them), whatever the phone's language. */
export const DECLINE_TEXT: Record<'no_vehicle' | 'not_approved' | 'other', string> = { no_vehicle: 'No vehicle free then', not_approved: 'Not approved', other: 'Other' };

/** What a declined reason sends: the reason's words and the note. */
export function declineReason(label: string, note: string): string {
  return [label, note.trim()].filter(Boolean).join(' — ').slice(0, 300);
}
