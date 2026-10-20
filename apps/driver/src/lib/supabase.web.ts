// The mobile website (Phase 8, O4): the same Supabase client as the app, with the session kept by the browser
// (supabase-js's own localStorage store, as the desktop site does). Only the URL and the publishable key reach the page.

import { createClient } from '@supabase/supabase-js';

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';
import type { Database } from './database.types';

export const supabase = createClient<Database>(
  SUPABASE_URL || 'https://not-configured.invalid',
  SUPABASE_PUBLISHABLE_KEY || 'not-configured',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } },
);
