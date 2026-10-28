// The map pane of a route page (Round 48, item 2; Airbnb's split view, Google Maps Timeline): the legend strip on top,
// the map filling the pane, and the playback bar laid over the map's bottom edge on a desktop (above the map's own
// corner, where Google's logo and terms or OpenFreeMap's credit stay visible) or right under the map on a phone. The
// pane is sticky in the split layout (styles.css .route-pane.split): out of the page's scroll path, so the wheel over
// the map zooms it (MapLibre: cooperativeGestures off; Google: gestureHandling "greedy") and a page scroll never does.
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type RouteLayout, splitPaneHeight } from "./routeLayout";

/** The split pane's height from where it sits now (first load, then stuck at the top): measured on scroll and resize. */
function useSplitPaneHeight(split: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!split || typeof window === "undefined") {
      setHeight(undefined);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const next = splitPaneHeight(window.innerHeight, el.getBoundingClientRect().top);
      setHeight((h) => (h === next ? h : next));
    };
    const onChange = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onChange, { passive: true });
    window.addEventListener("resize", onChange);
    return () => {
      window.removeEventListener("scroll", onChange);
      window.removeEventListener("resize", onChange);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [split]);
  return { ref, height };
}

export function RouteMapPane({ layout, strip, map, playback, note }: {
  layout: RouteLayout;
  /** The compact legend row (RouteLegend). */
  strip: ReactNode;
  /** The MapView (given `height={layout.mapHeight}` by the page when stacked). */
  map: ReactNode;
  /** The playback bar, when the page has one. */
  playback?: ReactNode;
  /** A line between the strip and the map (a route's note). */
  note?: ReactNode;
}) {
  const pane = useSplitPaneHeight(layout.kind === "split");
  return (
    <div ref={pane.ref} className={`route-pane ${layout.kind}`} data-testid="route-pane" data-layout={layout.kind}
      style={layout.kind === "split" && pane.height ? { height: pane.height } : undefined}>
      <div className="map-strip">{strip}</div>
      {note}
      <div className="route-mapwrap">
        {map}
        {playback && <div className="play-over">{playback}</div>}
      </div>
    </div>
  );
}
