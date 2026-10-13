// One map, two drawings (docs/office-web-plan.md, section 4): DrawnMap is the
// artifact's SVG of Sri Lanka (no tiles can load inside Claude); MapLibreMap
// is the real map on the web. Both take the same markers and route.
export interface MapMarker {
  id: string;
  label: string;
  title: string;
  lat: number;
  lng: number;
  tone: "live" | "warn" | "bad";
  selected: boolean;
}

export interface RoutePoint {
  lat: number;
  lng: number;
  /** Speed of the step that reached this point, km/h (colours the line when `bySpeed` is on). */
  kmh?: number;
}

export interface MapRoute {
  points: RoutePoint[];
  /** Colour each step by its speed class (stopped / slow / normal / fast). */
  bySpeed?: boolean;
  /** Stops of 10 minutes or more, with the label to show (the times). */
  stops?: { lat: number; lng: number; label: string }[];
  /** Over 10 minutes with no data: drawn dashed between the last and the next known position. */
  gaps?: { from: RoutePoint; to: RoutePoint }[];
  /** A moving marker (playback) and its label. */
  cursor?: { lat: number; lng: number; label: string } | null;
}

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
