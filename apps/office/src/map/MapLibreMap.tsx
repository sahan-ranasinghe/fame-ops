// The real map (web build only): MapLibre GL with OpenFreeMap's Liberty style,
// the driver app's tiles. A marker per driver (plate chip over a dot with an
// arrow that turns with the heading, blue live / amber stale / red not
// sharing), moves animated over the real time between two positions (0.3 to
// 10 s); routes as lines coloured by speed, thin and lighter where the fix was
// poor (over 30 m), stops as small circles with their times, holes dashed with
// a label, a playback marker, other drivers' trails drawn lighter; a focus (a
// timeline row) zooms to those points.
import { speedClass } from "@fleet/route";
import type { Feature, FeatureCollection } from "geojson";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icons";
import { type MapProps, moveDuration, poorStep, type RoutePoint, SPEED_COLORS } from "./types";

export const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const SRI_LANKA: [number, number] = [80.7, 7.8];

interface Live {
  marker: maplibregl.Marker;
  el: HTMLDivElement;
  from: [number, number];
  to: [number, number];
  started: number;
  duration: number;
  at: number | null;
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
  if (!bySpeed) return points.length > 1 ? [{ type: "Feature", properties: { cls: "normal", conf: "good" }, geometry: { type: "LineString", coordinates: points.map(lngLat) } }] : [];
  const out: Feature[] = [];
  for (let i = 1; i < points.length; i++) {
    out.push({
      type: "Feature",
      properties: { cls: speedClass(points[i].kmh ?? 0), conf: poorStep(points[i - 1], points[i]) ? "poor" : "good" },
      geometry: { type: "LineString", coordinates: [lngLat(points[i - 1]), lngLat(points[i])] },
    });
  }
  return out;
}

export default function MapLibreMap({ markers, route, trails = [], focus = null, onPick, onFail }: MapProps & { onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const live = useRef(new Map<string, Live>());
  const stopEls = useRef<maplibregl.Marker[]>([]);
  const cursorEl = useRef<maplibregl.Marker | null>(null);
  const pick = useRef(onPick);
  const fitted = useRef(false);
  const fittedRoute = useRef<string>("");
  const [ready, setReady] = useState(false);
  pick.current = onPick;

  useEffect(() => {
    if (!box.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({ container: box.current, style: STYLE_URL, center: SRI_LANKA, zoom: 6.6, attributionControl: { compact: true } });
    } catch {
      onFail();
      return;
    }
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      const empty = (): FeatureCollection => ({ type: "FeatureCollection", features: [] });
      m.addSource("trails", { type: "geojson", data: empty() });
      m.addLayer({ id: "trails-line", type: "line", source: "trails", paint: { "line-color": "#1e4fa0", "line-width": 3, "line-opacity": 0.45 }, layout: { "line-join": "round", "line-cap": "round" } });
      m.addSource("holes", { type: "geojson", data: empty() });
      m.addLayer({ id: "holes-line", type: "line", source: "holes", paint: { "line-color": "#8d9096", "line-width": 3, "line-dasharray": [2, 2] }, layout: { "line-cap": "round" } });
      m.addLayer({
        id: "holes-label",
        type: "symbol",
        source: "holes",
        layout: { "symbol-placement": "line-center", "text-field": ["get", "label"], "text-size": 11, "text-font": ["Noto Sans Regular"], "text-offset": [0, -0.9], "text-allow-overlap": false },
        paint: { "text-color": "#5a5e63", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
      });
      m.addSource("route", { type: "geojson", data: empty() });
      m.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        filter: ["==", "$type", "LineString"],
        paint: {
          "line-color": ["match", ["get", "cls"], "stopped", SPEED_COLORS.stopped, "slow", SPEED_COLORS.slow, "fast", SPEED_COLORS.fast, SPEED_COLORS.normal],
          "line-width": ["match", ["get", "conf"], "poor", 2.5, 5],
          "line-opacity": ["match", ["get", "conf"], "poor", 0.45, 0.9],
        },
        layout: { "line-join": "round", "line-cap": "round" },
      });
      m.addLayer({ id: "route-start", type: "circle", source: "route", filter: ["==", "$type", "Point"], paint: { "circle-radius": 7, "circle-color": "#ffffff", "circle-stroke-color": "#1e4fa0", "circle-stroke-width": 4 } });
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
      cursorEl.current?.remove();
      cursorEl.current = null;
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
        el.innerHTML = `<span class="mk-chip"></span><span class="mk-dot"><span class="mk-arrow"></span></span>`;
        el.addEventListener("click", (ev) => { ev.stopPropagation(); pick.current(mk.id); });
        const marker = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([mk.lng, mk.lat]).addTo(m);
        l = { marker, el, from: [mk.lng, mk.lat], to: [mk.lng, mk.lat], started: 0, duration: 0, at: mk.at ?? null };
        live.current.set(mk.id, l);
      }
      const entry = l;
      entry.el.className = `mk-dom ${mk.tone}${mk.selected ? " sel" : ""}${mk.heading != null ? " heading" : ""}`;
      entry.el.title = mk.title;
      entry.el.setAttribute("aria-label", mk.title);
      (entry.el.firstChild as HTMLElement).textContent = mk.label;
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

  // The route: the line (by speed and confidence), the start, the holes with their labels, the stops; fitted once per route, not on every new point.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const src = m.getSource("route") as maplibregl.GeoJSONSource | undefined;
    const holeSrc = m.getSource("holes") as maplibregl.GeoJSONSource | undefined;
    if (!src || !holeSrc) return;
    stopEls.current.forEach((s) => s.remove());
    stopEls.current = [];
    if (!route || !route.points.length) {
      src.setData({ type: "FeatureCollection", features: [] });
      holeSrc.setData({ type: "FeatureCollection", features: [] });
      fittedRoute.current = "";
      return;
    }
    const coords = route.points.map(lngLat);
    src.setData({
      type: "FeatureCollection",
      features: [...stepFeatures(route.points, !!route.bySpeed), { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: coords[0] } }],
    });
    holeSrc.setData({
      type: "FeatureCollection",
      features: (route.holes ?? []).map((h) => ({ type: "Feature", properties: { label: h.label }, geometry: { type: "LineString", coordinates: [lngLat(h.from), lngLat(h.to)] } })),
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
  }, [route, ready]);

  // The playback marker.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const c = route?.cursor;
    if (!c) {
      cursorEl.current?.remove();
      cursorEl.current = null;
      return;
    }
    if (!cursorEl.current) {
      const el = document.createElement("div");
      el.className = "mk-cursor";
      el.innerHTML = `<span class="mk-cursor-label"></span><span class="mk-cursor-dot"></span>`;
      cursorEl.current = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([c.lng, c.lat]).addTo(m);
    }
    cursorEl.current.setLngLat([c.lng, c.lat]);
    (cursorEl.current.getElement().firstChild as HTMLElement).textContent = c.label;
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

  return (
    <div className="mapbox ml">
      <div ref={box} className="ml-canvas" />
      <div className="zoom ml-fit">
        <button
          type="button"
          aria-label="Fit everyone on the map"
          onClick={() => {
            const m = map.current;
            if (!m) return;
            const pts: [number, number][] = markers.map((mk) => [mk.lng, mk.lat]);
            if (route) pts.push(...route.points.map(lngLat));
            fitTo(m, pts);
          }}
        ><Icon name="fit" /></button>
      </div>
    </div>
  );
}
