// Round 3 (docs/phase8-plan.md §30, item 1): "Who drives?", the rental and car-sharing booking forms' "Who's driving?"
// (Turo, Enterprise: one question, three choices, the details under the chosen one). A driver with the app (the default),
// "I'll drive myself" (the person asking), or someone who is not in Fame Fleet (a name and a phone). The last two only
// while the fleet setting self_drive_allowed is on (off = every trip needs a driver: the question is not asked). A trip
// with no app behind it names a specific vehicle (a plate) wherever a vehicle is chosen now (Book now, Assign a task):
// nobody confirms one on the day. The old path, the vehicle's custodian driving it (driver_required false, the Teams
// artifact), is kept for a request that already asks it. Pure (scripts/test-who-drives.ts): no react-native, no i18n.

import { phoneE164, phoneLocal } from '../../lib/profile';
import type { AskedDrivenBy, DrivenBy, RequestCard } from '../types';

export type WhoChoice = 'driver' | 'self' | 'other';

export interface WhoDrives {
  /** custodian only for a request that already asks it (the old path); the form offers the three. */
  choice: AskedDrivenBy;
  /** Someone else: their name and phone (as typed). */
  name: string;
  phone: string;
}

export const WHO_CHOICES: readonly WhoChoice[] = ['driver', 'self', 'other'];

export const defaultWho = (): WhoDrives => ({ choice: 'driver', name: '', phone: '' });

/** The English refusals the copied site logic speaks (words.ts reasonText says them in the person's language). */
export const WHO_NEED_PLATE = 'Pick the vehicle (its plate): there is no app to choose one on the day.';
export const WHO_NEED_NAME = 'Someone else drives: add their name.';
export const WHO_NEED_PHONE = 'Someone else drives: add their phone, a Sri Lankan number such as 077 123 4567.';

/** The draft's choice, also from a draft saved before Round 3 (driverRequired false = the custodian drives). */
export function whoOf(req: { who?: WhoDrives; driverRequired?: boolean } | null | undefined): WhoDrives {
  if (req?.who) return req.who;
  return req?.driverRequired === false ? { choice: 'custodian', name: '', phone: '' } : defaultWho();
}

/** The choices offered: the three while self_drive_allowed is on; off = a driver only (the question is hidden). */
export const whoChoices = (selfDriveAllowed: boolean): WhoChoice[] => (selfDriveAllowed ? [...WHO_CHOICES] : ['driver']);

/** Nobody with the app drives it: the person asking, someone else, or the custodian. */
export const noApp = (w: Pick<WhoDrives, 'choice'>): boolean => w.choice !== 'driver';

/** A specific vehicle, never "on the day" or "any van" (a trip with no app names its plate). */
export const isPlate = (v: string | null | undefined): boolean => !!v && !!v.trim() && v.trim() !== 'on the day' && !/^any /.test(v.trim());

/**
 * What is missing for the choice, as the copied logic's English sentence (null = nothing): someone else's name and phone (a
 * Sri Lankan number); with `plate` (Book now, Assign a task) self and someone else need a specific vehicle.
 */
export function whoProblem(w: WhoDrives, opts: { plate?: string | null; needsPlate?: boolean } = {}): string | null {
  if (w.choice === 'other') {
    if (!w.name.trim()) return WHO_NEED_NAME;
    if (!phoneE164(w.phone)) return WHO_NEED_PHONE;
  }
  if (opts.needsPlate && (w.choice === 'self' || w.choice === 'other') && !isPlate(opts.plate)) return WHO_NEED_PLATE;
  return null;
}

/**
 * The arguments create_request, book_vehicle and create_task take for the choice: nothing for a driver (the default),
 * driven_by self, driven_by other with the name and the phone, and the old driver_required false for the custodian.
 */
export function whoInput(w: WhoDrives): Record<string, unknown> {
  switch (w.choice) {
    case 'self':
      return { driven_by: 'self' };
    case 'other':
      return { driven_by: 'other', driver_name: w.name.trim(), driver_phone: w.phone.trim() };
    case 'custodian':
      return { driver_required: false };
    default:
      return {};
  }
}

/** update_request: only what changed (a driver again, self, someone else with the name and phone, or back to the custodian). */
export function whoChanges(now: WhoDrives, was: WhoDrives): Record<string, unknown> {
  const t = (s: string) => s.trim();
  if (now.choice === was.choice && (now.choice !== 'other' || (t(now.name) === t(was.name) && t(now.phone) === t(was.phone)))) return {};
  if (now.choice === 'driver') return { driven_by: 'driver' };
  return whoInput(now);
}

/** The edit form's choice from the request's fields (driven_by; an older card: driver_required false = the custodian). */
export function whoFromFields(f?: { driven_by?: string; driver_required?: boolean; driver_name?: string; driver_phone?: string } | null): WhoDrives {
  const choice = (['driver', 'self', 'other', 'custodian'] as const).find((c) => c === f?.driven_by)
    ?? (f?.driver_required === false ? 'custodian' : 'driver');
  return { choice, name: choice === 'other' ? f?.driver_name ?? '' : '', phone: choice === 'other' ? f?.driver_phone ?? '' : '' };
}

/** The small word under a task's driver instead of the duty state (the i18n key), or null for a driver. */
export function drivenByKey(d: DrivenBy | string | null | undefined): string | null {
  return d === 'self' ? 'office.who.drivesThemselves' : d === 'other' ? 'office.who.someoneElse' : null;
}

/** What a request asked, as Approve says it (a key and its values); null = a driver. */
export function askedWords(q: Pick<RequestCard, 'driven_by' | 'driver_name' | 'driver_phone' | 'driver_required' | 'requested_by' | 'on_behalf_of'>): { key: string; vars: Record<string, string> } | null {
  const asked = q.driven_by ?? (q.driver_required === false ? 'custodian' : undefined);
  if (asked === 'self') return { key: 'office.who.askedSelf', vars: { name: q.requested_by } };
  if (asked === 'other') {
    return q.driver_phone
      ? { key: 'office.who.askedOtherPhone', vars: { name: q.driver_name ?? '', phone: phoneLocal(q.driver_phone) } }
      : { key: 'office.who.askedOther', vars: { name: q.driver_name ?? '' } };
  }
  if (asked === 'custodian') return { key: 'office.who.askedCustodian', vars: {} };
  return null;
}

/** The request asks for no driver (self, someone else, the custodian): the approver picks the vehicle, no driver first. */
export const asksNoDriver = (q: Pick<RequestCard, 'driven_by' | 'driver_required'>): boolean =>
  q.driven_by === 'self' || q.driven_by === 'other' || q.driven_by === 'custodian' || q.driver_required === false;
