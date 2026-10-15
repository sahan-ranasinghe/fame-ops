// One pin on a small map, to confirm or move (Part 4): the search box's Map
// results and pasted pins, and the place page. On the web a real map with a
// draggable pin (a click also moves it): Google's under the google package
// (Part 5), else MapLibre; in the Claude artifact the drawn map and the
// "lat, lng" field beside it.
import { lazy, Suspense, useState } from "react";
import DrawnMap from "./DrawnMap";
import { NoMap } from "./NoMap";
import { useGoogleMap } from "./google/useGoogleMap";

const MapLibrePin = __BUILD__ === "web" ? lazy(() => import("./MapLibrePin")) : null;
const GooglePin = __BUILD__ === "web" ? lazy(() => import("./google/GooglePin")) : null;

const loading = <div className="pinmap"><div className="loading" style={{ padding: 16 }}>Loading the map…</div></div>;

export function PinMap({ lat, lng, onMove }: { lat: number; lng: number; onMove?: (lat: number, lng: number) => void }) {
  const [failed, setFailed] = useState(false);
  const choice = useGoogleMap();
  const drawn = (
    <div className="pinmap drawn" data-testid="pin-map">
      <DrawnMap markers={[{ id: "pin", label: "Pin", title: "The pin", lat, lng, tone: "live", selected: true }]} route={null} onPick={() => undefined} />
    </div>
  );
  if (choice.kind === "loading") return loading;
  if (choice.kind === "google") {
    if (choice.state !== "ready" || !GooglePin) return <NoMap small note={choice.state === "ready" ? "Google's map is web only" : choice.note} />;
    return <Suspense fallback={loading}><GooglePin lat={lat} lng={lng} onMove={onMove} maps={choice.maps} /></Suspense>;
  }
  if (!MapLibrePin || failed) return drawn;
  return (
    <Suspense fallback={loading}>
      <MapLibrePin lat={lat} lng={lng} onMove={onMove} onFail={() => setFailed(true)} />
    </Suspense>
  );
}
