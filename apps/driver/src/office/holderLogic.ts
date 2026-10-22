// Round 4–7, feature 7 (Sahan, 22 October 2026): someone else has that driver or vehicle. The pure rules of Office mode's
// holder screens, tested in scripts/test-holders.ts (no react-native here):
//   - the holder on a busy warning (Google Calendar's room booking: who booked it, their photo, the time; Call, WhatsApp,
//     Ask for it), and the short line on a busy row ("Anoja's · 08:00–11:00");
//   - Ask for it's input (the busy trip, driver or vehicle, the wanted window when the screen knows it, the note) and the
//     snackbar in the person's language;
//   - the notification centre's buttons (Gmail / Slack actionable notifications): the words of a button, the answer kept
//     for the session, where a holder.* item opens;
//   - the Asks page (To me · By me · All): the tabs by permission, each row's title, grey line and answer chip;
//   - the day's timeline (Google Calendar's resource view): where each booking's bar sits on 06:00–22:00, the hour ticks,
//     the tone of a booking.
// With the switch holder_contact off the server sends no holder and no actions: nothing here makes one up.

import { routeForUrl } from './nav';
import type { AskedForIt, Conflict, DayTimeline, Holder, HolderAsks, InboxItem } from './types';

export type Tr = (key: string, vars?: Record<string, string | number>) => string;
export type Resource = 'driver' | 'vehicle';

/** A holder as the busy rows and the timeline carry it (the timeline's has no task id or phone). */
export type HolderLike = Pick<Holder, 'name'> & Partial<Pick<Holder, 'label' | 'by' | 'window' | 'from' | 'to' | 'photo_url'>>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// The holder
// ---------------------------------------------------------------------------

/** The server's role words (holders.ts ROLE_TEXT) → their key under office.holders. */
const ROLE_KEYS: Record<string, string> = {
  Admin: 'role_admin',
  'Fleet admin': 'role_fleet_admin',
  Office: 'role_office',
  Coordinator: 'role_coordinator',
  Staff: 'role_staff',
  Viewer: 'role_viewer',
};

/** The holder's role in the person's language (an unknown word as the server sent it). */
export function roleWords(label: string | undefined, t: Tr): string {
  if (!label) return '';
  const key = ROLE_KEYS[label];
  return key ? t(`office.holders.${key}`) : label;
}

/** Is the holder the person looking (by name: the server answers with names; it refuses an ask to oneself anyway)? */
export const isMe = (h: Pick<Holder, 'name'>, meName: string | undefined): boolean =>
  !!meName && h.name.trim().toLowerCase() === meName.trim().toLowerCase();

export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** "Anoja Perera · Fleet admin", or "You". */
export function holderTitle(h: HolderLike, meName: string | undefined, t: Tr): string {
  if (isMe(h, meName)) return t('office.holders.you');
  return [h.name, roleWords(h.label, t)].filter(Boolean).join(' · ');
}

/** "08:00–11:00", or "from 08:00" when the trip has no end (never the server's English "from"). */
export function windowWords(h: Partial<Pick<Holder, 'window' | 'from' | 'to'>>, t: Tr): string {
  if (h.from && h.to) return `${h.from}–${h.to}`;
  if (h.from) return t('office.holders.fromTime', { time: h.from });
  const m = /(\d{2}:\d{2})(?:–(\d{2}:\d{2}))?/.exec(h.window ?? '');
  if (!m) return '';
  return m[2] ? `${m[1]}–${m[2]}` : t('office.holders.fromTime', { time: m[1] });
}

/** "Asked for it · 08:00–11:00" (the trip's requester) or "Assigned it · 08:00–11:00" (who assigned it). */
export function byLine(h: HolderLike, t: Tr): string {
  return [h.by ? t(h.by === 'asked' ? 'office.holders.byAsked' : 'office.holders.byAssigned') : '', windowWords(h, t)].filter(Boolean).join(' · ');
}

/** The short line on a busy row: "Anoja's · 08:00–11:00" ("Yours · …" when it is the person's own). */
export function busyWords(h: HolderLike, meName: string | undefined, t: Tr): string {
  const who = isMe(h, meName) ? t('office.holders.yours') : t('office.holders.whose', { name: firstName(h.name) });
  return [who, windowWords(h, t)].filter(Boolean).join(' · ');
}

/** A conflict card's resource: the driver or the vehicle; a vehicle in the garage has nobody to ask. */
export const conflictResource = (c: Pick<Conflict, 'kind'>): Resource | null => (c.kind === 'driver' ? 'driver' : c.kind === 'vehicle' ? 'vehicle' : null);

/** The holder a busy row carries (availability's busy drivers, suggest_vehicles' busy vehicles and drivers; none while
 *  holder_contact is off). */
