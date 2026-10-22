// A task's status in words, never internal text (Sahan, 21 October 2026). Pure: scripts/test-status-words.ts.
//
// The server says a task card's state as an English sentence (task_board's `status`, task_detail's `status_line`:
// supabase/functions/_shared/fleet/tools/tasks.ts statusLine): "Sent · not opened yet", "Seen by driver 16:06",
// "Accepted 16:10", "Started 07:06 · sharing location", "Done 11:40 · 42 km logged", "Declined (Vehicle problem) · note",
// "Cancelled: reason", "Driven by Nimal (custodian · no app)". Office mode shows it in the person's language: each sentence
// is read back into a key with its values; one it does not know is shown as the server said it (English words, never a
// key). A driver's presence sentences (status_text) are read the same way (presenceWords). The short chip at the right of a row (Gmail's label: "Sent", "Seen", "Accepted", "Under way", "Late", "Done",
// "Needs driver") comes from the card's column and that sentence.
//
// Round 3 (docs/phase8-plan.md §30, item 5c): the other English sentences most seen on Sinhala screens are read back the
// same way (the English stays the fallback for anything not matched; numbers, plates and times stay in Latin digits): a
// trip with no app ("Drives themselves · no app", "Someone else drives · no app"), a missed task, the assign warnings
// (_shared/fleet/fleet.ts assignCheck and its conflict cards; requests.ts fitWarnings), the plan's warnings (plan.ts), "The
// leave-by time is already in the past.", "Not available …" and "Running late …" and "Last seen …" (presence.ts), and the
// best match's reason (availability.ts rankMatches: "On duty · free 08:00–12:00 · 3.2 km from the pickup · 1 task today").

import { dateWords, relativeKey, type RelWords } from '../lib/dateWords';
import { durationText } from '../lib/durations';
import type { Tone } from './ui';

/** A value in a sentence: as it is (a plate, a time, a name), or words of its own, said in the person's language too. */
export type WordsVar = string | number | Words;

export interface Words {
  key: string;
  vars?: Record<string, WordsVar>;
  /** The driver's own words after the reason (a decline's note), shown as they wrote them. */
  tail?: string;
  /** Several sentences joined with " · " (the best match's reason): `key` is then only a name. */
  parts?: Words[];
}

/** The decline reasons as the server words them (tools/tasks.ts DECLINE_TEXT) → our keys. */
const REASONS: Record<string, string> = {
  'Vehicle problem': 'vehicle_problem',
  'Not available': 'not_available',
  Unwell: 'unwell',
  Other: 'other',
  'no reason given': 'none',
};

/** The server's status sentence as a key with its values, or null for a sentence this app does not know. */
export function sentenceWords(line: string | undefined | null): Words | null {
  if (!line) return null;
  const s = line.trim();
  let m: RegExpMatchArray | null;
  if (s === 'Sent · not opened yet') return { key: 'office.line.sent' };
  if ((m = s.match(/^Seen by driver (\d{2}:\d{2})$/))) return { key: 'office.line.seen', vars: { time: m[1] } };
  if ((m = s.match(/^Accepted (\d{2}:\d{2})$/))) return { key: 'office.line.accepted', vars: { time: m[1] } };
  if ((m = s.match(/^Driven by (.+) \(custodian · no app\)$/))) return { key: 'office.line.custodian', vars: { name: m[1] } };
  if ((m = s.match(/^Started (\S+) · (sharing location|not sharing location|location (.+) old)$/))) {
    const where = m[2] === 'sharing location' ? 'Sharing' : m[2] === 'not sharing location' ? 'NotSharing' : 'Old';
    return { key: `office.line.started${where}`, vars: { time: m[1], age: m[3] ?? '' } };
  }
  if ((m = s.match(/^Done (\S+) · (\d+(?:\.\d+)?) km logged$/))) return { key: 'office.line.done', vars: { time: m[1], km: m[2] } };
  if ((m = s.match(/^Declined( after accepting)? \((.+?)\)(?: · (.+))?$/))) {
    const reason = REASONS[m[2]];
    if (!reason) return null;
    return { key: m[1] ? 'office.line.declinedAfter' : 'office.line.declined', vars: { reason }, tail: m[3] };
  }
  if ((m = s.match(/^Cancelled:?\s*(.*)$/))) return { key: m[1] ? 'office.line.cancelledWhy' : 'office.line.cancelled', vars: { why: m[1] } };
  // Round 3: a trip with no app behind it, and a task never started.
  if (s === 'Drives themselves · no app') return { key: 'office.line.noAppSelf' };
  if (s === 'Someone else drives · no app') return { key: 'office.line.noAppOther' };
  if ((m = s.match(/^Missed · not started \(leave by (\d{2}:\d{2})\)$/))) return { key: 'office.line.missed', vars: { time: m[1] } };
  // Round 3 (A6): a request nobody decided before its day was over (requests.ts liveOf).
  if (s === 'Expired · nobody decided it in time') return { key: 'office.line.expired' };
  return presenceWords(s) ?? warningWords(s) ?? matchWhyWords(s);
}

