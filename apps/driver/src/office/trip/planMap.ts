// Office mode (Phase 8, O2): the plan on the map (design 09) through the driver app's own task map (components/TaskMap.tsx:
// both engines, Google's line on Google's map only, openrouteservice's on either, dashed straight lines otherwise). The
// map reads a task with its stops and plan_json; a plan_task preview is shaped into one here: only the fields the map
// reads (taskMapLogic.ts: task_stops' id, seq, lat, lng, status, arrive_by, planned_arrive_at, is_start,
// google_place_id; plan_json.legs' from_seq, to_seq, source, line; the start's pin). Pure (scripts/test-trip.ts).

import type { TaskWithStops } from '@/lib/types';
import type { PlanPreview, TimelineItem } from '../types';

/** "09:15" on the plan's day as an ISO time in Colombo, as a stored task would carry it. */
export const isoOn = (date: string, hhmm: string | undefined): string | null =>
  date && hhmm && /^\d{2}:\d{2}$/.test(hhmm) ? `${date}T${hhmm}:00+05:30` : null;

/** The map's view of a preview: a task-shaped object (the map never writes it). */
export function previewTask(p: PlanPreview): TaskWithStops {
  const date = p.date;
  const stops = p.stops.map((s, i) => ({
    id: `preview-${s.seq}`,
    task_id: 'preview',
    seq: s.seq,
    type: s.type,
    what: s.what ?? null,
    place_id: null,
    place_name: s.place ?? '',
    address: null,
    lat: s.lat ?? null,
    lng: s.lng ?? null,
    status: 'pending',
    arrive_by: isoOn(date, s.arrive_by),
    planned_arrive_at: isoOn(date, s.planned_arrive),
    planned_depart_at: isoOn(date, s.planned_depart ?? s.planned_leave),
    is_start: s.is_start === true,
    google_place_id: s.google ? `preview-google-${i}` : null,
  }));
  const legs = (p.timeline?.items ?? []).flatMap((it: TimelineItem) =>
    it.kind === 'leg'
      ? [{
        from_seq: it.from_n === 'start' ? 0 : seqOfN(p, it.from_n),
        to_seq: it.to_n === 'base' ? -1 : seqOfN(p, it.to_n),
        km: it.km,
        line: it.line ?? null,
        source: it.source,
      }]
      : []);
  const task = {
    id: 'preview',
    title: '',
    status: 'assigned',
    start_at: isoOn(date, p.leave_by),
    leave_by: isoOn(date, p.leave_by),
    start_name: p.start?.name ?? null,
    start_lat: p.start?.lat ?? null,
    start_lng: p.start?.lng ?? null,
    start_google_place_id: p.start?.google ? 'preview-google-start' : null,
    return_to_base: false,
    plan_json: { legs },
    task_stops: stops,
  };
  return task as unknown as TaskWithStops;
}

/** The seq of the stop numbered n in the preview (the timeline names stops by their number). */
function seqOfN(p: PlanPreview, n: number): number {
  const s = p.stops.find((x) => x.n === n) ?? p.stops[n - 1];
  return s ? s.seq : n;
}
