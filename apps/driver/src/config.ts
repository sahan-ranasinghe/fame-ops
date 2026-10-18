// The only server settings the app carries. Both are public: the database is
// protected by Row Level Security, not by hiding these.
//
// They come from EXPO_PUBLIC_* variables (apps/driver/.env when developing,
// eas.json when building). An update published with `eas update` does not read
// either of those, so the same two values are also kept in app.json ("extra")
// as a fallback: the app can never end up without its server.

import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { supabaseUrl?: string; supabasePublishableKey?: string; officePhone?: string; privacyUrl?: string };

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || extra.supabaseUrl || '';
export const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || extra.supabasePublishableKey || '';
/** The office's phone number for "Call office" on the Location screen. Empty = no button. */
export const OFFICE_PHONE = process.env.EXPO_PUBLIC_OFFICE_PHONE || extra.officePhone || '';

/** Part 6: the privacy policy on the office site (sign-in, Me and the location disclosure link to it). */
export const PRIVACY_URL = extra.privacyUrl || 'https://fame-fleet.pages.dev/privacy';

export const isSupabaseConfigured = SUPABASE_URL !== '' && SUPABASE_PUBLISHABLE_KEY !== '';