// ---------------------------------------------------------------------------------------------------------------------
// Round 3: the server's other sentences
// ---------------------------------------------------------------------------------------------------------------------

/** A server date ("2026-10-01") said in words when the sentence is shown (Round 3 A4, lib/dateWords.ts): "Thu 1 Oct". */
const dateVar = (day: string): Words => ({ key: '', vars: { isoDate: day } });

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TIME = '\\d{2}:\\d{2}';

/** "Thu 22 Oct" (time.ts colomboDay) in the person's day and month names; null when it is not one. */
function dayWords(text: string): Words | null {
  const m = text.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/);
  if (!m) return null;
  return { key: 'office.when.day', vars: { day: { key: `days.${DAY_NAMES.indexOf(m[1])}` }, date: m[2], month: { key: `months.${MONTH_NAMES.indexOf(m[3])}` } } };
}

/** "17:42" as it is, "Fri 16 Oct 17:42" in the person's words, or the server's relative words ("3 h ago", M5). */
function whenWords(text: string): WordsVar | null {
  if (new RegExp(`^${TIME}$`).test(text)) return text;
  const m = text.match(new RegExp(`^(.+) (${TIME})$`));
  const day = m ? dayWords(m[1]) : dayWords(text);
  if (day) return m ? { key: 'office.when.dayTime', vars: { day, time: m[2] } } : day;
  const rel = relativeKey(text);
  return rel ? relWords(rel) : null;
}

/** lib/dateWords' relative words as Words: a farther time's "Fri 16 Oct" said with the person's day and month names. */
function relWords(r: RelWords): Words {
  const vars: Record<string, WordsVar> = {};
  for (const [k, v] of Object.entries(r.vars)) vars[k] = typeof v === 'string' ? v : relWords(v);
  if (r.day) vars.date = dayWords(r.day) ?? r.day;
  return { key: r.key, vars };
}

/** "06:00–13:00" as it is, or "from 06:00" (fleet.ts taskWindow) in the person's words. */
function windowWords(text: string): WordsVar | null {
  if (new RegExp(`^${TIME}–${TIME}$`).test(text)) return text;
  const m = text.match(new RegExp(`^from (${TIME})$`));
  return m ? { key: 'office.warn.windowFrom', vars: { time: m[1] } } : null;
}

const AWAY_REASONS: Record<string, string> = { leave: 'office.away.reasonLeave', 'half day': 'office.away.reasonHalfDay', personal: 'office.away.reasonPersonal', other: 'office.away.reasonOther' };

/** presence.ts unavailableDetail: "leave, all day", "leave until Thu 22 Oct", "half day, back 13:00", "personal, from 13:00", "other, 09:30–11:00". */
function awayDetail(text: string): Words | null {
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^(leave|half day|personal|other), all day$/))) return { key: 'office.away.allDay', vars: { reason: { key: AWAY_REASONS[m[1]] } } };
  if ((m = text.match(/^(leave|half day|personal|other) until (.+)$/))) {
    const day = dayWords(m[2]);
    return day ? { key: 'office.away.until', vars: { reason: { key: AWAY_REASONS[m[1]] }, day } } : null;
  }
  if ((m = text.match(new RegExp(`^(leave|half day|personal|other), back (${TIME})$`)))) return { key: 'office.away.back', vars: { reason: { key: AWAY_REASONS[m[1]] }, time: m[2] } };
  if ((m = text.match(new RegExp(`^(leave|half day|personal|other), from (${TIME})$`)))) return { key: 'office.away.from', vars: { reason: { key: AWAY_REASONS[m[1]] }, time: m[2] } };
  if ((m = text.match(new RegExp(`^(leave|half day|personal|other), (${TIME})–(${TIME})$`)))) return { key: 'office.away.hours', vars: { reason: { key: AWAY_REASONS[m[1]] }, from: m[2], to: m[3] } };
  return null;
}

