// Part 3b (H3, docs/phase7-plan.md "Part 3b"): questions from the office with one-tap answers. Pure code with no phone
// modules, so scripts/test-asks.ts runs it as it is.
//   - "Free for a trip <day> <from–to>?" → Yes / No / Call me;
//   - "When can you be at the office?" → a time (the next quarter hours as big buttons, or a typed time), or Call me;
//   - "Where are you now?" → Share my location (one fix, taken once; never recording), or Call me.
// The driver reads the questions they were asked (driver_asks) and their own answer rows (driver_ask_answers). An answer
// goes through the offline queue (op ask_answer → answer_ask); the server keeps the last answer given before the question
// closes (a trip question at the trip's start, the others 2 hours after asking). 'expired' and 'bad' are final.

import { colomboDate, colomboTime } from './time';

export type AskKind = 'free_for_trip' | 'office_time' | 'where_now';
export type AskAnswer = 'yes' | 'no' | 'call_me' | 'time' | 'location';
/** answer_ask's answer: 'ok' | 'expired' (closed before the answer was given) | 'not_yours' | 'bad' (not an answer to this question). */
export type AskReply = 'ok' | 'expired' | 'not_yours' | 'bad';

const KINDS: readonly AskKind[] = ['free_for_trip', 'office_time', 'where_now'];
const ANSWERS: readonly AskAnswer[] = ['yes', 'no', 'call_me', 'time', 'location'];

/** A question as the phone keeps it: the ask and the driver's own answer row. */
export interface AskRow {
  ask_id: string;
  kind: AskKind;
  trip_from: string | null;
  trip_to: string | null;
  note: string | null;
  asked_by_name: string;
  created_at: string;
  expires_at: string;
  sent_at: string;
  seen_at: string | null;
  answer: AskAnswer | null;
  answer_at: string | null;
  answered_at: string | null;
}

/** The select the phone reads (driver_ask_answers with its ask). */
export const ASK_SELECT =
  'ask_id, sent_at, seen_at, answer, answer_at, answered_at, driver_asks!inner(kind, trip_from, trip_to, note, asked_by_name, created_at, expires_at)' as const;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** One row of that select, read defensively (null when it is not a question the phone understands). */
export function parseAskRow(raw: unknown): AskRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const ask = (Array.isArray(o.driver_asks) ? o.driver_asks[0] : o.driver_asks) as Record<string, unknown> | undefined;
  const askId = str(o.ask_id);
  const kind = str(ask?.kind);
  const expires = str(ask?.expires_at);
  if (!askId || !ask || !kind || !(KINDS as readonly string[]).includes(kind) || !expires) return null;
  const answer = str(o.answer);
  return {
    ask_id: askId,
    kind: kind as AskKind,
    trip_from: str(ask.trip_from),
    trip_to: str(ask.trip_to),
    note: str(ask.note),
    asked_by_name: str(ask.asked_by_name) ?? '',
    created_at: str(ask.created_at) ?? str(o.sent_at) ?? expires,
    expires_at: expires,
    sent_at: str(o.sent_at) ?? str(ask.created_at) ?? expires,
    seen_at: str(o.seen_at),
    answer: answer && (ANSWERS as readonly string[]).includes(answer) ? (answer as AskAnswer) : null,
    answer_at: str(o.answer_at),
    answered_at: str(o.answered_at),
  };
}

export function questionKey(kind: AskKind): 'ask.freeForTrip' | 'ask.officeTime' | 'ask.whereNow' {
  return kind === 'free_for_trip' ? 'ask.freeForTrip' : kind === 'office_time' ? 'ask.officeTime' : 'ask.whereNow';
}

/** The answers each question takes (answer_ask refuses any other as 'bad'). */
export function answersFor(kind: AskKind): AskAnswer[] {
  return kind === 'free_for_trip' ? ['yes', 'no', 'call_me'] : kind === 'office_time' ? ['time', 'call_me'] : ['location', 'call_me'];
}

/** Still open: the server takes an answer until it expires. */
export function isOpen(ask: Pick<AskRow, 'expires_at'>, now: number): boolean {
  return Date.parse(ask.expires_at) > now;
}

/** Open and not answered yet (Today's banner). */
export function needsAnswer(ask: Pick<AskRow, 'expires_at' | 'answered_at'>, now: number): boolean {
  return isOpen(ask, now) && !ask.answered_at;
}

