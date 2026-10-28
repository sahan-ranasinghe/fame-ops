// The mobile website's two map engines behind one small surface (Phase 8, O4), so the four maps (TaskMap, RouteMap,
// DriversMap, PinAdjust: the .web.tsx files) are written once:
//   - the free map: MapLibre GL JS with OpenFreeMap's Liberty style (the app's theme: lib/appTheme.ts), no key (as the office site's MapLibreMap.tsx and the
//     phones' OpenTaskMap.tsx);
//   - Google's map: the Maps JavaScript API, one of the tab's maps (googleWeb.ts), with HTML overlays and no map id.
// Each draws lines in groups (a group is one layer of the picture: the task's legs, the day's line, the trails), places
// HTML elements at points (the React pins are rendered into them: BrowserMap.tsx MapMarker), moves the camera to a frame,
// and says when it has loaded, failed, been moved by the person or turned. What may be drawn on which engine (rule 10) is
// decided before anything reaches here (taskMapLogic.ts, lib/mapRule.ts).

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { LatLng } from '@/components/taskMapLogic';
import { APP_SCHEME, freeMapStyle } from '@/lib/appTheme';
import type { Engine } from '@/lib/mapEngine';
import { zoomStep } from '@/office/liveLogic';
import { type Anchor, anchorShift, type Camera, type Dash, dashKey, googleDash, layerBefore, libreDash, MAX_FIT_ZOOM, withLayer } from './browserMapLogic';
import { failGoogle, giveGoogleMap, type GMap, type GoogleApi, type GoogleEntry } from './googleWeb';

/** The free map's style in the app's theme (lib/appTheme.ts, C §33.12: Liberty while /m/ is light only). */
export const FREE_MAP_STYLE = freeMapStyle(APP_SCHEME);

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LineSpec {
  points: readonly LatLng[];
  color: string;
  width: number;
  dash?: Dash | null;
  opacity?: number;
}

export interface MarkerOpts {
  anchor: Anchor;
  /** Pixels down from the anchor (the free map's Marker offset; Google's overlay shifts by it too). */
  offsetY?: number;
  z: number;
  /** A tap on the element (the map itself does not take it). */
  onPress?: () => void;
}

export interface MarkerHandle {
  /** The element at the point; the pin is rendered into it. */
  el: HTMLDivElement;
  move(at: LatLng): void;
  set(opts: MarkerOpts): void;
  remove(): void;
}

export interface MapEvents {
  loaded: () => void;
  failed: (note: string) => void;
  /** The camera came to rest (the map's centre then, and its zoom: Round 48, the cluster helper's input). */
  moved?: (center: LatLng, zoom: number) => void;
  /** The person started moving the map (a drag, a pinch, the wheel). */
  userMove?: () => void;
  turned?: (heading: number, pitch: number) => void;
}

export interface MapAdapter {
  readonly engine: Engine;
  /** Replace a group's lines; `z` orders the groups (higher on top). An empty list clears the group. */
  lines(group: string, z: number, lines: readonly LineSpec[]): void;
  marker(at: LatLng, opts: MarkerOpts): MarkerHandle;
  show(camera: Camera, padding: Padding, animate?: boolean): void;
  zoomBy(kind: 'in' | 'out'): void;
  /** The middle to a point at the zoom the map has (Follow me after its first move). */
  panTo(at: LatLng): void;
  center(): LatLng;
  northUp(): void;
  destroy(): void;
}

/** One element per marker, the pin's own clicks kept from the map. */
function markerElement(opts: MarkerOpts): HTMLDivElement {
  const el = document.createElement('div');
  el.style.zIndex = String(opts.z);
  if (!opts.onPress) el.style.pointerEvents = 'none';
  else el.style.cursor = 'pointer';
  return el;
}

// --- The free map ---------------------------------------------------------------------------------------------------------

