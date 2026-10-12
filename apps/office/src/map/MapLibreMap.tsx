// The real map (web build only): MapLibre GL with OpenFreeMap's Liberty style,
// the driver app's tiles. A marker per driver (plate chip over a dot, blue
// live / amber stale / red not sharing), moves animated over about a second,
// the day's route as a line.
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icons";
import type { MapProps } from "./types";

export const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const SRI_LANKA: [number, number] = [80.7, 7.8];
const MOVE_MS = 900;

interface Live {
  marker: maplibregl.Marker;
  el: HTMLDivElement;
  from: [number, number];
  to: [number, number];
  started: number;
}

function fitTo(map: maplibregl.Map, points: [number, number][]) {
  if (!points.length) return;
  if (points.length === 1) {
    map.easeTo({ center: points[0], zoom: Math.max(map.getZoom(), 12), duration: 600 });
    return;
  }
  const b = points.reduce((box, p) => box.extend(p), new maplibregl.LngLatBounds(points[0], points[0]));
  map.fitBounds(b, { padding: 70, maxZoom: 14, duration: 600 });
}

export default function MapLibreMap({ markers, route, onPick, onFail }: MapProps & { onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const live = useRef(new Map<string, Live>());
  const pick = useRef(onPick);
  const fitted = useRef(false);
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
      m.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "route-line", type: "line", source: "route", paint: { "line-color": "#1e4fa0", "line-width": 5, "line-opacity": 0.85 }, layout: { "line-join": "round", "line-cap": "round" } });
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
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Markers: add, move (animated), restyle, remove.
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
        el.innerHTML = `<span class="mk-chip"></span><span class="mk-dot"></span>`;
        el.addEventListener("click", (ev) => { ev.stopPropagation(); pick.current(mk.id); });
        const marker = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([mk.lng, mk.lat]).addTo(m);
        l = { marker, el, from: [mk.lng, mk.lat], to: [mk.lng, mk.lat], started: 0 };
        live.current.set(mk.id, l);
      }
      const entry = l;
      entry.el.className = `mk-dom ${mk.tone}${mk.selected ? " sel" : ""}`;
      entry.el.title = mk.title;
      entry.el.setAttribute("aria-label", mk.title);
      (entry.el.firstChild as HTMLElement).textContent = mk.label;
      if (entry.to[0] !== mk.lng || entry.to[1] !== mk.lat) {
        const cur = entry.marker.getLngLat();
        entry.from = [cur.lng, cur.lat];
        entry.to = [mk.lng, mk.lat];
        entry.started = performance.now();
        const stepAnim = (t: number) => {
          const k = Math.min(1, (t - entry.started) / MOVE_MS);
          const e = 1 - Math.pow(1 - k, 3);
          entry.marker.setLngLat([entry.from[0] + (entry.to[0] - entry.from[0]) * e, entry.from[1] + (entry.to[1] - entry.from[1]) * e]);
          if (k < 1 && map.current) requestAnimationFrame(stepAnim);
        };
        requestAnimationFrame(stepAnim);
      }
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

  // The day's route.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const src = m.getSource("route") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (!route || !route.points.length) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const coords = route.points.map((p): [number, number] => [p.lng, p.lat]);
    src.setData({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } },
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: coords[0] } },
      ],
    });
    fitTo(m, coords);
  }, [route, ready]);

  return (
    <div className="mapbox ml">
      <div ref={box} className="ml-canvas" />
      <div className="zoom ml-fit">
        <button type="button" aria-label="Fit everyone on the map" onClick={() => { const m = map.current; if (m) fitTo(m, markers.map((mk) => [mk.lng, mk.lat])); }}><Icon name="fit" /></button>
      </div>
    </div>
  );
}
