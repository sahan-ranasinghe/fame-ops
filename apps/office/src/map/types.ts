// One map, two drawings (docs/office-web-plan.md, section 4): DrawnMap is the
// artifact's SVG of Sri Lanka (no tiles can load inside Claude); MapLibreMap
// is the real map on the web. Both take the same markers and route.
export interface MapMarker {
  id: string;
  label: string;
  /** A second, smaller line under the label ("position 17:32:05"). */
  sub?: string;
  title: string;
  lat: number;
  lng: number;
  tone: "live" | "warn" | "bad";
  selected: boolean;
  /** Heading in degrees (the marker's arrow turns with it), when the phone gave one. */
  heading?: number | null;
  /** The time of this position (ms): a move is animated over the real time since the last one, capped at 10 s. */
  at?: number | null;
}

export interface RoutePoint {
  lat: number;
  lng: number;
  /** Speed of the step that reached this point, km/h (colours the line when `bySpeed` is on). */
  kmh?: number;
  /** The fix's accuracy in metres: over 30 m the step is drawn thin and lighter. */
  acc?: number | null;
  /** The point lies on a road the matcher chose, not on a GPS fix. */
  snapped?: boolean;
  /** The step that reaches this point is a gap drawn as an estimated road line instead (Part 5b): no solid step. */
  gapBefore?: boolean;
}

export interface MapRoute {
  points: RoutePoint[];
  /** Colour each step by its speed class (stopped / slow / normal / fast). */
  bySpeed?: boolean;
  /** Stops of 10 minutes or more, with the label to show (the times). */
  stops?: { lat: number; lng: number; label: string }[];
  /** Over 2 minutes between two line points: drawn dashed between them, with the label (what kind of hole, how long). */
  holes?: { from: RoutePoint; to: RoutePoint; label: string }[];
  /** A moving marker (playback) and its label. */
  cursor?: { lat: number; lng: number; label: string } | null;
  /** Gaps of over 300 m and 60 s drawn as the likely road (openrouteservice), dashed and labelled; never km (Part 5b). */
  estimated?: { points: { lat: number; lng: number }[]; label: string }[];
}

/** The estimated lines' colour: a quiet slate, dashed, so they never read as a driven line. */
export const ESTIMATED_COLOR = "#5b6f94";

export interface MapProps {
  markers: MapMarker[];
  route: MapRoute | null;
  /** Other drivers' lines (today's trails on the live map), drawn lighter. */
  trails?: MapRoute[];
  /** Zoom to these points when they change (a timeline row); null leaves the view alone. */
  focus?: RoutePoint[] | null;
  onPick: (id: string) => void;
}

/** The colours of the speed classes: standing grey, slow amber, normal blue, fast red. */
export const SPEED_COLORS: Record<"stopped" | "slow" | "normal" | "fast", string> = { stopped: "#8d9096", slow: "#f2a900", normal: "#1e4fa0", fast: "#b3261e" };

/** Up to this accuracy a step is drawn as a normal line; worse (to 150 m) thin and lighter. */
export const GOOD_ACCURACY_M = 30;

/** A step is "poor" when either end's fix was worse than 30 m. */
export const poorStep = (a: RoutePoint, b: RoutePoint) => (a.acc ?? 0) > GOOD_ACCURACY_M || (b.acc ?? 0) > GOOD_ACCURACY_M;

/** The marker's move is animated over the real time between the two positions, between 0.3 and 10 s. */
export const MOVE_MIN_MS = 300;
export const MOVE_MAX_MS = 10000;
export const moveDuration = (fromAt: number | null | undefined, toAt: number | null | undefined, fallback = 900) => {
  if (fromAt == null || toAt == null || toAt <= fromAt) return fallback;
  return Math.min(MOVE_MAX_MS, Math.max(MOVE_MIN_MS, toAt - fromAt));
};
