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
  /**
   * Over 2 minutes between two line points: drawn dashed between them. Phase 7 (§21): no map draws the label any more;
   * the words are on the gap's marker (MapProps.gaps), shown on hover or tap.
   */
  holes?: { from: RoutePoint; to: RoutePoint; label?: string }[];
  /**
   * A moving marker (playback) and its label (the recorded time). Phase 7 (§22): `estimated` while it crosses a gap
   * (drawn hollow), `heading` the path's direction (the marker turns with it).
   */
  cursor?: { lat: number; lng: number; label: string; estimated?: boolean; heading?: number | null } | null;
  /** Gaps of over 300 m and 60 s drawn as the likely road (openrouteservice), dashed; never km (Part 5b). No label drawn (§21). */
  estimated?: { points: { lat: number; lng: number }[]; label?: string }[];
}

/** What a gap was (Phase 7, §21): the app not running, no GPS signal, or recorded but uploaded late. */
export type GapMarkerKind = "no_data" | "no_gps" | "late";

/** A gap's marker (Phase 7, §21): one small grey marker at the middle of its dashed line; its words on hover or tap. */
export interface GapMarker {
  id: string;
  kind: GapMarkerKind;
  lat: number;
  lng: number;
  /** "App not running · 14:02–14:44 · 42 min · about 21.3 km by road" */
  text: string;
}

/** A pin of the plan (Phase 7, §20): the start ("S") or a stop by its number, labelled "2 · Kurunegala site · 09:00–10:30". */
export interface PlanPin {
  id: string;
  n: number | "S";
  lat: number;
  lng: number;
  label: string;
  /** A missed arrive-by: drawn red. */
  late?: boolean;
  /** A Google place: its pin is Google's, drawn on Google's map only (rule 10); other maps leave it out. */
  google?: boolean;
}

/** One leg of a plan for the map (Part 6): its ends (pin ids; "base" for the drive back) and its road line, if any. */
export interface PlanLegLine {
  from: string;
  to: string;
  points: { lat: number; lng: number }[];
  /** The line is Google's (Routes): drawn on Google's map only (rule 10). */
  google: boolean;
}

/** The plan on the map (Phase 7, §20). */
export interface MapPlan {
  pins: PlanPin[];
  /**
   * Google's road line of each leg (decoded from the Routes call's polyline): drawn on Google's map only. Every other
   * map draws thin straight dashed connectors between the pins instead, with the note "not the road".
   */
  lines?: { lat: number; lng: number }[][];
  /**
   * Part 6: the plan leg by leg, with each leg's road line and whose it is (planMapOf). planFor then draws, per leg, its
   * line where the map may show it (Google's on Google's map only; openrouteservice's on any) and a dashed straight
   * connector otherwise. When given, `lines` is not read.
   */
  legs?: PlanLegLine[];
  /** The pin highlighted from the timeline (a row under the pointer or tapped). */
  selected?: string | null;
}

/** The map's own colours where a CSS variable cannot reach (MapLibre's WebGL paint, Google's polylines, a marker's
 * inline style string). The tiles are light in both themes, so these are the light theme's tokens in styles.css
 * (--map-pin, --live, --accent, the white ring); DOM and SVG overlays use the CSS variables themselves. */
export const MAP_CANVAS = { ink: "#15181c", line: "#1e4fa0", hole: "#8d9096", ring: "#ffffff", accent: "#f2a900" } as const;

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
  /** Phase 7 (§21): the gaps' markers; the open one shows its card (a Gaps list row opens it, a tap or hover too). */
  gaps?: GapMarker[];
  openGap?: string | null;
  onGap?: (id: string | null) => void;
  /** Phase 7 (§20): the plan (pins, Google's line) instead of a route; tapping a pin calls onPin with its id. */
  plan?: MapPlan | null;
  onPin?: (id: string) => void;
  /** Phase 7 (§25): today's trails as the control cluster's toggle (Live), drawn filled while on. */
  trailsToggle?: { on: boolean; toggle: () => void };
  /** A fixed height in px (a map inside a form: the plan map); default: the map's usual height. */
  height?: number;
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