export function createFreeMap(container: HTMLElement, start: Camera, padding: Padding, on: MapEvents): MapAdapter {
  let m: maplibregl.Map;
  try {
    m = new maplibregl.Map({
      container: container as HTMLDivElement,
      style: FREE_MAP_STYLE,
      ...(start.kind === 'bounds'
        ? { bounds: [start.sw.lng, start.sw.lat, start.ne.lng, start.ne.lat] as [number, number, number, number], fitBoundsOptions: { padding, maxZoom: MAX_FIT_ZOOM } }
        : { center: [start.center.lng, start.center.lat] as [number, number], zoom: start.zoom }),
      // The credit is the page's own line under the map, as on the phones (taskMapLogic.ts OSM_CREDIT).
      attributionControl: false,
      cooperativeGestures: false,
    });
  } catch (e) {
    // No WebGL in this browser, or the library could not start: the free map failed.
    const note = e instanceof Error ? e.message : 'The map could not start';
    setTimeout(() => on.failed(note), 0);
    return deadAdapter('open');
  }

  let loaded = false;
  let gone = false;
  const groups = new Map<string, readonly LineSpec[]>();
  const groupZ = new Map<string, number>();
  const sources = new Set<string>();
  let order: { id: string; z: number }[] = [];

  const draw = (group: string) => {
    const z = groupZ.get(group) ?? 0;
    const byDash = new Map<string, LineSpec[]>();
    for (const l of groups.get(group) ?? []) {
      if (l.points.length < 2) continue;
      const k = dashKey(l.dash);
      byDash.set(k, [...(byDash.get(k) ?? []), l]);
    }
    // Parts drawn before and gone now are emptied (a layer stays, its data empty).
    for (const id of sources) {
      if (id.startsWith(`${group}|`) && !byDash.has(id.slice(group.length + 1))) {
        (m.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] });
      }
    }
    for (const [k, parts] of byDash) {
      const id = `${group}|${k}`;
      const data: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: parts.map((l) => ({
          type: 'Feature',
          properties: { color: l.color, width: l.width, opacity: l.opacity ?? 1 },
          geometry: { type: 'LineString', coordinates: l.points.map((p) => [p.lng, p.lat]) },
        })),
      };
      const had = m.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (had) {
        had.setData(data);
        continue;
      }
      m.addSource(id, { type: 'geojson', data });
      const dash = parts[0].dash;
      m.addLayer({
        id,
        type: 'line',
        source: id,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['get', 'width'],
          'line-opacity': ['get', 'opacity'],
          // line-dasharray is the layer's: the first line's width sets it (a group's dashed lines share one width).
          ...(dash ? { 'line-dasharray': libreDash(dash, parts[0].width) } : {}),
        },
      }, layerBefore(order, z));
      order = withLayer(order, id, z);
      sources.add(id);
    }
  };

  // The free style names sprite images it does not ship (atm, gate, office, toll_booth…): a blank 1×1 image answers each
  // once, so MapLibre neither warns nor asks again on every tile that uses it.
  m.on('styleimagemissing', (e: { id: string }) => {
    if (!gone && !m.hasImage(e.id)) m.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
  m.on('load', () => {
    if (gone) return;
    loaded = true;
    for (const g of groups.keys()) draw(g);
    on.loaded();
  });
  m.on('error', (e) => {
    // Before the style came: the style could not be fetched (no internet, OpenFreeMap down, a blocked host). A tile that
    // fails later is not the map failing.
    if (gone || loaded || m.isStyleLoaded()) return;
    const message = String((e as { error?: { message?: string } }).error?.message ?? 'The map could not load');
    on.failed(message);
  });
  m.on('movestart', (e) => {
    if ((e as { originalEvent?: unknown }).originalEvent) on.userMove?.();
  });
  m.on('moveend', () => {
    const c = m.getCenter();
    on.moved?.({ lat: c.lat, lng: c.lng }, m.getZoom());
    on.turned?.(m.getBearing(), m.getPitch());
  });
  m.on('rotate', () => on.turned?.(m.getBearing(), m.getPitch()));
  m.on('pitch', () => on.turned?.(m.getBearing(), m.getPitch()));

  return {
    engine: 'open',
    lines(group, z, lines) {
      groups.set(group, lines);
      groupZ.set(group, z);
      if (loaded && !gone) draw(group);
    },
    marker(at, opts) {
      const el = markerElement(opts);
      let current = opts;
      if (opts.onPress) el.addEventListener('click', (ev) => { ev.stopPropagation(); current.onPress?.(); });
      const mk = new maplibregl.Marker({ element: el, anchor: opts.anchor, offset: [0, opts.offsetY ?? 0] }).setLngLat([at.lng, at.lat]).addTo(m);
      return {
        el,
        move: (p) => { mk.setLngLat([p.lng, p.lat]); },
        set: (next) => {
          current = next;
          el.style.zIndex = String(next.z);
          mk.setOffset([0, next.offsetY ?? 0]);
        },
        remove: () => { mk.remove(); },
      };
    },
    show(camera, pad, animate = true) {
      if (gone) return;
      const duration = animate ? 600 : 0;
      if (camera.kind === 'bounds') m.fitBounds([[camera.sw.lng, camera.sw.lat], [camera.ne.lng, camera.ne.lat]], { padding: pad, maxZoom: MAX_FIT_ZOOM, duration });
      else m.easeTo({ center: [camera.center.lng, camera.center.lat], zoom: camera.zoom, bearing: 0, pitch: 0, duration });
    },
    zoomBy(kind) {
      if (!gone) m.easeTo({ zoom: zoomStep(m.getZoom(), kind), duration: 300 });
    },
    panTo(at) {
      if (!gone) m.easeTo({ center: [at.lng, at.lat], duration: 500 });
    },
    center() {
      const c = m.getCenter();
      return { lat: c.lat, lng: c.lng };
    },
    northUp() {
      if (!gone) m.easeTo({ bearing: 0, pitch: 0, duration: 400 });
    },
    destroy() {
      gone = true;
      m.remove();
    },
  };
}

// --- Google's map ---------------------------------------------------------------------------------------------------------

/** Google's map is loaded once its script is ready and the map is made (the desktop site's rule). The trade-off: only a
 *  failed script, the 15 s script limit or Google refusing the key (gm_authFailure → failGoogle) move the tab to the free
 *  map; a map whose tiles never come stays grey (Google's own fault, rare) instead of switching on a guess. */
export function createGoogleMap(container: HTMLElement, g: GoogleApi, entry: GoogleEntry, start: Camera, padding: Padding, on: MapEvents): MapAdapter {
  const m = entry.map;
  container.appendChild(entry.holder);
  let gone = false;
  const listeners: { remove: () => void }[] = [];
  const groups = new Map<string, { remove: () => void }[]>();
  const overlays = new Set<HtmlOverlay>();

  const show = (camera: Camera, pad: Padding, animate: boolean) => {
    if (gone) return;
    if (camera.kind === 'bounds') {
      const b = new g.LatLngBounds(camera.sw, camera.ne);
      // Tracked like every listener: a map handed on to the next page never keeps this one.
      listeners.push(g.event.addListenerOnce(m, 'idle', () => {
        if ((m.getZoom() ?? 0) > MAX_FIT_ZOOM) m.setZoom(MAX_FIT_ZOOM);
      }));
      m.fitBounds(b, pad);
    } else if (animate) {
      m.panTo(camera.center);
      m.setZoom(Math.round(camera.zoom));
    } else {
      m.setCenter(camera.center);
      m.setZoom(Math.round(camera.zoom));
    }
  };
  show(start, padding, false);

  // The desktop site's rule (21 October 2026): Google's map has loaded once its script is ready and the map is made. A
  // failure is the script failing, Google refusing the key (gm_authFailure) or the script not ready in 15 s, never "no
  // tiles yet" (a map made before its box had a size could wait for tiles that only come with the next move, and the tab
  // then went to the free map without a word).
  entry.loaded = true;
  setTimeout(() => { if (!gone) on.loaded(); }, 0);
  listeners.push(m.addListener('dragstart', () => on.userMove?.()));
  listeners.push(m.addListener('idle', () => {
    const c = m.getCenter();
    if (c) on.moved?.({ lat: c.lat(), lng: c.lng() }, m.getZoom() ?? 7);
  }));

  const Overlay = overlayClass(g);

  return {
    engine: 'google',
    lines(group, z, lines) {
      if (gone) return;
      for (const l of groups.get(group) ?? []) l.remove();
      const made = lines.filter((l) => l.points.length > 1).map((l) => {
        const path = l.points.map((p) => ({ lat: p.lat, lng: p.lng }));
        const opacity = l.opacity ?? 1;
        const line = l.dash
          ? new g.Polyline({
            map: m,
            path,
            strokeOpacity: 0,
            clickable: false,
            zIndex: z,
            icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: opacity, strokeColor: l.color, strokeWeight: l.width, scale: googleDash(l.dash).scale }, offset: '0', repeat: googleDash(l.dash).repeat }],
          })
          : new g.Polyline({ map: m, path, strokeColor: l.color, strokeWeight: l.width, strokeOpacity: opacity, clickable: false, zIndex: z });
        return { remove: () => line.setMap(null) };
      });
      groups.set(group, made);
    },
    marker(at, opts) {
      const el = markerElement(opts);
      let current = opts;
      if (opts.onPress) {
        el.addEventListener('click', (ev) => { ev.stopPropagation(); current.onPress?.(); });
        // A tap on the pin is the pin's: no map click, no drag from it.
        g.OverlayView.preventMapHitsAndGesturesFrom(el);
      }
      const o = new Overlay(el, at, opts.anchor, opts.offsetY ?? 0, !!opts.onPress);
      o.setMap(m);
      overlays.add(o);
      return {
        el,
        move: (p) => o.setPosition(p),
        set: (next) => {
          current = next;
          el.style.zIndex = String(next.z);
          o.setAnchor(next.anchor, next.offsetY ?? 0);
        },
        remove: () => {
          o.setMap(null);
          overlays.delete(o);
        },
      };
    },
    show: (camera, pad, animate = true) => show(camera, pad, animate),
    zoomBy(kind) {
      if (!gone) m.setZoom(zoomStep(m.getZoom() ?? 7, kind));
    },
    panTo(at) {
      if (!gone) m.panTo({ lat: at.lat, lng: at.lng });
    },
    center() {
      const c = m.getCenter();
      return c ? { lat: c.lat(), lng: c.lng() } : { lat: 0, lng: 0 };
    },
    northUp() {
      // Google's raster map (no map id) does not turn: nothing to put back.
    },
    destroy() {
      if (gone) return;
      gone = true;
      listeners.forEach((l) => l.remove());
      groups.forEach((ls) => ls.forEach((l) => l.remove()));
      overlays.forEach((o) => o.setMap(null));
      // Kept for the next page (a map that never drew is dropped by the pool once Google is judged failed).
      giveGoogleMap(entry);
    },
  };
}