export const holderOf = (row: object | null | undefined): Holder | undefined => {
  const h = (row as { holder?: Holder } | null | undefined)?.holder;
  return h && typeof h === 'object' && typeof h.name === 'string' && typeof h.task_id === 'string' ? h : undefined;
};

/** Ask for it is offered: the person may ask (ask_for_it), the holder is someone else, the trip is known. */
export const mayAsk = (h: Partial<Pick<Holder, 'name' | 'task_id'>>, tools: readonly string[], meName: string | undefined): boolean =>
  !!h.task_id && !!h.name && tools.includes('ask_for_it') && !isMe({ name: h.name }, meName);

/** Call and WhatsApp for someone else only (never oneself). */
export const reachOf = (h: Partial<Pick<Holder, 'name' | 'call' | 'whatsapp'>>, meName: string | undefined): { call?: string; whatsapp?: string } =>
  h.name && isMe({ name: h.name }, meName) ? {} : { ...(h.call ? { call: h.call } : {}), ...(h.whatsapp ? { whatsapp: h.whatsapp } : {}) };

/**
 * A conflict card's requester buttons once the holder line is shown (Sahan, 22 October 2026): when the holder IS the
 * conflict's requester (the same name, or the same number), the holder line's Call / WhatsApp reach them, so the
 * requester's own "Call / WhatsApp <name>" are not drawn again. Per button: only what the holder line itself shows goes (a
 * holder with no WhatsApp leaves the requester's WhatsApp). No holder line (holder_contact off): the requester's buttons stay.
 */
export function requesterReach(
  c: Pick<Conflict, 'holder' | 'requester'>,
  holderShown: boolean,
  meName: string | undefined,
): { call?: string; whatsapp?: string } {
  const r = c.requester;
  if (!r) return {};
  const own = { ...(r.call ? { call: r.call } : {}), ...(r.whatsapp ? { whatsapp: r.whatsapp } : {}) };
  const h = c.holder;
  if (!holderShown || !h) return own;
  const same = h.name.trim().toLowerCase() === r.name.trim().toLowerCase() || (!!h.call && h.call === r.call) || (!!h.whatsapp && h.whatsapp === r.whatsapp);
  if (!same) return own;
  const line = reachOf(h, meName);
  return { ...(own.call && !line.call ? { call: own.call } : {}), ...(own.whatsapp && !line.whatsapp ? { whatsapp: own.whatsapp } : {}) };
}

// ---------------------------------------------------------------------------
// Ask for it
// ---------------------------------------------------------------------------

/** When the screen knows the trip being planned: its day and times (each kept only when it reads right). */
export interface Wanted {
  date?: string;
  from?: string;
  until?: string;
}

/** "07:30", "Leave 07:30", "2026-10-24 07:30" → "07:30"; anything else → undefined. */
export const hhmmOf = (s: string | undefined | null): string | undefined => {
  const m = /(\d{2}:\d{2})/.exec(s ?? '');
  return m && HHMM.test(m[1]) ? m[1] : undefined;
};

/** The window availability answered for ({ day, from: "Fri 24 Oct 09:00", until: "12:00" | "end of the day" }). */
export function wantedOfWindow(w: { day?: string; from?: string; until?: string } | null | undefined): Wanted | undefined {
  if (!w?.day || !DAY.test(w.day)) return undefined;
  const from = hhmmOf(w.from);
  const until = hhmmOf(w.until);
  return { date: w.day, ...(from ? { from } : {}), ...(until ? { until } : {}) };
}

/** ask_for_it's input: the busy trip, the driver or the vehicle, the wanted window (only valid parts; a time needs its
 *  day), and the note when there is one. */
export function askArgs(taskId: string, resource: Resource, wanted: Wanted | undefined, note: string): Record<string, unknown> {
  const out: Record<string, unknown> = { task_id: taskId, resource };
  const date = wanted?.date && DAY.test(wanted.date) ? wanted.date : undefined;
  const from = hhmmOf(wanted?.from);
  const until = hhmmOf(wanted?.until);
  if (date) {
    out.date = date;
    if (from) out.from = from;
    if (from && until && until > from) out.until = until;
  }
  const words = note.trim().slice(0, 300);
  if (words) out.note = words;
  return out;
}

/** The snackbar after asking, in the person's language: "Asked Anoja. You'll hear their answer." or, for a holder with no
 *  account, "The fleet admin is told and can reassign." */
export function askedSnack(a: Pick<AskedForIt, 'asked'>, t: Tr): string {
  return a.asked ? t('office.holders.askedSnack', { name: firstName(a.asked) }) : t('office.holders.askedNoAccount');
}

/** The sheet's sentence: "Anoja has WP CAB-4521 08:00–11:00." (what = the plate or the driver's name when known). */
export function askSentence(h: HolderLike, resource: Resource, what: string | undefined, t: Tr): string {
  const thing = what?.trim() || t(resource === 'driver' ? 'office.holders.theDriver' : 'office.holders.theVehicle');
  return t('office.holders.hasIt', { name: firstName(h.name), what: thing, window: windowWords(h, t) }).replace(/\s+\./, '.');
}

