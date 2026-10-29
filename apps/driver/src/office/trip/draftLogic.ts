// Office mode (Phase 8, O2): the trip editor's draft, the pure part (scripts/test-trip.ts); the store is draft.ts. The draft (designs 06–09), one for the whole phone, kept in the kv store so a
// flow left half-way is there when the app opens again (Sahan's brief: the draft is kept). One flow, three entries:
//   request  "Request a vehicle" (request permission): create_request
//   task     "Assign a task" (assign_tasks): create_task (the driver and vehicle on the Who step)
//   edit     a request of mine on My trips: update_request with its version
// The fields are the site's (tripLogic / assignLogic / requestLogic, copied): the trip part is one shape for all three;
// the task's own fields live beside it, the request's own beside that.

import { addDays, colomboDate } from '@/lib/time';
import type { RequestCard } from '../types';
import { type AssignFields, emptyAssign, type ProjectRow } from './assignLogic';
import { editFields, type RequestFields } from './requestLogic';
import { openStops } from './stopsLogic';
import type { TripFields } from './tripLogic';
import type { WhoDrivesValue } from './whoDrivesLogic';
import { whoOfDraft } from './whoWords';

export type TripMode = 'request' | 'task' | 'edit' | 'stops';
export type Step = 'where' | 'when' | 'who' | 'review';
export const STEPS: Step[] = ['where', 'when', 'who', 'review'];

/** The request's own fields (RequestFields minus the trip). */
export interface RequestExtras {
  behalf: string;
  project: string;
  need: string;
  tools: boolean;
  note: string;
  requesterPhone: string;
  /** Round 3: "Who drives?" (a driver, I'll drive myself, someone else with a name and a phone), for a request and a task
   *  alike (the site's whoDrivesLogic.ts); a draft saved before the shared rules has { choice } (whoWords.whoOfDraft). */
  who?: WhoDrivesValue;
}

export interface TripDraft {
  mode: TripMode;
  /** edit: the request and the version the draft started from, and its fields as they were (only the changes are sent). */
  requestId?: string;
  version?: number;
  was?: RequestFields;
  /** Round 4–7 (item 10): edit of someone else's request: the request id, so the place boxes add the requester's recent. */
  forRequest?: string;
  /** stops: the task whose stops are changed, the plan version it was shown with, and the stops already reached (they keep their numbers). */
  taskId?: string;
  planVersion?: number;
  reached?: number;
  /** task: the picked driver's name beside the username in fields.driver (Review and the alert name the person). */
  driverName?: string;
  /** task: the picked driver's WhatsApp link (from Who's available, for people who may see numbers): "WhatsApp the driver" after sending. */
  driverWhatsapp?: string;
  /** request (Book now, with book_vehicle) and task: what Review needs beside fields.driver / fields.vehicle: the driver's
   *  default vehicle (null = known to bring none; undefined = not known yet). */
  book?: { defaultVehicle?: string | null };
  /** stops: the task is under way (no leave-by to change). edit: the request was approved (a change needs re-approval). */
  running?: boolean;
  wasApproved?: boolean;
  /** The trip and the task's own fields (the request mode leaves the task's empty). */
  fields: AssignFields;
  req: RequestExtras;
  rows: ProjectRow[];
  /** The step last shown. */
  step: Step;
  /** When it was last changed (ms). */
  at: number;
  /** request: made by "Request again" from this expired request (Round 3, A6): Where keeps it, no "Resume draft?" asked. */
  againOf?: string;
}

export const emptyExtras = (): RequestExtras => ({ behalf: '', project: '', need: '', tools: false, note: '', requesterPhone: '' });

export function newDraft(mode: TripMode, date = colomboDate()): TripDraft {
  return { mode, fields: emptyAssign(date), req: emptyExtras(), rows: [], step: 'where', at: Date.now() };
}

/** O3 row 7: a fresh task draft for one driver (Assign a task from their page): the driver picked, their name for Review. */
export function withDriver(d: TripDraft, username?: string, name?: string): TripDraft {
  const u = username?.trim();
  if (d.mode !== 'task' || !u) return d;
  return { ...d, fields: { ...d.fields, driver: u }, ...(name?.trim() ? { driverName: name.trim() } : {}) };
}

/**
 * Round 3 (A6), "Request again" on an expired request: a fresh Request a vehicle with everything the request asked (the
 * route or the stops and the start, the times, passengers, vehicle type, tools, the note, who drives, the project, on behalf
 * of) except the day, which is tomorrow (editable on When). Airbnb's and Uber's "Book again".
 */
export function requestAgainDraft(q: Pick<RequestCard, 'id' | 'fields' | 'note' | 'requester_phone' | 'trip' | 'project'>, today: string): TripDraft {
  const date = addDays(today, 1);
  const { behalf, project: _p, need, tools, note, requesterPhone, who, ...trip } = editFields(q);
  return {
    ...newDraft('request', date),
    againOf: q.id,
    fields: { ...emptyAssign(date), ...trip, date },
    req: { behalf, project: q.project ?? '', need, tools, note, requesterPhone: requesterPhone ?? '', who },
  };
}

/** The request's fields as the copied requestLogic takes them (create_request, update_request). */
export function requestFieldsOf(d: Pick<TripDraft, 'fields' | 'req'>): RequestFields {
  const { title: _t, buffer: _b, driver: _d, vehicle: _v, cname: _cn, cphone: _cp, notes: _n, whatsapp: _w, ...trip } = d.fields;
  return { ...(trip as TripFields & { pax: string }), behalf: d.req.behalf, project: d.req.project, need: d.req.need, tools: d.req.tools, note: d.req.note, who: whoOfDraft(d.req), requesterPhone: d.req.requesterPhone };
}

/**
 * Fix B (29 October 2026): a draft opened again (resumed on the Where step, or read back from the phone) comes without its
 * empty rows, and a row whose type is not its place's keeps it (openStops, the shared rule). Doing it twice changes nothing.
 */
export function openedDraft(d: TripDraft): TripDraft {
  if (!Array.isArray(d.fields?.stops)) return d;
  return { ...d, fields: { ...d.fields, stops: openStops(d.fields.stops) } };
}

/** A draft worth asking about when a flow starts again: something typed, less than a day old. */
export function draftWorthKeeping(d: TripDraft | null, now = Date.now()): boolean {
  if (!d) return false;
  if (now - d.at > 24 * 3_600_000) return false;
  const f = d.fields;
  return f.stops.some((s) => s.place.trim() || s.placeId || s.googlePlaceId || s.arriveBy) || !!f.leaveBy || !!f.title.trim() || !!f.start.trim();
}

/** The step after this one, and the one before; a task's stops (mode stops) have no Who: When goes straight to Review. */
export const nextStep = (s: Step, mode: TripMode = 'request'): Step | null =>
  s === 'where' ? 'when' : s === 'when' ? (mode === 'stops' ? 'review' : 'who') : s === 'who' ? 'review' : null;
export const prevStep = (s: Step, mode: TripMode = 'request'): Step | null =>
  s === 'review' ? (mode === 'stops' ? 'when' : 'who') : s === 'who' ? 'when' : s === 'when' ? 'where' : null;
export const stepIndex = (s: Step): number => STEPS.indexOf(s);
