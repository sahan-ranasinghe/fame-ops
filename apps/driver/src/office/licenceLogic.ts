// Round 3 Part A5 (Sahan, 21 October 2026; Zipcar for Business and Enterprise CarShare keep each member's driving licence on
// file before they may drive): an office person's own driving licence on My profile, and what the approver sees on a
// request the asker drives themselves. The rules only (pure: no react-native, no i18n; scripts/test-part-a.ts).
//
//   My profile   the number and the expiry (update_my_profile licence_no / licence_expiry, only what changed, '' = null
//                clears it), the front and back photos (set_my_licence_photo, the driver's own path), all from GET /me's
//                `licence {number, expiry, state, front_url, back_url}`.
//   The approver "Self-drive · licence on file ✓" / "Self-drive · no licence on file" / "Self-drive · licence expired" from the
//                card's `self_drive_licence` (amber for the last two): a warning, never a block.

import type { LicenceState, MyLicence, RequestCard } from './types';

export interface LicenceForm {
  number: string;
  /** YYYY-MM-DD, or '' for none. */
  expiry: string;
}

export const licenceForm = (l?: MyLicence | null): LicenceForm => ({ number: l?.number ?? '', expiry: l?.expiry ?? '' });

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * update_my_profile's input for the licence: only what differs from /me (a number trimmed, '' = null clears it), or the
 * problem's key (an expiry that is not a date). An empty input = nothing to save.
 */
export function licenceInput(form: LicenceForm, was?: MyLicence | null): { input: Record<string, string | null>; problem: string | null } {
  const number = form.number.trim();
  const expiry = form.expiry.trim();
  if (expiry && !(DAY.test(expiry) && new Date(`${expiry}T00:00:00Z`).toISOString().slice(0, 10) === expiry)) {
    return { input: {}, problem: 'office.profile.licenceDateBad' };
  }
  const input: Record<string, string | null> = {};
  if (number !== (was?.number ?? '')) input.licence_no = number || null;
  if (expiry !== (was?.expiry ?? '')) input.licence_expiry = expiry || null;
  return { input, problem: null };
}

/** My profile's line for the licence: on file (green), none (amber), expired (red). */
export function licenceStateWords(state: LicenceState | undefined): { key: string; tone: 'green' | 'amber' | 'red' } {
  if (state === 'on_file') return { key: 'office.profile.licenceOnFile', tone: 'green' };
  if (state === 'expired') return { key: 'office.profile.licenceExpired', tone: 'red' };
  return { key: 'office.profile.licenceNone', tone: 'amber' };
}

/**
 * The approver's line on a request the asker drives themselves (the Approve tab's row and the request's page): the key and
 * whether it warns (amber). Null for any other request, or a card from before the server sent the state.
 */
export function selfDriveLine(q: Pick<RequestCard, 'driven_by' | 'self_drive_licence'>): { key: string; warn: boolean } | null {
  if (q.driven_by !== 'self' || !q.self_drive_licence) return null;
  if (q.self_drive_licence === 'on_file') return { key: 'office.who.licenceOnFile', warn: false };
  if (q.self_drive_licence === 'expired') return { key: 'office.who.licenceExpired', warn: true };
  return { key: 'office.who.licenceNone', warn: true };
}
