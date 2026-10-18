// Part 6 (store readiness): the prominent disclosure before Android's location question. Google Play (and Apple) want the
// app to say, on its own screen and before the system's dialog, what location it collects, why, and that it does so in the
// background, with an Agree. components/LocationDisclosure.tsx shows it; the Permissions screen and "Where are you now?"
// ask Android only after it. The agreement is kept on the phone per driver (another driver signing in sees it again).

import { getJson, KEYS, setJson } from './kv';

export interface DisclosureAgreement {
  employeeId: string;
  at: number;
}

/** Whether this driver agreed on this phone. */
export function locationDisclosureAgreed(employeeId: string | null | undefined): boolean {
  const stored = getJson<DisclosureAgreement>(KEYS.locationDisclosure);
  return !!stored && !!employeeId && stored.employeeId === employeeId;
}

export function agreeLocationDisclosure(employeeId: string, now = Date.now()): void {
  setJson(KEYS.locationDisclosure, { employeeId, at: now } satisfies DisclosureAgreement);
}
