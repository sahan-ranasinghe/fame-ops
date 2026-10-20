// The mobile website (Phase 8, O4): the app's provider as Office mode reads it, and nothing of the driver's day. Office
// mode asks useApp() only for the words (t, tList), the language and its switch, the settings the maps read and whether
// data is coming in; the driver's state (duty, location, the queue, the heartbeat, push, SQLite) stays in the app
// (state/app.tsx), never in the browser. The language is kept in the browser (lib/kv on localStorage).

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { deviceLanguage, translate, translateList, type Vars } from '@/i18n';
import { DEFAULT_DRIVER_SETTINGS } from '@/lib/api';
import { getJson, KEYS, setJson } from '@/lib/kv';
import type { Language } from '@/lib/types';
import type { AppValue, SignInOutcome } from './app';

export type { SignInOutcome };

const AppContext = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>');
  return value;
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
    booted: true,
    signIn: async (): Promise<SignInOutcome> => 'not_configured',
  }) as unknown as AppValue, [t, tList, language, setLanguage, online]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