/** Google's map did not draw within the wait while online: Google failed in this tab. */
export const googleNeverDrew = (note: string) => failGoogle(note);

/** A placed element (overlayClass). */
interface HtmlOverlay {
  setMap(map: GMap | null): void;
  setPosition(p: LatLng): void;
  setAnchor(anchor: Anchor, offsetY: number): void;
}
type OverlayCtor = new (el: HTMLElement, pos: LatLng, anchor: Anchor, offsetY: number, clickable: boolean) => HtmlOverlay;
const overlayClasses = new WeakMap<GoogleApi, OverlayCtor>();

/** An element at a point, drawn above the map (OverlayView: no map id needed, unlike advanced markers). */
function overlayClass(g: GoogleApi): OverlayCtor {
  const had = overlayClasses.get(g);
  if (had) return had;
  const C = class extends g.OverlayView {
    el: HTMLElement;
    pos: LatLng;
    anchor: Anchor;
    offsetY: number;
    clickable: boolean;
    constructor(el: HTMLElement, pos: LatLng, anchor: Anchor, offsetY: number, clickable: boolean) {
      super();
      this.el = el;
      this.pos = pos;
      this.anchor = anchor;
      this.offsetY = offsetY;
      this.clickable = clickable;
      this.el.style.position = 'absolute';
    }
    onAdd() {
      const panes = this.getPanes();
      (this.clickable ? panes?.overlayMouseTarget : panes?.overlayLayer)?.appendChild(this.el);
    }
    draw() {
      const p = this.getProjection()?.fromLatLngToDivPixel(new g.LatLng(this.pos.lat, this.pos.lng));
      if (!p) return;
      this.el.style.left = `${p.x}px`;
      this.el.style.top = `${p.y}px`;
      this.el.style.transform = anchorShift(this.anchor, this.offsetY);
    }
    onRemove() {
      this.el.remove();
    }
    setPosition(p: LatLng) {
      this.pos = p;
      this.draw();
    }
    setAnchor(anchor: Anchor, offsetY: number) {
      this.anchor = anchor;
      this.offsetY = offsetY;
      this.draw();
    }
  };
  overlayClasses.set(g, C);
  return C;
}

/** A map that could not start: nothing is drawn, every call does nothing. */
function deadAdapter(engine: Engine): MapAdapter {
  return {
    engine,
    lines: () => undefined,
    marker: () => {
      const el = document.createElement('div');
      return { el, move: () => undefined, set: () => undefined, remove: () => undefined };
    },
    show: () => undefined,
    zoomBy: () => undefined,
    panTo: () => undefined,
    center: () => ({ lat: 0, lng: 0 }),
    northUp: () => undefined,
    destroy: () => undefined,
  };
}
