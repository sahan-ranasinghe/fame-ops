// Office mode (Phase 8, O1): Home's pure rules (designs 02–05), tested in scripts/test-office.ts: the greeting by the
// Colombo hour, a request card's one line, a task card's line and pill, a trip's pill, and the status pill's tone.

import { colomboHour } from '@/lib/time';
import type { Tone } from './ui';
import type { BoardCard, CreatedTaskCard, RequestCard, TripLive } from './types';

export type Greeting = 'morning' | 'afternoon' | 'evening';

/** Morning until 12:00, afternoon until 17:00, then evening (Colombo). */
export function greeting(at: Date | number = Date.now()): Greeting {
  const h = colomboHour(at);
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

/** A request card's title: a proposed task's title, else its route, else the project or who asked. */
export function requestTitle(r: Pick<RequestCard, 'title' | 'route' | 'project' | 'requested_by'>): string {
  return r.title || r.route || r.project || r.requested_by;
}

/** "Nimali · Tue 20 Oct 08:30 · 3 passengers · any van" (design 04). */
export function requestLine(r: Pick<RequestCard, 'requested_by' | 'when' | 'need' | 'proposed'>): string {
  const parts = [r.requested_by, r.when, r.need];
  if (r.proposed?.driver) parts.push(`${r.proposed.driver}${r.proposed.vehicle ? ` · ${r.proposed.vehicle}` : ''}`);
  return parts.filter(Boolean).join(' · ');
}

/** The status word's tone (the designs' colours). */
export function statusTone(status: string | undefined): Tone {
  switch (status) {
    case 'in_progress':
    case 'on_the_way':
    case 'under_way':
    case 'arrived':
      return 'blue';
    case 'completed':
    case 'approved':
    case 'accepted':
      return 'green';
    case 'waiting':
    case 'changed':
    case 'assigned':
      return 'amber';
    case 'declined':
    case 'cancelled':
    case 'missed':
      return 'red';
    default:
      return 'muted';
  }
}

/** A board card's pill: accepted when the driver has, else its status; "running late N min" wins while under way. */
export function boardPill(c: Pick<BoardCard, 'status' | 'accepted' | 'late_min'>): { key: string; tone: Tone; min?: number } {
  if (c.status === 'in_progress' && c.late_min && c.late_min > 0) return { key: 'late', tone: 'red', min: c.late_min };
  if (c.status === 'assigned' && c.accepted) return { key: 'accepted', tone: 'green' };
  return { key: c.status ?? 'assigned', tone: statusTone(c.status) };
}

/** "Sunil · WP CAB-4521 · 4 pax" (design 03); the passengers come in the person's words (office.trip.paxN). */
export function boardLine(c: Pick<BoardCard, 'driver' | 'vehicle' | 'vehicle_text'>, pax?: string): string {
  return [c.driver, c.vehicle || c.vehicle_text, pax ?? ''].filter(Boolean).join(' · ');
}

export const isCreatedTask = (t: RequestCard | CreatedTaskCard): t is CreatedTaskCard => (t as CreatedTaskCard).source === 'task';

/** A trip's title and line on Home and My trips. */
export function tripTitle(t: RequestCard | CreatedTaskCard): string {
  return isCreatedTask(t) ? t.title : requestTitle(t);
}

export function tripLive(t: RequestCard | CreatedTaskCard): TripLive {
  if (isCreatedTask(t)) return t.live;
  return t.live ?? { state: t.status === 'approved' ? 'approved' : t.status === 'changed' ? 'waiting' : t.status, text: t.status };
}
