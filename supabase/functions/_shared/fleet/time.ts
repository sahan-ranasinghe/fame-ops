// Times are stored in UTC and shown in Asia/Colombo. Sri Lanka is UTC+05:30
// all year (no daylight saving), so a fixed offset is exact.

export const TIME_ZONE = "Asia/Colombo";
const OFFSET = "+05:30";
const OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const two = (n: number) => String(n).padStart(2, "0");

/** A Date whose UTC fields read as Colombo wall-clock time. */
function wall(at: Date | string): Date {
  return new Date(new Date(at).getTime() + OFFSET_MS);
}

/** "2026-10-07" */
export function colomboDate(at: Date | string): string {
  const d = wall(at);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${
    two(d.getUTCDate())
  }`;
}

/** "07:06" */
export function colomboTime(at: Date | string): string {
  const d = wall(at);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** "2026-10-07 07:06" */
export function colomboDateTime(at: Date | string): string {
  return `${colomboDate(at)} ${colomboTime(at)}`;
}

/** "Thu 8 Oct" */
export function colomboDay(at: Date | string): string {
  const d = wall(at);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Thu 8 Oct 06:30" */
export function colomboDayTime(at: Date | string): string {
  return `${colomboDay(at)} ${colomboTime(at)}`;
}

/** "18 Oct" for a plain date such as "2026-10-18". */
export function shortDate(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

/** Colombo date + time -> UTC ISO string for the database. */
export function utcIso(date: string, time = "00:00"): string {
  return new Date(`${date}T${time}:00${OFFSET}`).toISOString();
}

export function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

export function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString().slice(0, 10);
}

/** Whole days from one plain date to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() -
      new Date(`${from}T00:00:00Z`).getTime()) / DAY_MS,
  );
}

/** The UTC range [from, to) covering one Colombo day. */
export function dayRange(date: string): { from: string; to: string } {
  return { from: utcIso(date), to: utcIso(addDays(date, 1)) };
}

/** The UTC range [from, to) covering one Colombo month, given "YYYY-MM". */
export function monthRange(
  month: string,
): { from: string; to: string; firstDay: string } {
  const [year, m] = month.split("-").map(Number);
  const firstDay = `${month}-01`;
  const next = m === 12 ? `${year + 1}-01-01` : `${year}-${two(m + 1)}-01`;
  return { from: utcIso(firstDay), to: utcIso(next), firstDay };
}

export function minutesSince(at: string, now: Date): number {
  return Math.max(
    0,
    Math.floor((now.getTime() - new Date(at).getTime()) / 60000),
  );
}

/** "2 min", "3 h", "4 d" */
export function ago(at: string, now: Date): string {
  const minutes = minutesSince(at, now);
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / (24 * 60))} d`;
}
