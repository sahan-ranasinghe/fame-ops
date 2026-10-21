// One pin on Google's map (the google package, web build, Part 5): to confirm or move a pin from
// the search box or on a place page. Drag the pin or click the map to move it (when onMove is
// given); a typed "lat, lng" moves it too. The tab's one Google map, moved into this box.
// Phase 7: greedy gestures (§23); the zoom buttons and the compass are our cluster (§25).
import { useEffect, useRef, useState } from "react";
import { compassShown } from "../controlsLogic";
import { MapControls } from "../MapControls";
import { attachMap, detachMap, type GoogleMapsApi, type HtmlMarker, htmlMarker } from "./googleMaps";

export default function GooglePin({ lat, lng, onMove, maps }: { lat: number; lng: number; onMove?: (lat: number, lng: number) => void; maps: GoogleMapsApi }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const marker = useRef<HtmlMarker | null>(null);
  const move = useRef(onMove);
  const [camera, setCamera] = useState({ heading: 0, tilt: 0 });
  move.current = onMove;

  useEffect(() => {
    if (!box.current) return;
    const m = attachMap(box.current, maps);
    m.setCenter({ lat, lng });
    m.setZoom(16);
    const turned = () => {
      const heading = Math.round((m.getHeading() ?? 0) * 10) / 10, tilt = Math.round((m.getTilt() ?? 0) * 10) / 10;
      setCamera((c) => (c.heading === heading && c.tilt === tilt ? c : { heading, tilt }));
    };
    turned();
    const cameraListeners = [m.addListener("heading_changed", turned), m.addListener("tilt_changed", turned)];
    const el = document.createElement("div");
    el.setAttribute("aria-label", "The pin");
    el.style.cssText = "width:22px;height:22px;border-radius:50% 50% 50% 0;transform-origin:center;background:var(--accent);border:3px solid var(--map-pin);" +
      "box-shadow:0 1px 4px rgba(0,0,0,.35);touch-action:none;" + (move.current ? "cursor:grab" : "");
    const mk = htmlMarker(maps, el, { lat, lng }, "bottom");
    mk.setMap(m);
    marker.current = mk;
    map.current = m;
    const click = m.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!move.current || !e.latLng) return;
      mk.setPosition({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      move.current(e.latLng.lat(), e.latLng.lng());
    });
    // Dragging the pin: the map stands still while the pin follows the pointer.
    let dragging = false;
    const at = (ev: PointerEvent) => {
      const div = m.getDiv().getBoundingClientRect();
      const p = mk.getProjection()?.fromContainerPixelToLatLng(new maps.Point(ev.clientX - div.left, ev.clientY - div.top));
      return p ? { lat: p.lat(), lng: p.lng() } : null;
    };
    const down = (ev: PointerEvent) => {
      if (!move.current) return;
      dragging = true;
      el.setPointerCapture(ev.pointerId);
      m.setOptions({ gestureHandling: "none" });
      ev.stopPropagation();
    };
    const drag = (ev: PointerEvent) => {
      if (!dragging) return;
      const p = at(ev);
      if (p) mk.setPosition(p);
    };
    const up = (ev: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      m.setOptions({ gestureHandling: "greedy" });
      const p = at(ev);
      if (p) move.current?.(p.lat, p.lng);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", drag);
    el.addEventListener("pointerup", up);
    return () => {
      click.remove();
      cameraListeners.forEach((l) => l.remove());
      m.setOptions({ gestureHandling: "greedy" });
      mk.setMap(null);
      marker.current = null;
      map.current = null;
      detachMap();
    };
    // The pin is made once; a new pin is followed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maps]);

  useEffect(() => {
    const mk = marker.current;
    if (!mk) return;
    const p = mk.getPosition();
    if (Math.abs(p.lat - lat) > 1e-7 || Math.abs(p.lng - lng) > 1e-7) {
      mk.setPosition({ lat, lng });
      map.current?.panTo({ lat, lng });
    }
  }, [lat, lng]);

  const zoomBy = (d: number) => {
    const m = map.current;
    if (m) m.setZoom((m.getZoom() ?? 16) + d);
  };
  return (
    <div className="pinmap ml" data-testid="pin-map" style={{ position: "relative" }}>
      <div ref={box} style={{ position: "absolute", inset: 0 }} />
      <MapControls
        onZoomIn={() => zoomBy(1)}
        onZoomOut={() => zoomBy(-1)}
        compass={{
          shown: compassShown(camera),
          bearing: camera.heading,
          reset: () => {
            map.current?.setHeading(0);
            map.current?.setTilt(0);
          },
        }}
      />
    </div>
  );
}
