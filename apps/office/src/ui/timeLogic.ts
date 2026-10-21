// The time field's rules (docs/ui-patterns.md §4), pure: what a whole time is, what typing on a desktop means ("9" is
// 09:00, "930" is 09:30, "14.30" is 14:30) and now in Colombo (where the clock starts). TimeField.tsx draws it; the clock's
// math is dialLogic.ts. No quick-time chips since 21 October 2026 (the boss's review: the clock only).
import { TZ } from "../lib/format";

/** A typed time counts this long after its last change, when it is whole and valid. */
export const TIME_SETTLE_MS = 1000;

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

/** Now to the minute (the clock picks any minute, 21 October 2026). */
export function nowExact(at: Date = new Date()): string {
  const [h, m] = clockFmt.format(at).split(":").map(Number);
  return fromMinutes((h % 24) * 60 + m);
}
