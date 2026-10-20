// Hotfix O2-H2, Part 1c: the app's crash handling at run time (the rules are crashLogic.ts).
//   - `noteScreen` keeps the route on screen (the root layout calls it), so a crash says where it happened;
//   - `installGlobalHandlers` catches what no error boundary sees: a JavaScript error outside rendering (ErrorUtils) and a
//     promise nobody caught (Hermes' rejection tracker). A fatal one shows the crash screen (crashStore, drawn by the root
//     layout over everything), a non-fatal one a snackbar; neither freezes the app;
//   - `reportCrash` sends the scrubbed details to the server (office-api or driver-api POST /errors) without waiting and
//     without ever failing: until the server has the route (Hotfix O2-H2's server change, its own go) the call is simply
//     refused and nothing else happens.

import { useSyncExternalStore } from 'react';

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';
import * as Application from 'expo-application';

import { getOfficeMe } from '../office/store';
import { type CrashDetails, crashDetails, reportBody, shouldReport, shouldShowSoft } from './crashLogic';
import { supabase } from './supabase';
import { runningUpdateId } from './updates';

let screen = '';
/** The route on screen now (the root layout's usePathname). */
export function noteScreen(path: string): void {
  screen = path;
}

/** "1.3.0+ab12cd34" (the heartbeat's label, without loading the location code: a crash must load nothing heavy). */
function appVersionLabel(): string {
  const update = runningUpdateId();
  return `${Application.nativeApplicationVersion ?? '?'}${update ? `+${update.slice(0, 8)}` : ''}`;
}

function runtime(): string | null {
  try {
    const Updates = require('expo-updates') as { runtimeVersion?: string | null };
    return Updates.runtimeVersion ?? null;
  } catch {
    return null;
  }
}

export function details(e: unknown, fatal: boolean): CrashDetails {
  return crashDetails(e, {
    screen,
    appVersion: safe(appVersionLabel, '?'),
    updateId: safe(runningUpdateId, null),
    runtime: runtime(),
    // An office person is reported through office-api wherever they are (the sign-in, the privacy page); a driver through
    // driver-api.
    side: safe(() => (getOfficeMe() ? 'office' : null), null) ?? (screen.startsWith('/office') ? 'office' : screen ? 'driver' : 'none'),
  }, fatal);
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// ---- The fatal error the root shows (an error outside any boundary) ----

let fatalNow: CrashDetails | null = null;
const listeners = new Set<() => void>();
export const crashStore = {
  get: () => fatalNow,
  set(d: CrashDetails | null) {
    fatalNow = d;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
export function useFatalCrash(): CrashDetails | null {
  return useSyncExternalStore(crashStore.subscribe, crashStore.get, crashStore.get);
}

// ---- Reporting ----

let lastReport: { key: string; at: number } | null = null;
export function reportCrash(d: CrashDetails): void {
  const now = Date.now();
  if (!shouldReport(lastReport, d, now)) return;
  lastReport = { key: `${d.screen}|${d.message}`, at: now };
  void (async () => {
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token || d.side === 'none') return;
      const fn = d.side === 'office' ? 'office-api' : 'driver-api';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/${fn}/errors`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify(reportBody(d)),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // A report that does not get through is dropped: it must never become an error of its own.
    }
  })();
}

// ---- The global handlers ----

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsLike {
  getGlobalHandler(): GlobalErrorHandler;
  setGlobalHandler(h: GlobalErrorHandler): void;
}

let installed = false;
/**
 * `onSoft` shows a snackbar for an error that did not break the screen (the root passes one that knows the words).
 * Safe to call more than once.
 */
export function installGlobalHandlers(showSoft: (d: CrashDetails) => void): void {
  if (installed) return;
  installed = true;
  let lastSoft: { key: string; at: number } | null = null;
  const onSoft = (d: CrashDetails) => {
    const now = Date.now();
    if (!shouldShowSoft(lastSoft, d, now)) return;
    lastSoft = { key: d.message, at: now };
    showSoft(d);
  };
  const g = globalThis as unknown as { ErrorUtils?: ErrorUtilsLike; HermesInternal?: { enablePromiseRejectionTracker?: (o: unknown) => void } };
  const eu = g.ErrorUtils;
  if (eu) {
    const previous = eu.getGlobalHandler();
    eu.setGlobalHandler((error, isFatal) => {
      const d = details(error, !!isFatal);
      reportCrash(d);
      if (isFatal) crashStore.set(d);
      else onSoft(d);
      // In development the red box still shows (the previous handler); a release build stays on our screens.
      if (__DEV__) previous(error, isFatal);
    });
  }
  g.HermesInternal?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id: number, rejection: unknown) => {
      const d = details(rejection, false);
      reportCrash(d);
      onSoft(d);
    },
    onHandled: () => undefined,
  });
}
