// Round 4–7, §33.6 item 2 and 3 (Sahan, 22 October 2026): the Fuel and Mileage tabs as Google Pay / Revolut / PickMe's
// history. Pure (no React, no phone modules), so scripts/test-fuel-card.ts runs it.
//
//   - A tab shows its summary card, the Log buttons, then ONE "Recent" card with the last RECENT_N (5) entries and "See
//     all", which opens the history (app/history.tsx): the entries grouped by month, newest first, 20 at a time with
//     Load more; on Mileage the chips All · Odometer · Trips (Round 51b; before it Fuel).
//   - A row: an icon (a fuel pump, an odometer gauge), the litres or the km, the plate and the date in words, a video
//     mark once the fill's video is uploaded.
//   - Money: a missing amount reads "–", never "LKR 0"; the totals add only the known amounts and say "N fills without an
//     amount" when there are any.
//   - The history pages from the server: my fills and my readings, each newest first (logged_at, then id), 20 at a time
//     below the oldest held. Two lists merged ("All") show only what is certain: nothing older than the oldest row held
//     of a list that has more (mergeSafe), so no entry ever appears out of order after a Load more.

import { megabytes, percentOf, thousands } from './format';
import { colomboDate } from './time';

// Round 51b (Sahan, 30 October 2026: one job per tab): fuel lives on the Fuel tab only; Mileage's Recent and its history show
// the odometer readings and the finished trips with their km (All · Odometer · Trips). The Fuel tab's history is fuel.
export type LogKind = 'fuel' | 'odometer' | 'trip';
export type HistoryFilter = 'all' | LogKind;
/** Mileage's history chips: All (readings and trips) · Odometer · Trips. */
export const HISTORY_FILTERS: readonly HistoryFilter[] = ['all', 'odometer', 'trip'];

/** The Recent card's rows. */
export const RECENT_N = 5;
/** The history's page. */
export const HISTORY_PAGE = 20;

export interface LogEntry {
  id: string;
  kind: LogKind;
  /** When it was logged (ISO). */
  at: string;
  vehicleId: string | null;
  /** A fill's litres and amount (null = not given). */
  litres: number | null;
  amountCents: number | null;
  /** A reading's km; a finished trip's km. */
  km: number | null;
  /** The server's word for a fill's video (uploaded, uploading, recorded, failed, none). */
  videoStatus: string | null;
  videoBytes: number | null;
  /** Still on the phone (not on the server yet). */
  onPhone: boolean;
}

const n = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** A fuel_logs row (the server's or the phone's queued insert) as an entry. */
export function fuelEntry(
  row: { id: string; logged_at?: string | null; vehicle_id?: string | null; litres?: number | null; amount_cents?: number | null; video_status?: string | null; video_bytes?: number | null },
  onPhone = false,
  now: () => string = () => new Date().toISOString(),
): LogEntry {
  return {
    id: row.id,
    kind: 'fuel',
    at: row.logged_at ?? now(),
    vehicleId: row.vehicle_id ?? null,
    litres: n(row.litres),
    amountCents: n(row.amount_cents),
    km: null,
    videoStatus: row.video_status ?? 'none',
    videoBytes: n(row.video_bytes),
    onPhone,
  };
}

/** An odometer_logs row (the server's or the phone's queued insert) as an entry. */
export function odometerEntry(
  row: { id: string; logged_at?: string | null; vehicle_id?: string | null; reading_km?: number | null },
  onPhone = false,
  now: () => string = () => new Date().toISOString(),
): LogEntry {
  return {
    id: row.id,
    kind: 'odometer',
    at: row.logged_at ?? now(),
    vehicleId: row.vehicle_id ?? null,
    litres: null,
    amountCents: null,
    km: n(row.reading_km),
    videoStatus: null,
    videoBytes: null,
    onPhone,
  };
}

/** Round 51b: a finished trip (tasks: completed) as an entry: its km, its vehicle, when it finished. */
export function tripEntry(
  row: { id: string; completed_at?: string | null; vehicle_id?: string | null; km?: number | null },
  onPhone = false,
  now: () => string = () => new Date().toISOString(),
): LogEntry {
  return {
    id: row.id,
    kind: 'trip',
    at: row.completed_at ?? now(),
    vehicleId: row.vehicle_id ?? null,
    litres: null,
    amountCents: null,
    km: n(row.km),
    videoStatus: null,
    videoBytes: null,
    onPhone,
  };
}

const time = (at: string) => {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : 0;
};

