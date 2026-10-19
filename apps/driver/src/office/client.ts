// Office mode (Phase 8, O1): the phone's office-api client (office/api.ts) with the app's server address, key and the
// signed-in person's session. The token source tells "signed out" (null) from "the refresh did not get through"
// (lib/session.ts: a dropped call, so the screen says Fame Fleet did not answer and keeps the session).

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';
import { sessionKind } from '../lib/session';
import { supabase } from '../lib/supabase';
import { createOfficeApi } from './api';
import type { FleetError } from './types';

export async function officeToken(): Promise<string | null> {
  const answer = await supabase.auth.getSession();
  const kind = sessionKind(answer);
  if (kind === 'offline') throw { code: 'network', message: 'No connection to Fame Fleet.' } satisfies FleetError;
  return kind === 'ok' ? (answer.data.session?.access_token ?? null) : null;
}

export const officeApi = createOfficeApi({
  baseUrl: `${SUPABASE_URL}/functions/v1/office-api`,
  apiKey: SUPABASE_PUBLISHABLE_KEY,
  token: officeToken,
});
