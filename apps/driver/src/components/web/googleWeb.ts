// Google's map in the mobile website (Phase 8, O4), as the office site's (apps/office/src/map/google/googleMaps.ts): the
// Maps JavaScript API loaded once per tab with the browser key that register_map_load hands out after counting the load
// (rule 10: counted before it is made, refused at a cap, fail closed). No map id (HTML overlays, not advanced markers) and
// none of Google's buttons: the pages have their own. Each map made is one load counted; a page that goes gives its map
// back for the next page (browserMapLogic.ts createGooglePool), so moving around the site is not a second load. Google
// refusing the key (gm_authFailure), the script blocked or not ready within 15 s: the free map in this tab until it is
// loaded again (mapSession, as on a phone after Google failed).

import { APP_SCHEME, googleColorScheme } from '@/lib/appTheme';
import { mapSession } from '@/lib/mapEngine';
import { officeApi } from '@/office/client';
import { createGooglePool, GOOGLE_SCRIPT_TIMEOUT_MS, type MapLoadAnswer, withinLimit } from './browserMapLogic';

/** A point as Google takes it. */
export interface GLatLngLiteral {
  lat: number;
  lng: number;
}
/** A point as Google answers it. */
export interface GLatLng {
  lat(): number;
  lng(): number;
}
export interface GListener {
  remove(): void;
}
export interface GMap {
  getZoom(): number | undefined;
  setZoom(zoom: number): void;
  getCenter(): GLatLng | undefined;
  setCenter(p: GLatLngLiteral): void;
  panTo(p: GLatLngLiteral): void;
  fitBounds(bounds: unknown, padding: { top: number; right: number; bottom: number; left: number }): void;
  addListener(event: string, fn: () => void): GListener;
}
export interface GPolyline {
  setMap(map: GMap | null): void;
}
export interface GOverlayView {
  setMap(map: GMap | null): void;
  getPanes(): { overlayLayer: HTMLElement; overlayMouseTarget: HTMLElement } | null;
  getProjection(): { fromLatLngToDivPixel(p: unknown): { x: number; y: number } | null } | undefined;
}

/**
 * The Maps JavaScript API as this code uses it. The app carries no Google types (no @types/google.maps in the driver app),
 * so the few calls made are typed here, by hand.
 */
export interface GoogleApi {
  Map: new (el: HTMLElement, options: Record<string, unknown>) => GMap;
  LatLng: new (lat: number, lng: number) => unknown;
  LatLngBounds: new (sw: GLatLngLiteral, ne: GLatLngLiteral) => unknown;
  Polyline: new (options: Record<string, unknown>) => GPolyline;
  OverlayView: (new () => GOverlayView) & { preventMapHitsAndGesturesFrom(el: HTMLElement): void };
  event: { addListenerOnce(target: GMap, event: string, fn: () => void): GListener };
  importLibrary(name: string): Promise<unknown>;
  /** google.maps.ColorScheme (LIGHT, DARK, FOLLOW_SYSTEM): the map's colours, set when it is made. */
  ColorScheme?: { LIGHT: string; DARK: string };
}

/** One of the tab's Google maps: its box (moved into a page's box), the map, and whether it has drawn its tiles once. */
export interface GoogleEntry {
  holder: HTMLDivElement;
  map: GMap;
  loaded: boolean;
}

const READY_CALLBACK = '__fameGoogleMapsReady';
let api: GoogleApi | null = null;
let parking: HTMLDivElement | null = null;

function loadScript(key: string): Promise<void> {
  const ready = new Promise<void>((resolve, reject) => {
    const w = window as unknown as Record<string, unknown>;
    w[READY_CALLBACK] = () => {
      const g = (w.google as { maps?: GoogleApi } | undefined)?.maps;
      if (!g) {
        reject(new Error("Google's map could not load"));
        return;
      }
      g.importLibrary('maps').then(() => {
        api = g;
        resolve();
      }, reject);
    };
    // Google calls this when it refuses the key (a referrer not on the key's list, the API not enabled, billing).
    w.gm_authFailure = () => failGoogle('Google refused the map key');
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=${READY_CALLBACK}`;
    s.async = true;
    s.onerror = () => reject(new Error("Google's map could not load"));
    document.head.appendChild(s);
  });
  return withinLimit(ready, GOOGLE_SCRIPT_TIMEOUT_MS, "Google's map did not load in time");
}

function makeEntry(): GoogleEntry {
  const holder = document.createElement('div');
  holder.style.position = 'absolute';
  holder.style.inset = '0';
  if (!api) throw new Error("Google's map could not load");
  const map = new api.Map(holder, {
    center: { lat: 7.75, lng: 80.7 },
    zoom: 7,
    disableDefaultUI: true,
    clickableIcons: false,
    keyboardShortcuts: false,
    // One finger moves the map and the wheel zooms (the site's §23): never "Use two fingers to move the map".
    gestureHandling: 'greedy',
    // The app's theme (lib/appTheme.ts, C §33.12): /m/ is light only today, so the light map whatever the browser's dark
    // mode. Google reads it only when the map is made (no map id needed).
    colorScheme: api.ColorScheme?.[googleColorScheme(APP_SCHEME)] ?? googleColorScheme(APP_SCHEME),
  });
  return { holder, map, loaded: false };
}

const pool = createGooglePool<GoogleEntry>({
  count: () => officeApi.call<MapLoadAnswer>('register_map_load', {}),
  loadScript,
  make: makeEntry,
});

/** Take one of the tab's Google maps for a page (counted when it is a new one). */
export const takeGoogleMap = () => pool.take();

/** The Maps JavaScript API, once a map was granted. */
export function googleApi(): GoogleApi {
  if (!api) throw new Error("Google's map could not load");
  return api;
}

/** The page is gone: its map waits off screen for the next page. */
export function giveGoogleMap(entry: GoogleEntry) {
  if (!parking) {
    parking = document.createElement('div');
    parking.style.display = 'none';
    parking.setAttribute('aria-hidden', 'true');
    document.body.appendChild(parking);
  }
  parking.appendChild(entry.holder);
  pool.give(entry);
}

/** Google's map failed in this tab: every page moves to the free map (mapSession), and no kept map is used again. */
export function failGoogle(note: string) {
  pool.fail(note);
  mapSession.markGoogleFailed(Date.now());
}
