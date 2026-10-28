// The words beside a route's map (Round 48, item 2): the legend as ONE compact row (a swatch and a short word each,
// like Google Maps' and Samsara's map keys), and the explanations behind a small ⓘ button that opens the site's sheet
// (docs/ui-patterns.md §6; the pattern is Apple Maps' and Google Maps' info sheet): what the colours mean, what the
// marks are, the gaps, which line is drawn and how the km are counted. Nothing that was under the map is gone: the
// sentences moved into the sheet. The credits the terms require stay visible in the row (openrouteservice's on an
// estimated line); the map's own corner keeps Google's logo and terms, or "© OpenStreetMap contributors · OpenFreeMap".
// Pure: RouteInfo.tsx draws these.
import { ORS_CREDIT, type Route, snapControl } from "../data/route";
import { num } from "../lib/format";

export type Swatch = "stopped" | "slow" | "normal" | "fast" | "thin" | "dashed" | "estimated" | "dot" | "pin";

export interface LegendItem {
  key: Swatch;
  text: string;
}

/** The compact row's items, in order; the estimated swatch only when the route has an estimated line. */
export function legendItems(route: Route | null): LegendItem[] {
  const out: LegendItem[] = [
    { key: "stopped", text: "Standing" },
    { key: "slow", text: "<20 km/h" },
    { key: "normal", text: "20–60" },
    { key: "fast", text: ">60" },
    { key: "thin", text: "Poor fix" },
    { key: "dashed", text: "Gap" },
    { key: "pin", text: "Start / end" },
    { key: "dot", text: "Stop" },
  ];
  if (route?.estimated?.length) out.push({ key: "estimated", text: "Estimated" });
  return out;
}

/** The credits that must stay visible with the row (openrouteservice's terms, wherever one of its lines is drawn). */
export function visibleCredits(route: Route | null): string[] {
  return route?.estimated?.length ? [ORS_CREDIT] : [];
}

/** The sentence that was under the map for the estimated lines (now in the sheet), or null. */
export function estimatedSentence(route: Route | null): string | null {
  const n = route?.estimated?.length ?? 0;
  return n ? `Dashed slate: ${n} gap${n > 1 ? "s" : ""} in the GPS drawn along the likely road (estimated, not counted in km)` : null;
}

/** The km sentence that was under the driver page's map (now in the sheet). */
export const KM_SENTENCE = "Km from GPS, drift filtered: fixes worse than 50 m, jumps and drift while standing still are left out. The odometer is the true figure.";

export interface InfoSection {
  title: string;
  lines: string[];
}

/** Which map is drawn, for the credits line of the sheet. */
export type MapName = "google" | "free" | "drawn" | "loading";

/** The ⓘ sheet's sections for a route as the page holds it. */
export function infoSections(route: Route | null, snap: boolean, opts: { map?: MapName; events?: boolean } = {}): InfoSection[] {
  const out: InfoSection[] = [];
  out.push({
    title: "Line colours",
    lines: [
      "Grey: standing. Amber: under 20 km/h. Blue: 20–60 km/h. Red: over 60 km/h.",
      "Thin and lighter: a poor fix (worse than 30 m).",
    ],
  });
  out.push({
    title: "Marks",
    lines: [
      "Pins: the first and the last point of the line.",
      "Dots: stops of 10 minutes or more. Tap one for where and how long.",
      `Events (no GPS signal, the app not running, recorded offline and uploaded later) are ${opts.events ? "on" : "off"}: Filter → Layers → Events. A tapped gap always shows its mark.`,
      "Marks that overlap are one numbered circle until you zoom in; tap the circle to zoom to them.",
    ],
  });
  const gaps: string[] = ["Dashed grey: no GPS signal or the app not running (nothing was recorded)."];
  const est = estimatedSentence(route);
  if (est) gaps.push(est + ".");
  if (route?.estimatedNote) gaps.push(route.estimatedNote + ".");
  out.push({ title: "Gaps", lines: gaps });
  const line: string[] = [];
  const snapUi = snapControl(route, snap);
  if (snapUi.note) line.push(snapUi.note + ".");
  if (route?.shown != null) line.push(`Line: ${num(route.shown)} of ${num(route.count)} points.`);
  if (route?.km != null) line.push(KM_SENTENCE);
  if (line.length) out.push({ title: "The line and the km", lines: line });
  const credits: string[] = [];
  if (opts.map === "google") credits.push("Map: Google Maps (its logo and terms are on the map).");
  else if (opts.map === "free") credits.push("Map: © OpenStreetMap contributors · OpenFreeMap (shown on the map).");
  else if (opts.map === "drawn") credits.push("Map: the drawn outline of Sri Lanka (no tiles).");
  credits.push(...visibleCredits(route));
  out.push({ title: "Credits", lines: credits });
  return out;
}
