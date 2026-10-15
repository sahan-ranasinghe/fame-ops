// One pin on Google's map (the google package, web build, Part 5): to confirm or move a pin from
// the search box or on a place page. Drag the pin or click the map to move it (when onMove is
// given); a typed "lat, lng" moves it too. The tab's one Google map, moved into this box.
import { useEffect, useRef } from "react";
import { attachMap, detachMap, type GoogleMapsApi, type HtmlMarker, htmlMarker } from "./googleMaps";

export default function GooglePin({ lat, lng, onMove, maps }: { lat: number; lng: number; onMove?: (lat: number, lng: number) => void; maps: GoogleMapsApi }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const marker = useRef<HtmlMarker | null>(null);
  const move = useRef(onMove);
  move.current = onMove;

  useEffect(() => {
    if (!box.current) return;
    const m = attachMap(box.current, maps);
    m.setCenter({ lat, lng });
    m.setZoom(16);
    const el = document.createElement("div");
    el.setAttribute("aria-label", "The pin");
    el.style.cssText = "width:22px;height:22px;border-radius:50% 50% 50% 0;transform-origin:center;background:#f2a900;border:3px solid #15181c;" +
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
      m.setOptions({ gestureHandling: "cooperative" });
      const p = at(ev);
      if (p) move.current?.(p.lat, p.lng);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", drag);
    el.addEventListener("pointerup", up);
    return () => {
      click.remove();
      m.setOptions({ gestureHandling: "cooperative" });
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

  return <div className="pinmap ml" data-testid="pin-map" style={{ position: "relative" }}><div ref={box} style={{ position: "absolute", inset: 0 }} /></div>;
}