// ---------------------------------------------------------------------------
// The notification centre's buttons
// ---------------------------------------------------------------------------

/** A button's words: the server's Yes / No in the person's language; any other label as it is. */
export function actionWords(label: string, t: Tr): string {
  const k = label.trim().toLowerCase();
  return k === 'yes' ? t('office.holders.yes') : k === 'no' ? t('office.holders.no') : label;
}

/** The answers given in this session, by item (the server's item keeps its buttons; the last answer wins). */
const answered = new Map<number, string>();
export const rememberAnswer = (id: number, label: string): void => void answered.set(id, label);
export const answeredLabel = (id: number): string | undefined => answered.get(id);
export const forgetAnswers = (): void => answered.clear();

/** A holder.* item's own place: the Asks page (To me for an ask, By me for an answer); null for any other event. */
export function holderAsksRoute(item: Pick<InboxItem, 'event'>): string | null {
  if (item.event === 'holder.asked') return '/office/holder-asks?which=to_me';
  if (item.event === 'holder.answered') return '/office/holder-asks?which=by_me';
  return null;
}

/** Where an item opens: its link's screen; a holder.* item the person cannot open as a task opens the Asks page. */
export const inboxRoute = (item: Pick<InboxItem, 'url' | 'event'>, permissions: readonly string[]): string | null =>
  routeForUrl(item.url, permissions) ?? holderAsksRoute(item);

// ---------------------------------------------------------------------------
// The Asks page
// ---------------------------------------------------------------------------

export type AsksWhich = HolderAsks['which'];
export type Ask = HolderAsks['asks'][number];

/** To me · By me, and All for the people who approve (the tool refuses All to anyone else). */
export const asksTabs = (permissions: readonly string[]): AsksWhich[] =>
  permissions.includes('approve') ? ['to_me', 'by_me', 'all'] : ['to_me', 'by_me'];

/** The tab a link asks for, else the first. */
export function asksTab(which: string | undefined, permissions: readonly string[]): AsksWhich {
  const tabs = asksTabs(permissions);
  return (tabs as string[]).includes(which ?? '') ? (which as AsksWhich) : tabs[0];
}

/** "WP CAB-4521 · Team drop", or the driver's name; the trip alone when the thing is not known. */
export const askTitle = (a: Ask, t: Tr): string =>
  [a.what || t(a.resource === 'driver' ? 'office.holders.theDriver' : 'office.holders.theVehicle'), a.trip].filter(Boolean).join(' · ');

/** The server's window ("Fri 24 Oct 09:00–12:00", "Fri 24 Oct 22:00–Sat 25 Oct 01:00") with its days said by `when`
 *  (lib/dateWords whenWords: the person's language); a time alone stays as it is. */
export function wantedWords(w: string | undefined, when: (s: string) => string): string {
  const s = (w ?? '').trim();
  const i = s.indexOf('–');
  if (i < 0) return s ? when(s) : '';
  const end = s.slice(i + 1).trim();
  return `${when(s.slice(0, i).trim())}–${/^\d{2}:\d{2}$/.test(end) ? end : when(end)}`;
}

/** The grey line: when it is wanted, then who asked (To me, All) or who holds it (By me), then the note in quotes. */
export function askMeta(a: Ask, which: AsksWhich, t: Tr, when: (s: string) => string = (s) => s): string {
  const who = which === 'by_me'
    ? (a.holder ? t('office.holders.heldBy', { name: a.holder }) : '')
    : which === 'all'
      ? [a.asked_by ? t('office.holders.askedByName', { name: a.asked_by }) : '', a.holder ? t('office.holders.heldBy', { name: a.holder }) : ''].filter(Boolean).join(' · ')
      : a.asked_by ? t('office.holders.askedByName', { name: a.asked_by }) : '';
  return [wantedWords(a.wanted, when), who, a.note ? `“${a.note}”` : ''].filter(Boolean).join(' · ');
}

/** The answer chip: Yes (green), No (red) or Waiting (amber). */
export function askChip(a: Pick<Ask, 'answer'>, t: Tr): { text: string; tone: 'green' | 'red' | 'amber' } {
  if (a.answer === 'yes') return { text: t('office.holders.yes'), tone: 'green' };
  if (a.answer === 'no') return { text: t('office.holders.no'), tone: 'red' };
  return { text: t('office.holders.waiting'), tone: 'amber' };
}

/** A row the person answers here: an ask to them not answered yet. */
export const canAnswer = (a: Pick<Ask, 'answer'>, which: AsksWhich): boolean => which === 'to_me' && !a.answer;

