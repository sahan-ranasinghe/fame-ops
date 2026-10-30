// The mobile website (Phase 8, O4): the app's provider as Office mode reads it, and nothing of the driver's day. Office
// mode asks useApp() only for the words (t, tList), the language and its switch, the settings the maps read and whether
// data is coming in; the driver's state (duty, location, the queue, the heartbeat, push, SQLite) stays in the app
// (state/app.tsx), never in the browser. The language is kept in the browser (lib/kv on localStorage).

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { deviceLanguage, translate, translateList, type Vars } from '@/i18n';
import { DEFAULT_DRIVER_SETTINGS, fetchMe, fetchTasks } from '@/lib/api';
import { getJson, KEYS, setJson } from '@/lib/kv';
import { supabase } from '@/lib/supabase';
import { colomboDate, startOfColomboDay } from '@/lib/time';
import type { Employee, Language, TaskWithStops } from '@/lib/types';
import type { AppValue, SignInOutcome } from './app';

export type { SignInOutcome };

const AppContext = createContext<AppValue | null>(null);

/**
 * Round 4–7, item 12: a screen drawn with a given state, for the design pages of src/design (the mockup comparison's
 * screenshots, the e2e build only): sample data, no phone, no network. Nothing else uses it.
 */
export function AppValueProvider({ value, children }: { value: AppValue; children: ReactNode }) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>');
  return value;
}

/**
 * Round 53 (c): Home's "You have a trip to drive" and More → Driving read the person's own self trips from today, the
 * web's own (not started, or started on the web), with their own session: the same two reads as the app's Driving mode,
 * nothing kept in the browser. (CI 41050400834: without it the website's Home crashed for a person who can drive.)
 */
export async function loadWebDriveTrips(): Promise<{ me: Employee; tasks: TaskWithStops[] } | null> {
  const row = await fetchMe(supabase);
  if (!row) return null;
  // The query is the filter (the person's own, driven by themselves, not under way in the app or from My trip); the app's
  // ownTasks would drop the ones started on the web, which are Continue driving here.
  const tasks = await fetchTasks(supabase, startOfColomboDay(colomboDate()), { employeeId: row.id, selfOnly: true, on: 'web' });
  return { me: row, tasks };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => getJson<Language>(KEYS.language) ?? deviceLanguage());
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  // The page's own language for the browser (screen readers, the Sinhala font choice).
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    setJson(KEYS.language, next);
  }, []);
  const t = useCallback((key: string, vars?: Vars) => translate(language, key, vars), [language]);
  const tList = useCallback((key: string) => translateList(language, key), [language]);

  const value = useMemo(() => ({
    t,
    tList,
    language,
    setLanguage,
    settings: DEFAULT_DRIVER_SETTINGS,
    dataAvailable: online,
    // The driver's side does not exist on the website: no driver is ever signed in here.
    me: null,
    // Round 50: no Driving mode in a browser (/m/ has its driver-lite page).
    officeDriver: false,
    driving: false,
    officeSignOutCheck: async () => 'ok',
    // Round 53 (c): /m/'s way into a self trip (Home's card, More → Driving), the web's own trips only.
    loadDriveTrips: loadWebDriveTrips,
    booted: true,
    signIn: async (): Promise<SignInOutcome> => 'not_configured',
  }) as unknown as AppValue, [t, tList, language, setLanguage, online]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
