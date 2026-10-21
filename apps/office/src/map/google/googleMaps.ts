// Google's map in the web app (Phase 6, Part 5): loaded once per browser tab, and only after the
// server counted the load (register_map_load answers the browser key when the map loads cap
// allows it). One google.maps.Map is made per tab and moved between the pages that show a map
// (the Live map, a driver's page, a task's route, a pin), so moving around the app is never a
// second load (Google bills one map load per map; reusing one map is its own advice). Phase 7:
// greedy gestures (§23) and none of Google's buttons (our control cluster instead, §25).
import type { Transport } from "../../transport/types";

export type GoogleMapsApi = typeof google.maps;

export type GoogleMapState =
  | { state: "ready"; maps: GoogleMapsApi }
  | { state: "refused"; note: string }
  | { state: "failed"; note: string };

interface MapLoadAnswer {
  allowed: boolean;
  key?: string;
  note?: string;
}

const READY_CALLBACK = "__fameGoogleMapsReady";
/** Google's map must be ready this long after its load was counted, or this tab shows the free map (Part 6). */
export const GOOGLE_LOAD_TIMEOUT_MS = 15_000;
let scriptLoad: Promise<GoogleMapsApi> | null = null;
let once: Promise<GoogleMapState> | null = null;
/** Google's map failed in this tab (the key refused, billing, the script, the time limit): the free map until a reload. */
let failedNote: string | null = null;
const authListeners = new Set<(note: string) => void>();

/** Google's map failed in this tab: kept, and every page showing a map is told (it then shows the free map). */
function markFailed(note: string) {
  failedNote = note;
  for (const fn of authListeners) fn(note);
}

