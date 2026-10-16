// The real map under the google package (web build, Part 5): Google's tiles with the same
// markers and lines as the MapLibre map: a marker per driver (plate chip over a dot with an arrow
// that turns with the heading), moves glided over the real time between two positions, routes
// coloured by speed and thin where the fix was poor, stops with their times, holes dashed, the
// playback marker (hollow while it crosses a gap, turned to the path), other drivers' trails
// lighter, a focus zooms in. Phase 7 (Part 2b): gap markers with their card instead of labels
// (§21), the plan's pins (Google's pins too: this is Google's map) and Google's road line of each
// leg (§20), and the one control cluster with the compass (§24, §25). The map itself is the tab's
// one Google map (googleMaps.ts), moved in and out of this page's box.
import { speedClass } from "@fleet/route";
import { useEffect, useMemo, useRef, useState } from "react";
import { compassShown, fixedHeight } from "../controlsLogic";
import { cursorEl, gapKey, gapMarkEl, placeCard, planPinEl, setCursor, setGapOpen, setPlanPin } from "../domMarks";
import { plainRuns } from "../DrawnMap";
import { needsCentre, useGapOpen } from "../gapLogic";
import { MapControls } from "../MapControls";
import { planFitKey, planFor, planPoints } from "../planDraw";
import { ESTIMATED_COLOR, type MapProps, moveDuration, poorStep, type RoutePoint, SPEED_COLORS } from "../types";
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

interface Placed {
  marker: HtmlMarker;
  el: HTMLButtonElement;
  key: string;
}

/** Google's road line of a plan's leg (§20): solid, dark, under the pins. */
const PLAN_LINE_COLOR = "#15181c";

const ll = (p: RoutePoint): google.maps.LatLngLiteral => ({ lat: p.lat, lng: p.lng });

/** Runs of steps with the same speed class and confidence: one polyline each. */
function runs(points: RoutePoint[], bySpeed: boolean): { color: string; poor: boolean; path: google.maps.LatLngLiteral[] }[] {
  if (points.length < 2) return [];
  if (!bySpeed) return plainRuns(points).map((run) => ({ color: SPEED_COLORS.normal, poor: false, path: run.map(ll) }));
  const out: { color: string; poor: boolean; path: google.maps.LatLngLiteral[] }[] = [];
  let broken = false;
  for (let i = 1; i < points.length; i++) {
    // A gap drawn as an estimated road line: no straight step here.
    if (points[i].gapBefore) {
      broken = true;
      continue;
    }
    const color = SPEED_COLORS[speedClass(points[i].kmh ?? 0)];
    const poor = poorStep(points[i - 1], points[i]);
    const last = out[out.length - 1];
    if (last && !broken && last.color === color && last.poor === poor) last.path.push(ll(points[i]));
    else out.push({ color, poor, path: [ll(points[i - 1]), ll(points[i])] });
    broken = false;
  }
  return out;
}

/** A dashed line drawn with repeated dash symbols (Google's polylines have no dash style of their own). */
function dashed(maps: GoogleMapsApi, m: google.maps.Map, path: google.maps.LatLngLiteral[], color: string, weight: number, scale: number, repeat: string, opacity = 1) {
  return new maps.Polyline({
    map: m,
    path,
    strokeOpacity: 0,
    clickable: false,
    icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: opacity, strokeColor: color, strokeWeight: weight, scale }, offset: "0", repeat }],
  });
}

