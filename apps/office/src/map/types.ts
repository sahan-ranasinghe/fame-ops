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

export interface MapRoute {
  points: { lat: number; lng: number }[];
}

export interface MapProps {
  markers: MapMarker[];
  route: MapRoute | null;
  onPick: (id: string) => void;
}
