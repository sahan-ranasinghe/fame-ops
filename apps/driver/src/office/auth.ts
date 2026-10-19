// Office mode (Phase 8, O1): the office sign-in (design 01, "Office": work e-mail and password through Supabase Auth, the
// same account as the site), who this is (GET /me) and sign-out. The rules of 19 October 2026:
//   - signed out only on a 401 or 403 ('signed_out', 'no_office_role', 'switched_off'); a /me that is dropped is asked
//     again once by the client, and if it still fails the person stays signed in ('unreachable': Try again);
//   - a token that could not be refreshed for want of a connection is offline, not signed out (lib/session.ts);
//   - an office sign-in starts nothing driver-side (no duty, no location, no push registration here), and a driver's
//     sign-in on this phone is cleared first (one person per phone).
// No phone-only code but the Supabase client and the kv store: scripts/test-office.ts runs loadMe with a fake api.

import { isSupabaseConfigured } from '../config';
import { getJson, KEYS, remove } from '../lib/kv';
import { sessionKind } from '../lib/session';
import { supabase } from '../lib/supabase';
import { signedOut } from './api';
import { officeApi } from './client';
import { getOfficeMe, OFFICE_KEYS, setOfficeMe } from './store';
import type { FleetError, Me } from './types';
import { setJson } from '../lib/kv';

export type OfficeSignInOutcome = 'ok' | 'wrong' | 'network' | 'no_office_role' | 'switched_off' | 'mfa_required' | 'not_configured';

/** The outcome of asking who this is. */
export type MeOutcome = { kind: 'ok'; me: Me } | { kind: 'signed_out'; why: 'signed_out' | 'no_office_role' | 'switched_off' | 'mfa_required' } | {
  kind: 'unreachable';
  error: FleetError;
};

/** GET /me through `api`: ok, signed out (a 401 or 403 only), or unreachable (anything else: the session is kept). */
export async function loadMe(api: Pick<typeof officeApi, 'me'>): Promise<MeOutcome> {
  try {
    return { kind: 'ok', me: await api.me() };
  } catch (e) {
    const error = e as FleetError;
    if (!signedOut(error)) return { kind: 'unreachable', error };
    const why = error.code === 'not_an_office_user' ? 'no_office_role' : error.code === 'switched_off' ? 'switched_off' : error.code === 'mfa_required' ? 'mfa_required' : 'signed_out';
    return { kind: 'signed_out', why };
  }
}

/** The Office sign-in: Auth, then /me. A wrong password or an account that is no office account never leaves a session behind. */
export async function signInOffice(email: string, password: string): Promise<OfficeSignInOutcome> {
  if (!isSupabaseConfigured) return 'not_configured';
  // One person per phone: a driver's sign-in on this phone goes first (the driver app forgets its data at its next start).
  if (getJson(KEYS.me)) {
    await supabase.auth.signOut({ scope: 'local' });
    remove(KEYS.me);
  }
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) return error.status !== undefined && error.status >= 400 && error.status < 500 ? 'wrong' : 'network';
  const outcome = await loadMe(officeApi);
  if (outcome.kind === 'ok') {
    setOfficeMe(outcome.me);
    setJson(OFFICE_KEYS.email, email.trim().toLowerCase());
    return 'ok';
  }
  if (outcome.kind === 'signed_out') {
    await supabase.auth.signOut({ scope: 'local' });
    return outcome.why === 'no_office_role' ? 'no_office_role' : outcome.why === 'switched_off' ? 'switched_off' : outcome.why === 'mfa_required' ? 'mfa_required' : 'wrong';
  }
  // Auth answered but office-api did not: the session is kept and the person is signed in with what /me will say later.
  await supabase.auth.signOut({ scope: 'local' });
  return 'network';
}

/** Who this is, again (on start, on Try again, after the profile changed): the store follows; signed out clears it. */
export async function refreshOfficeMe(): Promise<MeOutcome> {
  const outcome = await loadMe(officeApi);
  if (outcome.kind === 'ok') setOfficeMe(outcome.me);
  else if (outcome.kind === 'signed_out') {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    setOfficeMe(null);
  }
  return outcome;
}

/** On start: an office person on this phone whose session is gone for good is signed out; offline keeps everything. */
export async function bootOffice(): Promise<void> {
  if (!getOfficeMe()) return;
  const kind = sessionKind(await supabase.auth.getSession());
  if (kind === 'none') setOfficeMe(null);
}

export async function signOutOffice(): Promise<void> {
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  setOfficeMe(null);
}
