// The real map under the google package (web build, Part 5): Google's tiles with the same
// markers, lines and labels as the MapLibre map: a marker per driver (plate chip over a dot with
// an arrow that turns with the heading), moves glided over the real time between two positions,
// routes coloured by speed and thin where the fix was poor, stops with their times, holes dashed
// with a label, the playback marker, other drivers' trails lighter, a focus zooms in. The map
// itself is the tab's one Google map (googleMaps.ts), moved in and out of this page's box.
import { speedClass } from "@fleet/route";
import { useEffect, useRef } from "react";
import { Icon } from "../../ui/icons";
import { type MapProps, moveDuration, poorStep, type RoutePoint, SPEED_COLORS } from "../types";
import { attachMap, detachMap, fitTo, type GoogleMapsApi, type HtmlMarker, htmlMarker } from "./googleMaps";

interface Live {
  marker: HtmlMarker;
  el: HTMLDivElement;
  from: google.maps.LatLngLiteral;
  to: google.maps.LatLngLiteral;
  started: number;
  duration: number;
  at: number | null;
}

const ll = (p: RoutePoint): google.maps.LatLngLiteral => ({ lat: p.lat, lng: p.lng });

/** Runs of steps with the same speed class and confidence: one polyline each. */
function runs(points: RoutePoint[], bySpeed: boolean): { color: string; poor: boolean; path: google.maps.LatLngLiteral[] }[] {
  if (points.length < 2) return [];
  if (!bySpeed) return [{ color: SPEED_COLORS.normal, poor: false, path: points.map(ll) }];
  const out: { color: string; poor: boolean; path: google.maps.LatLngLiteral[] }[] = [];
  for (let i = 1; i < points.length; i++) {
    const color = SPEED_COLORS[speedClass(points[i].kmh ?? 0)];
    const poor = poorStep(points[i - 1], points[i]);
    const last = out[out.length - 1];
    if (last && last.color === color && last.poor === poor) last.path.push(ll(points[i]));
    else out.push({ color, poor, path: [ll(points[i - 1]), ll(points[i])] });
  }
  return out;
}

