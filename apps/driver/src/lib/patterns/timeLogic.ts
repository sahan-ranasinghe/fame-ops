// The time sheet's rules (docs/ui-patterns.md §4), pure: the 5-minute steps, Now rounded up to the next 5 minutes, the
// common times of the office day, where the list scrolls to.

export const STEP_MIN = 5;
export const COMMON_TIMES = ['07:00', '08:00', '09:00', '12:00', '13:00', '17:00'] as const;

export const isHHMM = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

const toMin = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
const fromMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Every time of the day in 5-minute steps (288). */
export const TIME_STEPS: readonly string[] = Array.from({ length: (24 * 60) / STEP_MIN }, (_, i) => fromMin(i * STEP_MIN));

/** Now rounded up to the next 5 minutes ("07:02" → "07:05"; "23:58" → "23:55": never past midnight). */
export function nowRounded(now: string): string {
  if (!isHHMM(now)) return '00:00';
  const m = toMin(now);
  const up = Math.ceil(m / STEP_MIN) * STEP_MIN;
  return fromMin(Math.min(up, 24 * 60 - STEP_MIN));
}

/** The step the list opens at: the value, else the suggestion, else now — each rounded down to its 5 minutes. */
export function openIndex(value: string, suggested: string | undefined, now: string): number {
  const pick = isHHMM(value) ? value : suggested && isHHMM(suggested) ? suggested : nowRounded(now);
  return Math.floor(toMin(pick) / STEP_MIN);
}

/** The chips over the list: the suggestion first (when it is not a common time), Now, then the common times. */
export function quickTimes(now: string, suggested?: string): { key: string; time: string; kind: 'suggested' | 'now' | 'common' }[] {
  const out: { key: string; time: string; kind: 'suggested' | 'now' | 'common' }[] = [];
  if (suggested && isHHMM(suggested)) out.push({ key: 'suggested', time: suggested, kind: 'suggested' });
  out.push({ key: 'now', time: nowRounded(now), kind: 'now' });
  for (const c of COMMON_TIMES) if (!out.some((o) => o.time === c)) out.push({ key: c, time: c, kind: 'common' });
  return out;
}
