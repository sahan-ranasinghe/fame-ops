import { lazy, Suspense, useState } from "react";
import DrawnMap from "./DrawnMap";
import { NoMap } from "./NoMap";
import type { MapProps } from "./types";
import { useGoogleMap } from "./google/useGoogleMap";

// The real map is web only (tiles cannot load inside a Claude artifact) and is loaded on demand:
// Google's under the google package (after the tab's map load is counted), else MapLibre.
const MapLibre = __BUILD__ === "web" ? lazy(() => import("./MapLibreMap")) : null;
const GoogleMap = __BUILD__ === "web" ? lazy(() => import("./google/GoogleMap")) : null;

const loading = <div className="mapbox ml"><div className="loading" style={{ padding: 24 }}>Loading the map…</div></div>;

export function MapView(props: MapProps) {
  const [failed, setFailed] = useState(false);
  const choice = useGoogleMap();
  if (choice.kind === "loading") return loading;
  if (choice.kind === "google") {
    // The google package: Google's map, or no map with the reason (never another map: Google's terms).
    if (choice.state !== "ready" || !GoogleMap) return <NoMap note={choice.state === "ready" ? "Google's map is web only" : choice.note} />;
    return <Suspense fallback={loading}><GoogleMap {...props} maps={choice.maps} /></Suspense>;
  }
  if (!MapLibre || failed) return <DrawnMap {...props} />;
  return (
    <Suspense fallback={loading}>
      <MapLibre {...props} onFail={() => setFailed(true)} />
    </Suspense>
  );
}
