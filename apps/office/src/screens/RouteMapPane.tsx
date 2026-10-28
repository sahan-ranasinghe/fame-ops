// The map pane of a route page (Round 48, item 2; Airbnb's split view, Google Maps Timeline): the legend strip on top,
// the map filling the pane, and the playback bar laid over the map's bottom edge on a desktop (above the map's own
// corner, where Google's logo and terms or OpenFreeMap's credit stay visible) or right under the map on a phone. The
// pane is sticky in the split layout (styles.css .route-pane.split): out of the page's scroll path, so the wheel over
// the map zooms it (MapLibre: cooperativeGestures off; Google: gestureHandling "greedy") and a page scroll never does.
import type { ReactNode } from "react";
import type { RouteLayout } from "./routeLayout";

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
  return (
    <div className={`route-pane ${layout.kind}`} data-testid="route-pane" data-layout={layout.kind}>
      <div className="map-strip">{strip}</div>
      {note}
      <div className="route-mapwrap">
        {map}
        {playback && <div className="play-over">{playback}</div>}
      </div>
    </div>
  );
}
