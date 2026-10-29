// The real map (web build only): MapLibre GL with OpenFreeMap's Liberty style
// (its Dark style in the site's dark theme: C, §33.12), the driver app's tiles. A marker per driver (plate chip over a dot with an
// arrow that turns with the heading, blue live / amber stale / red not
// sharing), moves animated over the real time between two positions (0.3 to
// 10 s); routes as lines coloured by speed, thin and lighter where the fix was
// poor (over 30 m), stops as small circles with their times, holes dashed, a
// playback marker (hollow while it crosses a gap, turned to the path), other
// drivers' trails drawn lighter; a focus (a timeline row) zooms to those points.
// Phase 7 (Part 2b): gap markers with their card instead of labels (§21), the
// plan's pins with straight connectors, never a Google pin or line (§20, rule
// 10), and the one control cluster with the compass (§24, §25). Round 48 (item 3; Google Maps Timeline, MarkerClusterer):
// the route's first and last point are pins, a stop is a dot drawn in a circle layer UNDER the route line (z-order: the
// line reads over the clutter; the HTML button above keeps the card), the event marks are a layer the page turns on, and
// marks that overlap at this zoom are one numbered circle (cluster.ts, re-grouped after every move) until zoomed in.
import { speedClass } from "@fleet/route";
import type { Feature, FeatureCollection } from "geojson";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { clusterItems, meanOf } from "./cluster";
import { compassShown, fixedHeight } from "./controlsLogic";
import { clusterEl, cursorEl, gapKey, gapMarkEl, markAnchor, placeCard, planPinEl, setCluster, setClustered, setCursor, setGapOpen, setPlanPin, underLine } from "./domMarks";
import { plainRuns } from "./DrawnMap";
import { needsCentre, useGapOpen } from "./gapLogic";
import { MapControls } from "./MapControls";
import { planFitKey, planFor, planPoints } from "./planDraw";
import { FREE_MAP_STYLES, type MapScheme } from "./scheme";
import { estimatedColor, mapCanvas, type MapProps, type MapRoute, moveDuration, poorStep, type RoutePoint, speedColors } from "./types";

/** The light style (the dark one: FREE_MAP_STYLES.dark, by the page's theme). */
export const STYLE_URL = FREE_MAP_STYLES.light;
const SRI_LANKA: [number, number] = [80.7, 7.8];

// The plan's connectors (thin, dashed, never read as a road, §20) and a plan leg's own road line (openrouteservice's on
// this map, as Google's map draws its lines): the map's ink in the page's scheme.

interface Live {
  marker: maplibregl.Marker;
  el: HTMLDivElement;
  from: [number, number];
  to: [number, number];
  started: number;
  duration: number;
  at: number | null;
}

interface Placed {
  marker: maplibregl.Marker;
  el: HTMLButtonElement;
  key: string;
  lat: number;
  lng: number;
  kind: string;
}

/** A plan's pin (§20). */
interface PlacedPin {
  marker: maplibregl.Marker;
  el: HTMLButtonElement;
  key: string;
}

interface PlacedCluster {
  marker: maplibregl.Marker;
  el: HTMLButtonElement;
}

function fitTo(map: maplibregl.Map, points: [number, number][], maxZoom = 14) {
  if (!points.length) return;
  if (points.length === 1) {
    map.easeTo({ center: points[0], zoom: Math.max(map.getZoom(), 12), duration: 600 });
    return;
  }
  const b = points.reduce((box, p) => box.extend(p), new maplibregl.LngLatBounds(points[0], points[0]));
  map.fitBounds(b, { padding: 70, maxZoom, duration: 600 });
}

const lngLat = (p: RoutePoint): [number, number] => [p.lng, p.lat];

/** One LineString per step, carrying its speed class and whether the fix was poor (the layer colours and thins by them). */
function stepFeatures(points: RoutePoint[], bySpeed: boolean): Feature[] {
  if (!bySpeed) {
    return plainRuns(points).map((run): Feature => ({ type: "Feature", properties: { cls: "normal", conf: "good" }, geometry: { type: "LineString", coordinates: run.map(lngLat) } }));
  }
  const out: Feature[] = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i].gapBefore) continue; // drawn as an estimated road line instead
    out.push({
      type: "Feature",
      properties: { cls: speedClass(points[i].kmh ?? 0), conf: poorStep(points[i - 1], points[i]) ? "poor" : "good" },
      geometry: { type: "LineString", coordinates: [lngLat(points[i - 1]), lngLat(points[i])] },
    });
  }
  return out;
}

