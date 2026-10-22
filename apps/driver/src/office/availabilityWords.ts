// A vehicle's availability line in the person's language (Round 4–7, unify). Pure: scripts/test-availability-words.ts.
//
// The server says whether a vehicle is free as an English sentence:
//   - list_vehicles' `availability` (supabase/functions/_shared/fleet/tools/vehicles.ts availabilityOf): "Free",
//     "On a task · back ~14:30 (live)", "On a task · back ~14:30 (planned)", "On a task · end time not set",
//     "Booked later today · 16:00", "Booked · 09:00 (not started yet)", "In garage";
//   - suggest_vehicles' and availability's vehicle `availability` for the time asked (tools/requests.ts availabilityFor):
//     "in garage", "booked 09:00–12:00 · Team drop" (or "booked from 09:00 · …": fleet.ts taskWindow), "over km allowance",
//     "free all day", "free at that time (other task 09:00–12:00)"; a busy one's `back`: "back ~14:30", "end time not set".
// Office mode shows it the way office/statusWords.ts does a task's status: each sentence is read back into a key with its
// values (times, a task's title, as they are); one it does not know is shown as the server sent it, never a key.

import { type Words, wordsText } from './statusWords';

type T = (key: string, vars?: Record<string, string | number>) => string;

const TIME = '(\\d{2}:\\d{2})';
const WINDOW = '(\\d{2}:\\d{2}–\\d{2}:\\d{2}|from \\d{2}:\\d{2})';

/** A task's window: "06:00–13:00" as it is, "from 06:00" in words. */
function windowWords(s: string): string | Words {
  const m = s.match(new RegExp(`^from ${TIME}$`));
  return m ? { key: 'office.avail.fromTime', vars: { time: m[1] } } : s;
}

/** The server's availability sentence as a key with its values, or null for a sentence this app does not know. */
export function availabilityWords(line: string | undefined | null): Words | null {
  if (!line) return null;
  const s = line.trim();
  let m: RegExpMatchArray | null;
  // list_vehicles: the vehicle now.
  if (s === 'Free') return { key: 'office.avail.free' };
  if (s === 'In garage') return { key: 'office.avail.inGarage' };
  if ((m = s.match(new RegExp(`^On a task · back ~${TIME} \\((live|planned)\\)$`)))) return { key: `office.avail.onTask_${m[2]}`, vars: { time: m[1] } };
  if (s === 'On a task · end time not set') return { key: 'office.avail.onTaskNoEnd' };
  if ((m = s.match(new RegExp(`^Booked later today · ${TIME}$`)))) return { key: 'office.avail.bookedLater', vars: { time: m[1] } };
  if ((m = s.match(new RegExp(`^Booked · ${TIME} \\(not started yet\\)$`)))) return { key: 'office.avail.bookedNotStarted', vars: { time: m[1] } };
  // suggest_vehicles / availability: the vehicle for the time asked, and a busy one's way back.
  if (s === 'in garage') return { key: 'office.avail.then_garage' };
  if (s === 'free all day') return { key: 'office.avail.then_freeAllDay' };
  if (s === 'over km allowance') return { key: 'office.avail.then_overKm' };
  if ((m = s.match(new RegExp(`^free at that time \\(other task ${WINDOW}\\)$`)))) return { key: 'office.avail.then_free', vars: { window: windowWords(m[1]) } };
  if ((m = s.match(new RegExp(`^booked ${WINDOW} · (.+)$`)))) return { key: 'office.avail.then_booked', vars: { window: windowWords(m[1]), title: m[2] } };
  if ((m = s.match(new RegExp(`^back ~${TIME}$`)))) return { key: 'office.avail.back', vars: { time: m[1] } };
  if (s === 'end time not set') return { key: 'office.avail.endNotSet' };
  return null;
}

/** The availability line in the person's language (the server's own words when this app does not know the sentence). */
export function availabilityText(t: T, line: string | undefined | null): string {
  const w = availabilityWords(line);
  return w ? wordsText(t, w) : line ?? '';
}
