// Office mode (Phase 8, O2): Ask drivers (design 13), the pure rules, tested in scripts/test-asks-office.ts: the rows the
// sheet lists (from Who's available, Who can take it or the Drivers board), who is ticked first (the free ones), the
// window's words under "Free for a trip?", the ask_drivers input and when it may be sent, the answer line per row from
// ask_answers (waiting… / seen / Yes · 09:14 / No / Call me / a time / where they are), the Use rule (a Yes with a username
// while the caller can pick a driver), and when the sheet keeps asking for answers. Pure: no React, no native module.

import { driverParts } from './approveLogic';
import type { AskAnswers, Ask, AskDriverRow, AskKind, AvailableDriver, BoardDriver } from './types';

export type Words = (key: string, vars?: Record<string, string | number>) => string;

export const ASK_KINDS: readonly AskKind[] = ['free_for_trip', 'office_time', 'where_now'];

/** Answers are read again this often while the sheet is open and someone has still to answer. */
export const ANSWERS_EVERY_MS = 10_000;

/** What the question is about: the trip's day and window, a line (where to), and the task or request it belongs to. */
export interface AskContext {
  date?: string;
  from?: string;
  to?: string;
  note?: string;
  task_id?: string;
  request_id?: string;
}

/** One driver the sheet can ask: the name, the status line, free (ticked first) and the Call link when the person may see numbers. */
export interface AskTarget {
  name: string;
  /** Null: no account to ask (the row is shown greyed, never ticked). */
  username: string | null;
  line: string;
  free: boolean;
  call?: string;
}

/** The rows from Who's available / Who can take it (availability). */
export function askTargets(drivers: readonly AvailableDriver[]): AskTarget[] {
  return drivers.map((d) => ({
    name: d.name,
    username: d.username ?? null,
    line: driverParts(d).join(' · '),
    free: d.free && !d.not_available,
    ...(d.phone?.call ? { call: d.phone.call } : {}),
  }));
}

/** The rows from the Drivers board (drivers_board). */
export function askTargetsFromBoard(drivers: readonly BoardDriver[]): AskTarget[] {
  return drivers.map((d) => ({
    name: d.name,
    username: d.username ?? null,
    line: d.status.text,
    free: d.free_now,
    ...(d.links?.call ? { call: d.links.call } : {}),
  }));
}

/** Who is ticked when the sheet opens: the caller's list when it gave one, else every free driver with an account. */
export function preticked(targets: readonly AskTarget[], given?: readonly string[]): string[] {
  const askable = new Set(targets.filter((d) => d.username).map((d) => d.username as string));
  if (given && given.length > 0) return given.filter((u) => askable.has(u));
  return targets.filter((d) => d.free && d.username).map((d) => d.username as string);
}

/** "All free": every free driver with an account. */
export const allFree = (targets: readonly AskTarget[]): string[] => preticked(targets);

/** A tick toggled: the username added or taken out; a driver without an account never. */
export function toggled(picked: readonly string[], targets: readonly AskTarget[], username: string): string[] {
  if (!targets.some((d) => d.username === username)) return [...picked];
  return picked.includes(username) ? picked.filter((u) => u !== username) : [...picked, username];
}

