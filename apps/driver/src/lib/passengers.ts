// Round 4–7, feature 6 (docs/phase8-plan.md §33.3): who rides on the driver's task. The driver reads their own tasks'
// passengers (RLS on task_passengers: id, task_id, name, phone, removed_at; removed_at null = riding), read with the tasks
// (lib/api.ts fetchTasks), so they show offline from the copy on the phone. The count (tasks.passengers) stays as it was:
// "5 passengers · Contact: …"; under it the names, and on the task and its preview each name with Call when it has a phone
// (lib/contacts.ts: tel: opens the dialler with the number filled, nothing dials by itself). The switch passengers
// (get_driver_settings) off: the count only, as before. Pure, so scripts/test-fuel-card.ts runs it.

import { phoneDisplay } from './contacts';
import { phoneDigits } from './format';

export interface Passenger {
  id: string;
  name: string;
  phone: string | null;
  removed_at?: string | null;
}

/** The names shown on Today's card before "+N more". */
export const NAMES_ON_CARD = 2;

/** The passengers riding (removed ones left out), in the order the office added them, each name once. */
export function ridingPassengers(list: readonly Passenger[] | null | undefined): Passenger[] {
  const seen = new Set<string>();
  return (list ?? []).filter((p) => {
    if (p.removed_at || !p.name?.trim()) return false;
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Today's card: "Nimal Perera, Kamal Silva +3 more" (null with no names, or the switch off). */
export function namesLine(t: Translate, list: readonly Passenger[] | null | undefined, on: boolean, max = NAMES_ON_CARD): string | null {
  const riding = on ? ridingPassengers(list) : [];
  if (riding.length === 0) return null;
  const names = riding.slice(0, max).map((p) => p.name.trim()).join(', ');
  const more = riding.length - Math.min(max, riding.length);
  return more > 0 ? `${names} ${t('pax.more', { n: more })}` : names;
}

/** One passenger's row: the name, the number as the office shows it, and the dialler's link (none without a number). */
export interface PassengerRow {
  id: string;
  name: string;
  display: string | null;
  tel: string | null;
}

export function passengerRows(list: readonly Passenger[] | null | undefined, on: boolean): PassengerRow[] {
  if (!on) return [];
  return ridingPassengers(list).map((p) => {
    const digits = phoneDigits(p.phone);
    return { id: p.id, name: p.name.trim(), display: p.phone && digits ? phoneDisplay(p.phone) : null, tel: p.phone && digits ? `tel:+${digits}` : null };
  });
}
