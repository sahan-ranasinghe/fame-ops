// Office mode (Phase 8, O2): the Who step's rules, pure (scripts/test-trip.ts).

import { firstStopOf, type StopDraft } from './stopsLogic';

/**
 * Round 48: the plan's end as HH:MM from a plan preview (the timeline's "ends", else the plan's ends_at "YYYY-MM-DD HH:MM");
 * '' without a plan. The site's planEndOf.
 */
export function planEndOf(preview: { timeline?: { totals?: { ends?: string } }; plan?: { ends_at?: string } } | null | undefined): string {
  const ends = preview?.timeline?.totals?.ends ?? preview?.plan?.ends_at ?? '';
  const m = /(\d{2}:\d{2})$/.exec(String(ends).trim());
  return m ? m[1] : '';
}

/**
 * Who's available at the leave-by, until back-by, nearest the first stop (the site's availabilityArgs with floorTo5).
 * Round 48 (Google Calendar's room picker): with no back-by, the plan's end (`extra.plannedEnd`) goes as planned_end, so
 * the window is the trip's and not the rest of the day.
 */
export function whoArgs(f: { date: string; leaveBy: string; end: string; stops: StopDraft[]; start: string; startLat?: number; startLng?: number; startPax?: boolean }, extra: { base?: string; need?: string; pax?: string; plannedEnd?: string } = {}): Record<string, unknown> | null {
  const m = /^(\d{2}):(\d{2})$/.exec(f.leaveBy.trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || !m) return null;
  const time = `${m[1]}:${String(Math.floor(Number(m[2]) / 5) * 5).padStart(2, '0')}`;
  const args: Record<string, unknown> = { at: `${f.date} ${time}` };
  if (/^\d{2}:\d{2}$/.test(f.end.trim()) && f.end.trim() > time) args.until = f.end.trim();
  else if (extra.plannedEnd && /^\d{2}:\d{2}$/.test(extra.plannedEnd) && extra.plannedEnd > time) args.planned_end = extra.plannedEnd;
  // The first stop is the start only when passengers get in there (the site's rule), else the first row.
  const first = firstStopOf(f.stops, f.startPax ? { name: f.start.trim() || extra.base || '', lat: f.startLat, lng: f.startLng } : null);
  if (first?.lat !== undefined && first.lng !== undefined) {
    args.lat = first.lat;
    args.lng = first.lng;
  } else if (first?.place) args.first_stop = first.place.slice(0, 160);
  if (extra.need?.trim()) args.need_type = extra.need.trim();
  if (extra.pax?.trim()) args.pax = Math.max(0, Math.min(80, parseInt(extra.pax, 10) || 0));
  return args;
}

