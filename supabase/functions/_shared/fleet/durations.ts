// Hotfix 2 (D): one way to say how long and when, everywhere: the office site (imported as @fleet/durations), the
// connector's answers and the push texts, in English and Sinhala. The driver app keeps a copy with its own strings
// (apps/driver/src/lib/durations.ts, the dur.* keys: the same words). Pure; days are Colombo days, digits Latin.
//
//   duration(75)          "1 h 15 min" · "2 h" · "2 d 3 h"     si "පැය 1 මිනිත්තු 15"
//   whenText(at, now)     future "in 45 min" · "in 3 h 20 min" · "tomorrow 09:00" · "Mon 19 Oct 09:00 (in 2 days)"
//                         past   "45 min ago" · "3 h 20 min ago" · "yesterday 09:00" · "Thu 15 Oct 09:00 (3 days ago)"
//
// Under half a minute is "now". The same Colombo day, or under 6 hours away, is said in hours and minutes ("in 5 h" at
// 22:00 for 03:00); another day by the day and the clock time ("tomorrow 09:00" rather than "in 20 h").
import { colomboDate, colomboDay, colomboTime, daysBetween } from "./time.ts";

export type DurLang = "en" | "si";

const WORDS: Record<DurLang, Record<string, string>> = {
  en: {
    now: "now",
    inMin: "in {n} min",
    inHours: "in {h} h {m} min",
    inHoursOnly: "in {h} h",
    tomorrow: "tomorrow {time}",
    later: "{date} {time} (in {days} days)",
    agoMin: "{n} min ago",
    agoHours: "{h} h {m} min ago",
    agoHoursOnly: "{h} h ago",
    yesterday: "yesterday {time}",
    earlier: "{date} {time} ({days} days ago)",
    minutes: "{n} min",
    hours: "{h} h {m} min",
    hoursOnly: "{h} h",
    days: "{d} d {h} h",
    daysOnly: "{d} d",
  },
  si: {
    now: "දැන්",
    inMin: "මිනිත්තු {n} කින්",
    inHours: "පැය {h} මිනිත්තු {m} කින්",
    inHoursOnly: "පැය {h} කින්",
    tomorrow: "හෙට {time}",
    later: "{date} {time} (දින {days} කින්)",
    agoMin: "මිනිත්තු {n} කට පෙර",
    agoHours: "පැය {h} මිනිත්තු {m} කට පෙර",
    agoHoursOnly: "පැය {h} කට පෙර",
    yesterday: "ඊයේ {time}",
    earlier: "{date} {time} (දින {days} කට පෙර)",
    minutes: "මිනිත්තු {n}",
    hours: "පැය {h} මිනිත්තු {m}",
    hoursOnly: "පැය {h}",
    days: "දින {d} පැය {h}",
    daysOnly: "දින {d}",
  },
};

/** Within this many minutes a time on another day is still said in hours ("in 5 h" late in the evening). */
const HOURS_REACH_MIN = 6 * 60;

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

/** The words, for a page or a test that wants them (the driver app's dur.* keys are the same). */
export function durationWords(lang: DurLang = "en"): Readonly<Record<string, string>> {
  return WORDS[lang];
}

/** How long: "45 min", "1 h 15 min", "2 h", from a day on "2 d 3 h" (a negative length is said as its size). */
export function duration(minutes: number, lang: DurLang = "en"): string {
  const w = WORDS[lang];
  const m = Math.round(Math.abs(minutes));
  if (m < 60) return fill(w.minutes, { n: m });
  if (m >= 24 * 60) {
    const d = Math.floor(m / (24 * 60));
    const h = Math.floor((m % (24 * 60)) / 60);
    return h === 0 ? fill(w.daysOnly, { d }) : fill(w.days, { d, h });
  }
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? fill(w.hoursOnly, { h }) : fill(w.hours, { h, m: rest });
}

/** When, from now: "in 45 min", "3 h 20 min ago", "tomorrow 09:00", "Mon 19 Oct 09:00 (in 2 days)", "now". */
export function whenText(at: Date | string, now: Date, lang: DurLang = "en"): string {
  const w = WORDS[lang];
  const target = new Date(at);
  const diffMin = (target.getTime() - now.getTime()) / 60000;
  const future = diffMin > 0;
  const m = Math.round(Math.abs(diffMin));
  if (m < 1) return w.now;
  if (m < 60) return fill(future ? w.inMin : w.agoMin, { n: m });
  const days = daysBetween(colomboDate(now), colomboDate(target));
  if (days === 0 || m < HOURS_REACH_MIN) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    if (rest === 0) return fill(future ? w.inHoursOnly : w.agoHoursOnly, { h });
    return fill(future ? w.inHours : w.agoHours, { h, m: rest });
  }
  const time = colomboTime(target);
  if (days === 1) return fill(w.tomorrow, { time });
  if (days === -1) return fill(w.yesterday, { time });
  return fill(days > 0 ? w.later : w.earlier, { date: colomboDay(target), time, days: Math.abs(days) });
}
