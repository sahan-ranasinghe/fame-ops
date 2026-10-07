// Times are stored in UTC and shown in Asia/Colombo. Sri Lanka is UTC+05:30
// all year, so a fixed offset is exact. Digits are always Latin.

const OFFSET_MS = 5.5 * 60 * 60 * 1000;
const two = (n: number) => String(n).padStart(2, '0');

/** A Date whose UTC fields read as Colombo wall-clock time. */
function wall(at: Date | string | number): Date {
  return new Date(new Date(at).getTime() + OFFSET_MS);
}

/** "2026-10-07" */
export function colomboDate(at: Date | string | number = new Date()): string {
  const d = wall(at);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
}

/** "07:06" */
export function colomboTime(at: Date | string | number): string {
  const d = wall(at);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

export function colomboHour(at: Date | string | number = new Date()): number {
  return wall(at).getUTCHours();
}

/** Day of week (0 = Sunday), day of month and month (0 = January), for translated date labels. */
export function colomboParts(at: Date | string | number): { weekday: number; day: number; month: number } {
  const d = wall(at);
  return { weekday: d.getUTCDay(), day: d.getUTCDate(), month: d.getUTCMonth() };
}

/** UTC instant of 00:00 Colombo time on the given Colombo date. */
export function startOfColomboDay(date: string): Date {
  return new Date(`${date}T00:00:00+05:30`);
}

/** UTC instant of 00:00 on the first day of the month that contains `at`. */
export function startOfColomboMonth(at: Date | string | number = new Date()): Date {
  return new Date(`${colomboDate(at).slice(0, 7)}-01T00:00:00+05:30`);
}

export function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
}
