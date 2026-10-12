import { lazy, Suspense, useState } from "react";
import DrawnMap from "./DrawnMap";
import type { MapProps } from "./types";

// The real map is web only (tiles cannot load inside a Claude artifact) and is loaded on demand.
const MapLibre = __BUILD__ === "web" ? lazy(() => import("./MapLibreMap")) : null;

export function MapView(props: MapProps) {
  const [failed, setFailed] = useState(false);
  if (!MapLibre || failed) return <DrawnMap {...props} />;
  return (
    <Suspense fallback={<div className="mapbox ml"><div className="loading" style={{ padding: 24 }}>Loading the map…</div></div>}>
      <MapLibre {...props} onFail={() => setFailed(true)} />
    </Suspense>
  );
}