export default function GoogleMap({
  markers,
  route,
  trails = [],
  focus = null,
  onPick,
  gaps = [],
  openGap,
  onGap,
  plan = null,
  onPin,
  trailsToggle,
  height,
  maps,
}: MapProps & { maps: GoogleMapsApi }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const live = useRef(new Map<string, Live>());
  const routeParts = useRef<{ lines: google.maps.Polyline[]; marks: HtmlMarker[] }>({ lines: [], marks: [] });
  const trailLines = useRef<google.maps.Polyline[]>([]);
  const planLines = useRef<google.maps.Polyline[]>([]);
  const cursor = useRef<HtmlMarker | null>(null);
  const gapEls = useRef(new Map<string, Placed>());
  const pinEls = useRef(new Map<string, Placed>());
  const pick = useRef(onPick);
  const pinTap = useRef(onPin);
  const fitted = useRef(false);
  const fittedRoute = useRef("");
  const fittedPlan = useRef("");
  const [camera, setCamera] = useState({ heading: 0, tilt: 0 });
  const [open, setOpen] = useGapOpen(openGap, onGap);
  const openRef = useRef(open);
  pick.current = onPick;
  pinTap.current = onPin;
  openRef.current = open;
  // Google's own map: every pin of the plan and Google's road lines.
  const drawnPlan = useMemo(() => planFor(plan, true), [plan]);

  useEffect(() => {
    if (!box.current) return;
    const m = attachMap(box.current, maps);
    map.current = m;
    // §24: the compass shows while the map is turned or tilted (on a raster map: the 45° imagery only).
    const turned = () => {
      const heading = Math.round((m.getHeading() ?? 0) * 10) / 10, tilt = Math.round((m.getTilt() ?? 0) * 10) / 10;
      setCamera((c) => (c.heading === heading && c.tilt === tilt ? c : { heading, tilt }));
    };
    turned();
    const listeners = [
      m.addListener("heading_changed", turned),
      m.addListener("tilt_changed", turned),
      // A tap on the map closes an open gap card.
      m.addListener("click", () => {
        if (openRef.current) setOpen(null);
      }),
    ];
    return () => {
      listeners.forEach((l) => l.remove());
      live.current.forEach((l) => l.marker.setMap(null));
      live.current.clear();
      routeParts.current.lines.forEach((l) => l.setMap(null));
      routeParts.current.marks.forEach((x) => x.setMap(null));
      routeParts.current = { lines: [], marks: [] };
      trailLines.current.forEach((l) => l.setMap(null));
      trailLines.current = [];
      planLines.current.forEach((l) => l.setMap(null));
      planLines.current = [];
      cursor.current?.setMap(null);
      cursor.current = null;
      gapEls.current.forEach((g) => g.marker.setMap(null));
      gapEls.current.clear();
      pinEls.current.forEach((p) => p.marker.setMap(null));
      pinEls.current.clear();
      fittedPlan.current = "";
      detachMap();
      map.current = null;
    };
  }, [maps, setOpen]);

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

  // The route: lines by speed and confidence, the start, holes and estimated lines dashed (no labels, §21), the stops.
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
    for (const h of route.holes ?? []) lines.push(dashed(maps, m, [ll(h.from), ll(h.to)], "#8d9096", 3, 2, "10px"));
    for (const e of route.estimated ?? []) {
      if (e.points.length > 1) lines.push(dashed(maps, m, e.points, ESTIMATED_COLOR, 3, 1.5, "8px"));
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

  // The playback marker: hollow while it crosses a gap, turned to the path (§22).
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
      cursor.current = htmlMarker(maps, cursorEl(), { lat: c.lat, lng: c.lng }, "bottom");
      cursor.current.setMap(m);
    }
    cursor.current.setPosition({ lat: c.lat, lng: c.lng });
    setCursor(cursor.current.el, c);
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
      had?.marker.setMap(null);
      const el = gapMarkEl(g, {
        toggle: (id) => setOpen(openRef.current === id ? null : id),
        close: () => setOpen(null),
        container: () => map.current?.getDiv() ?? null,
      });
      // A tap on the marker is the marker's, not the map's (no map click, no drag from it).
      maps.OverlayView.preventMapHitsAndGesturesFrom(el);
      setGapOpen(el, openRef.current === g.id);
      const marker = htmlMarker(maps, el, { lat: g.lat, lng: g.lng }, "center");
      marker.setMap(m);
      gapEls.current.set(g.id, { marker, el, key });
    }
    for (const [id, g] of gapEls.current) {
      if (!seen.has(id)) {
        g.marker.setMap(null);
        gapEls.current.delete(id);
      }
    }
  }, [gaps, maps, setOpen]);

  // The open card (a Gaps list row or a tap): shown, and centred gently when its marker sits near the edge.
  useEffect(() => {
    gapEls.current.forEach((g, id) => setGapOpen(g.el, id === open));
    const m = map.current;
    const g = open ? gapEls.current.get(open) : undefined;
    if (!m || !g) return;
    // A Gaps list row may zoom the map to the gap at the same moment: look once that has settled.
    const t = window.setTimeout(() => {
      const div = m.getDiv();
      const p = g.marker.getProjection()?.fromLatLngToContainerPixel(new maps.LatLng(g.marker.getPosition()));
      if (p && needsCentre(p.x, p.y, div.clientWidth, div.clientHeight)) {
        maps.event.addListenerOnce(m, "idle", () => placeCard(g.el, div));
        m.panTo(g.marker.getPosition());
      } else placeCard(g.el, div);
    }, 350);
    return () => window.clearTimeout(t);
  }, [open, maps]);

  // The plan (§20): every pin (Google's too: this is Google's map), numbered, late in red, the selected one
  // highlighted; Google's road line of each leg (straight dashed connectors only when there is none); fitted when
  // the pins or lines change, not on a highlight.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    for (const p of drawnPlan.pins) {
      seen.add(p.id);
      const key = `${p.lat},${p.lng}`;
      let placed = pinEls.current.get(p.id);
      if (placed && placed.key !== key) {
        placed.marker.setPosition({ lat: p.lat, lng: p.lng });
        placed.key = key;
      }
      if (!placed) {
        const el = planPinEl(p, (id) => pinTap.current?.(id));
        maps.OverlayView.preventMapHitsAndGesturesFrom(el);
        const marker = htmlMarker(maps, el, { lat: p.lat, lng: p.lng }, "center");
        marker.setMap(m);
        placed = { marker, el, key };
        pinEls.current.set(p.id, placed);
      }
      setPlanPin(placed.el, p, plan?.selected === p.id);
    }
    for (const [id, p] of pinEls.current) {
      if (!seen.has(id)) {
        p.marker.setMap(null);
        pinEls.current.delete(id);
      }
    }
    const fitKey = planFitKey(drawnPlan);
    if (fitKey && fittedPlan.current !== fitKey) {
      fittedPlan.current = fitKey;
      fitTo(m, maps, planPoints(drawnPlan));
    } else if (!fitKey) fittedPlan.current = "";
  }, [drawnPlan, plan?.selected, maps]);

  // The plan's lines: Google's road line per leg, or the straight dashed connectors.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    planLines.current.forEach((l) => l.setMap(null));
    planLines.current = [
      ...drawnPlan.lines.map((path) => new maps.Polyline({ map: m, path, strokeColor: PLAN_LINE_COLOR, strokeWeight: 4, strokeOpacity: 0.75, clickable: false })),
      ...drawnPlan.links.map(([a, b]) => dashed(maps, m, [{ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }], PLAN_LINE_COLOR, 2, 2, "12px", 0.55)),
    ];
  }, [drawnPlan, maps]);

  const fitAll = () => {
    const m = map.current;
    if (!m) return;
    const pts = markers.map((mk) => ({ lat: mk.lat, lng: mk.lng }));
    if (route) pts.push(...route.points.map(ll));
    pts.push(...planPoints(drawnPlan));
    fitTo(m, maps, pts);
  };

  return (
    <div className="mapbox ml" data-testid="google-map" style={fixedHeight(height)}>
      <div ref={box} className="ml-canvas" />
      {drawnPlan.note && <div className="map-note" data-testid="map-note"><i className="map-note-dash" />{drawnPlan.note}</div>}
      <MapControls
        onZoomIn={() => {
          const m = map.current;
          if (m) m.setZoom((m.getZoom() ?? 7) + 1);
        }}
        onZoomOut={() => {
          const m = map.current;
          if (m) m.setZoom((m.getZoom() ?? 7) - 1);
        }}
        compass={{
          shown: compassShown(camera),
          bearing: camera.heading,
          reset: () => {
            map.current?.setHeading(0);
            map.current?.setTilt(0);
          },
        }}
        trails={trailsToggle}
        onFit={fitAll}
        fitLabel={!markers.length && drawnPlan.pins.length ? "Fit the plan on the map" : undefined}
      />
    </div>
  );
}