/** One empty list for every render: a new `[]` each time would redraw the trails on every playback frame. */
const NO_TRAILS: MapRoute[] = [];

export default function MapLibreMap({
  markers,
  route,
  trails = NO_TRAILS,
  focus = null,
  onPick,
  gaps = [],
  openGap,
  onGap,
  plan = null,
  onPin,
  trailsToggle,
  height,
  onFail,
  scheme = "light",
}: MapProps & { onFail: () => void; scheme?: MapScheme }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const live = useRef(new Map<string, Live>());
  const stopEls = useRef<maplibregl.Marker[]>([]);
  const cursorMark = useRef<maplibregl.Marker | null>(null);
  const gapEls = useRef(new Map<string, Placed>());
  const clusterEls = useRef(new Map<string, PlacedCluster>());
  const pinEls = useRef(new Map<string, PlacedPin>());
  const recluster = useRef<() => void>(() => undefined);
  const pick = useRef(onPick);
  const pinTap = useRef(onPin);
  const fitted = useRef(false);
  const fittedRoute = useRef<string>("");
  const fittedPlan = useRef<string>("");
  const [ready, setReady] = useState(false);
  const [camera, setCamera] = useState({ bearing: 0, pitch: 0 });
  const [open, setOpen] = useGapOpen(openGap, onGap);
  const openRef = useRef(open);
  pick.current = onPick;
  pinTap.current = onPin;
  openRef.current = open;
  // Rule 10: this map never draws a Google pin or Google's line.
  const drawnPlan = useMemo(() => planFor(plan, false), [plan]);

  useEffect(() => {
    if (!box.current) return;
    let m: maplibregl.Map;
    // C (§33.12): the style and the lines in the page's scheme (MapView makes this map again when the theme changes).
    const canvas = mapCanvas(scheme), speed = speedColors(scheme);
    try {
      // §23: no cooperative gestures (one finger moves the map, the wheel zooms). Round 48: the map sits in a sticky pane
      // out of the page's scroll path (RouteMapPane), so the wheel over it zooms and a page scroll never does; no
      // "use ctrl + scroll" hint is needed.
      m = new maplibregl.Map({ container: box.current, style: FREE_MAP_STYLES[scheme], center: SRI_LANKA, zoom: 6.6, attributionControl: { compact: false }, cooperativeGestures: false });
    } catch {
      onFail();
      return;
    }
    // §24: the compass (in the cluster) shows while the map is rotated or tilted.
    const turned = () => {
      const bearing = Math.round(m.getBearing() * 10) / 10, pitch = Math.round(m.getPitch() * 10) / 10;
      setCamera((c) => (c.bearing === bearing && c.pitch === pitch ? c : { bearing, pitch }));
    };
    m.on("rotate", turned);
    m.on("pitch", turned);
    m.on("moveend", turned);
    // Round 48: the marks are grouped again at every zoom or move (the clusters depend on the pixel distances).
    m.on("moveend", () => recluster.current());
    // A tap on the map closes an open gap card.
    m.on("click", () => {
      if (openRef.current) setOpen(null);
    });
    m.on("load", () => {
      const empty = (): FeatureCollection => ({ type: "FeatureCollection", features: [] });
      m.addSource("trails", { type: "geojson", data: empty() });
      m.addLayer({ id: "trails-line", type: "line", source: "trails", paint: { "line-color": canvas.line, "line-width": 3, "line-opacity": 0.45 }, layout: { "line-join": "round", "line-cap": "round" } });
      // Part 6: a plan leg's own road line where this map may show it (openrouteservice's, never Google's: planFor).
      m.addSource("plan-lines", { type: "geojson", data: empty() });
      m.addLayer({
        id: "plan-lines-line",
        type: "line",
        source: "plan-lines",
        paint: { "line-color": canvas.ink, "line-width": 4, "line-opacity": 0.75 },
        layout: { "line-join": "round", "line-cap": "round" },
      });
      m.addSource("plan-links", { type: "geojson", data: empty() });
      m.addLayer({
        id: "plan-links-line",
        type: "line",
        source: "plan-links",
        paint: { "line-color": canvas.ink, "line-width": 2, "line-opacity": 0.55, "line-dasharray": [3, 3] },
        layout: { "line-cap": "round" },
      });
      // The gaps (§21): dashed lines only; their words are on the gap markers, never on the map.
      m.addSource("holes", { type: "geojson", data: empty() });
      m.addLayer({ id: "holes-line", type: "line", source: "holes", paint: { "line-color": canvas.hole, "line-width": 3, "line-dasharray": [2, 2] }, layout: { "line-cap": "round" } });
      m.addSource("estimated", { type: "geojson", data: empty() });
      m.addLayer({ id: "estimated-line", type: "line", source: "estimated", paint: { "line-color": estimatedColor(scheme), "line-width": 3.5, "line-dasharray": [1, 2] }, layout: { "line-cap": "round", "line-join": "round" } });
      // Round 50 (§37.5): a web trip's actions joined by straight dashed lines in ink (no live route; never a GPS line).
      m.addSource("web-trip", { type: "geojson", data: empty() });
      m.addLayer({ id: "web-trip-line", type: "line", source: "web-trip", paint: { "line-color": canvas.ink, "line-width": 3, "line-opacity": 0.8, "line-dasharray": [2.5, 2] }, layout: { "line-cap": "round" } });
      // Round 48 (z-order): the stops' dots, a circle layer added BEFORE the route line so the line draws over them (the
      // HTML button of each dot sits above, transparent, with the hit area and the card: domMarks.underLine).
      m.addSource("marks", { type: "geojson", data: empty() });
      m.addLayer({ id: "marks-dots", type: "circle", source: "marks", paint: { "circle-radius": 7, "circle-color": canvas.ring, "circle-stroke-color": canvas.ink, "circle-stroke-width": 2.5 } });
      m.addSource("route", { type: "geojson", data: empty() });
      m.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        filter: ["==", "$type", "LineString"],
        paint: {
          "line-color": ["match", ["get", "cls"], "stopped", speed.stopped, "slow", speed.slow, "fast", speed.fast, speed.normal],
          "line-width": ["match", ["get", "conf"], "poor", 2.5, 5],
          "line-opacity": ["match", ["get", "conf"], "poor", 0.45, 0.9],
        },
        layout: { "line-join": "round", "line-cap": "round" },
      });
      // Round 48: the start's own circle moved into the start pin (the page's marks: routeMarks.endPins).
      setReady(true);
    });
    m.on("error", (e) => {
      // The style itself could not load (no internet, a blocked host): fall back to the drawn map.
      const message = String((e as { error?: { message?: string } }).error?.message ?? "");
      if (!m.loaded() && /style/i.test(message)) onFail();
    });
    map.current = m;
    return () => {
      live.current.forEach((l) => l.marker.remove());
      live.current.clear();
      stopEls.current.forEach((s) => s.remove());
      stopEls.current = [];
      cursorMark.current?.remove();
      cursorMark.current = null;
      gapEls.current.forEach((g) => g.marker.remove());
      gapEls.current.clear();
      clusterEls.current.forEach((c) => c.marker.remove());
      clusterEls.current.clear();
      pinEls.current.forEach((p) => p.marker.remove());
      pinEls.current.clear();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Markers: add, move (animated over the real time between the two positions), turn, restyle, remove.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    for (const mk of markers) {
      seen.add(mk.id);
      let l = live.current.get(mk.id);
      if (!l) {
        const el = document.createElement("div");
        el.className = "mk-dom";
        el.innerHTML = `<span class="mk-chip"><span class="mk-label"></span><span class="mk-sub"></span></span><span class="mk-dot"><span class="mk-arrow"></span></span>`;
        el.addEventListener("click", (ev) => { ev.stopPropagation(); pick.current(mk.id); });
        const marker = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([mk.lng, mk.lat]).addTo(m);
        l = { marker, el, from: [mk.lng, mk.lat], to: [mk.lng, mk.lat], started: 0, duration: 0, at: mk.at ?? null };
        live.current.set(mk.id, l);
      }
      const entry = l;
      entry.el.className = `mk-dom ${mk.tone}${mk.selected ? " sel" : ""}${mk.heading != null ? " heading" : ""}`;
      entry.el.title = mk.title;
      entry.el.setAttribute("aria-label", mk.title);
      const chip = entry.el.firstChild as HTMLElement;
      (chip.firstChild as HTMLElement).textContent = mk.label;
      (chip.lastChild as HTMLElement).textContent = mk.sub ?? "";
      const arrow = entry.el.querySelector(".mk-arrow") as HTMLElement | null;
      if (arrow) arrow.style.transform = mk.heading != null ? `rotate(${Math.round(mk.heading)}deg)` : "";
      if (entry.to[0] !== mk.lng || entry.to[1] !== mk.lat) {
        const cur = entry.marker.getLngLat();
        entry.from = [cur.lng, cur.lat];
        entry.to = [mk.lng, mk.lat];
        entry.started = performance.now();
        entry.duration = moveDuration(entry.at, mk.at);
        entry.at = mk.at ?? null;
        const stepAnim = (t: number) => {
          const k = Math.min(1, (t - entry.started) / entry.duration);
          const e = entry.duration > 1500 ? k : 1 - Math.pow(1 - k, 3); // a glide over real time is linear; a short hop eases out
          entry.marker.setLngLat([entry.from[0] + (entry.to[0] - entry.from[0]) * e, entry.from[1] + (entry.to[1] - entry.from[1]) * e]);
          if (k < 1 && map.current) requestAnimationFrame(stepAnim);
        };
        requestAnimationFrame(stepAnim);
      } else entry.at = mk.at ?? entry.at;
    }
    for (const [id, l] of live.current) {
      if (!seen.has(id)) {
        l.marker.remove();
        live.current.delete(id);
      }
    }
    if (!fitted.current && markers.length) {
      fitted.current = true;
      fitTo(m, markers.map((mk) => [mk.lng, mk.lat]));
    }
  }, [markers]);

  // The route: the line (by speed and confidence), the start, the holes and estimated lines dashed (no labels, §21),
  // the stops; fitted once per route, not on every new point.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const src = m.getSource("route") as maplibregl.GeoJSONSource | undefined;
    const holeSrc = m.getSource("holes") as maplibregl.GeoJSONSource | undefined;
    const estSrc = m.getSource("estimated") as maplibregl.GeoJSONSource | undefined;
    if (!src || !holeSrc) return;
    estSrc?.setData({
      type: "FeatureCollection",
      features: (route?.estimated ?? []).filter((e) => e.points.length > 1).map((e) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: e.points.map((p): [number, number] => [p.lng, p.lat]) },
      })),
    });
    const webSrc = m.getSource("web-trip") as maplibregl.GeoJSONSource | undefined;
    const webPoints = route?.web?.points ?? [];
    webSrc?.setData({
      type: "FeatureCollection",
      features: webPoints.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: webPoints.map((p): [number, number] => [p.lng, p.lat]) } }] : [],
    });
    stopEls.current.forEach((s) => s.remove());
    stopEls.current = [];
    if (!route || !route.points.length) {
      src.setData({ type: "FeatureCollection", features: [] });
      holeSrc.setData({ type: "FeatureCollection", features: [] });
      // A day with only a web trip: fitted once to its actions.
      const webKey = webPoints.length ? `web:${webPoints[0].lat},${webPoints[0].lng}` : "";
      if (webKey && fittedRoute.current !== webKey) fitTo(m, webPoints.map((p): [number, number] => [p.lng, p.lat]));
      fittedRoute.current = webKey;
      return;
    }
    const coords = route.points.map(lngLat);
    src.setData({ type: "FeatureCollection", features: stepFeatures(route.points, !!route.bySpeed) });
    holeSrc.setData({
      type: "FeatureCollection",
      features: (route.holes ?? []).map((h) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [lngLat(h.from), lngLat(h.to)] } })),
    });
    for (const s of route.stops ?? []) {
      const el = document.createElement("div");
      el.className = "mk-stop";
      el.innerHTML = `<span class="mk-stop-dot"></span><span class="mk-stop-label"></span>`;
      (el.lastChild as HTMLElement).textContent = s.label;
      el.title = `Stopped ${s.label}`;
      stopEls.current.push(new maplibregl.Marker({ element: el, anchor: "left", offset: [-8, 0] }).setLngLat([s.lng, s.lat]).addTo(m));
    }
    const key = `${route.points[0].lat},${route.points[0].lng},${route.points[0].kmh ?? ""}`;
    if (fittedRoute.current !== key) {
      fittedRoute.current = key;
      fitTo(m, coords);
    }
    // Not on `route` itself: during playback only the cursor changes every frame and the line's arrays stay the same
    // objects, so the line and the stops are redrawn only when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.points, route?.holes, route?.estimated, route?.web, route?.stops, route?.bySpeed, ready]);

  // The playback marker: hollow while it crosses a gap, turned to the path (§22).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const c = route?.cursor;
    if (!c) {
      cursorMark.current?.remove();
      cursorMark.current = null;
      return;
    }
    if (!cursorMark.current) cursorMark.current = new maplibregl.Marker({ element: cursorEl(), anchor: "bottom" }).setLngLat([c.lng, c.lat]).addTo(m);
    cursorMark.current.setLngLat([c.lng, c.lat]);
    setCursor(cursorMark.current.getElement(), c);
  }, [route?.cursor]);

  // Other drivers' trails.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const src = m.getSource("trails") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: trails.filter((t) => t.points.length > 1).map((t) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: t.points.map(lngLat) } })),
    });
  }, [trails, ready]);

  // A timeline row: zoom to it.
  useEffect(() => {
    const m = map.current;
    if (!m || !focus || !focus.length) return;
    fitTo(m, focus.map(lngLat), 16);
  }, [focus]);

  // Round 48 (item 3): the marks grouped by their pixel distance at this zoom (cluster.ts: MarkerClusterer's grid). A
  // grouped mark is hidden and its group drawn as one numbered circle (a tap zooms in two steps on it); the open mark is
  // never grouped. The stops' dots under the line (the "marks" layer) are the single stops only.
  recluster.current = () => {
    const m = map.current;
    // Once the style has loaded (the "marks" source is there); never on loaded(), which is false while tiles still load.
    if (!m || !m.getSource("marks")) return;
    const items = [...gapEls.current.entries()].map(([id, g]) => {
      const p = m.project([g.lng, g.lat]);
      return { id, x: p.x, y: p.y };
    });
    const { singles, clusters } = clusterItems(items, { keep: openRef.current ? [openRef.current] : [] });
    const single = new Set(singles);
    gapEls.current.forEach((g, id) => setClustered(g.el, !single.has(id)));
    const seen = new Set<string>();
    for (const c of clusters) {
      seen.add(c.id);
      const members = c.ids.map((id) => gapEls.current.get(id)).filter((g): g is Placed => !!g);
      const at = meanOf(members);
      let placed = clusterEls.current.get(c.id);
      if (!placed) {
        const el = clusterEl((ids) => {
          const mm = map.current;
          if (!mm) return;
          const pts = ids.map((id) => gapEls.current.get(id)).filter((g): g is Placed => !!g);
          if (!pts.length) return;
          mm.easeTo({ center: [meanOf(pts).lng, meanOf(pts).lat], zoom: Math.min(mm.getZoom() + 2, 18), duration: 400 });
        });
        placed = { marker: new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([at.lng, at.lat]).addTo(m), el };
        clusterEls.current.set(c.id, placed);
      } else placed.marker.setLngLat([at.lng, at.lat]);
      setCluster(placed.el, c);
    }
    for (const [id, c] of clusterEls.current) {
      if (!seen.has(id)) {
        c.marker.remove();
        clusterEls.current.delete(id);
      }
    }
    const dots = m.getSource("marks") as maplibregl.GeoJSONSource | undefined;
    dots?.setData({
      type: "FeatureCollection",
      features: [...gapEls.current.entries()]
        .filter(([id, g]) => single.has(id) && underLine(g.kind as "stop"))
        .map(([, g]) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [g.lng, g.lat] } })),
    });
  };

  // The gaps' markers (§21): made again only when a gap changes, so an open card stays open across refreshes.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    for (const g of gaps) {
      seen.add(g.id);
      const key = gapKey(g);
      const had = gapEls.current.get(g.id);
      if (had && had.key === key) continue;
      had?.marker.remove();
      const el = gapMarkEl(g, {
        toggle: (id) => setOpen(openRef.current === id ? null : id),
        close: () => setOpen(null),
        container: () => map.current?.getContainer() ?? null,
      });
      setGapOpen(el, openRef.current === g.id);
      gapEls.current.set(g.id, { marker: new maplibregl.Marker({ element: el, anchor: markAnchor(g.kind) }).setLngLat([g.lng, g.lat]).addTo(m), el, key, lat: g.lat, lng: g.lng, kind: g.kind });
    }
    for (const [id, g] of gapEls.current) {
      if (!seen.has(id)) {
        g.marker.remove();
        gapEls.current.delete(id);
      }
    }
    recluster.current();
  }, [gaps, setOpen, ready]);

  // The open card (a Gaps list row or a tap): shown, and centred gently when its marker sits near the edge.
  useEffect(() => {
    gapEls.current.forEach((g, id) => setGapOpen(g.el, id === open));
    recluster.current();
    const m = map.current;
    const g = open ? gapEls.current.get(open) : undefined;
    if (!m || !g) return;
    let alive = true;
    const settle = () => {
      if (!alive) return;
      const c = m.getContainer();
      const p = m.project(g.marker.getLngLat());
      if (needsCentre(p.x, p.y, c.clientWidth, c.clientHeight)) {
        m.once("moveend", () => placeCard(g.el, c));
        m.easeTo({ center: g.marker.getLngLat(), duration: 500 });
      } else placeCard(g.el, c);
    };
    // A Gaps list row may zoom the map to the gap at the same moment: look once that move has ended.
    if (m.isMoving()) m.once("moveend", settle);
    else settle();
    return () => {
      alive = false;
    };
  }, [open]);

  // The plan (§20): our pins (never Google's), numbered, late in red, the selected one highlighted; fitted when the
  // pins change, not on a highlight.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    for (const p of drawnPlan.pins) {
      seen.add(p.id);
      const key = `${p.lat},${p.lng}`;
      let placed = pinEls.current.get(p.id);
      if (placed && placed.key !== key) {
        placed.marker.setLngLat([p.lng, p.lat]);
        placed.key = key;
      }
      if (!placed) {
        const el = planPinEl(p, (id) => pinTap.current?.(id));
        placed = { marker: new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([p.lng, p.lat]).addTo(m), el, key };
        pinEls.current.set(p.id, placed);
      }
      setPlanPin(placed.el, p, plan?.selected === p.id);
    }
    for (const [id, p] of pinEls.current) {
      if (!seen.has(id)) {
        p.marker.remove();
        pinEls.current.delete(id);
      }
    }
    const fitKey = planFitKey(drawnPlan);
    if (fitKey && fittedPlan.current !== fitKey) {
      fittedPlan.current = fitKey;
      fitTo(m, planPoints(drawnPlan).map((q): [number, number] => [q.lng, q.lat]));
    } else if (!fitKey) fittedPlan.current = "";
  }, [drawnPlan, plan?.selected]);

  // The plan's road lines this map may show (openrouteservice's) and the straight dashed connectors for the other legs
  // (never Google's line on this map: planFor).
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource("plan-lines") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: drawnPlan.lines.map((l) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: l.map((q) => [q.lng, q.lat]) } })),
    });
    (m.getSource("plan-links") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: drawnPlan.links.map(([a, b]) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[a.lng, a.lat], [b.lng, b.lat]] } })),
    });
  }, [drawnPlan, ready]);

  const fitAll = () => {
    const m = map.current;
    if (!m) return;
    const pts: [number, number][] = markers.map((mk) => [mk.lng, mk.lat]);
    if (route) pts.push(...route.points.map(lngLat));
    pts.push(...planPoints(drawnPlan).map((q): [number, number] => [q.lng, q.lat]));
    fitTo(m, pts);
  };

  return (
    <div className="mapbox ml" style={fixedHeight(height)}>
      <div ref={box} className="ml-canvas" />
      {drawnPlan.note && <div className="map-note" data-testid="map-note"><i className="map-note-dash" />{drawnPlan.note}</div>}
      <MapControls
        onZoomIn={() => map.current?.zoomIn()}
        onZoomOut={() => map.current?.zoomOut()}
        compass={{ shown: compassShown(camera), bearing: camera.bearing, reset: () => map.current?.easeTo({ bearing: 0, pitch: 0, duration: 400 }) }}
        trails={trailsToggle}
        onFit={fitAll}
        fitLabel={!markers.length && drawnPlan.pins.length ? "Fit the plan on the map" : undefined}
      />
    </div>
  );
}
