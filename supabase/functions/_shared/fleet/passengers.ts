// Round 4–7, feature 6 (Sahan, 22 October 2026): passengers on trips. Pure rules: the list a form or Claude sends, and the
// trip's words for someone without an account (Share trip, wa.me). The tables and the notices are the database's
// (migration 20261022120400_round6_passengers); the tools: tools/passengers.ts.

import { phoneE164 } from "./format.ts";

/** One passenger as sent: a registered office person (their id) or a typed name and an optional phone. */
export interface PassengerIn {
  person?: string;
  name?: string;
  phone?: string;
}

export interface PassengerRow {
  employee_id: string | null;
  name: string;
  phone: string | null;
}

export const MAX_PASSENGERS = 20;

/** The list checked and made into rows, or the first problem in words. `people` = the active office people by id. */
export function passengerRows(
  list: readonly PassengerIn[],
  people: ReadonlyMap<string, { name: string; phone: string | null }>,
): { rows: PassengerRow[] } | { error: string } {
  if (list.length > MAX_PASSENGERS) return { error: `At most ${MAX_PASSENGERS} passengers by name.` };
  const rows: PassengerRow[] = [];
  const seen = new Set<string>();
  for (const [i, p] of list.entries()) {
    const n = i + 1;
    if (p.person) {
      const who = people.get(p.person);
      if (!who) return { error: `Passenger ${n}: not an active office person. Search again or type the name.` };
      if (seen.has(p.person)) continue;
      seen.add(p.person);
      rows.push({ employee_id: p.person, name: who.name, phone: who.phone });
      continue;
    }
    const name = (p.name ?? "").trim().replace(/\s+/g, " ");
    if (!name) return { error: `Passenger ${n}: a name is needed.` };
    if (name.length > 120) return { error: `Passenger ${n}: the name is too long.` };
    let phone: string | null = null;
    if (p.phone && p.phone.trim()) {
      phone = phoneE164(p.phone);
      if (!phone) return { error: `Passenger ${n}: ${p.phone} is not a Sri Lankan phone number.` };
    }
    rows.push({ employee_id: null, name, phone });
  }
  return { rows };
}

/** The count a trip keeps: never under the names. Pure. */
export const countWith = (count: number | null | undefined, names: number): number | null =>
  names > 0 ? Math.max(count ?? 0, names) : count ?? null;

export interface ShareTrip {
  /** "Fri 24 Oct 08:00" */
  when: string;
  from?: string | null;
  to?: string | null;
  driver?: string | null;
  driverPhone?: string | null;
  plate?: string | null;
}

/** The trip in plain words for a passenger without an account (Share trip by WhatsApp). Pure. */
export function shareText(name: string, t: ShareTrip): string {
  const first = name.split(" ")[0];
  return [
    `Hi ${first}, your Fame trip: ${t.when}`,
    t.from || t.to ? [t.from, t.to].filter(Boolean).join(" → ") : null,
    t.driver ? `Driver: ${t.driver}${t.driverPhone ? ` ${t.driverPhone}` : ""}` : null,
    t.plate ? `Vehicle: ${t.plate}` : null,
  ].filter(Boolean).join("\n");
}
