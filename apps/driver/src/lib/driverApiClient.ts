// The phone's driver-api client (lib/driverApi.ts) with the app's server address, key and session.

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';
import { createDriverApi } from './driverApi';
import { supabase } from './supabase';

export const driverApi = createDriverApi({
  baseUrl: `${SUPABASE_URL}/functions/v1/driver-api`,
  apiKey: SUPABASE_PUBLISHABLE_KEY,
  // getSession refreshes a token that has run out before answering.
  token: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
});
