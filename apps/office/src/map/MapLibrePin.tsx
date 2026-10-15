// The web's pin map (Part 4): OpenFreeMap Liberty tiles, one amber pin that
// can be dragged (or a click moves it) when onMove is given. The pin follows a
// typed "lat, lng" too. Falls back to the drawn map when the style cannot load.
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { STYLE_URL } from "./MapLibreMap";

export default function MapLibrePin({ lat, lng, onMove, onFail }: { lat: number; lng: number; onMove?: (lat: number, lng: number) => void; onFail?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const move = useRef(onMove);
  move.current = onMove;

  useEffect(() => {
    if (!box.current) return;
    let alive = true;
    const m = new maplibregl.Map({ container: box.current, style: STYLE_URL, center: [lng, lat], zoom: 16, attributionControl: { compact: true } });
    m.on("error", (e) => { if (alive && !m.isStyleLoaded() && String(e.error?.message ?? "").match(/style|fetch|load/i)) onFail?.(); });
    const mk = new maplibregl.Marker({ draggable: !!move.current, color: "#f2a900" }).setLngLat([lng, lat]).addTo(m);
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

  return <div ref={box} className="pinmap ml" data-testid="pin-map" />;
}