/** The question for Today's banner: the open one not answered that closes soonest. */
export function bannerAsk<A extends Pick<AskRow, 'expires_at' | 'answered_at'>>(asks: A[], now: number): A | null {
  return asks.filter((ask) => needsAnswer(ask, now)).sort((a, b) => a.expires_at.localeCompare(b.expires_at))[0] ?? null;
}

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** The trip asked about: "Tue 20 Oct · 09:00–12:00" (the day in the driver's language, digits Latin); null for the others. */
export function tripWhen(dayLabel: (at: Date | string) => string, ask: Pick<AskRow, 'kind' | 'trip_from' | 'trip_to'>): string | null {
  if (ask.kind !== 'free_for_trip' || !ask.trip_from) return null;
  const to = ask.trip_to ? `–${colomboTime(ask.trip_to)}` : '';
  return `${dayLabel(ask.trip_from)} · ${colomboTime(ask.trip_from)}${to}`;
}

/** The answer given, in words: "Yes", "Call me", "At the office at 09:15", "Location shared"; null when none. */
export function answerWords(
  t: Translate,
  ask: Pick<AskRow, 'answer' | 'answer_at'>,
  dayLabel?: (at: Date | string) => string,
  now = Date.now(),
): string | null {
  switch (ask.answer) {
    case 'yes':
      return t('ask.yes');
    case 'no':
      return t('ask.no');
    case 'call_me':
      return t('ask.callMe');
    case 'location':
      return t('ask.answerLocation');
    case 'time': {
      if (!ask.answer_at) return null;
      const time = colomboTime(ask.answer_at);
      const other = colomboDate(ask.answer_at) !== colomboDate(now) && dayLabel ? `${dayLabel(ask.answer_at)} ${time}` : time;
      return t('ask.answerTime', { time: other });
    }
    default:
      return null;
  }
}

/** "When can you be at the office?": the times offered as buttons, every `stepMin` minutes after now (the next quarter hours). */
export const TIME_CHOICES = 8;
export const TIME_STEP_MIN = 15;

export function timeChoices(now: number, count = TIME_CHOICES, stepMin = TIME_STEP_MIN): { at: string; label: string }[] {
  const step = stepMin * 60_000;
  // Colombo is UTC+05:30 all year: the quarter hours line up with UTC's, so rounding the instant is exact.
  const first = Math.floor(now / step) * step + step;
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(first + i * step).toISOString();
    return { at, label: colomboTime(at) };
  });
}

/**
 * A typed time ("14:30", "9.15", "0930") as the next time it comes in Colombo: later today, or tomorrow when it has
 * passed today (asked in the evening, "07:30" is tomorrow morning). null when it is not a time.
 */
export function typedTime(text: string, now: number): string | null {
  const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2])];
  if (h > 23 || min > 59) return null;
  const hhmm = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  const today = Date.parse(`${colomboDate(now)}T${hhmm}:00+05:30`);
  return new Date(today > now ? today : today + 86_400_000).toISOString();
}

/** What an answer carries (answer_ask's arguments, the phone's time as p_at). */
export interface AskAnswerInput {
  answer: AskAnswer;
  /** The time picked (an office_time answer). */
  answer_at?: string | null;
  lat?: number | null;
  lng?: number | null;
  accuracy_m?: number | null;
}

/** The queue's op for an answer (sync/engine.ts): answer_ask with the phone's time; id = the ask. */
export interface AskAnswerOp {
  kind: 'ask_answer';
  /** The ask's id. */
  id: string;
  /** This answer's own id on the phone (the screen hears its answer by it). */
  client_id: string;
  answer: AskAnswer;
  answer_at: string | null;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  /** When the driver answered (the server takes the latest answer given before the question closed). */
  at: string;
}

export function askAnswerOp(askId: string, clientId: string, input: AskAnswerInput, at: string): AskAnswerOp {
  return {
    kind: 'ask_answer',
    id: askId,
    client_id: clientId,
    answer: input.answer,
    answer_at: input.answer === 'time' ? input.answer_at ?? null : null,
    lat: input.answer === 'location' ? input.lat ?? null : null,
    lng: input.answer === 'location' ? input.lng ?? null : null,
    accuracy_m: input.answer === 'location' ? input.accuracy_m ?? null : null,
    at,
  };
}

/** Whether the answer has what its question needs (a time, a position), before it is queued. */
export function answerComplete(kind: AskKind, input: AskAnswerInput): boolean {
  if (!answersFor(kind).includes(input.answer)) return false;
  if (input.answer === 'time') return !!input.answer_at;
  if (input.answer === 'location') return input.lat != null && input.lng != null;
  return true;
}

/**
 * How the queue treats the server's reply: 'ok' and 'expired' are done (an expired question is told on the screen,
 * never tried again); 'bad' and 'not_yours' are refusals (kept failed, never tried again by themselves).
 */
export function replyDone(reply: string): boolean {
  return reply === 'ok' || reply === 'expired';
}

/** The phone's copy after an answer (offline too): the answer, when it was given, the time picked. */
export function withAnswer<A extends AskRow>(asks: A[], askId: string, input: AskAnswerInput, at: string): A[] {
  return asks.map((ask) => (ask.ask_id !== askId ? ask : {
    ...ask,
    answer: input.answer,
    answer_at: input.answer === 'time' ? input.answer_at ?? null : null,
    answered_at: at,
    seen_at: ask.seen_at ?? at,
  }));
}

/** Puts a question read from the server into the phone's list (newest first), replacing the copy it had. */
export function mergeAsk<A extends AskRow>(asks: A[], ask: A): A[] {
  return [ask, ...asks.filter((item) => item.ask_id !== ask.ask_id)].sort((a, b) => b.sent_at.localeCompare(a.sent_at));
}
