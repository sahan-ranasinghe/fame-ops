// Office mode (Phase 8, O2): the Who step's rules, pure (scripts/test-trip.ts).

import { firstStopOf, type StopDraft } from './stopsLogic';

/** Who's available at the leave-by, until back-by, nearest the first stop (the site's availabilityArgs with floorTo5). */
export function whoArgs(f: { date: string; leaveBy: string; end: string; stops: StopDraft[]; start: string; startLat?: number; startLng?: number }): Record<string, unknown> | null {
  const m = /^(\d{2}):(\d{2})$/.exec(f.leaveBy.trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || !m) return null;
  const time = `${m[1]}:${String(Math.floor(Number(m[2]) / 5) * 5).padStart(2, '0')}`;
  const args: Record<string, unknown> = { at: `${f.date} ${time}` };
  if (/^\d{2}:\d{2}$/.test(f.end.trim()) && f.end.trim() > time) args.until = f.end.trim();
  const first = firstStopOf(f.stops, f.start.trim() ? { name: f.start, lat: f.startLat, lng: f.startLng } : null);
  if (first?.lat !== undefined && first.lng !== undefined) {
    args.lat = first.lat;
    args.lng = first.lng;
  } else if (first?.place) args.first_stop = first.place.slice(0, 160);
  return args;
}

