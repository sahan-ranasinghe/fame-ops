// Office mode (Phase 8, O2): the trip editor's words in both languages. The copied logic (the site's) speaks English in
// its reasons and checks; the common sentences are said through i18n keys here (the rest, the server's own warnings,
// as they come). Pure (scripts/test-trip.ts).

import type { Translate } from '@/lib/durations';
import type { DepartureCheck } from './departureLogic';
import type { TimelineItem } from '../types';
import { durationText } from '@/lib/durations';
import type { PlanReason } from './planLogic';
import { sentenceText } from '../statusWords';


/** A reason from planReasons / stopsInput / tripRequestInput in the phone's language, or as it came. */
export function reasonText(t: Translate, text: string): string {
  if (/^Add a date\.?$/.test(text) || /^Add the day\.?$/.test(text)) return t('office.trip.reasonDate');
  if (/^Add at least one stop/.test(text)) return t('office.trip.reasonStop');
  if (/^Add a leave-by time/.test(text)) return t('office.trip.reasonLeave');
  let m = /^Stop (\d+): (?:needs a place|add a place)/.exec(text);
  if (m) return t('office.trip.reasonStopPlace', { n: m[1] });
  m = /^(.+?) has no pin — add one\.$/.exec(text);
  if (m) return t('office.trip.reasonNoPin', { place: m[1] });
  if (/^No base place set/.test(text)) return t('office.trip.reasonNoBase');
  if (/^No routing key/.test(text)) return t('office.trip.reasonEstimate');
  if (/^Nothing changed\.?$/.test(text)) return t('office.trip.nothingChanged');
  if (/^Pick a driver\.$/.test(text)) return t('office.trip.needDriver');
  if (/^Pick a vehicle: this driver holds none today/.test(text)) return t('office.trip.needVehicle');
  // Round 3: Who drives? (the site's whoDrivesLogic.ts and requestLogic.ts say these).
  if (/ it: pick the vehicle \(nobody confirms one on the day\)\.$/.test(text)) return t('office.who.needPlate');
  if (text === 'Someone else drives: type their name.') return t('office.who.needName');
  if (/^Someone else drives: type their phone/.test(text) || /^Their phone: /.test(text)) return t('office.who.needPhone');
  // The server's own sentences (the plan's and the assign warnings) as statusWords reads them; else as they came.
  return sentenceText(t, text);
}

export const reasonLines = (t: Translate, reasons: readonly PlanReason[]): { text: string; note: boolean }[] =>
  reasons.map((r) => ({ text: reasonText(t, r.text), note: !!r.note }));

/** The departure check's sentence (the site composes it in English; the parts are read back for the phone's language). */
export function departureText(t: Translate, c: DepartureCheck): string {
  if (c.kind === 'fill') return '';
  if (c.kind === 'early') return t('office.trip.earlyBy', { dur: durPart(c.text) || String(c.minutes) });
  let m = /^Leaving (\d{2}:\d{2}) you reach (.+?) at (\d{2}:\d{2}), (.+?) after (\d{2}:\d{2})\. Leave by (\d{2}:\d{2})\.$/.exec(c.text);
  if (m) return t('office.trip.lateAfter', { leave: m[1], place: m[2], arrive: m[3], dur: m[4], by: m[5], use: m[6] });
  m = /^Leaving (\d{2}:\d{2}) you reach (.+?) at (\d{2}:\d{2}), just at (\d{2}:\d{2})\. Leave by (\d{2}:\d{2})\.$/.exec(c.text);
  if (m) return t('office.trip.justAt', { leave: m[1], place: m[2], arrive: m[3], by: m[4], use: m[5] });
  m = /^Leaving (\d{2}:\d{2}) you reach (.+?) at (\d{2}:\d{2}), only (.+?) before (\d{2}:\d{2})\. Leave by (\d{2}:\d{2})\.$/.exec(c.text);
  if (m) return t('office.trip.onlyBefore', { leave: m[1], place: m[2], arrive: m[3], dur: m[4], by: m[5], use: m[6] });
  m = /^Leaving (\d{2}:\d{2}) you are back at (\d{2}:\d{2}), (.+?) after (\d{2}:\d{2})\. Leave by (\d{2}:\d{2})\.$/.exec(c.text);
  if (m) return t('office.trip.backAfter', { leave: m[1], arrive: m[2], dur: m[3], by: m[4], use: m[5] });
  m = /^Leaving (\d{2}:\d{2}) you finish at (.+?) at (\d{2}:\d{2}), (.+?) after (\d{2}:\d{2})\. Leave by (\d{2}:\d{2})\.$/.exec(c.text);
  if (m) return t('office.trip.finishAfter', { leave: m[1], place: m[2], arrive: m[3], dur: m[4], by: m[5], use: m[6] });
  return c.text;
}

/** "36 min too late" for the red field label: the minutes between the typed time and the one to leave by. */
export function lateByText(t: Translate, c: DepartureCheck | null, typed: string): string | null {
  if (!c || c.kind !== 'late') return null;
  const a = toMin(typed), b = toMin(c.leaveBy);
  if (a === null || b === null || a <= b) return null;
  return t('office.trip.tooLate', { min: a - b });
}

const toMin = (v: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(v.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const durPart = (text: string): string => /(\d+ h(?: \d+ min)?|\d+ min)/.exec(text)?.[1] ?? '';

/** A stop row's line in the phone's language: "arrive 09:00 · 1 h 30 min (usual here) · leave 10:30"; the start: "leave 07:24 · passengers get in here". */
export function stopTimesT(t: Translate, s: Extract<TimelineItem, { kind: 'stop' }>): string {
  if (s.is_start) return [t('office.trip.rowLeave', { time: s.planned_leave }), t('office.trip.rowPassengers')].join(' · ');
  const stay = `${durationText(t, Math.max(0, s.dwell_min))}${s.dwell_source === 'place' ? ` (${t('office.trip.rowUsualHere')})` : ''}`;
  return [t('office.trip.rowArrive', { time: s.planned_arrive }), stay, t('office.trip.rowLeave', { time: s.planned_leave })].join(' · ');
}

/** A leg row's line: "From Head office · 42 km · 1 h 5 min · Google traffic", "Back to the base · …". */
export function legTextT(t: Translate, l: Extract<TimelineItem, { kind: 'leg' }>, startName?: string): string {
  const km = Math.round(l.km * 10) / 10;
  const head = l.from_n === 'start' ? t('office.trip.rowFromStart', { place: startName || t('office.trip.rowTheStart') }) : l.to_n === 'base' ? t('office.trip.rowBackToBase') : '';
  const src = ['google', 'ors', 'estimate'].includes(l.source) ? t(`office.trip.legSource_${l.source}`) : l.source;
  return [head, t('office.trip.kmN', { km }), durationText(t, l.minutes), src].filter(Boolean).join(' · ');
}
