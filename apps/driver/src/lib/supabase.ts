// The Supabase client. The sign-in session is kept in the phone's secure
// store, so the driver stays signed in and the background location task can
// upload without the app being open.

import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';
import type { Database } from './database.types';

// One secure-store entry holds about 2 KB; a session is larger, so it is
// stored in pieces: <key>.n = number of pieces, <key>.0, <key>.1, ...
const PIECE = 1800;

const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = Number(await SecureStore.getItemAsync(`${key}.n`));
    if (!count) return null;
    const pieces = await Promise.all(Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${key}.${i}`)));
    return pieces.some((piece) => piece == null) ? null : pieces.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    const before = Number(await SecureStore.getItemAsync(`${key}.n`)) || 0;
    const count = Math.ceil(value.length / PIECE);
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(`${key}.${i}`, value.slice(i * PIECE, (i + 1) * PIECE));
    }
    await SecureStore.setItemAsync(`${key}.n`, String(count));
    for (let i = count; i < before; i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
  },
  async removeItem(key: string): Promise<void> {
    const count = Number(await SecureStore.getItemAsync(`${key}.n`)) || 0;
    for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
    await SecureStore.deleteItemAsync(`${key}.n`);
  },
};

// A build without settings must still open (and say so on the sign-in screen)
// rather than crash here.
export const supabase = createClient<Database>(
  SUPABASE_URL || 'https://not-configured.invalid',
  SUPABASE_PUBLISHABLE_KEY || 'not-configured',
  {
    auth: {
      storage: secureStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);

// Keep the session fresh while the app is on screen; stop the timer when it is not.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