export default function GoogleMap({ markers, route, trails = [], focus = null, onPick, maps }: MapProps & { maps: GoogleMapsApi }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const live = useRef(new Map<string, Live>());
  const routeParts = useRef<{ lines: google.maps.Polyline[]; marks: HtmlMarker[] }>({ lines: [], marks: [] });
  const trailLines = useRef<google.maps.Polyline[]>([]);
  const cursor = useRef<HtmlMarker | null>(null);
  const pick = useRef(onPick);
  const fitted = useRef(false);
  const fittedRoute = useRef("");
  pick.current = onPick;

  useEffect(() => {
    if (!box.current) return;
    map.current = attachMap(box.current, maps);
    return () => {
      live.current.forEach((l) => l.marker.setMap(null));
      live.current.clear();
      routeParts.current.lines.forEach((l) => l.setMap(null));
      routeParts.current.marks.forEach((m) => m.setMap(null));
      routeParts.current = { lines: [], marks: [] };
      trailLines.current.forEach((l) => l.setMap(null));
      trailLines.current = [];
      cursor.current?.setMap(null);
      cursor.current = null;
      detachMap();
      map.current = null;
    };
  }, [maps]);

  // Markers: add, glide, turn, restyle, remove.
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
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          pick.current(mk.id);
        });
        const marker = htmlMarker(maps, el, { lat: mk.lat, lng: mk.lng }, "bottom");
        marker.setMap(m);
        l = { marker, el, from: { lat: mk.lat, lng: mk.lng }, to: { lat: mk.lat, lng: mk.lng }, started: 0, duration: 0, at: mk.at ?? null };
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
      if (entry.to.lat !== mk.lat || entry.to.lng !== mk.lng) {
        entry.from = entry.marker.getPosition();
        entry.to = { lat: mk.lat, lng: mk.lng };
        entry.started = performance.now();
        entry.duration = moveDuration(entry.at, mk.at);
        entry.at = mk.at ?? null;
        const stepAnim = (t: number) => {
          const k = Math.min(1, (t - entry.started) / entry.duration);
          const e = entry.duration > 1500 ? k : 1 - Math.pow(1 - k, 3);
          entry.marker.setPosition({ lat: entry.from.lat + (entry.to.lat - entry.from.lat) * e, lng: entry.from.lng + (entry.to.lng - entry.from.lng) * e });
          if (k < 1 && map.current) requestAnimationFrame(stepAnim);
        };
        requestAnimationFrame(stepAnim);
      } else entry.at = mk.at ?? entry.at;
    }
    for (const [id, l] of live.current) {
      if (!seen.has(id)) {
        l.marker.setMap(null);
        live.current.delete(id);
      }
    }
    if (!fitted.current && markers.length) {
      fitted.current = true;
      fitTo(m, maps, markers.map((mk) => ({ lat: mk.lat, lng: mk.lng })));
    }
  }, [markers, maps]);

  // The route: lines by speed and confidence, the start, holes dashed with labels, the stops.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    routeParts.current.lines.forEach((l) => l.setMap(null));
    routeParts.current.marks.forEach((x) => x.setMap(null));
    routeParts.current = { lines: [], marks: [] };
    if (!route || !route.points.length) {
      fittedRoute.current = "";
      return;
    }
    const lines: google.maps.Polyline[] = [];
    const marks: HtmlMarker[] = [];
    for (const r of runs(route.points, !!route.bySpeed)) {
      lines.push(new maps.Polyline({ map: m, path: r.path, strokeColor: r.color, strokeWeight: r.poor ? 2.5 : 5, strokeOpacity: r.poor ? 0.45 : 0.9, clickable: false }));
    }
    for (const h of route.holes ?? []) {
      lines.push(new maps.Polyline({
        map: m,
        path: [ll(h.from), ll(h.to)],
        strokeOpacity: 0,
        clickable: false,
        icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: "#8d9096", strokeWeight: 3, scale: 2 }, offset: "0", repeat: "10px" }],
      }));
      const label = document.createElement("div");
      label.className = "mk-stop";
      label.innerHTML = `<span class="mk-stop-label"></span>`;
      (label.firstChild as HTMLElement).textContent = h.label;
      const mid = htmlMarker(maps, label, { lat: (h.from.lat + h.to.lat) / 2, lng: (h.from.lng + h.to.lng) / 2 }, "center");
      mid.setMap(m);
      marks.push(mid);
    }
    const start = document.createElement("div");
    start.style.cssText = "width:14px;height:14px;border-radius:50%;background:#ffffff;border:4px solid #1e4fa0;pointer-events:none";
    const startMark = htmlMarker(maps, start, ll(route.points[0]), "center");
    startMark.setMap(m);
    marks.push(startMark);
    for (const s of route.stops ?? []) {
      const el = document.createElement("div");
      el.className = "mk-stop";
      el.innerHTML = `<span class="mk-stop-dot"></span><span class="mk-stop-label"></span>`;
      (el.lastChild as HTMLElement).textContent = s.label;
      el.title = `Stopped ${s.label}`;
      const mark = htmlMarker(maps, el, { lat: s.lat, lng: s.lng }, "left");
      mark.setMap(m);
      marks.push(mark);
    }
    routeParts.current = { lines, marks };
    const key = `${route.points[0].lat},${route.points[0].lng},${route.points[0].kmh ?? ""}`;
    if (fittedRoute.current !== key) {
      fittedRoute.current = key;
      fitTo(m, maps, route.points.map(ll));
    }
  }, [route, maps]);

  // The playback marker.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const c = route?.cursor;
    if (!c) {
      cursor.current?.setMap(null);
      cursor.current = null;
      return;
    }
    if (!cursor.current) {
      const el = document.createElement("div");
      el.className = "mk-cursor";
      el.innerHTML = `<span class="mk-cursor-label"></span><span class="mk-cursor-dot"></span>`;
      cursor.current = htmlMarker(maps, el, { lat: c.lat, lng: c.lng }, "bottom");
      cursor.current.setMap(m);
    }
    cursor.current.setPosition({ lat: c.lat, lng: c.lng });
    (cursor.current.el.firstChild as HTMLElement).textContent = c.label;
  }, [route?.cursor, maps]);

  // Other drivers' trails.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    trailLines.current.forEach((l) => l.setMap(null));
    trailLines.current = trails.filter((t) => t.points.length > 1).map((t) =>
      new maps.Polyline({ map: m, path: t.points.map(ll), strokeColor: "#1e4fa0", strokeWeight: 3, strokeOpacity: 0.45, clickable: false })
    );
  }, [trails, maps]);

  // A timeline row: zoom to it.
  useEffect(() => {
    const m = map.current;
    if (!m || !focus || !focus.length) return;
    fitTo(m, maps, focus.map(ll), 16);
  }, [focus, maps]);

  return (
    <div className="mapbox ml" data-testid="google-map">
      <div ref={box} className="ml-canvas" />
      <div className="zoom ml-fit">
        <button
          type="button"
          aria-label="Fit everyone on the map"
          onClick={() => {
            const m = map.current;
            if (!m) return;
            const pts = markers.map((mk) => ({ lat: mk.lat, lng: mk.lng }));
            if (route) pts.push(...route.points.map(ll));
            fitTo(m, maps, pts);
          }}
        ><Icon name="fit" /></button>
      </div>
    </div>
  );
}
