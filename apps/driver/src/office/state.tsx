// Office mode (Phase 8, O1): what every office screen shares. The person (office/store.ts), the client (office/client.ts),
// `useTool` (a tool's answer with loading, error, reload; read again when the screen comes back and on pull to refresh),
// the unread count for the Alerts badge, and the screens' sign-out. The driver's AppProvider stays as it is: the office
// screens read `t` and the language from it, nothing else.

import { useFocusEffect } from 'expo-router';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { officeApi } from './client';
import { refreshOfficeMe, signOutOffice } from './auth';
import { useOfficeMe } from './store';
import type { FleetError, Inbox, Me } from './types';

interface OfficeValue {
  me: Me;
  api: typeof officeApi;
  /** Who this is, again (after the profile changed). */
  refreshMe: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Unread notifications (my_inbox), for the Alerts badge; read every minute while the app is open. */
  unread: number;
  /** After a screen marked items read: the badge follows at once. */
  setUnread: (n: number) => void;
  reloadUnread: () => void;
}

const Ctx = createContext<OfficeValue | null>(null);

export function useOffice(): OfficeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('OfficeProvider is missing');
  return v;
}

const UNREAD_EVERY_MS = 60_000;
/** /me again every minute while the app is open: the office's map package, the permissions and the number follow (a dropped one keeps everything). */
const ME_EVERY_MS = 60_000;

export function OfficeProvider({ me, children }: { me: Me; children: ReactNode }) {
  const [unread, setUnread] = useState(0);
  const reloadUnread = useCallback(() => {
    officeApi.call<Inbox>('my_inbox', { limit: 1, unread: true }).then((r) => setUnread(r.unread ?? 0), () => undefined);
  }, []);
  useEffect(() => {
    reloadUnread();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') reloadUnread();
    }, UNREAD_EVERY_MS);
    const meTimer = setInterval(() => {
      if (AppState.currentState === 'active') void refreshOfficeMe();
    }, ME_EVERY_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') reloadUnread();
    });
    return () => {
      clearInterval(timer);
      clearInterval(meTimer);
      sub.remove();
    };
  }, [reloadUnread]);

  const value = useMemo<OfficeValue>(() => ({
    me,
    api: officeApi,
    refreshMe: async () => {
      await refreshOfficeMe();
    },
    signOut: signOutOffice,
    unread,
    setUnread,
    reloadUnread,
  }), [me, unread, reloadUnread]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export interface ToolState<T> {
  data: T | null;
  error: FleetError | null;
  /** The first load (nothing to show yet). */
  loading: boolean;
  /** A later load (pull to refresh, the screen came back): the old data stays on screen. */
  refreshing: boolean;
  reload: () => Promise<void>;
  /** Replace the data in place (after a write the server answered). */
  patch: (next: T | ((prev: T) => T)) => void;
}

/**
 * A tool's answer for a screen. Loads when the screen opens, again every time it comes to the front (`useFocusEffect`)
 * and on `reload` (pull to refresh); `every` adds a timer while the screen is focused. `args` is compared as JSON.
 * A dropped read was already asked again once by the client (office/api.ts).
 */
export function useTool<T>(tool: string, args: Record<string, unknown> = {}, opts: { every?: number; enabled?: boolean } = {}): ToolState<T> {
  const { api } = useOffice();
  const enabled = opts.enabled ?? true;
  const key = JSON.stringify(args);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<FleetError | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);
  const dataRef = useRef<T | null>(null);
  dataRef.current = data;

  const load = useCallback(async (quiet: boolean) => {
    if (!enabled) return;
    const n = ++seq.current;
    if (dataRef.current === null) setLoading(true);
    else if (!quiet) setRefreshing(true);
    try {
      const next = await api.call<T>(tool, JSON.parse(key) as Record<string, unknown>);
      if (n !== seq.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (n !== seq.current) return;
      setError(e as FleetError);
    } finally {
      if (n === seq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [api, tool, key, enabled]);

  // The screen is in front: load now, and every `every` ms while it stays.
  useFocusEffect(
    useCallback(() => {
      void load(true);
      if (!opts.every) return undefined;
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') void load(true);
      }, opts.every);
      return () => clearInterval(timer);
    }, [load, opts.every]),
  );

  const patch = useCallback((next: T | ((prev: T) => T)) => {
    setData((prev) => (typeof next === 'function' ? (prev === null ? prev : (next as (p: T) => T)(prev)) : next));
  }, []);

  return { data, error, loading, refreshing, reload: () => load(false), patch };
}
