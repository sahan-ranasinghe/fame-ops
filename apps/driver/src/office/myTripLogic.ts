// Office mode and /m/ (Round 4–7, feature 4; phase8-plan.md §33.1): the rules of a trip nobody drives with the app, on the
// person's own account (my_trip: I'll drive myself, or Someone else drives it), and of the vehicle checks the office reads
// (a vehicle's page, a task, Issues). Pure (no react-native): the screens render what these decide, every word a key
// (the strings: src/i18n/parts/trip-close.json until the lead merges them). The site's twin: apps/office/src/screens/
// myTripLogic.ts (English inline); the same rules, checked by scripts/test-trip-close.ts.
//
// The person's side (Samsara / Motive's pre-trip inspection; Zipcar's and Turo's return):
// - the check: "Any damage or problem with <plate>?" No, all good (the four sides optional) or Yes, a problem (what it is,
//   1–6 photos, a note), and the odometer now (the vehicle's last reading prefilled, never under it). On the trip's day
//   from 2 h before its planned start the check starts the trip; earlier it is only recorded. The switch vehicle_check off
//   (my_trip's check_needed false): the odometer alone, which starts the trip from that time.
// - Trip finished? Enter the odometer: the odometer now (never under the start), the start when there is none (the
//   vehicle's last reading by default), the fuel added and an odometer photo (optional). A trip closed at 09:00 the next
//   day (Completed · not confirmed) is confirmed with the same form.

import type { CheckResult, MyTrip, ReportCategory, TripAction, VehicleCheck } from './types';

export interface Words {
  key: string;
  vars?: Record<string, string | number>;
}

/** The six kinds of problem (the driver's five and Damage), most likely first; their words: office.checks.cat.<kind>. */
export const CATEGORIES: readonly ReportCategory[] = ['damage', 'tyre', 'warning_light', 'breakdown', 'accident', 'other'];
export const categoryKey = (c: string | undefined): string => `office.checks.cat.${(CATEGORIES as readonly string[]).includes(c ?? '') ? c : 'other'}`;

/** The four sides of an all-good check (Turo's check-in photos); words office.checks.side.<side>. */
export const SIDES = ['front', 'back', 'left', 'right'] as const;
export type Side = (typeof SIDES)[number];

export const MIN_PROBLEM_PHOTOS = 1;
export const MAX_PROBLEM_PHOTOS = 6;
/** A typed odometer more than this over the last reading (or the start) is a typing mistake (the server's rule). */
export const MAX_TRIP_KM = 3000;
export const MAX_LITRES = 500;
export const MAX_LKR = 1_000_000;

/** The button on a My trips row, by what the trip asks of the person now. */
export const TRIP_ACTION_KEY: Record<TripAction, string> = {
  check: 'office.myTrip.action.check',
  finish: 'office.myTrip.action.finish',
  confirm: 'office.myTrip.action.confirm',
};

/** The task a My trips card's button opens (a request's task, or the created task itself). */
export const tripTaskId = (card: { task_id?: string; id: string; source?: string }): string | undefined =>
  card.task_id ?? (card.source === 'task' ? card.id : undefined);

export type TripMode = 'check' | 'finish' | 'confirm' | 'done' | 'cancelled' | 'other';

/**
 * What the page asks for: the check before setting off (not started, its day not over), the finish (started, asked, or
 * a day over with no check), the confirm (closed as Completed · not confirmed), else nothing.
 */
export function tripMode(t: Pick<MyTrip, 'state' | 'window'>): TripMode {
  switch (t.state) {
    case 'to_check':
      return t.window.past ? 'finish' : 'check';
    case 'on_the_way':
    case 'finish':
      return 'finish';
    case 'not_confirmed':
      return 'confirm';
    case 'done':
      return 'done';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'other';
  }
}

/** The plate, else the vehicle's words. */
export const plateOfTrip = (t: Pick<MyTrip, 'vehicle' | 'vehicle_label'>): string => t.vehicle || t.vehicle_label || '';

/** A typed number of km ("45 210", "45,210") as a whole number, or null. */
export function parseKm(text: string): number | null {
  const s = text.replace(/[\s,]/g, '');
  if (!/^\d{1,7}$/.test(s)) return null;
  return Number(s);
}

