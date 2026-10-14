// The artifact's hand-drawn map, ported: the island's outline, a grid, the
// markers as plate chips over a square dot (with an arrow that turns with the
// heading), routes as lines (coloured by speed when asked; thin and lighter
// where the fix was poor), stops as small circles with their times, holes
// dashed with a label, a playback marker, and other drivers' trails drawn
// lighter. Zoom in, out and fit; a focus (a timeline row) zooms to those points.
import { speedClass } from "@fleet/route";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../ui/icons";
import { type MapProps, poorStep, type RoutePoint, SPEED_COLORS } from "./types";

const LK: [number, number][] = [[80.04, 9.81], [80.24, 9.83], [80.45, 9.62], [80.6, 9.42], [80.82, 9.25], [81.05, 8.92], [81.23, 8.58], [81.38, 8.4], [81.5, 8.05], [81.7, 7.72], [81.85, 7.25], [81.85, 6.88], [81.7, 6.5], [81.4, 6.25], [81.12, 6.12], [80.8, 6.0], [80.59, 5.92], [80.4, 5.96], [80.22, 6.03], [80.05, 6.25], [79.96, 6.57], [79.86, 6.9], [79.84, 7.2], [79.8, 7.6], [79.82, 8.0], [79.76, 8.25], [79.9, 8.6], [79.92, 8.95], [80.1, 9.3], [80.2, 9.48], [80.0, 9.62], [79.88, 9.75]];
const KX = Math.cos(7.8 * Math.PI / 180);
const W = 1000, H = 640;

