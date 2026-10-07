// The only server settings the app carries. Both are public: the database is
// protected by Row Level Security, not by hiding these. They come from
// apps/driver/.env when developing and from eas.json when building.

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export const isSupabaseConfigured = SUPABASE_URL !== '' && SUPABASE_PUBLISHABLE_KEY !== '';
