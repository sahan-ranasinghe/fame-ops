// The only server settings the app carries. Both are public: the database is
// protected by Row Level Security, not by hiding these.
//
// They come from EXPO_PUBLIC_* variables (apps/driver/.env when developing,
// eas.json when building). An update published with `eas update` does not read
// either of those, so the same two values are also kept in app.json ("extra")
// as a fallback: the app can never end up without its server.

import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { supabaseUrl?: string; supabasePublishableKey?: string };

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || extra.supabaseUrl || '';
export const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || extra.supabasePublishableKey || '';

export const isSupabaseConfigured = SUPABASE_URL !== '' && SUPABASE_PUBLISHABLE_KEY !== '';