/** A typed amount ("12.5", "4,500"): the number, null when it is not one, '' when nothing is typed. */
export function parseAmount(text: string): number | null | '' {
  const s = text.replace(/[\s,]/g, '');
  if (s === '') return '';
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** "45,210": km in Latin digits with the thousands. */
export const kmText = (n: number): string => n.toLocaleString('en-US');

/** What is wrong with a typed odometer against the reading it must not be under (null = fine). */
export function odometerReason(typed: string, base: number | null | undefined, against: 'last' | 'start'): Words | null {
  if (!typed.trim()) return { key: 'office.myTrip.why.enterOdo' };
  const n = parseKm(typed);
  if (n === null) return { key: 'office.myTrip.why.wholeKm' };
  if (base != null && n < base) return { key: against === 'last' ? 'office.myTrip.why.underLast' : 'office.myTrip.why.underStart', vars: { km: kmText(base) } };
  if (base != null && n - base > MAX_TRIP_KM) return { key: against === 'last' ? 'office.myTrip.why.farLast' : 'office.myTrip.why.farStart', vars: { km: kmText(n - base) } };
  return null;
}

/** When the check starts the trip; `when` = the window's opening in words (the page's dateWords + the time). */
export function windowWords(t: Pick<MyTrip, 'window' | 'check_needed'>, when: string): Words {
  if (t.window.open) return { key: t.check_needed ? 'office.myTrip.windowOpen' : 'office.myTrip.windowOpenOdo' };
  return { key: t.check_needed ? 'office.myTrip.windowEarly' : 'office.myTrip.windowEarlyOdo', vars: { when } };
}

export interface CheckForm {
  /** 'odo' = the switch is off: the odometer alone. */
  result: CheckResult | 'odo';
  odometer: string;
  category: ReportCategory | '';
  note: string;
  /** The problem's photos already up (their ids). */
  photos: string[];
  /** The sides already up. */
  sides: { photo_id: string; side: Side }[];
  /** Photos still going up. */
  uploading: number;
}

export const emptyCheck = (t: Pick<MyTrip, 'last_odometer_km'>, result: CheckForm['result']): CheckForm => ({
  result,
  odometer: t.last_odometer_km != null ? String(t.last_odometer_km) : '',
  category: '',
  note: '',
  photos: [],
  sides: [],
  uploading: 0,
});

/** Why the check's button is not ready (null = ready). `when` as for windowWords. */
export function checkReason(t: Pick<MyTrip, 'check_needed' | 'window' | 'last_odometer_km'>, f: CheckForm, when: string): Words | null {
  if ((!t.check_needed || f.result === 'odo') && !t.window.open) return { key: 'office.myTrip.why.notYet', vars: { when } };
  if (f.result === 'problem') {
    if (!f.category) return { key: 'office.myTrip.why.category' };
    if (f.photos.length < MIN_PROBLEM_PHOTOS && f.uploading === 0) return { key: 'office.myTrip.why.photo' };
  }
  if (f.uploading > 0) return { key: 'office.myTrip.why.uploading' };
  return odometerReason(f.odometer, t.last_odometer_km, 'last');
}

/** The check's button words. */
export function checkButtonKey(t: Pick<MyTrip, 'window'>, f: Pick<CheckForm, 'result'>): string {
  if (f.result === 'odo') return 'office.myTrip.startTrip';
  if (!t.window.open) return f.result === 'problem' ? 'office.myTrip.sendProblem' : 'office.myTrip.saveCheck';
  return f.result === 'problem' ? 'office.myTrip.sendAndStart' : 'office.myTrip.startTrip';
}

/** my_trip_check's input (the check's id made by the screen, so a retry never doubles it). */
export function checkInput(taskId: string, checkId: string, f: CheckForm): Record<string, unknown> {
  const odometer = parseKm(f.odometer) ?? 0;
  if (f.result !== 'problem') {
    return { task_id: taskId, check_id: checkId, result: 'ok', odometer_km: odometer, ...(f.result === 'ok' && f.sides.length ? { sides: f.sides } : {}) };
  }
  const note = f.note.trim();
  return { task_id: taskId, check_id: checkId, result: 'problem', odometer_km: odometer, category: f.category, ...(note ? { note } : {}), photos: f.photos };
}

/** The line after a check: started (On the way · left 07:42) or only recorded (check again from …). */
export function checkDone(r: Pick<MyTrip, 'started_now' | 'started'>, when: string): Words {
  return r.started_now ? { key: 'office.myTrip.done.started', vars: { time: r.started ?? '' } } : { key: 'office.myTrip.done.recorded', vars: { when } };
}

export interface FinishForm {
  odometer: string;
  /** Only when the trip has no start reading (never checked): the vehicle's last reading by default. */
  start: string;
  litres: string;
  amount: string;
  photo: string | null;
  uploading: boolean;
}

export const emptyFinish = (t: Pick<MyTrip, 'last_odometer_km' | 'start_odometer_km'>): FinishForm => ({
  odometer: '',
  start: t.start_odometer_km == null && t.last_odometer_km != null ? String(t.last_odometer_km) : '',
  litres: '',
  amount: '',
  photo: null,
  uploading: false,
});

/** The trip has no start reading: the form asks it (the vehicle's last reading by default). */
export const needsStart = (t: Pick<MyTrip, 'start_odometer_km'>): boolean => t.start_odometer_km == null;

/** The start the finish is measured from: the trip's, else what is typed. */
export const startOf = (t: Pick<MyTrip, 'start_odometer_km'>, f: Pick<FinishForm, 'start'>): number | null => t.start_odometer_km ?? parseKm(f.start);

/** Why the finish's button is not ready (null = ready). */
export function finishReason(t: Pick<MyTrip, 'start_odometer_km'>, f: FinishForm): Words | null {
  if (needsStart(t)) {
    const s = odometerReason(f.start, null, 'start');
    if (s) return s.key === 'office.myTrip.why.enterOdo' ? { key: 'office.myTrip.why.enterStart' } : s;
  }
  const end = odometerReason(f.odometer, startOf(t, f), 'start');
  if (end) return end;
  const litres = parseAmount(f.litres);
  if (litres === null || (typeof litres === 'number' && (litres <= 0 || litres > MAX_LITRES))) return { key: 'office.myTrip.why.litres', vars: { max: MAX_LITRES } };
  const amount = parseAmount(f.amount);
  if (amount === null || (typeof amount === 'number' && amount > MAX_LKR)) return { key: 'office.myTrip.why.amount', vars: { max: kmText(MAX_LKR) } };
  if (f.uploading) return { key: 'office.myTrip.why.uploadingOne' };
  return null;
}

/** The km of the trip as typed so far, or null. */
export function tripKm(t: Pick<MyTrip, 'start_odometer_km'>, f: Pick<FinishForm, 'start' | 'odometer'>): number | null {
  const start = startOf(t, f);
  const end = parseKm(f.odometer);
  return start != null && end != null && end >= start ? end - start : null;
}

/** finish_my_trip's input. */
export function finishInput(taskId: string, t: Pick<MyTrip, 'start_odometer_km'>, f: FinishForm): Record<string, unknown> {
  const litres = parseAmount(f.litres);
  const amount = parseAmount(f.amount);
  const fuel = { ...(typeof litres === 'number' ? { litres } : {}), ...(typeof amount === 'number' ? { amount_lkr: amount } : {}) };
  const start = parseKm(f.start);
  return {
    task_id: taskId,
    odometer_km: parseKm(f.odometer) ?? 0,
    ...(needsStart(t) && start != null ? { start_odometer_km: start } : {}),
    ...(Object.keys(fuel).length ? { fuel } : {}),
    ...(f.photo ? { photo: f.photo } : {}),
  };
}

/** The line after the finish: "Trip finished · 42 km" (· confirmed). */
export function finishDone(km: number | null | undefined, confirm: boolean): Words {
  if (km == null) return { key: confirm ? 'office.myTrip.done.confirmedNoKm' : 'office.myTrip.done.finishedNoKm' };
  return { key: confirm ? 'office.myTrip.done.confirmed' : 'office.myTrip.done.finished', vars: { km: kmText(km) } };
}

/** What the trip already has, as lines: the check, the start, the end. */
export function tripFacts(t: MyTrip): Words[] {
  const out: Words[] = [];
  if (t.check) {
    out.push({
      key: t.check.result === 'problem' ? 'office.myTrip.fact.checkedProblem' : 'office.myTrip.fact.checkedOk',
      vars: { time: t.check.at, km: t.check.odometer_km != null ? kmText(t.check.odometer_km) : '—' },
    });
  }
  if (t.started && t.state !== 'to_check') out.push({ key: 'office.myTrip.fact.started', vars: { time: t.started, km: t.start_odometer_km != null ? kmText(t.start_odometer_km) : '—' } });
  if (t.end_odometer_km != null) out.push({ key: 'office.myTrip.fact.ended', vars: { km: kmText(t.end_odometer_km), trip: t.km != null ? kmText(t.km) : '—' } });
  return out;
}

// ---- The office's view of the checks ----

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** A check's result in the person's language: All good, or Problem: <kind> (from the report, else the server's words). */
export function resultText(t: Translate, c: { result: CheckResult; report?: { category: string } | null; result_text?: string }): string {
  if (c.result === 'ok') return t('office.checks.allGood');
  const fromText = /^Problem: (.+)$/.exec(c.result_text ?? '')?.[1];
  const cat = c.report?.category ?? CATEGORY_BY_TEXT[fromText ?? ''];
  return cat ? t('office.checks.problem', { what: t(categoryKey(cat)) }) : t('office.checks.problemOnly');
}

/** The server's category words back to the kind (list_vehicles' check_today has only result_text). */
const CATEGORY_BY_TEXT: Record<string, ReportCategory> = {
  Breakdown: 'breakdown', Accident: 'accident', Tyre: 'tyre', 'Warning light': 'warning_light', Damage: 'damage', 'Other problem': 'other',
};

/** How a check was made, in words: office.checks.how.<how>. */
export const howKey = (how: string): string => `office.checks.how.${['clock_in', 'change', 'task_start', 'vehicle_confirm', 'trip'].includes(how) ? how : 'trip'}`;

/** vehicle_checks' input for a vehicle's last 7 days (today and the 6 before). */
export function lastWeekArgs(plate: string, today: string): { vehicle: string; from: string; to: string; limit: number } {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 6);
  return { vehicle: plate, from: d.toISOString().slice(0, 10), to: today, limit: 50 };
}

/** The checks by day, newest first (the answer is newest first already). */
export function byDay(checks: readonly VehicleCheck[]): { date: string; checks: VehicleCheck[] }[] {
  const out: { date: string; checks: VehicleCheck[] }[] = [];
  for (const c of checks) {
    const last = out[out.length - 1];
    if (last && last.date === c.date) last.checks.push(c);
    else out.push({ date: c.date, checks: [c] });
  }
  return out;
}