/** "Tue 20 Oct · 07:24–15:40 · Kurunegala" under "Free for a trip?"; null when the caller gave no window. */
export function windowText(ctx: Pick<AskContext, 'date' | 'from' | 'to' | 'note'>, dayLabel: (date: string) => string): string | null {
  const parts = [
    ctx.date ? dayLabel(ctx.date) : '',
    ctx.from ? (ctx.to ? `${ctx.from}–${ctx.to}` : ctx.from) : '',
    ctx.note?.trim() ?? '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

const TIME = /^\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The trip question needs the day and a from time (the server's rule); `to`, when given, after `from`. */
export function tripWindowOk(ctx: Pick<AskContext, 'date' | 'from' | 'to'>): boolean {
  if (!ctx.date || !DATE.test(ctx.date) || !ctx.from || !TIME.test(ctx.from)) return false;
  if (ctx.to && (!TIME.test(ctx.to) || ctx.to <= ctx.from)) return false;
  return true;
}

/** May Send be pressed: someone ticked, and for a trip question the window is known. */
export function canSend(kind: AskKind, picked: readonly string[], ctx: AskContext): boolean {
  if (picked.length === 0) return false;
  return kind !== 'free_for_trip' || tripWindowOk(ctx);
}

/** The ask_drivers input: the kind, the drivers by username, the trip's window for a trip question, the note and the links. */
export function askInput(kind: AskKind, picked: readonly string[], ctx: AskContext): Record<string, unknown> {
  const input: Record<string, unknown> = { kind, drivers: [...picked] };
  if (kind === 'free_for_trip') {
    if (ctx.date) input.date = ctx.date;
    if (ctx.from) input.from = ctx.from;
    if (ctx.to) input.to = ctx.to;
  }
  const note = ctx.note?.trim();
  if (note) input.note = note.slice(0, 300);
  if (ctx.task_id) input.task_id = ctx.task_id;
  if (ctx.request_id) input.request_id = ctx.request_id;
  return input;
}

export type AnswerKey = 'waiting' | 'seen' | 'yes' | 'no' | 'callMe' | 'time' | 'location';
export type AnswerTone = 'muted' | 'green' | 'red' | 'amber' | 'blue';

/** The chip on a row once the question is sent, and the button beside it (Use on a Yes, Call on "Call me", Maps on a location). */
export interface AnswerView {
  key: AnswerKey;
  tone: AnswerTone;
  /** When they answered (or were seen), "HH:MM". */
  time?: string;
  /** The server's own words for a time or a location ("At the office at 10:30", "Shared where they are"). */
  text?: string;
  call?: string;
  map?: string;
  /** A Yes from a driver with an account, while the question is open for assigning: the caller may pick them. */
  use: boolean;
}

export function answerOf(row: AskDriverRow): AnswerView {
  if (row.state === 'answered' && row.answer) {
    const time = row.answered;
    switch (row.answer) {
      case 'yes':
        return { key: 'yes', tone: 'green', time, use: !!row.username && row.assignable !== false };
      case 'no':
        return { key: 'no', tone: 'red', time, use: false };
      case 'call_me':
        return { key: 'callMe', tone: 'amber', time, ...(row.links?.call ? { call: row.links.call } : {}), use: false };
      case 'time':
        return { key: 'time', tone: 'blue', time, text: row.answer_text ?? row.answer_time, use: false };
      case 'location':
        return { key: 'location', tone: 'blue', time, text: row.answer_text ?? row.location?.near, ...(row.location?.map ? { map: row.location.map } : {}), use: false };
    }
  }
  if (row.state === 'seen') return { key: 'seen', tone: 'muted', time: row.seen, use: false };
  return { key: 'waiting', tone: 'muted', use: false };
}

/** The chip's words: "Yes · 09:14", "waiting…", "seen 09:12", "Call me", or the server's words for a time or a place. */
export function answerLabel(a: AnswerView, t: Words): string {
  switch (a.key) {
    case 'yes':
      return a.time ? t('office.ask.yesAt', { time: a.time }) : t('office.ask.yes');
    case 'no':
      return a.time ? t('office.ask.noAt', { time: a.time }) : t('office.ask.no');
    case 'callMe':
      return t('office.ask.callMe');
    case 'seen':
      return a.time ? t('office.ask.seenAt', { time: a.time }) : t('office.ask.seen');
    case 'time':
    case 'location':
      return a.text ?? t(`office.ask.${a.key}`);
    default:
      return t('office.ask.waiting');
  }
}

/** A row of the sheet: the target and, once sent, their answer row (by username); the ask's rows nobody listed are added. */
export interface SheetRow {
  target: AskTarget;
  row: AskDriverRow | null;
}

export function mergeRows(targets: readonly AskTarget[], ask: Pick<Ask, 'drivers'> | null): SheetRow[] {
  const byUser = new Map((ask?.drivers ?? []).filter((r) => r.username).map((r) => [r.username as string, r]));
  const out: SheetRow[] = targets.map((target) => ({ target, row: target.username ? byUser.get(target.username) ?? null : null }));
  for (const r of ask?.drivers ?? []) {
    if (r.username && targets.some((d) => d.username === r.username)) continue;
    out.push({ target: { name: r.name, username: r.username ?? null, line: '', free: false, ...(r.links?.call ? { call: r.links.call } : {}) }, row: r });
  }
  return out;
}

/** Answers are read again while the question is open and someone has still to answer. */
export function keepPolling(ask: Pick<Ask, 'expired' | 'counts'>): boolean {
  return !ask.expired && ask.counts.answered < ask.counts.asked;
}

/** "Send to 3 drivers" / "Send to 1 driver" / "Send". */
export function sendLabel(n: number, t: Words): string {
  if (n === 0) return t('office.ask.send');
  return n === 1 ? t('office.ask.sendOne') : t('office.ask.sendMany', { n });
}

/** The question's own words when the server gave them, else the kind's. */
export function questionText(ask: Pick<Ask, 'kind' | 'question'>, t: Words): string {
  return ask.question || t(`office.ask.kind.${ask.kind}`);
}

/** Stage 1 (O3 item 7): "3 of 5 answered · 2 yes · 1 seen" under a question. */
export function askCountsLine(c: Pick<Ask, 'counts'>['counts'], t: Words): string {
  return [t('office.asks.answeredOf', { n: c.answered, total: c.asked }), c.yes ? t('office.asks.yesN', { n: c.yes }) : '', c.seen > c.answered ? t('office.asks.seenN', { n: c.seen - c.answered }) : ''].filter(Boolean).join(' · ');
}

/** The next page of questions after the ones on screen (never a question twice). */
export function appendAsks(list: AskAnswers, page: AskAnswers): AskAnswers {
  const have = list.asks ?? [];
  const seen = new Set(have.map((a) => a.id));
  const out: AskAnswers = { ...list, asks: [...have, ...(page.asks ?? []).filter((a) => !seen.has(a.id))] };
  if (page.next) out.next = page.next;
  else delete out.next;
  if (page.total !== undefined) out.total = page.total;
  return out;
}
