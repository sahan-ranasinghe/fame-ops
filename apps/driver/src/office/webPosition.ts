// Round 50 (§37.5): ONE position from the browser at the moment of an action on /m/ driver-lite (no watch, no tracking: a
// browser cannot record in the background, and the page says so). navigator.geolocation.getCurrentPosition with a
// timeout; refused, unavailable or too slow = the action is saved with no position (office/webTripLogic.ts positionInput).
// Never throws.

import { POSITION_MAX_AGE_MS, POSITION_TIMEOUT_MS, positionFailure, type PositionResult } from './webTripLogic';

interface GeoLike {
  getCurrentPosition: (
    ok: (p: { coords: { latitude: number; longitude: number; accuracy?: number } }) => void,
    fail: (e: { code?: number }) => void,
    opts: { enableHighAccuracy: boolean; timeout: number; maximumAge: number },
  ) => void;
}

/** The browser's geolocation, or null (not a browser, or a browser without it). */
function geolocation(): GeoLike | null {
  const nav = (globalThis as { navigator?: { geolocation?: GeoLike } }).navigator;
  return nav?.geolocation && typeof nav.geolocation.getCurrentPosition === 'function' ? nav.geolocation : null;
}

/** True when the browser says it has a connection (unknown = true). */
export function browserOnline(): boolean | undefined {
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  return typeof nav?.onLine === 'boolean' ? nav.onLine : undefined;
}

/** Asks the browser for one position; answers within the timeout whatever happens (plus a guard of 2 s). */
export function askOnePosition(geo: GeoLike | null = geolocation(), timeoutMs = POSITION_TIMEOUT_MS): Promise<PositionResult> {
  if (!geo) return Promise.resolve({ ok: false, reason: 'unsupported' });
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: PositionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      resolve(r);
    };
    // Some browsers never call back while their permission prompt stays open: the guard ends the wait.
    const guard = setTimeout(() => done({ ok: false, reason: 'timeout' }), timeoutMs + 2_000);
    try {
      geo.getCurrentPosition(
        (p) => done({ ok: true, lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: p.coords.accuracy }),
        (e) => done({ ok: false, reason: positionFailure(e?.code) }),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: POSITION_MAX_AGE_MS },
      );
    } catch {
      done({ ok: false, reason: 'unavailable' });
    }
  });
}
