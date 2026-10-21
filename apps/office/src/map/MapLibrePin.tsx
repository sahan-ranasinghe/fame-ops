// The web's pin map (Part 4): OpenFreeMap Liberty tiles, one amber pin that
// can be dragged (or a click moves it) when onMove is given. The pin follows a
// typed "lat, lng" too. Falls back to the drawn map when the style cannot load.
// Phase 7: no cooperative gestures (§23); zoom and the compass are the one
// control cluster (§24, §25).
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { compassShown } from "./controlsLogic";
import { MapControls } from "./MapControls";
import { STYLE_URL } from "./MapLibreMap";
import { MAP_CANVAS } from "./types";

export default function MapLibrePin({ lat, lng, onMove, onFail }: { lat: number; lng: number; onMove?: (lat: number, lng: number) => void; onFail?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const move = useRef(onMove);
  const [camera, setCamera] = useState({ bearing: 0, pitch: 0 });
  move.current = onMove;

  useEffect(() => {
    if (!box.current) return;
    let alive = true;
    const m = new maplibregl.Map({ container: box.current, style: STYLE_URL, center: [lng, lat], zoom: 16, attributionControl: { compact: false }, cooperativeGestures: false });
    m.on("error", (e) => { if (alive && !m.isStyleLoaded() && String(e.error?.message ?? "").match(/style|fetch|load/i)) onFail?.(); });
    const turned = () => {
      const bearing = Math.round(m.getBearing() * 10) / 10, pitch = Math.round(m.getPitch() * 10) / 10;
      setCamera((c) => (c.bearing === bearing && c.pitch === pitch ? c : { bearing, pitch }));
    };
    m.on("rotate", turned);
    m.on("pitch", turned);
    m.on("moveend", turned);
    const mk = new maplibregl.Marker({ draggable: !!move.current, color: MAP_CANVAS.accent }).setLngLat([lng, lat]).addTo(m);
    mk.on("dragend", () => {
      const p = mk.getLngLat();
      move.current?.(p.lat, p.lng);
    });
    m.on("click", (e) => {
      if (!move.current) return;
      mk.setLngLat(e.lngLat);
      move.current(e.lngLat.lat, e.lngLat.lng);
    });
    map.current = m;
    marker.current = mk;
    return () => {
      alive = false;
      m.remove();
      map.current = null;
      marker.current = null;
    };
    // The map is made once; a new pin is followed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mk = marker.current;
    if (!mk) return;
    const p = mk.getLngLat();
    if (Math.abs(p.lat - lat) > 1e-7 || Math.abs(p.lng - lng) > 1e-7) {
      mk.setLngLat([lng, lat]);
      map.current?.easeTo({ center: [lng, lat], duration: 300 });
    }
  }, [lat, lng]);

  return (
    <div className="pinmap ml" data-testid="pin-map" style={{ position: "relative" }}>
      <div ref={box} style={{ position: "absolute", inset: 0 }} />
      <MapControls
        onZoomIn={() => map.current?.zoomIn()}
        onZoomOut={() => map.current?.zoomOut()}
        compass={{ shown: compassShown(camera), bearing: camera.bearing, reset: () => map.current?.easeTo({ bearing: 0, pitch: 0, duration: 400 }) }}
      />
    </div>
  );
}