const DOCS: Record<string, string> = { 'revenue licence': 'office.warn.docRevenue', insurance: 'office.warn.docInsurance', 'emission test': 'office.warn.docEmission' };
const TYPES: Record<string, string> = { car: 'office.warn.typeCar', van: 'office.warn.typeVan', 'double cab': 'office.warn.typeDoubleCab', lorry: 'office.warn.typeLorry', other: 'office.warn.typeOther' };

/** "10 h 30 min", "45 min", "2 h", "1 d 3 h" (the server's duration) as minutes; null when it is not one. */
function minutesOf(text: string): number | null {
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^(\d+) min$/))) return Number(m[1]);
  if ((m = text.match(/^(\d+) h(?: (\d+) min)?$/))) return Number(m[1]) * 60 + Number(m[2] ?? 0);
  if ((m = text.match(/^(\d+) d(?: (\d+) h)?$/))) return Number(m[1]) * 1440 + Number(m[2] ?? 0) * 60;
  return null;
}

/**
 * The warnings a save, a plan or a proposal answers (fleet.ts assignCheck and its conflict cards, requests.ts fitWarnings,
 * plan.ts, tasks.ts), and the warnings saved past ("… (saved by Palitha)"). A plate holds no lower-case letter ("WP
 * CAB-4521", "16 ශ්‍රී 1234"), so a sentence about "The vehicle …" is not read as one of these.
 */
