// Office mode (Stage 1, O3 row 1): Approve's Change time, the rules only (pure: no react-native, no i18n). The approver
// may move a waiting request to another day, another leave-by and another back-by, change where the trip starts and the
// minutes at From and To (a request asked as From / To, without its own stops), as decide_request takes them (Phase 7
// §11, §17, §33). Only what differs from the request is sent: a new day or leave-by plans the trip again on the server,
// the stops stay as asked. A changed booking (redecide_request) takes the day, the leave time and the back-by only. Who's
// available is asked at the new time. The website does the same (approvalLogic.ts timeChanges, requestLogic.ts
// dwellChanges).

import type { Picked } from './trip/locationLogic';
import type { RequestCard } from './types';

export interface Asked {
  date: string;
  leaveBy: string;
  back: string;
  fromDwell: number | null;
  toDwell: number | null;
}

/** What the approver changed; absent = as asked. A dwell of null = back to the usual time (not sent). */
export interface TimeChange {
  date?: string;
  leaveBy?: string;
  back?: string;
  fromDwell?: number | null;
  toDwell?: number | null;
  start?: Picked;
}

/** The request's times as asked (the plan's leave-by when it has one). */
export function askedOf(q: Pick<RequestCard, 'fields' | 'trip'>): Asked {
  const f = q.fields;
  return {
    date: f?.date ?? '',
    leaveBy: q.trip?.leave_by ?? f?.time ?? '',
    back: f?.back_by ?? '',
    fromDwell: typeof f?.from_dwell_min === 'number' ? f.from_dwell_min : null,
    toDwell: typeof f?.to_dwell_min === 'number' ? f.to_dwell_min : null,
  };
}

/** A request asked as From / To (no stops of its own): the minutes at each place may be changed. */
export const asksFromTo = (q: Pick<RequestCard, 'fields'>): boolean => !(q.fields?.stops?.length) && !!(q.fields?.route_from || q.fields?.route_to);

/** The times shown: changed, else as asked. */
export function shownOf(c: TimeChange | null | undefined, a: Asked): Asked {
  return {
    date: c?.date ?? a.date,
    leaveBy: c?.leaveBy ?? a.leaveBy,
    back: c?.back ?? a.back,
    fromDwell: c && 'fromDwell' in c ? c.fromDwell ?? null : a.fromDwell,
    toDwell: c && 'toDwell' in c ? c.toDwell ?? null : a.toDwell,
  };
}

const isDate = (s: string | undefined) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: string | undefined) => !!s && /^\d{2}:\d{2}$/.test(s);

/** decide_request's extra fields: only what differs from the request (and is well formed). */
export function decideTimes(c: TimeChange | null | undefined, a: Asked): Record<string, unknown> {
  if (!c) return {};
  const out: Record<string, unknown> = {};
  if (isDate(c.date) && c.date !== a.date) out.date = c.date;
  if (isTime(c.leaveBy) && c.leaveBy !== a.leaveBy) out.leave_by = c.leaveBy;
  if (isTime(c.back) && c.back !== a.back) out.back_by = c.back;
  if (typeof c.fromDwell === 'number' && c.fromDwell !== a.fromDwell) out.from_dwell_min = Math.max(0, Math.min(720, Math.round(c.fromDwell)));
  if (typeof c.toDwell === 'number' && c.toDwell !== a.toDwell) out.to_dwell_min = Math.max(0, Math.min(720, Math.round(c.toDwell)));
  if (c.start && c.start.name.trim()) {
    out.start = {
      ...(c.start.placeId ? { place_id: c.start.placeId } : c.start.googlePlaceId ? { google_place_id: c.start.googlePlaceId } : {}),
      place: c.start.name.trim().slice(0, 160),
      ...(!c.start.placeId && !c.start.googlePlaceId && typeof c.start.lat === 'number' && typeof c.start.lng === 'number' ? { lat: c.start.lat, lng: c.start.lng } : {}),
    };
  }
  return out;
}

/** redecide_request's fields for a changed booking: the day, the leave time (`time`) and the back-by only. */
export function redecideTimes(c: TimeChange | null | undefined, a: Asked): Record<string, unknown> {
  const d = decideTimes(c ? { date: c.date, leaveBy: c.leaveBy, back: c.back } : null, a);
  return { ...(d.date ? { date: d.date } : {}), ...(d.leave_by ? { time: d.leave_by } : {}), ...(d.back_by ? { back_by: d.back_by } : {}) };
}

/** Anything to send. */
export const hasChange = (c: TimeChange | null | undefined, a: Asked): boolean => Object.keys(decideTimes(c, a)).length > 0;

/** Why "Use these times" is not ready: a back-by not after the leave-by. */
export function timeProblem(s: Pick<Asked, 'leaveBy' | 'back'>): 'backBeforeLeave' | null {
  return isTime(s.leaveBy) && isTime(s.back) && s.back <= s.leaveBy ? 'backBeforeLeave' : null;
}

/** Who's available at the times shown (the request's own args with the new day, leave and back). */
export function availabilityAt(base: Record<string, unknown> | null, s: Asked): Record<string, unknown> | null {
  if (!base || !isDate(s.date) || !isTime(s.leaveBy)) return base;
  const out: Record<string, unknown> = { ...base, at: `${s.date} ${s.leaveBy}` };
  delete out.until;
  if (isTime(s.back) && s.back > s.leaveBy) out.until = s.back;
  return out;
}

/** The minutes a dwell chip offers (0 = no wait; the website's DwellPicker choices). */
export const DWELL_CHOICES = [0, 15, 30, 60, 90, 120, 180, 240] as const;
