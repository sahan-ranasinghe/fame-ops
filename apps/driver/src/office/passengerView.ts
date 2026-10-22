// Office mode and /m/ (Round 4–7, feature 6; phase8-plan.md §33.3): a trip the person rides in, as my_trip answers it for a
// registered passenger (viewer passenger): the server's English live line and each stop's state as keys for the person's
// language. Pure: no react-native, no i18n; the page is app/office/my-trip/[id].tsx (components/office/Passengers.tsx).

import type { MyTrip, PassengerTrip } from './types';

export interface Words {
  key: string;
  vars?: Record<string, string | number>;
}

/** my_trip answered the passenger's view (the other answer is a no-app trip of the person's own). */
export const isPassengerView = (x: MyTrip | PassengerTrip | null | undefined): x is PassengerTrip => !!x && (x as PassengerTrip).viewer === 'passenger';

/**
 * The server's live line (tools/checks.ts passengerView): "On the way · 07:40", "Completed · 10:00", "Driver accepted",
 * "Sent to the driver", "Cancelled"; anything else as it came (`text`).
 */
export function liveWords(text: string): Words | { text: string } {
  const m = /^(On the way|Completed)(?: · (\d{2}:\d{2}))?$/.exec(text.trim());
  if (m) {
    const base = m[1] === 'On the way' ? 'office.passengers.live_onTheWay' : 'office.passengers.live_completed';
    return m[2] ? { key: base, vars: { time: m[2] } } : { key: `${base}NoTime` };
  }
  if (text === 'Cancelled') return { key: 'office.passengers.live_cancelled' };
  if (text === 'Driver accepted') return { key: 'office.passengers.live_accepted' };
  if (text === 'Sent to the driver') return { key: 'office.passengers.live_sent' };
  return { text };
}

/** A stop as it goes: "Done 08:05", "Arrived 10:52", "Planned 10:30", "Skipped"; nothing when there is nothing to say. */
export function stopWords(s: PassengerTrip['stops'][number]): Words | null {
  if (s.status === 'skipped') return { key: 'office.passengers.stop_skipped' };
  if (s.arrived) return { key: s.status === 'done' ? 'office.passengers.stop_done' : 'office.passengers.stop_arrived', vars: { time: s.arrived } };
  if (s.status === 'done') return { key: 'office.passengers.stop_doneNoTime' };
  return s.planned ? { key: 'office.passengers.stop_planned', vars: { time: s.planned } } : null;
}

/** The trip's state as a tone: on the way blue, done green, cancelled red, else plain. */
export const passengerTone = (status: string): 'blue' | 'green' | 'red' | 'muted' =>
  status === 'in_progress' ? 'blue' : status === 'completed' ? 'green' : status === 'cancelled' ? 'red' : 'muted';