/** The asks about one trip (a task page's link), else all. */
export const asksFor = (asks: readonly Ask[], taskId: string | undefined): Ask[] => (taskId ? asks.filter((a) => a.task_id === taskId) : [...asks]);

/** The list after an answer given here (the chip at once; the next read settles it). */
export const answeredAsk = (list: HolderAsks, id: string, answer: 'yes' | 'no'): HolderAsks =>
  ({ ...list, asks: list.asks.map((a) => (a.id === id ? { ...a, answer } : a)) });

/** The empty line of each tab. */
export const asksEmptyKey = (which: AsksWhich): string =>
  which === 'to_me' ? 'office.holders.emptyToMe' : which === 'by_me' ? 'office.holders.emptyByMe' : 'office.holders.emptyAll';

// ---------------------------------------------------------------------------
// The day's timeline
// ---------------------------------------------------------------------------

export const DAY_START_H = 6;
export const DAY_END_H = 22;
/** A booking with no end is drawn this long. */
export const NO_END_MIN = 60;

export const minutesOf = (hhmm: string | undefined): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * A bar on the day's track (06:00–22:00 by default) as fractions of its width: where it starts and how wide it is, and
 * whether it runs past either edge. A booking with no end is NO_END_MIN long; one that ends before it starts (past
 * midnight) runs to the edge. Nothing when it is wholly outside the track or the time cannot be read.
 */
export function barOf(from: string | undefined, to: string | undefined, startH = DAY_START_H, endH = DAY_END_H): { left: number; width: number; cutLeft: boolean; cutRight: boolean } | null {
  const a = minutesOf(from);
  if (a === null) return null;
  const lo = startH * 60;
  const hi = endH * 60;
  let b = minutesOf(to);
  if (b === null) b = a + NO_END_MIN;
  else if (b <= a) b = 24 * 60;
  if (b <= lo || a >= hi) return null;
  const s = Math.max(a, lo);
  const e = Math.min(b, hi);
  const span = hi - lo;
  return { left: (s - lo) / span, width: Math.max((e - s) / span, 0.01), cutLeft: a < lo, cutRight: b > hi };
}

/** The hour marks under the track: 06, 08, … 22. */
export function hourTicks(startH = DAY_START_H, endH = DAY_END_H, step = 2): { h: number; at: number; label: string }[] {
  const out: { h: number; at: number; label: string }[] = [];
  for (let h = startH; h <= endH; h += step) out.push({ h, at: (h - startH) / (endH - startH), label: `${String(h).padStart(2, '0')}:00` });
  return out;
}

/** Where "now" sits on today's track (null outside it). */
export function nowAt(hhmm: string, startH = DAY_START_H, endH = DAY_END_H): number | null {
  const m = minutesOf(hhmm);
  if (m === null || m < startH * 60 || m > endH * 60) return null;
  return (m - startH * 60) / ((endH - startH) * 60);
}

export type TimelineRow = DayTimeline['rows'][number];
export type Booking = TimelineRow['bookings'][number];

/** A booking's tone: under way blue, done grey, still to come amber (Google Calendar's past events greyed). */
export const bookingTone = (status: string): 'blue' | 'muted' | 'amber' => (status === 'in_progress' ? 'blue' : status === 'completed' ? 'muted' : 'amber');

/** "08:00–11:00", or "from 08:00". */
export const bookingTime = (b: Pick<Booking, 'from' | 'to'>, t: Tr): string => windowWords({ from: b.from, to: b.to }, t);

/** A row's second line: "3 trips", "Free all day", "Not available 08:00–13:00". */
export function rowLine(r: TimelineRow, t: Tr): string {
  const parts: string[] = [];
  if (r.bookings.length) parts.push(t(r.bookings.length === 1 ? 'office.holders.oneTrip' : 'office.holders.nTrips', { n: r.bookings.length }));
  for (const u of r.not_available ?? []) parts.push(t('office.holders.notAvailableAt', { time: `${u.from}–${u.to}` }));
  if (!parts.length) parts.push(r.in_garage ? t('office.holders.inGarage') : t('office.holders.freeAllDay'));
  else if (r.in_garage) parts.push(t('office.holders.inGarage'));
  return parts.join(' · ');
}

/** The rows in the order to read them: busy first (by their first booking), then the free ones, as the server gave them. */
export function timelineOrder(rows: readonly TimelineRow[]): TimelineRow[] {
  const first = (r: TimelineRow) => Math.min(...r.bookings.map((b) => minutesOf(b.from) ?? 24 * 60), 24 * 60);
  return rows.map((r, i) => ({ r, i })).sort((x, y) => {
    const a = x.r.bookings.length ? first(x.r) : 99999;
    const b = y.r.bookings.length ? first(y.r) : 99999;
    return a - b || x.i - y.i;
  }).map((x) => x.r);
}
