// Round 4–7, feature 7 (22 October 2026): the Timeline's layout, pure (/schedule; Google Calendar's resource view): a day
// from 06:00 to 22:00 as a track, each booking a bar placed by its time (left and width in % of the track, clamped to it;
// a booking with no end shown as an hour), bookings that overlap in one row on lanes of their own, the hour ticks, the
// "now" line, a driver's not-available entries as hatched bars, and the words of a booking and of a row.
import type { DayTimeline } from "../data/types";
import { joinDots } from "../lib/format";

export type TimelineRow = DayTimeline["rows"][number];
export type Booking = TimelineRow["bookings"][number];
export type TimelineKind = DayTimeline["kind"];

export const TIMELINE_KINDS: readonly TimelineKind[] = ["drivers", "vehicles"];

/** The track: 06:00–22:00 in minutes of the day. */
export const TRACK_FROM = 6 * 60;
export const TRACK_TO = 22 * 60;
const TRACK = TRACK_TO - TRACK_FROM;
/** A booking with no end is drawn as this long. */
export const NO_END_MIN = 60;
/** The narrowest bar (a few minutes, or one outside the track at its edge), % of the track. */
export const MIN_WIDTH = 1.5;

/** "08:30" → 510; anything else → null. */
export function minutesOf(hhmm: string | undefined | null): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm?.trim() ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
}

const pct = (minutes: number) => ((minutes - TRACK_FROM) / TRACK) * 100;
const round = (n: number) => Math.round(n * 100) / 100;

export interface Bar {
  /** % of the track from its left edge. */
  left: number;
  /** % of the track. */
  width: number;
  /** It starts before 06:00 / goes on after 22:00 (or past midnight). */
  before: boolean;
  after: boolean;
  /** No end time: drawn as NO_END_MIN. */
  open: boolean;
}

/**
 * Where a booking (or a not-available entry) sits on the track. An end before the start (past midnight) runs to the
 * track's end; one wholly outside the track is a thin bar at that edge. Null when the start is unreadable.
 */
export function barOf(from: string, to?: string | null): Bar | null {
  const start = minutesOf(from);
  if (start === null) return null;
  const endRead = minutesOf(to);
  const open = endRead === null;
  const end = open ? start + NO_END_MIN : endRead <= start ? 24 * 60 : endRead;
  const s = Math.max(TRACK_FROM, Math.min(TRACK_TO, start));
  const e = Math.max(TRACK_FROM, Math.min(TRACK_TO, end));
  let left = pct(s);
  let width = pct(e) - pct(s);
  if (width < MIN_WIDTH) {
    width = MIN_WIDTH;
    if (left + width > 100) left = 100 - width;
  }
  return { left: round(left), width: round(width), before: start < TRACK_FROM, after: end > TRACK_TO, open };
}

/** The hour marks along the track: 06:00, 08:00 … 22:00 at their %. */
export function hourTicks(step = 2): { label: string; left: number }[] {
  const out: { label: string; left: number }[] = [];
  for (let m = TRACK_FROM; m <= TRACK_TO; m += step * 60) out.push({ label: `${String(m / 60).padStart(2, "0")}:00`, left: round(pct(m)) });
  return out;
}

/** The "now" line's % (today only, inside the track), else null. */
export function nowLeft(now: string | null | undefined): number | null {
  const m = minutesOf(now);
  return m === null || m < TRACK_FROM || m > TRACK_TO ? null : round(pct(m));
}

/**
 * Bookings that overlap in one row each get a lane (Google Calendar's side-by-side events, here one under the other):
 * the lane of each booking in the given order, and how many lanes the row needs.
 */
export function lanesOf(bookings: readonly Pick<Booking, "from" | "to">[]): { lanes: number[]; count: number } {
  const ends: number[] = [];
  const lanes = bookings.map((b) => {
    const start = minutesOf(b.from) ?? 0;
    const endRead = minutesOf(b.to);
    const end = endRead === null ? start + NO_END_MIN : endRead <= start ? 24 * 60 : endRead;
    let lane = ends.findIndex((e) => e <= start);
    if (lane < 0) lane = ends.length;
    ends[lane] = end;
    return lane;
  });
  return { lanes, count: Math.max(1, ends.length) };
}

/** A booking's state as the bar's look: done (grey), under way (blue), planned (amber). */
export function bookingTone(status: string): "done" | "live" | "planned" {
  if (status === "completed") return "done";
  if (status === "in_progress") return "live";
  return "planned";
}

/** "Planned", "On the way", "Done". */
export const STATUS_WORD: Record<ReturnType<typeof bookingTone>, string> = { planned: "Planned", live: "On the way", done: "Done" };

/** "08:00–11:00", or "from 08:00" when there is no end. */
export const bookingTime = (b: Pick<Booking, "from" | "to">): string => (b.to ? `${b.from}–${b.to}` : `from ${b.from}`);

/** "Anoja asked for it" / "Nimal assigned it", or nothing (holder_contact off). */
export const holderWords = (b: Pick<Booking, "holder">): string =>
  b.holder ? `${b.holder.name} ${b.holder.by === "asked" ? "asked for it" : "assigned it"}` : "";

/** A bar's full words (its title and what a screen reader says): the trip, the time, the state, the other side, the holder. */
export function bookingLabel(b: Booking, kind: TimelineKind): string {
  return joinDots([b.title, bookingTime(b), STATUS_WORD[bookingTone(b.status)], kind === "drivers" ? b.vehicle : b.driver, holderWords(b)]);
}

const PART_WORDS: Record<string, string> = { full_day: "all day", morning: "morning", afternoon: "afternoon" };
const REASON_WORDS: Record<string, string> = { leave: "leave", half_day: "half day", personal: "personal" };

/** A not-available entry's words: "Not available 13:00–22:00 · afternoon · leave" (the codes in words, never raw). */
export function notAvailableText(u: NonNullable<TimelineRow["not_available"]>[number]): string {
  return joinDots([`Not available ${u.from}–${u.to}`, u.part ? PART_WORDS[u.part] : undefined, u.reason ? REASON_WORDS[u.reason] : undefined]);
}

/** A row's bookings by their start. */
export const byStart = (bookings: readonly Booking[]): Booking[] =>
  [...bookings].sort((a, b) => (minutesOf(a.from) ?? 0) - (minutesOf(b.from) ?? 0));

/** The header's count: "3 of 12 busy". */
export const busyLine = (t: Pick<DayTimeline, "busy" | "count">): string => `${t.busy} of ${t.count} busy`;
