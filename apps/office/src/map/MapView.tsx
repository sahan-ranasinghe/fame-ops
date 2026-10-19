import { lazy, Suspense, useState } from "react";
import { fixedHeight } from "./controlsLogic";
import DrawnMap from "./DrawnMap";
import { NoMap } from "./NoMap";
import type { MapProps } from "./types";
import { useGoogleMap } from "./google/useGoogleMap";

// The real map is web only (tiles cannot load inside a Claude artifact) and is loaded on demand:
// Google's under the google package (after the tab's map load is counted), else MapLibre.
const MapLibre = __BUILD__ === "web" ? lazy(() => import("./MapLibreMap")) : null;
const GoogleMap = __BUILD__ === "web" ? lazy(() => import("./google/GoogleMap")) : null;

const Loading = ({ height }: { height?: number }) => (
  <div className="mapbox ml" style={fixedHeight(height)}><div className="loading" style={{ padding: 24 }}>Loading the map…</div></div>
);

export function MapView(props: MapProps) {
  const [failed, setFailed] = useState(false);
  const choice = useGoogleMap();
  const loading = <Loading height={props.height} />;
  if (choice.kind === "loading") return loading;
  if (choice.kind === "google") {
    if (!GoogleMap) return <NoMap height={props.height} note="Google's map is web only" />;
    return <Suspense fallback={loading}><GoogleMap {...props} maps={choice.maps} /></Suspense>;
  }
  // The open package, or Google's map refused or failed (Part 6): the free map, with no Google content on it (the pages
  // leave Google's pins, lines and snapped roads out for it: googleDrawn, snapAllowed).
  const why = choice.kind === "free" ? <FreeMapNote note={choice.note} /> : null;
  if (!MapLibre || failed) return <>{why}<DrawnMap {...props} /></>;
  return (
    <>
      {why}
      <Suspense fallback={loading}>
        <MapLibre {...props} onFail={() => setFailed(true)} />
      </Suspense>
    </>
  );
}

/** Why the free map shows instead of Google's (a cap, a refused key, a slow load): one quiet line above it. */
export function FreeMapNote({ note }: { note: string }) {
  return <div className="muted small" data-testid="free-map-note" role="note">The free map: {note}.</div>;
}
