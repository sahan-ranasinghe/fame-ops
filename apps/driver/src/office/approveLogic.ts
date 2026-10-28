// Office mode (Phase 8, O1): Approve a request (design 10), the pure rules, tested in scripts/test-office.ts: the trip's
// rows from the request's plan, the summary line, Who's available's arguments, which driver is picked first, the decide
// input (decide_request for a waiting request, redecide_request with the version for a changed booking), the button's
// label, and what the server's "already decided" refusal means.

import { sentenceText } from './statusWords';
import { asksNoDriver } from './trip/whoWords';
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
  // Round 48: with no back-by the plan's end (the timeline's "ends") bounds the window: the trip's time, never the rest of the day.
  const ends = q.trip?.timeline?.totals?.ends?.trim();
  if (!args.until && ends && /^\d{2}:\d{2}$/.test(ends) && ends > time) args.planned_end = ends;
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

/**
 * The driver picked when the page opens: the proposal's driver (a proposed task), else the best match, else nobody.
 * Round 3: nobody for a request that asks for no driver (the asker drives, someone else does, or the custodian): the
 * approver picks the vehicle, and may still give a driver instead.
 */
export function firstPick(q: Pick<RequestCard, 'proposed' | 'driven_by' | 'driver_required'>, avail: Pick<Availability, 'best' | 'drivers'> | null): string {
  if (asksNoDriver(q)) return '';
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

/**
 * "On duty · free 08:00–12:00 · 0.4 km from the pickup · 1 task today": the parts the screen joins, every server sentence
 * in the person's language (Round 1 and Round 3: never the server's English on a Sinhala screen). The vehicle is the chip
 * under the name (vehicleChip), never the server's English vehicle_note.
 */
export function driverParts(d: AvailableDriver, t?: (key: string, vars?: Record<string, string | number>) => string): string[] {
  const say = (line: string) => (t ? sentenceText(t, line) : line);
  const parts: string[] = [];
  if (d.not_available) parts.push(say(d.not_available));
  else if (d.match_why) parts.push(say(d.match_why));
  else {
    parts.push(say(d.status_text));
    if (d.current_task) parts.push(d.current_task.title);
  }
  return parts.filter(Boolean);
}

/**
 * Round 3 (Uber Fleet's and Samsara's driver list: the person first, the vehicle under them): the chip under a driver's
 * name. The plate they hold today, or their regular one ("regular"); none known: "Vehicle: on the day" while the fleet
 * setting vehicle_on_the_day is on, else "No vehicle yet".
 */
export type VehicleChip = { kind: 'plate'; plate: string; regular: boolean } | { kind: 'on_the_day' } | { kind: 'none' };

export function vehicleChip(d: { vehicle?: { reg_no: string; source: 'on_duty' | 'regular' } | null }, onTheDay: boolean): VehicleChip {
  if (d.vehicle?.reg_no) return { kind: 'plate', plate: d.vehicle.reg_no, regular: d.vehicle.source === 'regular' };
  return onTheDay ? { kind: 'on_the_day' } : { kind: 'none' };
}

/** The chip's words beside the plate ("regular"), or instead of it; '' for a plate held today. */
export function vehicleChipText(c: VehicleChip, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (c.kind === 'plate') return c.regular ? t('office.who.regular') : '';
  return t(c.kind === 'on_the_day' ? 'office.who.vehicleOnTheDay' : 'office.who.noVehicleYet');
}

/**
 * The small line under a driver ("Last seen 17:42 near Kadawatha · usually starts 07:40"). The server's last_seen is
 * already a whole sentence that starts with "Last seen" (presence.ts lastSeenText): it is said in the person's words as it
 * is, never put inside another "Last seen {when}" (the "Last seen Last seen" doubling, Round 3).
 */
export function presenceLine(d: Pick<AvailableDriver, 'last_seen' | 'usual_start'>, t: (key: string, vars?: Record<string, string | number>) => string): string {
  return [d.last_seen ? sentenceText(t, d.last_seen) : '', d.usual_start ? t('office.trip.usuallyStarts', { time: d.usual_start }) : ''].filter(Boolean).join(' · ');
}

/**
 * The pill on a row: best match, busy, not available, or nothing for a free driver. Round 48 (Google Calendar's room
 * picker): a driver busy for the trip's window is BUSY whatever they do now; "off duty" was said for a busy driver off
 * duty now, which is the status now, not the trip's. The status now stays on the row's line (driverParts).
 */
export function driverPill(d: AvailableDriver, bestUsername: string): 'best' | 'busy' | 'off_duty' | 'not_available' | null {
  if (d.not_available) return 'not_available';
  if (d.username && d.username === bestUsername && d.free) return 'best';
  if (d.free) return null;
  return 'busy';
}

/**
 * Round 48: the trip's chip in the person's words: "Free Thu 29 Oct" / "Busy 09:00–13:00 that day · Team drop" (the
 * server's free_text / busy_text through statusWords), else the old pill word (busy / off duty) for an answer without them.
 */
export function tripChipText(d: Pick<AvailableDriver, 'free' | 'free_text' | 'busy_text' | 'not_available'>, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (d.free) return d.free_text ? sentenceText(t, d.free_text) : '';
  if (d.not_available) return sentenceText(t, d.not_available);
  return d.busy_text ? sentenceText(t, d.busy_text) : t('office.request.busy');
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

/**
 * What Approve still needs (Round 3), as an i18n key; null = it may be pressed. A request that asks for a driver (or the
 * approver gives one instead): a driver picked. A request the asker drives, someone else drives or the custodian drives,
 * approved as asked: the vehicle (a proposed task brings its own). The server refuses the rest (it used to be sent with
 * neither a driver nor a vehicle).
 */
export function approveProblem(q: Pick<RequestCard, 'driven_by' | 'driver_required' | 'kind' | 'proposed'> & { status?: RequestCard['status'] }, pick: { asAsked: boolean; driver: string; vehicle: string }): string | null {
  if (asksNoDriver(q) && pick.asAsked) {
    // A changed booking kept as asked keeps its task's vehicle (redecide_request keep).
    if (pick.vehicle || (q.kind === 'task' && q.proposed?.vehicle) || q.status === 'changed') return null;
    return 'office.who.pickVehicle';
  }
  return pick.driver ? null : 'office.trip.needDriver';
}

/** May Approve be pressed (the older rule, kept for the callers that only know the driver): a driver, or no driver asked. */
export const canApprove = (q: Pick<RequestCard, 'driver_required' | 'driven_by'>, driver: string): boolean => driver !== '' || asksNoDriver(q);

/** The server refused because the request is decided already (its words say by whom): the card is read again. */
export const alreadyDecided = (e: FleetError | null | undefined): boolean =>
  e?.code === 'tool_error' && /already|decided|just now|opened it|edited|changed again/i.test(e.message);

/** The decline reasons' words for the office (the site and Claude read them), whatever the phone's language. */
export const DECLINE_TEXT: Record<'no_vehicle' | 'not_approved' | 'other', string> = { no_vehicle: 'No vehicle free then', not_approved: 'Not approved', other: 'Other' };

/** What a declined reason sends: the reason's words and the note. */
export function declineReason(label: string, note: string): string {
  return [label, note.trim()].filter(Boolean).join(' — ').slice(0, 300);
}