/** The Maps JavaScript API with the key, once per tab (weekly channel, the async loader). */
function loadScript(key: string): Promise<GoogleMapsApi> {
  if (scriptLoad) return scriptLoad;
  scriptLoad = new Promise<GoogleMapsApi>((resolve, reject) => {
    const w = window as unknown as Record<string, unknown>;
    w[READY_CALLBACK] = () => {
      google.maps.importLibrary("maps").then(() => resolve(google.maps), reject);
    };
    // Google calls this when it refuses the key (a referrer not on the key's list, the API not enabled, billing).
    w.gm_authFailure = () => markFailed("Google refused the map key");
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=${READY_CALLBACK}`;
    s.async = true;
    s.onerror = () => {
      scriptLoad = null;
      reject(new Error("Google's map could not load"));
    };
    document.head.appendChild(s);
  });
  return scriptLoad;
}

/** The script, or a failure after the time limit (a slow or blocked network: the free map instead). */
function withinLimit<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Google's map did not load in time")), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e: unknown) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * The tab's one Google map load: counted by the server first; refused (a cap, the counter) = the free map with the server's
 * note (Part 6: never no map). The script not ready within GOOGLE_LOAD_TIMEOUT_MS, or Google refusing the key
 * (gm_authFailure), is kept for the tab: the free map until a reload, with no second load counted. A failed call to our
 * own server (offline) is not kept, so a later page asks again.
 */
export function googleMapOnce(transport: Transport): Promise<GoogleMapState> {
  if (failedNote) return Promise.resolve({ state: "failed", note: failedNote });
  if (once) return once;
  once = transport.call<MapLoadAnswer>("register_map_load", {})
    .then(async (a): Promise<GoogleMapState> => {
      if (!a.allowed || !a.key) return { state: "refused", note: a.note ?? "Google's map is not available" };
      try {
        return { state: "ready", maps: await withinLimit(loadScript(a.key), GOOGLE_LOAD_TIMEOUT_MS) };
      } catch (e) {
        const note = e instanceof Error ? e.message : "Google's map could not load";
        markFailed(note);
        return { state: "failed", note };
      }
    })
    .catch((e: unknown): GoogleMapState => {
      once = null;
      const message = e instanceof Error ? e.message : (e as { message?: string })?.message;
      return { state: "failed", note: message || "Google's map could not load" };
    });
  return once;
}

/** Tell a page when Google's map fails after it was ready (the key refused): it then shows the free map. */
export function onGoogleMapFailure(fn: (note: string) => void): () => void {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

/** Tests only: forget this tab's Google map. */
export function resetGoogleMapForTests() {
  scriptLoad = null;
  once = null;
  failedNote = null;
  authListeners.clear();
  holder = null;
  shared = null;
}

// ---- The tab's one map ------------------------------------------------------------------------------

let holder: HTMLDivElement | null = null;
let shared: google.maps.Map | null = null;
let parking: HTMLDivElement | null = null;
const SRI_LANKA = { lat: 7.8, lng: 80.7 };

/** The options the tab's map is made with. */
export const MAP_OPTIONS: google.maps.MapOptions = {
  center: SRI_LANKA,
  zoom: 7,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
  // Phase 7 (§24, §25): our one control cluster (zoom, the compass, fit) replaces Google's own buttons.
  zoomControl: false,
  cameraControl: false,
  rotateControl: false,
  clickableIcons: false,
  // Phase 7 (§23): one finger moves the map and the wheel zooms; never "Use ctrl + scroll to zoom".
  gestureHandling: "greedy",
  // Round 3 A3: always the light map (Google Maps' own default on the web), never FOLLOW_SYSTEM: a dark browser or the
  // site's dark theme does not darken it. It can only be set when the map is made. No `styles` and no map id: nothing
  // else picks a scheme.
  colorScheme: "LIGHT",
};

/** The tab's map, moved into this page's box (made on first use). */
export function attachMap(box: HTMLElement, maps: GoogleMapsApi): google.maps.Map {
  if (!holder || !shared) {
    holder = document.createElement("div");
    holder.style.position = "absolute";
    holder.style.inset = "0";
    shared = new maps.Map(holder, { ...MAP_OPTIONS });
  }
  box.appendChild(holder);
  return shared;
}

/** The page is gone: its map waits off screen for the next page (never made again in this tab). */
export function detachMap() {
  if (!holder) return;
  if (!parking) {
    parking = document.createElement("div");
    parking.style.display = "none";
    parking.setAttribute("aria-hidden", "true");
    document.body.appendChild(parking);
  }
  parking.appendChild(holder);
}

// ---- HTML markers (the same elements and CSS as the MapLibre map's) -------------------------------

export type Anchor = "bottom" | "left" | "center";

export interface HtmlMarker extends google.maps.OverlayView {
  el: HTMLElement;
  setPosition(p: google.maps.LatLngLiteral): void;
  getPosition(): google.maps.LatLngLiteral;
}

let MarkerClass: (new (el: HTMLElement, pos: google.maps.LatLngLiteral, anchor: Anchor) => HtmlMarker) | null = null;

/** An element at a point, drawn above the map (OverlayView: no map id needed, unlike advanced markers). */
export function htmlMarker(maps: GoogleMapsApi, el: HTMLElement, pos: google.maps.LatLngLiteral, anchor: Anchor = "bottom"): HtmlMarker {
  if (!MarkerClass) {
    MarkerClass = class extends maps.OverlayView implements HtmlMarker {
      el: HTMLElement;
      private pos: google.maps.LatLngLiteral;
      private anchor: Anchor;
      constructor(element: HTMLElement, position: google.maps.LatLngLiteral, a: Anchor) {
        super();
        this.el = element;
        this.pos = position;
        this.anchor = a;
        this.el.style.position = "absolute";
      }
      onAdd() {
        this.getPanes()?.overlayMouseTarget.appendChild(this.el);
      }
      draw() {
        const p = this.getProjection()?.fromLatLngToDivPixel(new maps.LatLng(this.pos));
        if (!p) return;
        const shift = this.anchor === "bottom" ? "translate(-50%, -100%)" : this.anchor === "left" ? "translate(-8px, -50%)" : "translate(-50%, -50%)";
        this.el.style.left = `${p.x}px`;
        this.el.style.top = `${p.y}px`;
        this.el.style.transform = shift;
      }
      onRemove() {
        this.el.remove();
      }
      setPosition(p: google.maps.LatLngLiteral) {
        this.pos = p;
        this.draw();
      }
      getPosition() {
        return this.pos;
      }
    };
  }
  return new MarkerClass(el, pos, anchor);
}

/** Fit the map to points, at most this zoom (Google's fitBounds has no limit of its own). */
export function fitTo(map: google.maps.Map, maps: GoogleMapsApi, points: google.maps.LatLngLiteral[], maxZoom = 14) {
  if (!points.length) return;
  if (points.length === 1) {
    map.panTo(points[0]);
    map.setZoom(Math.max(map.getZoom() ?? 7, 12));
    return;
  }
  const b = new maps.LatLngBounds();
  for (const p of points) b.extend(p);
  maps.event.addListenerOnce(map, "bounds_changed", () => {
    if ((map.getZoom() ?? 0) > maxZoom) map.setZoom(maxZoom);
  });
  map.fitBounds(b, 70);
}
