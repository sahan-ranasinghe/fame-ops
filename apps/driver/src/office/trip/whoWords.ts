// Round 3, "Who drives?" in Office mode: the app's own part beside the site's rules (whoDrivesLogic.ts is the site's file,
// copied by scripts/shared-logic.mjs). Here: the choices as i18n keys, the small word under a task's driver, what a request
// asked as a key, a draft saved before the shared rules (its `choice`), and what keeps the Who step's Next disabled. Pure
// (scripts/test-who-drives.ts): no react-native, no i18n.

import type { RequestCard } from '../types';
import { isChoice } from './vehicleChoiceLogic';
import { emptyWho, needsPlate, plateReason, type DrivenBy, type WhoDrivesValue, whoInput } from './whoDrivesLogic';
import { phoneLocal } from '../../lib/profile';

/** The three answers in order (the words are office.who.* keys). */
export const WHO_CHOICES: readonly DrivenBy[] = ['driver', 'self', 'other'];

/**
 * The draft's answer: the shared shape ({ by }), a draft saved before it ({ choice }; the custodian reads as a driver, as on
 * the site), or none (a driver).
 */
export function whoOfDraft(req: { who?: Partial<WhoDrivesValue> & { choice?: string } } | null | undefined): WhoDrivesValue {
  const w = req?.who;
  if (!w) return emptyWho();
  const by = w.by ?? w.choice;
  return { by: by === 'self' || by === 'other' ? by : 'driver', name: w.name ?? '', phone: w.phone ?? '' };
}

/** A specific vehicle, never "on the day" or "any van" (a trip with no app names its plate). */
export const isPlate = (v: string | null | undefined): boolean => !!v && !!v.trim() && !isChoice(v.trim());

/**
 * What keeps Next disabled for the answer, as the shared rules say it in English (words.ts reasonText gives the key): someone
 * else's name or phone missing; with `needsPlate` (Book now, Assign a task) self and someone else need a plate. Null = fine.
 */
export function whoReason(w: WhoDrivesValue, opts: { needsPlate?: boolean; plate?: string | null } = {}): string | null {
  const input = whoInput(w);
  if ('error' in input) return input.error;
  if (opts.needsPlate && needsPlate(w.by) && !isPlate(opts.plate)) return plateReason(w);
  return null;
}

/** The small word under a task's driver instead of the duty state (the i18n key), or null for a driver. */
export function drivenByKey(d: DrivenBy | string | null | undefined): string | null {
  return d === 'self' ? 'office.who.drivesThemselves' : d === 'other' ? 'office.who.someoneElse' : null;
}

/** What a request asked, as Approve says it (a key and its values); null = a driver. */
export function askedKey(q: Pick<RequestCard, 'driven_by' | 'driver_name' | 'driver_phone' | 'driver_required' | 'requested_by' | 'on_behalf_of'>): { key: string; vars: Record<string, string> } | null {
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