/** Newest first, as the server orders them (logged_at, then id, both descending). */
export function newestFirst(a: Pick<LogEntry, 'at' | 'id'>, b: Pick<LogEntry, 'at' | 'id'>): number {
  return time(b.at) - time(a.at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** Lists as one, newest first; an entry in more than one list is taken from the first that has it (the phone's copy first). */
export function mergeEntries(...lists: readonly (readonly LogEntry[])[]): LogEntry[] {
  const byId = new Map<string, LogEntry>();
  for (const list of lists) for (const e of list) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort(newestFirst);
}

/** A chip's entries: All is Mileage's (readings and trips, never fuel: the Fuel tab has its own). */
export function ofKind(entries: readonly LogEntry[], filter: HistoryFilter): LogEntry[] {
  return filter === 'all' ? entries.filter((e) => e.kind !== 'fuel') : entries.filter((e) => e.kind === filter);
}

/** The Recent card: the newest RECENT_N. */
export function recentEntries(entries: readonly LogEntry[], max = RECENT_N): LogEntry[] {
  return [...entries].sort(newestFirst).slice(0, max);
}

export interface MonthGroup {
  /** YYYY-MM in Colombo time (lib/dateWords.ts monthWords says it). */
  month: string;
  rows: LogEntry[];
}

/** Grouped by the Colombo month, newest month first, each newest first. */
export function byMonth(entries: readonly LogEntry[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const e of [...entries].sort(newestFirst)) {
    const month = colomboDate(e.at).slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.rows.push(e);
    else groups.push({ month, rows: [e] });
  }
  return groups;
}

// --- Money and litres -------------------------------------------------------------------------------------------------

/** "LKR 12,400", or "–" when the amount was not given (never "LKR 0"). */
export function amountText(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? '–' : `LKR ${thousands(cents / 100)}`;
}

/** "32.5 L" (up to one decimal), or "–". */
export function litresText(litres: number | null | undefined): string {
  if (litres === null || litres === undefined) return '–';
  const rounded = Math.round(litres * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)} L`;
}

/** A fill's line: "32.5 L · LKR 12,400", "32.5 L · –". */
export function fuelLine(e: Pick<LogEntry, 'litres' | 'amountCents'>): string {
  return `${litresText(e.litres)} · ${amountText(e.amountCents)}`;
}

export interface FuelTotals {
  fills: number;
  litres: number;
  /** The known amounts added up (cents). */
  cents: number;
  /** Fills with an amount, and without one. */
  known: number;
  missing: number;
}

/** The month's fills: litres and the known amounts added up, and how many fills have no amount. */
export function fuelTotals(entries: readonly Pick<LogEntry, 'kind' | 'litres' | 'amountCents'>[]): FuelTotals {
  const fills = entries.filter((e) => e.kind === 'fuel');
  const known = fills.filter((e) => e.amountCents !== null);
  return {
    fills: fills.length,
    litres: fills.reduce((sum, e) => sum + (e.litres ?? 0), 0),
    cents: known.reduce((sum, e) => sum + (e.amountCents ?? 0), 0),
    known: known.length,
    missing: fills.length - known.length,
  };
}

/** The total's amount: "LKR 24,800" from the known amounts, "–" when no fill has one. */
export function totalAmountText(totals: FuelTotals): string {
  return totals.known === 0 ? '–' : amountText(totals.cents);
}

/** "3 fills without an amount" (the key and its n), or null when every fill has one. */
export function missingAmountKey(totals: FuelTotals): { key: 'logHistory.noAmountOne' | 'logHistory.noAmount'; n: number } | null {
  if (totals.missing === 0) return null;
  return { key: totals.missing === 1 ? 'logHistory.noAmountOne' : 'logHistory.noAmount', n: totals.missing };
}

// --- A fill's video ---------------------------------------------------------------------------------------------------

export type VideoMark =
  | { kind: 'uploaded' }
  /** retry: the phone still holds the piece (its queue's upload failed: a tap tries again); false = only the server says so. */
  | { kind: 'failed'; retry: boolean }
  | { kind: 'waitingWifi' }
  | { kind: 'uploading'; bytes: number; offset: number }
  | { kind: 'queued' }
  | { kind: 'none' };

/** The pieces of a fill still on the phone, together. */
export interface Upload {
  failed: boolean;
  bytes: number;
  offset: number;
}

/**
 * The fill's video in a word: uploaded (the mark), uploading (how far: the pieces already gone count as done), waiting for
 * Wi-Fi, failed (tap to retry while the phone holds the piece; the server's word alone is only said), or none.
 */
export function videoMark(e: Pick<LogEntry, 'videoStatus' | 'videoBytes'>, upload: Upload | undefined, wifiOnly: boolean): VideoMark {
  if (upload?.failed) return { kind: 'failed', retry: true };
  if (upload) {
    if (wifiOnly) return { kind: 'waitingWifi' };
    const total = e.videoBytes ?? upload.bytes;
    return total > upload.bytes
      ? { kind: 'uploading', bytes: total, offset: total - upload.bytes + upload.offset }
      : { kind: 'uploading', bytes: upload.bytes, offset: upload.offset };
  }
  if (e.videoStatus === 'uploaded') return { kind: 'uploaded' };
  if (e.videoStatus === 'failed') return { kind: 'failed', retry: false };
  if (e.videoStatus === 'recorded' || e.videoStatus === 'uploading') return { kind: 'queued' };
  return { kind: 'none' };
}

// --- The history's pages: two lists from the server, merged ------------------------------------------------------------

export interface LogCursor {
  at: string;
  id: string;
}

/** One list from the server: the rows held so far, and whether the server has older ones. */
export interface Stream {
  rows: LogEntry[];
  /** The server has nothing older than the rows held. */
  done: boolean;
}

/** Where the next page of a list starts: below its oldest row (null = from the newest). */
export function cursorOf(stream: Stream | null | undefined): LogCursor | null {
  if (!stream || stream.rows.length === 0) return null;
  const oldest = [...stream.rows].sort(newestFirst)[stream.rows.length - 1];
  return { at: oldest.at, id: oldest.id };
}

/** The server's next page added to what is held (each row once); `more` = the server answered a full page plus one. */
export function addPage(stream: Stream | null | undefined, page: readonly LogEntry[], more: boolean): Stream {
  return { rows: mergeEntries(stream?.rows ?? [], page), done: !more };
}

/**
 * The lists merged, newest first, cut where it is certain: a list that has more on the server holds nothing older than its
 * oldest row, so no row older than that is shown yet (it may have older rows of the other list in front of it). `extra`
 * (the phone's own entries, still to be sent) join in first; `after` (the month's copy kept on the phone, for no
 * connection) last, so the server's fresh copy of a row wins over it. `complete` = every list is done (nothing more).
 */
export function mergeSafe(
  streams: readonly (Stream | null)[],
  extra: readonly LogEntry[] = [],
  after: readonly LogEntry[] = [],
): { rows: LogEntry[]; complete: boolean } {
  const held = streams.filter((s): s is Stream => s !== null);
  const merged = mergeEntries(extra, ...held.map((s) => s.rows), after);
  let cut: LogEntry | null = null;
  for (const s of held) {
    if (s.done) continue;
    const c = cursorOf(s);
    if (!c) return { rows: [], complete: false };
    const edge = s.rows.find((r) => r.id === c.id) ?? null;
    if (edge && (!cut || newestFirst(edge, cut) < 0)) cut = edge;
  }
  const rows = cut ? merged.filter((r) => newestFirst(r, cut as LogEntry) <= 0) : merged;
  return { rows, complete: held.length === streams.length && held.every((s) => s.done) };
}

/** The lists a filter shows. */
export function streamsFor(filter: HistoryFilter): LogKind[] {
  return filter === 'all' ? ['odometer', 'trip'] : [filter];
}

/** The video's words on a fill's row, as keys: the mark in words (the row's icon says it too) and its tone. */
export function videoWords(mark: VideoMark, canRetry: boolean): { key: string; vars?: Record<string, string | number>; tone: 'blue' | 'amber' | 'red' | 'muted' } {
  switch (mark.kind) {
    case 'uploaded': return { key: 'fuel.uploaded', tone: 'blue' };
    case 'failed': return mark.retry && canRetry ? { key: 'fuel.failed', tone: 'red' } : { key: 'fuel.uploadFailed', tone: 'red' };
    case 'waitingWifi': return { key: 'fuel.waitingWifi', tone: 'amber' };
    case 'uploading': return { key: 'fuel.pctOfSize', vars: { pct: percentOf(mark.offset, mark.bytes), size: megabytes(mark.bytes) }, tone: 'blue' };
    case 'queued': return { key: 'fuel.uploading', vars: { pct: 0 }, tone: 'amber' };
    default: return { key: 'fuel.noVideo', tone: 'muted' };
  }
}
