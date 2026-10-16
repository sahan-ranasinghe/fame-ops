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
let scriptLoad: Promise<GoogleMapsApi> | null = null;
let once: Promise<GoogleMapState> | null = null;
let authFailed: ((note: string) => void) | null = null;

/** The Maps JavaScript API with the key, once per tab (weekly channel, the async loader). */
function loadScript(key: string): Promise<GoogleMapsApi> {
  if (scriptLoad) return scriptLoad;
  scriptLoad = new Promise<GoogleMapsApi>((resolve, reject) => {
    const w = window as unknown as Record<string, unknown>;
    w[READY_CALLBACK] = () => {
      google.maps.importLibrary("maps").then(() => resolve(google.maps), reject);
    };
    // Google calls this when it refuses the key (a referrer not on the key's list, the API not enabled).
    w.gm_authFailure = () => authFailed?.("Google refused the map key for this address");
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

/**
 * The tab's one Google map load: counted by the server first; refused (the open package, a cap, the
 * counter) = no map, with the server's note. A failure to load is not kept, so a later page tries again.
 */
export function googleMapOnce(transport: Transport): Promise<GoogleMapState> {
  if (once) return once;
  once = transport.call<MapLoadAnswer>("register_map_load", {})
    .then(async (a): Promise<GoogleMapState> => {
      if (!a.allowed || !a.key) return { state: "refused", note: a.note ?? "Google's map is not available" };
      return { state: "ready", maps: await loadScript(a.key) };
    })
    .catch((e: unknown): GoogleMapState => {
      once = null;
      const message = e instanceof Error ? e.message : (e as { message?: string })?.message;
      return { state: "failed", note: message || "Google's map could not load" };
    });
  return once;
}

/** Tell the page when Google refuses the key after the script loaded. */
export function onGoogleAuthFailure(fn: ((note: string) => void) | null) {
  authFailed = fn;
}

// ---- The tab's one map ------------------------------------------------------------------------------

let holder: HTMLDivElement | null = null;
let shared: google.maps.Map | null = null;
let parking: HTMLDivElement | null = null;
const SRI_LANKA = { lat: 7.8, lng: 80.7 };

/** The tab's map, moved into this page's box (made on first use). */
export function attachMap(box: HTMLElement, maps: GoogleMapsApi): google.maps.Map {
  if (!holder || !shared) {
    holder = document.createElement("div");
    holder.style.position = "absolute";
    holder.style.inset = "0";
    shared = new maps.Map(holder, {
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
    });
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
