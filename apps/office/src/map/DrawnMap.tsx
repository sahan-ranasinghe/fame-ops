// The artifact's hand-drawn map, ported: the island's outline, a grid, the
// markers as plate chips over a square dot (with an arrow that turns with the
// heading), routes as lines (coloured by speed when asked; thin and lighter
// where the fix was poor), stops as small circles with their times, holes
// dashed, a playback marker (hollow while it crosses a gap, turned to the
// path), and other drivers' trails drawn lighter. A focus (a timeline row)
// zooms to those points. Phase 7 (Part 2b): gap markers whose words show only
// on hover or tap (§21: no permanent text for a gap), the plan's pins with
// straight dashed connectors and never a Google pin or line (§20, rule 10),
// and the one control cluster: zoom in, zoom out, trails, fit (§25; this map
// never turns, so it has no compass). Round 48 (item 3; Google Maps Timeline,
// MarkerClusterer): the route's first and last point are pins, a stop is a dot
// drawn BEFORE the route line (z-order: the line over the clutter; the button
// after it keeps the card), the events are a layer the page turns on, and marks
// that overlap in the SVG are one numbered circle (cluster.ts) until zoomed in.
import { speedClass } from "@fleet/route";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { type Cluster, clusterItems, clusterLabel, clusterTitle } from "./cluster";
import { fixedHeight } from "./controlsLogic";
import { cardPlacement, gapCardLines, useGapOpen } from "./gapLogic";
import { isPin } from "./layers";
import { MapControls } from "./MapControls";
import { GAP_ICONS } from "./mapIcons";
import { pinChip, planFitKey, planFor } from "./planDraw";
import { usePageScheme } from "./scheme";
import { estimatedColor, type GapMarker, type MapProps, type MapRoute, poorStep, type RoutePoint, SPEED_COLORS, speedColors } from "./types";

const LK: [number, number][] = [[80.04, 9.81], [80.24, 9.83], [80.45, 9.62], [80.6, 9.42], [80.82, 9.25], [81.05, 8.92], [81.23, 8.58], [81.38, 8.4], [81.5, 8.05], [81.7, 7.72], [81.85, 7.25], [81.85, 6.88], [81.7, 6.5], [81.4, 6.25], [81.12, 6.12], [80.8, 6.0], [80.59, 5.92], [80.4, 5.96], [80.22, 6.03], [80.05, 6.25], [79.96, 6.57], [79.86, 6.9], [79.84, 7.2], [79.8, 7.6], [79.82, 8.0], [79.76, 8.25], [79.9, 8.6], [79.92, 8.95], [80.1, 9.3], [80.2, 9.48], [80.0, 9.62], [79.88, 9.75]];
const KX = Math.cos(7.8 * Math.PI / 180);
const W = 1000, H = 640;
const FONT = "IBM Plex Sans, sans-serif";
const MONO = "IBM Plex Mono, monospace";
/** A gap marker's grey (§21) and the plan's pin colours. */
const GAP_GREY = "var(--map-gap)", PIN_RING = "var(--map-pin-ink)";
const PIN_INK = "var(--map-pin)", PIN_LATE = "var(--map-pin-late)";
/** Round 48: the grid cell for the clusters in this SVG's units (its 1000 px is a card's width on a screen). */
const CLUSTER_CELL_SVG = 56;

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
  let broken = false;
  for (let i = 1; i < points.length; i++) {
    // A gap drawn as an estimated road line: no straight step here, a new run after it.
    if (points[i].gapBefore) {
      broken = true;
      continue;
    }
    const cls = speedClass(points[i].kmh ?? 0);
    const poor = poorStep(points[i - 1], points[i]);
    const last = out[out.length - 1];
    if (last && !broken && last.cls === cls && last.poor === poor) last.pts.push(points[i]);
    else out.push({ cls, poor, pts: [points[i - 1], points[i]] });
    broken = false;
  }
  return out;
}

