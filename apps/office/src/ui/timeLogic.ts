// The time field's rules (docs/ui-patterns.md §4), pure: what a whole time is, what typing on a desktop means ("9" is
// 09:00, "930" is 09:30, "14.30" is 14:30), Now rounded up to the next 5 minutes in Colombo, the office day's common
// times, and the 5-minute list the time sheet scrolls. TimeField.tsx draws it.
import { TZ } from "../lib/format";

/** A typed time counts this long after its last change, when it is whole and valid. */
export const TIME_SETTLE_MS = 1000;

/** The list's step. */
export const STEP_MIN = 5;

/** The office day's common times, the sheet's chips. */
/** The presets over the clock (Sahan, 21 October 2026): Now, then these. */
export const COMMON_TIMES = ["08:00", "09:00", "12:00", "13:00", "17:00"] as const;

/** "07:05", "23:59": a whole time (no seconds). */
export const isWholeTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

const pad = (n: number) => String(n).padStart(2, "0");
const fromMinutes = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
export const toMinutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));

/**
 * What a typed text means as a time: "" for an emptied field, "HH:MM" for a time, null for anything else.
 * Accepted: "9" "09" (the hour), "930" "0930" (hour and minutes), "9:30" "09:30" "9.30" "9 30".
 */
export function parseTyped(text: string): string | "" | null {
  const t = text.trim();
  if (!t) return "";
  let h: number;
  let m: number;
  const sep = /^(\d{1,2})[:.\s](\d{2})$/.exec(t);
  if (sep) {
    h = Number(sep[1]);
    m = Number(sep[2]);
  } else if (/^\d{1,2}$/.test(t)) {
    h = Number(t);
    m = 0;
  } else if (/^\d{3,4}$/.test(t)) {
    h = Number(t.slice(0, t.length - 2));
    m = Number(t.slice(-2));
  } else return null;
  if (h > 23 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

const clockFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

/** Now in Colombo, rounded up to the next 5 minutes (10:41 → 10:45; 10:45 stays; 23:58 → 23:55, never tomorrow). */
/** Now to the minute (the clock picks any minute, 21 October 2026). */
export function nowExact(at: Date = new Date()): string {
  const [h, m] = clockFmt.format(at).split(":").map(Number);
  return fromMinutes((h % 24) * 60 + m);
}

export function nowRounded(at: Date = new Date()): string {
  const [h, m] = clockFmt.format(at).split(":").map(Number);
  const mins = (h % 24) * 60 + m;
  const up = Math.ceil(mins / STEP_MIN) * STEP_MIN;
  return fromMinutes(Math.min(up, 24 * 60 - STEP_MIN));
}

/** Every time of the day in `step`-minute steps: 00:00, 00:05 … 23:55. */
export function timeSteps(step = STEP_MIN): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += step) out.push(fromMinutes(m));
  return out;
}

/** The list's row nearest a value (07:24 → 07:25), where the list scrolls to. "" → the fallback (now). */
export function nearestStep(value: string, fallback: string, step = STEP_MIN): string {
  const v = isWholeTime(value) ? value : fallback;
  if (!isWholeTime(v)) return "09:00";
  const m = Math.round(toMinutes(v) / step) * step;
  return fromMinutes(Math.min(m, 24 * 60 - step));
}

/** The sheet's chips: the suggested time first (when it is one), Now, then the common times; no time twice. */
export function sheetChips(now: string, suggested?: string): { time: string; label: string; kind: "suggested" | "now" | "common" }[] {
  const out: { time: string; label: string; kind: "suggested" | "now" | "common" }[] = [];
  const seen = new Set<string>();
  if (suggested && isWholeTime(suggested)) {
    out.push({ time: suggested, label: `Planned ${suggested}`, kind: "suggested" });
    seen.add(suggested);
  }
  // "Now" is its own choice, and every common time is always there (21 October 2026): from 08:56 "Now" is 09:00, and the
  // 09:00 chip used to give way to it, so the time an office person looks for was gone for those minutes.
  out.push({ time: now, label: `Now · ${now}`, kind: "now" });
  for (const t of COMMON_TIMES) if (!seen.has(t)) out.push({ time: t, label: t, kind: "common" });
  return out;
}
