// Office mode (Phase 8, O2): the trip editor's draft, the pure part (scripts/test-trip.ts); the store is draft.ts. The draft (designs 06–09), one for the whole phone, kept in the kv store so a
// flow left half-way is there when the app opens again (Sahan's brief: the draft is kept). One flow, three entries:
//   request  "Request a vehicle" (request permission): create_request
//   task     "Assign a task" (assign_tasks): create_task (the driver and vehicle on the Who step)
//   edit     a request of mine on My trips: update_request with its version
// The fields are the site's (tripLogic / assignLogic / requestLogic, copied): the trip part is one shape for all three;
// the task's own fields live beside it, the request's own beside that.

import { colomboDate } from '@/lib/time';
import { type AssignFields, emptyAssign, type ProjectRow } from './assignLogic';
import { type RequestFields } from './requestLogic';
import type { TripFields } from './tripLogic';

export type TripMode = 'request' | 'task' | 'edit' | 'stops';
export type Step = 'where' | 'when' | 'who' | 'review';
export const STEPS: Step[] = ['where', 'when', 'who', 'review'];

/** The request's own fields (RequestFields minus the trip and `driver`, which is a boolean there). */
export interface RequestExtras {
  behalf: string;
  project: string;
  need: string;
  tools: boolean;
  note: string;
  /** Unticked = the vehicle's custodian drives (no driver needed). */
  driverRequired: boolean;
  requesterPhone: string;
}

export interface TripDraft {
  mode: TripMode;
  /** edit: the request and the version the draft started from, and its fields as they were (only the changes are sent). */
  requestId?: string;
  version?: number;
  was?: RequestFields;
  /** stops: the task whose stops are changed, the plan version it was shown with, and the stops already reached (they keep their numbers). */
  taskId?: string;
  planVersion?: number;
  reached?: number;
  /** task: the picked driver's name beside the username in fields.driver (Review and the alert name the person). */
  driverName?: string;
  /** The trip and the task's own fields (the request mode leaves the task's empty). */
  fields: AssignFields;
  req: RequestExtras;
  rows: ProjectRow[];
  /** The step last shown. */
  step: Step;
  /** When it was last changed (ms). */
  at: number;
}

export const emptyExtras = (): RequestExtras => ({ behalf: '', project: '', need: '', tools: false, note: '', driverRequired: true, requesterPhone: '' });

export function newDraft(mode: TripMode, date = colomboDate()): TripDraft {
  return { mode, fields: emptyAssign(date), req: emptyExtras(), rows: [], step: 'where', at: Date.now() };
}

/** The request's fields as the copied requestLogic takes them (create_request, update_request). */
export function requestFieldsOf(d: Pick<TripDraft, 'fields' | 'req'>): RequestFields {
  const { title: _t, buffer: _b, driver: _d, vehicle: _v, cname: _cn, cphone: _cp, notes: _n, whatsapp: _w, ...trip } = d.fields;
  return { ...(trip as TripFields & { pax: string }), behalf: d.req.behalf, project: d.req.project, need: d.req.need, tools: d.req.tools, note: d.req.note, driver: d.req.driverRequired, requesterPhone: d.req.requesterPhone };
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