/** The line in runs without the gaps that have an estimated road line (one colour). */
export function plainRuns(points: RoutePoint[]): RoutePoint[][] {
  const out: RoutePoint[][] = [];
  let run: RoutePoint[] = [];
  for (const p of points) {
    if (p.gapBefore && run.length) {
      out.push(run);
      run = [];
    }
    run.push(p);
  }
  if (run.length) out.push(run);
  return out.filter((r) => r.length > 1);
}

/** Enter or Space on an SVG button acts like a click. */
const activate = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fn();
  }
};

/** A gap's card (§21), drawn only while hovered or open: the kind in bold, the times and km under it, on the side that stays inside the map. */
function GapCard({ x, y, text }: { x: number; y: number; text: string }) {
  const [head, rest] = gapCardLines(text);
  const w = Math.max(head.length * 8.4, rest.length * 7.1) + 26;
  const h = rest ? 54 : 32;
  const { side } = cardPlacement(x, y, W, H);
  const left = side === "left" ? x - 22 - w : x + 22;
  const top = Math.min(Math.max(y - h / 2, 6), H - h - 6);
  return (
    <g className="gap-card" pointerEvents="none" data-testid="gap-card">
      <rect x={left.toFixed(1)} y={top.toFixed(1)} width={w.toFixed(1)} height={h} rx="9" fill="var(--surface)" stroke="var(--line-strong)" />
      <text x={(left + 13).toFixed(1)} y={(top + 21).toFixed(1)} fontFamily={FONT} fontWeight="700" fontSize="15" fill="var(--ink)">{head}</text>
      {rest && <text x={(left + 13).toFixed(1)} y={(top + 42).toFixed(1)} fontFamily={FONT} fontSize="13" fill="var(--muted)">{rest}</text>}
    </g>
  );
}

/** One empty list for every render: a new `[]` each time would redraw the trails on every playback frame. */
const NO_TRAILS: MapRoute[] = [];

