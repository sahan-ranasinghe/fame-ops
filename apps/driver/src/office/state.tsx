// Office mode (Phase 8, O1): what every office screen shares. The person (office/store.ts), the client (office/client.ts),
// `useTool` (a tool's answer with loading, error, reload; read again when the screen comes back and on pull to refresh),
// the unread count for the Alerts badge, and the screens' sign-out. The driver's AppProvider stays as it is: the office
// screens read `t` and the language from it, nothing else.

import { useFocusEffect } from 'expo-router';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { officeApi } from './client';
import { registerPush } from '../lib/push';
import { refreshOfficeMe, signOutOffice } from './auth';
import { useOfficeMe } from './store';
import type { FleetError, Inbox, Me } from './types';

export interface OfficeValue {
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

/**
 * Round 4–7, item 12: the office context with a value given (the design pages of src/design: the real screens drawn with
 * sample answers, no network). The app's screens use OfficeProvider.
 */
export function OfficeValueProvider({ value, children }: { value: OfficeValue; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const UNREAD_EVERY_MS = 60_000;
/** /me again every minute while the app is open: the office's map package, the permissions and the number follow (a dropped one keeps everything). */
const ME_EVERY_MS = 60_000;

export function OfficeProvider({ me, children }: { me: Me; children: ReactNode }) {
  const [unread, setUnread] = useState(0);
  const reloadUnread = useCallback(() => {
    officeApi.call<Inbox>('my_inbox', { limit: 1, unread: true }).then((r) => setUnread(r.unread ?? 0), () => undefined);
  }, []);
  // The token once per start, with the phone's channels (the office's own included, 21 October 2026): a person signed in
  // before an update that brings a channel gets it registered. Nothing in a browser (lib/push.web.ts).
  useEffect(() => { void registerPush(); }, []);
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
  /** The answer for the args asked now (never an answer for other args: a new filter or day shows skeletons first). */
  data: T | null;
  error: FleetError | null;
  /** The first load for these args (nothing to show yet). */
  loading: boolean;
  /** A later load (pull to refresh, the screen came back): the old data stays on screen. */
  refreshing: boolean;
  /** The args the data belongs to (JSON): a Load more captures it and hands it back to `patch`. */
  key: string;
  reload: () => Promise<void>;
  /** The same, quietly (no refresh spinner): a live change (Realtime) asking again. */
  refetch: () => Promise<void>;
  /**
   * Replace the data in place (after a write the server answered). With `forKey`, only when the data still belongs to
   * those args (a Load more that lands after the filter changed is dropped); `more` marks the list as extended: the
   * timer and the screen's return do not read it again (they would put back the first page only); pull to refresh does.
   */
  patch: (next: T | ((prev: T) => T), forKey?: string, more?: boolean) => void;
}

/**
 * A tool's answer for a screen. Loads when the screen opens, again every time it comes to the front (`useFocusEffect`)
 * and on `reload` (pull to refresh); `every` adds a timer while the screen is focused. `args` is compared as JSON.
 * A dropped read was already asked again once by the client (office/api.ts). Stage 1 review: the data is kept with the
 * args it answered, so an old answer never shows under new args, and a list extended by Load more is not collapsed by
 * the timer.
 */
export function useTool<T>(tool: string, args: Record<string, unknown> = {}, opts: { every?: number; enabled?: boolean } = {}): ToolState<T> {
  const { api } = useOffice();
  const enabled = opts.enabled ?? true;
  const key = JSON.stringify(args);
  const keyRef = useRef(key);
  keyRef.current = key;
  const [store, setStore] = useState<{ key: string; data: T | null; error: FleetError | null }>({ key, data: null, error: null });
  const data = store.key === key ? store.data : null;
  const error = store.key === key ? store.error : null;
  const [busy, setBusy] = useState<{ key: string; first: boolean; refreshing: boolean }>({ key, first: enabled, refreshing: false });
  const seq = useRef(0);
  const dataRef = useRef<T | null>(null);
  dataRef.current = data;
  /** The args whose list was extended by Load more ('' = none). */
  const extended = useRef('');

  const load = useCallback(async (quiet: boolean, force = false) => {
    if (!enabled) return;
    if (!force && extended.current === key) return;
    if (force) extended.current = '';
    const n = ++seq.current;
    setBusy({ key, first: dataRef.current === null, refreshing: dataRef.current !== null && !quiet });
    try {
      const next = await api.call<T>(tool, JSON.parse(key) as Record<string, unknown>);
      if (n !== seq.current) return;
      setStore({ key, data: next, error: null });
    } catch (e) {
      if (n !== seq.current) return;
      setStore((prev) => ({ key, data: prev.key === key ? prev.data : null, error: e as FleetError }));
    } finally {
      if (n === seq.current) setBusy({ key, first: false, refreshing: false });
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

  // A patch is newer than any load still on its way (Hotfix O2-H2: a switch flipped while the screen's focus load runs must
  // not be flipped back by that older answer): the load in flight is let go, and its busy state with it.
  const patch = useCallback((next: T | ((prev: T) => T), forKey?: string, more?: boolean) => {
    if (forKey !== undefined && forKey !== keyRef.current) return;
    if (more) extended.current = keyRef.current;
    seq.current += 1;
    setBusy({ key: keyRef.current, first: false, refreshing: false });
    setStore((prev) => {
      if (prev.key !== keyRef.current) return prev;
      const value = typeof next === 'function' ? (prev.data === null ? prev.data : (next as (p: T) => T)(prev.data)) : next;
      return { ...prev, data: value };
    });
  }, []);

  const loading = enabled && data === null && error === null && (busy.key !== key || busy.first);
  const refreshing = busy.key === key && busy.refreshing;
  return { data, error, loading, refreshing, key, reload: () => load(false, true), refetch: () => load(true, true), patch };
}
