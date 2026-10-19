// Which map the app shows, and when Google's map counts as failed (Part 6, Sahan 19 October 2026: both maps on every
// phone). Pure: no React and no native module, so scripts/test-maps.ts runs it.
//
//   - Google's map (react-native-maps, the Maps SDK for Android: free on a phone, no map id) when the build carries the
//     Android key, the office's map package is "google" (get_driver_settings, read again every minute while the app is
//     open) and Google's map has not failed on this phone since the app opened.
//   - The free map (MapLibre with OpenFreeMap's tiles, no key) otherwise.
//   - Neither: the "Map not available" card (components/MapUnavailable.tsx) with the stops and the straight-line distance;
//     the rest of the screen works as before.
//
// How a failure is seen on Android. Google's SDK has no "key refused" callback: a refused key, a billing or authorisation
// problem, Google Play services missing or out of date, or Google down all leave a grey map that never finishes loading.
// react-native-maps passes on Google's OnMapLoadedCallback as onMapLoaded ("the map has finished rendering": every tile
// drawn), so: no onMapLoaded within phone_map_wait_s (30 s) while the phone has internet = Google failed. The wait runs
// only while the map can draw (its screen in front, the app on screen) and starts again when it can or the network returns.
// The same wait with no internet is not Google's fault: the card shows until the network is back, then the map is tried
// again. A render error of either map (the error boundary) is a failure at once; MapLibre also says onDidFailLoadingMap (the
// style or the tiles could not be fetched).
//
// After a failure the phone stays on the free map until the app opens again: started afresh, or brought to the front
// 30 minutes or more after the failure (appOpened). The phone tells the server (report_map_state) about a failure and
// about the next good load after one; the office's issue opens and resolves from those reports.

export type MapPackage = 'google' | 'open';
export type Engine = 'google' | 'open';
export type FailReason = 'timeout' | 'error';

/** Google's map is tried again when the app comes to the front this long after it failed. */
export const GOOGLE_RETRY_AFTER_MS = 30 * 60_000;
/** The free map's own wait before the card (it has no key to refuse; this is the network or OpenFreeMap). */
export const OPEN_WAIT_S = 30;
/** How often the open app reads the settings again (the office's map package reaches the phones within a minute). */
export const SETTINGS_EVERY_MS = 60_000;

/** The engine for this phone now. */
export function engineFor(googleInBuild: boolean, setting: MapPackage, googleFailed: boolean): Engine {
  return googleInBuild && setting === 'google' && !googleFailed ? 'google' : 'open';
}

/** The wait before a map that has not said it loaded is judged (seconds). */
export function waitFor(engine: Engine, phoneMapWaitS: number): number {
  return engine === 'google' ? phoneMapWaitS : OPEN_WAIT_S;
}

// --- One map on a screen -------------------------------------------------------------------------------------------------

export type MountStatus = 'loading' | 'loaded' | 'unavailable';

export interface MountState {
  engine: Engine;
  status: MountStatus;
  /** Raised to mount the map afresh (Try again, the network back, the engine changed). */
  attempt: number;
}

export type MountEvent =
  | { type: 'loaded' }
  /** The engine failed: MapLibre's onDidFailLoadingMap, or a render error caught by the boundary. */
  | { type: 'error' }
  /** The wait is over and the map has not said it loaded; for this attempt of this engine (a later one ignores it). */
  | { type: 'timeout'; online: boolean; attempt: number; engine: Engine }
  /** Try again (the card's button), or the network came back while the card shows. */
  | { type: 'retry' }
  /** The engine for this phone changed (the setting, or Google failed or came back). */
  | { type: 'engine'; engine: Engine };

export interface Step {
  state: MountState;
  /** Google's map failed on this phone: the caller marks it (mapSession) and reports it. */
  googleFailed?: FailReason;
  /** Google's map loaded: the caller reports it if the server last heard of a failure. */
  googleLoaded?: true;
}

export function startMount(engine: Engine): MountState {
  return { engine, status: 'loading', attempt: 0 };
}

export function mapStep(s: MountState, e: MountEvent): Step {
  switch (e.type) {
    case 'loaded':
      if (s.status === 'loaded') return { state: s };
      return { state: { ...s, status: 'loaded' }, ...(s.engine === 'google' ? { googleLoaded: true as const } : {}) };
    case 'error':
      // Google's failure moves this phone to the free map (the 'engine' event that follows mounts it).
      if (s.engine === 'google') return { state: s, googleFailed: 'error' };
      return { state: { ...s, status: 'unavailable' } };
    case 'timeout':
      if (s.status !== 'loading' || e.attempt !== s.attempt || e.engine !== s.engine) return { state: s };
      // Offline: neither map can load, and it is not Google's fault.
      if (!e.online) return { state: { ...s, status: 'unavailable' } };
      if (s.engine === 'google') return { state: s, googleFailed: 'timeout' };
      return { state: { ...s, status: 'unavailable' } };
    case 'retry':
      return { state: { ...s, status: 'loading', attempt: s.attempt + 1 } };
    case 'engine':
      if (e.engine === s.engine) return { state: s };
      return { state: { engine: e.engine, status: 'loading', attempt: s.attempt + 1 } };
  }
}

// --- This phone, since the app opened ------------------------------------------------------------------------------------

type Listener = () => void;

/** Google's failure on this phone, kept in memory: a fresh start of the app forgets it. */
export function createMapSession() {
  let failedAt: number | null = null;
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => l());
  return {
    googleFailed: () => failedAt !== null,
    markGoogleFailed(now: number) {
      if (failedAt !== null) return;
      failedAt = now;
      emit();
    },
    /** The app came to the front: Google is tried again once its failure is 30 minutes old. True when it is. */
    appOpened(now: number): boolean {
      if (failedAt === null || now - failedAt < GOOGLE_RETRY_AFTER_MS) return false;
      failedAt = null;
      emit();
      return true;
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type MapSession = ReturnType<typeof createMapSession>;

/** The app's one session. */
export const mapSession = createMapSession();

// --- What the server hears -----------------------------------------------------------------------------------------------

export interface MapReport {
  google_ok: boolean;
  reason: FailReason | null;
  at: string;
}

/**
 * The report to send after an outcome, or null: every failure the server has not heard yet (the last report said OK, or
 * there was none), and a good load only when the last report was a failure or there was none (once, after the phone
 * forgot what it sent). `last` is the pending report's google_ok, else the last one the server took, else null.
 */
export function nextReport(last: boolean | null, outcome: { googleFailed?: FailReason; googleLoaded?: true }, at: string): MapReport | null {
  if (outcome.googleFailed) return last === false ? null : { google_ok: false, reason: outcome.googleFailed, at };
  if (outcome.googleLoaded) return last === true ? null : { google_ok: true, reason: null, at };
  return null;
}