export default function DrawnMap({
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
}: MapProps) {
  // C (§33.12): the island, the sea and every mark take the page's colour tokens; the speed and estimated lines (hex) the
  // page's scheme.
  const scheme = usePageScheme();
  const speed = speedColors(scheme);
  const [zoom, setZoom] = useState(1);
  // A focus (a timeline row) replaces the box the view is fitted to, until "fit" is pressed.
  const [view, setView] = useState<[number, number][] | null>(null);
  const [open, setOpen] = useGapOpen(openGap, onGap);
  const [hover, setHover] = useState<string | null>(null);
  // Rule 10: no Google pin and never Google's line on this map.
  const drawnPlan = useMemo(() => planFor(plan, false), [plan]);
  const planKey = planFitKey(drawnPlan);
  useEffect(() => {
    setView(focus && focus.length ? focus.map((p): [number, number] => [p.lng, p.lat]) : null);
    setZoom(1);
  }, [focus]);
  // New pins: the view fits everything again (a highlight changes nothing).
  useEffect(() => {
    if (!planKey) return;
    setView(null);
    setZoom(1);
  }, [planKey]);
  const pts = useMemo(() => {
    if (view) return view;
    const all: [number, number][] = markers.map((m) => [m.lng, m.lat]);
    if (route) all.push(...route.points.map((p): [number, number] => [p.lng, p.lat]));
    for (const t of trails) all.push(...t.points.map((p): [number, number] => [p.lng, p.lat]));
    all.push(...drawnPlan.pins.map((p): [number, number] => [p.lng, p.lat]));
    return all;
    // On the route's points, not the route: during playback only the cursor changes every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, route?.points, trails, view, drawnPlan]);
  const { pr, sx, sy, x0, y1 } = useMemo(() => projection(pts, zoom), [pts, zoom]);
  const prRef = useRef(pr);
  prRef.current = pr;
  // An opened gap outside the view (zoomed in elsewhere): the view fits everything again, so its card shows.
  useEffect(() => {
    const g = open ? gaps.find((x) => x.id === open) : undefined;
    if (!g) return;
    const [x, y] = prRef.current(g.lng, g.lat);
    if (x < 0 || x > W || y < 0 || y > H) {
      setView(null);
      setZoom(1);
    }
    // Only when a card opens, not on every new list of gaps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const step = [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1].find((s) => sy / s <= 9) || 1;
  const grid: { x1: number; x2: number; y1: number; y2: number }[] = [];
  for (let la = Math.ceil((y1 - sy) / step) * step; la <= y1; la += step) { const y = pr(0, la)[1]; grid.push({ x1: 0, x2: W, y1: y, y2: y }); }
  const lngMin = x0 / KX, lngMax = (x0 + sx) / KX;
  for (let lo = Math.ceil(lngMin / step) * step; lo <= lngMax; lo += step) { const x = pr(lo, 0)[0]; grid.push({ x1: x, x2: x, y1: 0, y2: H }); }
  const island = "M" + LK.map(([lo, la]) => pr(lo, la).map((v) => v.toFixed(1)).join(",")).join("L") + "Z";
  const sea = pr(79.5, 7.3);
  const color = (t: string) => (t === "live" ? "var(--live)" : t === "warn" ? "var(--accent)" : "var(--bad)");
  const line = (points: { lat: number; lng: number }[]) => points.map((p) => pr(p.lng, p.lat).map((v) => v.toFixed(1)).join(",")).join(" ");
  const cursor = route?.cursor ? pr(route.cursor.lng, route.cursor.lat) : null;
  const cards = gaps.filter((g) => g.id === open || g.id === hover);
  const toggleGap = (g: GapMarker) => setOpen(open === g.id ? null : g.id);
  // Round 48: the marks grouped by their place in the SVG (cluster.ts); the open one is never grouped. A tap on a
  // cluster's circle zooms to its marks (the view fitted to them).
  const grouped = useMemo(() => clusterItems(gaps.map((g) => { const [x, y] = pr(g.lng, g.lat); return { id: g.id, x, y }; }), { cell: CLUSTER_CELL_SVG, keep: open ? [open] : [] }), [gaps, pr, open]);
  const single = useMemo(() => new Set(grouped.singles), [grouped]);
  const zoomTo = (c: Cluster) => {
    const members = gaps.filter((g) => c.ids.includes(g.id));
    setView(members.map((g): [number, number] => [g.lng, g.lat]));
    setZoom(1);
  };
  const shownGaps = gaps.filter((g) => single.has(g.id));

  return (
    <div className="mapbox" style={fixedHeight(height)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Map of driver positions in Sri Lanka"
        style={height ? { height: "100%", aspectRatio: "auto" } : undefined}
        onClick={() => {
          if (open) setOpen(null);
        }}
      >
        <rect width={W} height={H} fill="var(--sea)" />
        <path d={island} fill="var(--land)" stroke="var(--coast)" strokeWidth="2" />
        <g stroke="var(--grid)" strokeWidth="1.5">{grid.map((g, i) => <line key={i} x1={g.x1.toFixed(1)} x2={g.x2.toFixed(1)} y1={g.y1.toFixed(1)} y2={g.y2.toFixed(1)} />)}</g>
        {sy > 0.6 && (
          <text x={sea[0].toFixed(0)} y={sea[1].toFixed(0)} fill="var(--muted)" fontSize="20" letterSpacing="6" fontFamily={FONT} transform={`rotate(-90 ${sea[0].toFixed(0)} ${sea[1].toFixed(0)})`}>INDIAN OCEAN</text>
        )}
        {trails.map((t, i) => t.points.length > 1 && (
          <polyline key={"t" + i} points={line(t.points)} fill="none" stroke="var(--live)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" opacity=".45" />
        ))}
        {drawnPlan.links.length > 0 && (
          <g data-testid="plan-links">
            {drawnPlan.links.map(([a, b]) => (
              <polyline key={a.id + ">" + b.id} points={line([a, b])} fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeDasharray="9 8" strokeLinecap="round" opacity=".55" />
            ))}
          </g>
        )}
        {/* Round 48 (z-order): the stops' dots drawn before the route line, so the line reads over them. */}
        {shownGaps.filter((g) => g.kind === "stop").map((g) => {
          const [x, y] = pr(g.lng, g.lat);
          return <circle key={"u" + g.id} className="under-dot" data-testid="under-dot" cx={x.toFixed(1)} cy={y.toFixed(1)} r="7" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2.5" pointerEvents="none" />;
        })}
        {route && route.points.length > 0 && (
          <g data-testid="drawn-route">
            {route.bySpeed
              ? speedRuns(route.points).map((r, i) => (
                <polyline key={i} points={line(r.pts)} fill="none" stroke={speed[r.cls]} strokeWidth={r.poor ? "2.5" : "5"} strokeLinejoin="round" strokeLinecap="round" opacity={r.poor ? ".45" : ".9"} />
              ))
              : plainRuns(route.points).map((r, i) => <polyline key={"p" + i} points={line(r)} fill="none" stroke="var(--live)" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" opacity=".85" />)}
            {/* The gaps (§21): dashed lines only, their words on the gap markers. */}
            {(route.estimated ?? []).map((e, i) => (
              <polyline key={"e" + i} data-testid="estimated-line" points={line(e.points)} fill="none" stroke={estimatedColor(scheme)} strokeWidth="4" strokeDasharray="4 8" strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {(route.holes ?? []).map((h, i) => (
              <polyline key={"h" + i} className="hole" points={line([h.from, h.to])} fill="none" stroke="var(--muted)" strokeWidth="4" strokeDasharray="10 10" strokeLinecap="round" />
            ))}
            {/* Round 48: the start's own circle moved into the start pin (the page's marks). */}
            {(route.stops ?? []).map((s, i) => {
              const [x, y] = pr(s.lng, s.lat);
              return (
                <g key={"s" + i} className="stop">
                  <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="9" fill="var(--surface)" stroke="var(--ink)" strokeWidth="3" />
                  <text x={(x + 14).toFixed(1)} y={(y + 5).toFixed(1)} fontFamily={MONO} fontSize="15" fill="var(--ink)">{s.label}</text>
                </g>
              );
            })}
          </g>
        )}
        {shownGaps.map((g) => {
          const [x, y] = pr(g.lng, g.lat);
          const isOpen = g.id === open;
          const pin = isPin(g.kind);
          const stop = g.kind === "stop";
          // A pin stands on its point (the round head above it); a stop's button is a transparent hit area over the dot
          // drawn under the line, shown only while open or hovered; an event mark is the grey round mark as before.
          const cy = pin ? y - 16 : y;
          const fill = stop ? (isOpen || hover === g.id ? "var(--surface)" : "transparent") : pin ? (g.kind === "start" ? "var(--live)" : PIN_INK) : GAP_GREY;
          const stroke = stop ? (isOpen || hover === g.id ? "var(--ink)" : "transparent") : pin ? PIN_RING : PIN_RING;
          const r = stop ? 9 : 14;
          return (
            <g
              key={g.id}
              className={`gap ${g.kind}${pin ? " pin" : ""}${isOpen ? " open" : ""}`}
              data-testid={stop ? "stop-pin" : pin ? "route-pin" : "gap-marker"}
              role="button"
              tabIndex={0}
              aria-label={g.text}
              aria-expanded={isOpen}
              style={{ cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                toggleGap(g);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(null);
                else activate(() => toggleGap(g))(e);
              }}
              onMouseEnter={() => setHover(g.id)}
              onMouseLeave={() => setHover((h) => (h === g.id ? null : h))}
            >
              {isOpen && <circle cx={x.toFixed(1)} cy={cy.toFixed(1)} r={pin ? "23" : "21"} fill="var(--accent)" opacity=".4" />}
              {pin && <path d={`M${(x - 8).toFixed(1)},${(y - 10).toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)} L${(x + 8).toFixed(1)},${(y - 10).toFixed(1)} Z`} fill={fill} stroke={stroke} strokeWidth="2" />}
              <circle cx={x.toFixed(1)} cy={cy.toFixed(1)} r={r} fill={fill} stroke={stroke} strokeWidth="3" />
              {!stop && (
                <g transform={`translate(${(x - 9).toFixed(1)} ${(cy - 9).toFixed(1)}) scale(0.75)`} fill={pin && g.kind === "start" ? PIN_RING : "none"} stroke={PIN_RING} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                  {GAP_ICONS[g.kind].map((d) => <path key={d} d={d} />)}
                </g>
              )}
            </g>
          );
        })}
        {/* Round 48: a numbered circle per group of overlapping marks; a tap zooms to them (MarkerClusterer). */}
        {grouped.clusters.map((c) => (
          <g key={c.id} className="mk-cluster-svg" data-testid="mark-cluster" role="button" tabIndex={0} aria-label={clusterTitle(c.ids.length)} style={{ cursor: "pointer" }}
            onClick={(e) => { e.stopPropagation(); zoomTo(c); }} onKeyDown={activate(() => zoomTo(c))}>
            <title>{clusterTitle(c.ids.length)}</title>
            <circle cx={c.x.toFixed(1)} cy={c.y.toFixed(1)} r="16" fill={PIN_INK} stroke={PIN_RING} strokeWidth="3" />
            <text x={c.x.toFixed(1)} y={(c.y + 5).toFixed(1)} textAnchor="middle" fontFamily={MONO} fontWeight="700" fontSize="14" fill={PIN_RING}>{clusterLabel(c.ids.length)}</text>
          </g>
        ))}
        {drawnPlan.pins.map((p) => {
          const [x, y] = pr(p.lng, p.lat);
          const sel = plan?.selected === p.id;
          const chip = pinChip(p);
          const w = chip.length * 7.6 + 20;
          return (
            <g
              key={p.id}
              className={`plan-pin${p.late ? " late" : ""}${sel ? " sel" : ""}`}
              data-testid="plan-pin"
              role="button"
              tabIndex={0}
              aria-label={p.label + (p.late ? " · late" : "")}
              aria-pressed={sel}
              style={{ cursor: "pointer" }}
              onClick={() => onPin?.(p.id)}
              onKeyDown={activate(() => onPin?.(p.id))}
            >
              {sel && <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="25" fill="var(--accent)" opacity=".5" />}
              <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="16" fill={p.late ? PIN_LATE : PIN_INK} stroke={PIN_RING} strokeWidth="3" />
              <text x={x.toFixed(1)} y={(y + 5.5).toFixed(1)} textAnchor="middle" fontFamily={MONO} fontWeight="700" fontSize="15" fill={PIN_RING}>{String(p.n)}</text>
              <rect x={(x + 23).toFixed(1)} y={(y - 14).toFixed(1)} width={w.toFixed(1)} height="28" rx="7" fill={sel ? "var(--accent)" : "var(--surface)"} stroke={p.late ? "var(--bad)" : "var(--line-strong)"} />
              <text x={(x + 33).toFixed(1)} y={(y + 5).toFixed(1)} fontFamily={FONT} fontWeight="600" fontSize="14" fill={sel ? "var(--accent-ink)" : p.late ? "var(--bad)" : "var(--ink)"}>{chip}</text>
            </g>
          );
        })}
        {cursor && route?.cursor && (
          <g className={`cursor${route.cursor.estimated ? " est" : ""}`} data-testid="drawn-cursor">
            {route.cursor.heading != null && Number.isFinite(route.cursor.heading) && (
              <polygon
                points={`${cursor[0].toFixed(1)},${(cursor[1] - 25).toFixed(1)} ${(cursor[0] + 7).toFixed(1)},${(cursor[1] - 15).toFixed(1)} ${(cursor[0] - 7).toFixed(1)},${(cursor[1] - 15).toFixed(1)}`}
                fill="var(--ink)"
                transform={`rotate(${Math.round(route.cursor.heading)} ${cursor[0].toFixed(1)} ${cursor[1].toFixed(1)})`}
              />
            )}
            {route.cursor.estimated
              ? (
                <>
                  <circle cx={cursor[0].toFixed(1)} cy={cursor[1].toFixed(1)} r="13" fill="none" stroke="var(--surface)" strokeWidth="8" />
                  <circle cx={cursor[0].toFixed(1)} cy={cursor[1].toFixed(1)} r="13" fill="none" stroke="var(--accent)" strokeWidth="5" />
                </>
              )
              : <circle cx={cursor[0].toFixed(1)} cy={cursor[1].toFixed(1)} r="11" fill="var(--accent)" stroke="var(--surface)" strokeWidth="4" />}
            <text x={cursor[0].toFixed(1)} y={(cursor[1] - (route.cursor.heading != null && Number.isFinite(route.cursor.heading) ? 32 : 20)).toFixed(1)} textAnchor="middle" fontFamily={MONO} fontWeight="600" fontSize="16" fill="var(--ink)">{route.cursor.label}</text>
          </g>
        )}
        {markers.map((m) => {
          const [x, y] = pr(m.lng, m.lat);
          const w = Math.max(60, Math.max(m.label.length * 12.5, (m.sub?.length ?? 0) * 7.5) + 22);
          const h = m.sub ? 52 : 34;
          const top = y - 28 - h;
          return (
            <g key={m.id} className="mk" style={{ cursor: "pointer" }} role="button" aria-label={m.title} onClick={() => onPick(m.id)}>
              {m.selected && <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="30" fill={color(m.tone)} opacity=".18" />}
              <rect x={(x - 15).toFixed(1)} y={(y - 15).toFixed(1)} width="30" height="30" rx="9" fill={color(m.tone)} stroke="var(--surface)" strokeWidth="4" />
              {m.heading != null && (
                <polygon points={`${x.toFixed(1)},${(y - 9).toFixed(1)} ${(x + 6).toFixed(1)},${(y + 6).toFixed(1)} ${(x - 6).toFixed(1)},${(y + 6).toFixed(1)}`} fill="var(--surface)" transform={`rotate(${Math.round(m.heading)} ${x.toFixed(1)} ${y.toFixed(1)})`} />
              )}
              <rect x={(x - w / 2).toFixed(1)} y={top.toFixed(1)} width={w.toFixed(1)} height={h} rx="7" fill={m.selected ? "var(--accent)" : "var(--surface)"} stroke="var(--line-strong)" />
              <text x={x.toFixed(1)} y={(top + 23).toFixed(1)} textAnchor="middle" fontFamily={MONO} fontWeight="600" fontSize="20" fill={m.selected ? "var(--accent-ink)" : "var(--ink)"}>{m.label}</text>
              {m.sub && <text x={x.toFixed(1)} y={(top + 42).toFixed(1)} textAnchor="middle" fontFamily={MONO} fontSize="12" fill={m.selected ? "var(--accent-ink)" : "var(--muted)"}>{m.sub}</text>}
            </g>
          );
        })}
        {cards.map((g) => {
          const [x, y] = pr(g.lng, g.lat);
          return <GapCard key={"c" + g.id} x={x} y={y} text={g.text} />;
        })}
      </svg>
      {drawnPlan.note && <div className="map-note" data-testid="map-note"><i className="map-note-dash" />{drawnPlan.note}</div>}
      <MapControls
        onZoomIn={() => setZoom((z) => Math.min(z * 2, 64))}
        onZoomOut={() => setZoom((z) => Math.max(z / 2, 1 / 64))}
        trails={trailsToggle}
        onFit={() => {
          setView(null);
          setZoom(1);
        }}
        fitLabel={!markers.length && drawnPlan.pins.length ? "Fit the plan on the map" : undefined}
      />
    </div>
  );
}
