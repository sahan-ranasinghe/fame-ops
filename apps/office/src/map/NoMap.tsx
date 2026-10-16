// Under the google package a page whose Google map is refused (a cap, the counter, a failed
// load) shows its lists without a map, and says why (Part 5). A map with a fixed height (a form's
// plan map, Phase 7) keeps that height, so the form does not jump.
import { fixedHeight } from "./controlsLogic";

export function NoMap({ note, small = false, height }: { note: string; small?: boolean; height?: number }) {
  return (
    <div className={small ? "pinmap" : "mapbox ml"} data-testid="no-map" role="note" style={fixedHeight(height)}>
      <div className="muted" style={{ padding: 24 }}>No map: {note}. The lists show everything.</div>
    </div>
  );
}