/** The projection the artifact used: a box around every point (or the island), stretched to the SVG's shape, divided by the zoom. */
export function projection(points: [number, number][], zoom: number) {
  let minX: number, maxX: number, minY: number, maxY: number;
  if (!points.length) { minX = 79.6; maxX = 81.95; minY = 5.85; maxY = 9.9; }
  else {
    minX = Math.min(...points.map((p) => p[0])); maxX = Math.max(...points.map((p) => p[0]));
    minY = Math.min(...points.map((p) => p[1])); maxY = Math.max(...points.map((p) => p[1]));
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  let sx = Math.max((maxX - minX) * KX, 0.03) * 1.45, sy = Math.max(maxY - minY, 0.03) * 1.45;
  sx /= zoom; sy /= zoom;
  if (sx / sy > W / H) sy = sx * H / W; else sx = sy * W / H;
  const x0 = cx * KX - sx / 2, y1 = cy + sy / 2;
  const pr = (lng: number, lat: number): [number, number] => [((lng * KX - x0) / sx) * W, ((y1 - lat) / sy) * H];
  return { pr, sx, sy, x0, y1 };
}

/** Consecutive steps of the same speed class and confidence, so each run is one polyline. */
export function speedRuns(points: RoutePoint[]): { cls: keyof typeof SPEED_COLORS; poor: boolean; pts: RoutePoint[] }[] {
  const out: { cls: keyof typeof SPEED_COLORS; poor: boolean; pts: RoutePoint[] }[] = [];
  for (let i = 1; i < points.length; i++) {
    const cls = speedClass(points[i].kmh ?? 0);
    const poor = poorStep(points[i - 1], points[i]);
    const last = out[out.length - 1];
    if (last && last.cls === cls && last.poor === poor) last.pts.push(points[i]);
    else out.push({ cls, poor, pts: [points[i - 1], points[i]] });
  }
  return out;
}

export default function DrawnMap({ markers, route, trails = [], focus = null, onPick }: MapProps) {
  const [zoom, setZoom] = useState(1);
  // A focus (a timeline row) replaces the box the view is fitted to, until "fit" is pressed.
  const [view, setView] = useState<[number, number][] | null>(null);
  useEffect(() => {
    setView(focus && focus.length ? focus.map((p): [number, number] => [p.lng, p.lat]) : null);
    setZoom(1);
  }, [focus]);
  const pts = useMemo(() => {
    if (view) return view;
    const all: [number, number][] = markers.map((m) => [m.lng, m.lat]);
    if (route) all.push(...route.points.map((p): [number, number] => [p.lng, p.lat]));
    for (const t of trails) all.push(...t.points.map((p): [number, number] => [p.lng, p.lat]));
    return all;
  }, [markers, route, trails, view]);
  const { pr, sx, sy, x0, y1 } = useMemo(() => projection(pts, zoom), [pts, zoom]);
  const step = [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1].find((s) => sy / s <= 9) || 1;
  const grid: { x1: number; x2: number; y1: number; y2: number }[] = [];
  for (let la = Math.ceil((y1 - sy) / step) * step; la <= y1; la += step) { const y = pr(0, la)[1]; grid.push({ x1: 0, x2: W, y1: y, y2: y }); }
  const lngMin = x0 / KX, lngMax = (x0 + sx) / KX;
  for (let lo = Math.ceil(lngMin / step) * step; lo <= lngMax; lo += step) { const x = pr(lo, 0)[0]; grid.push({ x1: x, x2: x, y1: 0, y2: H }); }
  const island = "M" + LK.map(([lo, la]) => pr(lo, la).map((v) => v.toFixed(1)).join(",")).join("L") + "Z";
  const sea = pr(79.5, 7.3);
  const start = route?.points[0] ? pr(route.points[0].lng, route.points[0].lat) : null;
  const color = (t: string) => (t === "live" ? "var(--live)" : t === "warn" ? "var(--accent)" : "var(--bad)");
  const line = (points: RoutePoint[]) => points.map((p) => pr(p.lng, p.lat).map((v) => v.toFixed(1)).join(",")).join(" ");
  const cursor = route?.cursor ? pr(route.cursor.lng, route.cursor.lat) : null;

  return (
    <div className="mapbox">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Map of driver positions in Sri Lanka">
        <rect width={W} height={H} fill="var(--sea)" />
        <path d={island} fill="var(--land)" stroke="var(--coast)" strokeWidth="2" />
        <g stroke="var(--grid)" strokeWidth="1.5">{grid.map((g, i) => <line key={i} x1={g.x1.toFixed(1)} x2={g.x2.toFixed(1)} y1={g.y1.toFixed(1)} y2={g.y2.toFixed(1)} />)}</g>
        {sy > 0.6 && (
          <text x={sea[0].toFixed(0)} y={sea[1].toFixed(0)} fill="var(--muted)" fontSize="20" letterSpacing="6" fontFamily="IBM Plex Sans, sans-serif" transform={`rotate(-90 ${sea[0].toFixed(0)} ${sea[1].toFixed(0)})`}>INDIAN OCEAN</text>
        )}
        {trails.map((t, i) => t.points.length > 1 && (
          <polyline key={"t" + i} points={line(t.points)} fill="none" stroke="var(--live)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" opacity=".45" />
        ))}
        {route && route.points.length > 0 && (
          <g data-testid="drawn-route">
            {route.bySpeed
              ? speedRuns(route.points).map((r, i) => (
                <polyline key={i} points={line(r.pts)} fill="none" stroke={SPEED_COLORS[r.cls]} strokeWidth={r.poor ? "2.5" : "5"} strokeLinejoin="round" strokeLinecap="round" opacity={r.poor ? ".45" : ".9"} />
              ))
              : <polyline points={line(route.points)} fill="none" stroke="var(--live)" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" opacity=".85" />}
            {(route.holes ?? []).map((h, i) => {
              const a = pr(h.from.lng, h.from.lat), b = pr(h.to.lng, h.to.lat);
              return (
                <g key={"h" + i} className="hole">
                  <polyline points={line([h.from, h.to])} fill="none" stroke="var(--muted)" strokeWidth="4" strokeDasharray="10 10" strokeLinecap="round" />
                  <text x={((a[0] + b[0]) / 2).toFixed(1)} y={((a[1] + b[1]) / 2 - 8).toFixed(1)} textAnchor="middle" fontFamily="IBM Plex Sans, sans-serif" fontSize="13" fill="var(--muted)">{h.label}</text>
                </g>
              );
            })}
            {start && <circle cx={start[0].toFixed(1)} cy={start[1].toFixed(1)} r="8" fill="var(--surface)" stroke="var(--live)" strokeWidth="4" />}
            {(route.stops ?? []).map((s, i) => {
              const [x, y] = pr(s.lng, s.lat);
              return (
                <g key={"s" + i} className="stop">
                  <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="9" fill="var(--surface)" stroke="var(--ink)" strokeWidth="3" />
                  <text x={(x + 14).toFixed(1)} y={(y + 5).toFixed(1)} fontFamily="IBM Plex Mono, monospace" fontSize="15" fill="var(--ink)">{s.label}</text>
                </g>
              );
            })}
            {cursor && route.cursor && (
              <g className="cursor">
                <circle cx={cursor[0].toFixed(1)} cy={cursor[1].toFixed(1)} r="11" fill="var(--accent)" stroke="var(--surface)" strokeWidth="4" />
                <text x={cursor[0].toFixed(1)} y={(cursor[1] - 18).toFixed(1)} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontWeight="600" fontSize="16" fill="var(--ink)">{route.cursor.label}</text>
              </g>
            )}
          </g>
        )}
        {markers.map((m) => {
          const [x, y] = pr(m.lng, m.lat);
          const w = Math.max(60, m.label.length * 12.5 + 22);
          return (
            <g key={m.id} className="mk" style={{ cursor: "pointer" }} role="button" aria-label={m.title} onClick={() => onPick(m.id)}>
              {m.selected && <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="30" fill={color(m.tone)} opacity=".18" />}
              <rect x={(x - 15).toFixed(1)} y={(y - 15).toFixed(1)} width="30" height="30" rx="9" fill={color(m.tone)} stroke="var(--surface)" strokeWidth="4" />
              {m.heading != null && (
                <polygon points={`${x.toFixed(1)},${(y - 9).toFixed(1)} ${(x + 6).toFixed(1)},${(y + 6).toFixed(1)} ${(x - 6).toFixed(1)},${(y + 6).toFixed(1)}`} fill="var(--surface)" transform={`rotate(${Math.round(m.heading)} ${x.toFixed(1)} ${y.toFixed(1)})`} />
              )}
              <rect x={(x - w / 2).toFixed(1)} y={(y - 62).toFixed(1)} width={w.toFixed(1)} height="34" rx="7" fill={m.selected ? "var(--accent)" : "var(--surface)"} stroke="var(--line-strong)" />
              <text x={x.toFixed(1)} y={(y - 39).toFixed(1)} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontWeight="600" fontSize="20" fill={m.selected ? "var(--accent-ink)" : "var(--ink)"}>{m.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="zoom">
        <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(z * 2, 64))}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(z / 2, 1 / 64))}>−</button>
        <button type="button" aria-label="Fit everyone on the map" onClick={() => { setView(null); setZoom(1); }}><Icon name="fit" /></button>
      </div>
    </div>
  );
}