function warningWords(s: string): Words | null {
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(.+) \(saved by ([^()]+)\)$/))) {
    const inner = sentenceWords(m[1]);
    return inner ? { key: 'office.warn.savedBy', vars: { text: inner, name: m[2] } } : null;
  }
  if ((m = s.match(/^([^a-z]+?) is booked (.+?) (at the same time|the same day) \((.+)\)\.$/))) {
    const window = windowWords(m[2]);
    return window ? { key: m[3] === 'at the same time' ? 'office.warn.vehicleBooked' : 'office.warn.vehicleBookedDay', vars: { plate: m[1], window, title: m[4] } } : null;
  }
  if ((m = s.match(/^(.+?) has another task (.+?) (at the same time|the same day) \((.+)\)\.$/))) {
    const window = windowWords(m[2]);
    return window ? { key: m[3] === 'at the same time' ? 'office.warn.driverBusy' : 'office.warn.driverBusyDay', vars: { name: m[1], window, title: m[4] } } : null;
  }
  if ((m = s.match(/^([^a-z]+) is marked as in the garage\.$/))) return { key: 'office.warn.inGarage', vars: { plate: m[1] } };
  if ((m = s.match(/^([^a-z]+) is in the garage$/))) return { key: 'office.warn.inGarageNow', vars: { plate: m[1] } };
  if ((m = s.match(/^([^a-z]+) is over its monthly km allowance \(([\d,]+) of ([\d,]+) km\)\.$/))) return { key: 'office.warn.overKm', vars: { plate: m[1], used: m[2], allowance: m[3] } };
  if ((m = s.match(/^([^a-z]+): (revenue licence|insurance|emission test) expired on (\d{4}-\d{2}-\d{2})\.$/))) return { key: 'office.warn.docExpired', vars: { plate: m[1], doc: { key: DOCS[m[2]] }, date: dateVar(m[3]) } };
  if ((m = s.match(/^(.+)'s driving licence expired on (\d{4}-\d{2}-\d{2})\.$/))) return { key: 'office.warn.licenceExpired', vars: { name: m[1], date: dateVar(m[2]) } };
  // Round 3 (A5): a self-driven trip whose driver has no licence on file (_shared/fleet/licence.ts noLicenceWarning).
  if ((m = s.match(/^(.+) has no driving licence on file \(self-drive\)\.$/))) return { key: 'office.warn.noLicence', vars: { name: m[1] } };
  if ((m = s.match(/^(.+?) is not available (then|that day) · (.+)$/))) {
    const detail = awayDetail(m[3]);
    return detail ? { key: m[2] === 'then' ? 'office.warn.notAvailableThen' : 'office.warn.notAvailableDay', vars: { name: m[1], detail } } : null;
  }
  if ((m = s.match(/^([^a-z]+?) is a (car|van|double cab|lorry|other), not a (car|van|double cab|lorry|other)\.$/))) return { key: 'office.warn.notType', vars: { plate: m[1], type: { key: TYPES[m[2]] }, need: { key: TYPES[m[3]] } } };
  if ((m = s.match(/^([^a-z]+?) has (\d+) seats for (\d+) passengers\.$/))) return { key: 'office.warn.seats', vars: { plate: m[1], seats: m[2], pax: m[3] } };
  if (s === 'The leave-by time is already in the past.') return { key: 'office.warn.leavePast' };
  if (s === 'The time is already in the past.') return { key: 'office.warn.timePast' };
  if (s === 'The leave-by time is already past.') return { key: 'office.warn.planLeavePast' };
  if (s === 'No base place set — add it in Settings') return { key: 'office.warn.noBase' };
  if ((m = s.match(/^(.+): no map pin, so its leg counts as 0 minutes\. Save the place with a pin, or type a town name\.$/))) return { key: 'office.warn.noPin', vars: { place: m[1] } };
  if ((m = s.match(new RegExp(`^Leaving now, the earliest arrival at Stop (\\d+) is (${TIME}) UTC; the deadline cannot be met with the buffer\\.$`)))) return { key: 'office.warn.notReachable', vars: { n: m[1], time: m[2] } };
  if ((m = s.match(/^A long day: (.+) from leaving to the end\.$/))) {
    const min = minutesOf(m[1]);
    return min === null ? null : { key: 'office.warn.longDay', vars: { dur: { key: '', vars: { minutes: min } } } };
  }
  if ((m = s.match(/^Same as the start: Stop 1 \((.+)\) is a pickup where the trip starts\. Tick "Passengers get in here" instead/))) return { key: 'office.warn.sameAsStart', vars: { place: m[1] } };
  // A conflict card (fleet.ts card): "WP CAB-4521 is on task Team drop 08:00–11:00 for Dilini (driver Kamal)".
  if ((m = s.match(new RegExp(`^(.+?) is on task (.+) (${TIME}–${TIME}|from ${TIME})(?: for (\\S+))?(?: \\(driver (\\S+)\\))?$`)))) {
    const window = windowWords(m[3]);
    if (!window) return null;
    const key = m[4] && m[5] ? 'office.warn.onTaskForDriver' : m[4] ? 'office.warn.onTaskFor' : m[5] ? 'office.warn.onTaskDriver' : 'office.warn.onTask';
    return { key, vars: { who: m[1], title: m[2], window, name: m[4] ?? '', driver: m[5] ?? '' } };
  }
  return null;
}

/** availability.ts rankMatches: "On duty · free 08:00–12:00 · 3.2 km from the pickup · 1 task today". */
function matchWhyWords(s: string): Words | null {
  const parts = s.split(' · ');
  if (parts.length < 3 || parts[0] !== 'On duty') return null;
  const out: Words[] = [{ key: 'office.why.onDuty' }];
  let m: RegExpMatchArray | null;
  for (const p of parts.slice(1)) {
    if ((m = p.match(new RegExp(`^free (${TIME})–(${TIME})$`)))) out.push({ key: 'office.why.free', vars: { from: m[1], to: m[2] } });
    else if ((m = p.match(new RegExp(`^free (${TIME})–end of day$`)))) out.push({ key: 'office.why.freeToEnd', vars: { from: m[1] } });
    else if ((m = p.match(/^([\d.]+) km from (the pickup|the first stop)$/))) out.push({ key: m[2] === 'the pickup' ? 'office.why.kmPickup' : 'office.why.kmFirst', vars: { km: m[1] } });
    else if ((m = p.match(/^(\d+) tasks? today$/))) out.push(m[1] === '1' ? { key: 'office.why.oneTask' } : { key: 'office.why.tasks', vars: { n: m[1] } });
    else return null;
  }
  return { key: 'office.why', parts: out };
}

/**
 * A driver's presence as the server words it (status.ts statusText, availability.ts): "Live · 2 min ago", "Location off
 * since 09:10", "Location permission removed since 09:10", "No signal since 09:10", "Off duty", "On duty since 07:12",
 * "Off duty since 07:40", "On a task until ~10:40 (live)", "On a task · end time not set"; "· 3 points refused" after any.
 */
function presenceWords(line: string): Words | null {
  let m: RegExpMatchArray | null;
  let s = line;
  let refused: number | null = null;
  if ((m = s.match(/^(.*) · (\d+) points? refused$/))) {
    s = m[1];
    refused = Number(m[2]);
  }
  const w = presenceCore(s);
  if (!w) return null;
  return refused === null ? w : { ...w, vars: { ...w.vars, refused } };
}

function presenceCore(s: string): Words | null {
  let m: RegExpMatchArray | null;
  if (s === 'Live · now') return { key: 'office.line.liveNow' };
  if ((m = s.match(/^Live · (\d+) (min|h|d) ago$/))) return { key: `office.line.live_${m[2]}`, vars: { n: Number(m[1]) } };
  if ((m = s.match(/^(Location off|Location permission removed|No signal)(?: since (\d{2}:\d{2}))?$/))) {
    const k = m[1] === 'Location off' ? 'locationOff' : m[1] === 'No signal' ? 'noSignal' : 'permissionGone';
    return m[2] ? { key: `office.line.${k}Since`, vars: { time: m[2] } } : { key: `office.line.${k}` };
  }
  if (s === 'Off duty') return { key: 'office.line.offDuty' };
  if ((m = s.match(/^(On|Off) duty since (\d{2}:\d{2})$/))) return { key: m[1] === 'On' ? 'office.line.onDutySince' : 'office.line.offDutySince', vars: { time: m[2] } };
  if ((m = s.match(/^On a task until ~(\d{2}:\d{2})(?: \((live|planned)\))?$/))) return { key: m[2] ? `office.line.onTaskUntil_${m[2]}` : 'office.line.onTaskUntil', vars: { time: m[1] } };
  if (s === 'On a task · end time not set') return { key: 'office.line.onTaskNoEnd' };
  // Round 3 (presence.ts): not available now, an entry over the window, running late, last seen.
  if ((m = s.match(/^Not available, back (\d{2}:\d{2})$/))) return { key: 'office.line.notAvailableBack', vars: { time: m[1] } };
  if (s === 'Not available today') return { key: 'office.line.notAvailableToday' };
  if ((m = s.match(/^Not available until (.+)$/))) {
    const when = whenWords(m[1]);
    return when ? { key: 'office.line.notAvailableUntil', vars: { when } } : null;
  }
  if ((m = s.match(/^Not available · (.+)$/))) {
    const detail = awayDetail(m[1]);
    return detail ? { key: 'office.line.notAvailable', vars: { detail } } : null;
  }
  if ((m = s.match(/^Running late (\d+) min · said (.+)$/))) {
    const said = whenWords(m[2]);
    return said ? { key: 'office.line.runningLate', vars: { min: m[1], said } } : null;
  }
  if ((m = s.match(/^Last seen (.+?)(?: near (.+))?$/))) {
    const when = whenWords(m[1]);
    if (!when) return null;
    return m[2] ? { key: 'office.line.lastSeenNear', vars: { when, town: m[2] } } : { key: 'office.line.lastSeen', vars: { when } };
  }
  return null;
}

type T = (key: string, vars?: Record<string, string | number>) => string;

/** Words as text: the key with its values, each value that is words of its own said first; a duration in the person's words. */
export function wordsText(t: T, w: Words): string {
  if (w.parts) return w.parts.map((p) => wordsText(t, p)).join(' · ');
  // A duration (plan.ts "A long day: 10 h 30 min"): the app's own words for it.
  if (w.key === '' && typeof w.vars?.minutes === 'number') return durationText(t, w.vars.minutes);
  // A date (an expiry): in words, "Thu 1 Oct" (Round 3 A4).
  if (w.key === '' && typeof w.vars?.isoDate === 'string') return dateWords(t, w.vars.isoDate);
  const vars: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(w.vars ?? {})) vars[k] = typeof v === 'object' ? wordsText(t, v) : v;
  if (typeof w.vars?.reason === 'string') vars.reason = t(`office.line.reason_${w.vars.reason}`);
  const text = t(w.key, vars) + (typeof w.vars?.refused === 'number' ? ` · ${t('office.line.refused', { n: w.vars.refused })}` : '');
  return w.tail ? `${text} · ${w.tail}` : text;
}

/** The status sentence in the person's language (the server's own words when this app does not know the sentence). */
export function sentenceText(t: T, line: string | undefined | null): string {
  const w = sentenceWords(line);
  return w ? wordsText(t, w) : line ?? '';
}

export type BoardColumn = 'assigned' | 'in_progress' | 'completed' | 'declined';

/**
 * The short chip of a task card, by its column and its sentence (Round 4–7: Completed · not confirmed is "Not confirmed",
 * grey) (a short word; the sentence is the row's second line).
 * Round 3: a trip with no app says who drives from the card's `driven_by` (never read from the sentence): "Self-drive"
 * when the person drives it themselves, "Someone else" when someone not in Fame Fleet does.
 */
export function taskChip(column: BoardColumn, card: { status?: string; accepted?: string; late_min?: number; driven_by?: string; finish_flag?: { kind: string } | null }): { key: string; tone: Tone; min?: number } {
  if (column === 'in_progress') return card.late_min && card.late_min > 0 ? { key: 'late', tone: 'red', min: card.late_min } : { key: 'underWay', tone: 'blue' };
  // Round 4–7 (4b): a trip nobody drives with the app, closed at 09:00 the next day without its odometer (grey).
  if (column === 'completed') return card.finish_flag?.kind === 'not_confirmed' ? { key: 'notConfirmed', tone: 'muted' } : { key: 'done', tone: 'green' };
  if (column === 'declined') return { key: 'needsDriver', tone: 'red' };
  if (card.driven_by === 'self') return { key: 'selfDrive', tone: 'muted' };
  if (card.driven_by === 'other') return { key: 'someoneElse', tone: 'muted' };
  if (card.accepted) return { key: 'accepted', tone: 'green' };
  const w = sentenceWords(card.status);
  if (w?.key === 'office.line.seen') return { key: 'seen', tone: 'amber' };
  return { key: 'sent', tone: 'amber' };
}

/**
 * A task row's second line (the Tasks tab, Home): who drives, then the status in words. A driver: "Kamal · Seen by driver
 * 16:06". No app: "Nimali · Drives themselves · no app" (the status line says it) or, once the line says something else,
 * the small word after the name ("Nimali · Drives themselves · Done 11:40 · 42 km logged").
 */
export function taskRowLine(t: T, c: { driver?: string; driven_by?: string; status?: string }): string {
  const status = sentenceText(t, c.status);
  const noAppLine = ['office.line.noAppSelf', 'office.line.noAppOther'].includes(sentenceWords(c.status)?.key ?? '');
  const word = c.driven_by === 'self' ? t('office.who.drivesThemselves') : c.driven_by === 'other' ? t('office.who.someoneElse') : '';
  return [c.driver, noAppLine ? '' : word, status].filter(Boolean).join(' · ');
}

/** A chip's words ("Late 12 min"). */
export function chipText(t: T, chip: { key: string; min?: number }): string {
  return chip.key === 'late' ? t('office.chip.late', { min: chip.min ?? 0 }) : t(`office.chip.${chip.key}`);
}

/** A trip's live state (My trips: tools/requests.ts liveOf / taskLive) as a short chip; an unknown one reads "Waiting". */
const TRIP_CHIP: Record<string, { key: string; tone: Tone }> = {
  waiting: { key: 'waiting', tone: 'amber' },
  approved: { key: 'approved', tone: 'green' },
  accepted: { key: 'accepted', tone: 'green' },
  sent: { key: 'sent', tone: 'amber' },
  on_the_way: { key: 'onTheWay', tone: 'blue' },
  arrived: { key: 'arrived', tone: 'blue' },
  completed: { key: 'done', tone: 'green' },
  declined: { key: 'declined', tone: 'red' },
  cancelled: { key: 'cancelled', tone: 'muted' },
  missed: { key: 'missed', tone: 'red' },
  changed: { key: 'changed', tone: 'amber' },
  // Round 3 (A6): nobody decided it before its day was over (grey, with its own icon on the chip).
  expired: { key: 'expired', tone: 'muted' },
};

export function tripChip(state: string | undefined): { key: string; tone: Tone } {
  return TRIP_CHIP[state ?? ''] ?? TRIP_CHIP.waiting;
}

/** A task's status (the enum) as a chip word key: Task history, a task's own page. */
export function taskStatusChip(status: string | undefined): string {
  switch (status) {
    case 'in_progress': return 'underWay';
    case 'completed': return 'done';
    case 'cancelled': return 'cancelled';
    case 'declined': return 'needsDriver';
    case 'missed': return 'missed';
    default: return 'sent';
  }
}
