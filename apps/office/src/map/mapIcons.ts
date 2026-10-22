// The maps' own small icons (Phase 7, §21 and §24), as path data on a 24 × 24 grid, stroked: the
// drawn map draws them as SVG paths, the HTML maps (MapLibre, Google) as an inline <svg>.
import type { GapMarkerKind } from "./types";

/** A gap's icon by kind: power off (the app not running), a crossed GPS crosshair, an upload cloud (recorded, uploaded late);
 * a stop's pin. */
export const GAP_ICONS: Record<GapMarkerKind, string[]> = {
  no_data: ["M18.36 6.64a9 9 0 1 1-12.73 0", "M12 2v10"],
  no_gps: ["M12 2v3", "M12 19v3", "M2 12h3", "M19 12h3", "M12 5.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13", "M3.5 3.5l17 17"],
  late: ["M16 16l-4-4-4 4", "M12 12v9", "M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"],
  // A stop on a driver's day (§33.6 item 1): a map pin.
  stop: ["M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0", "M12 7a3 3 0 1 0 0 6a3 3 0 1 0 0-6"],
};

/** The compass needle: the north half (red) and the south half. */
export const COMPASS_NORTH = "M12 3l4 9H8z";
export const COMPASS_SOUTH = "M8 12h8l-4 9z";

/** Stroked path data as an inline <svg> string (for the HTML markers). */
export function svgMarkup(paths: string[]): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
    paths.map((d) => `<path d="${d}"/>`).join("")
  }</svg>`;
}
