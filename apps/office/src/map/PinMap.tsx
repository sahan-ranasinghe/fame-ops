// One pin on a small map, to confirm or move (Part 4): the search box's Map
// results and pasted pins, and the place page. On the web a real map with a
// draggable pin (a click also moves it); in the Claude artifact the drawn map
// and the "lat, lng" field beside it.
import { lazy, Suspense, useState } from "react";
import DrawnMap from "./DrawnMap";

const MapLibrePin = __BUILD__ === "web" ? lazy(() => import("./MapLibrePin")) : null;

export function PinMap({ lat, lng, onMove }: { lat: number; lng: number; onMove?: (lat: number, lng: number) => void }) {
  const [failed, setFailed] = useState(false);
  const drawn = (
    <div className="pinmap drawn" data-testid="pin-map">
      <DrawnMap markers={[{ id: "pin", label: "Pin", title: "The pin", lat, lng, tone: "live", selected: true }]} route={null} onPick={() => undefined} />
    </div>
  );
  if (!MapLibrePin || failed) return drawn;
  return (
    <Suspense fallback={<div className="pinmap"><div className="loading" style={{ padding: 16 }}>Loading the map…</div></div>}>
      <MapLibrePin lat={lat} lng={lng} onMove={onMove} onFail={() => setFailed(true)} />
    </Suspense>
  );
}
