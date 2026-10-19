// Which map a page shows (Part 6), as a type and two rules, apart from the hook (google/useGoogleMap.ts) so a test that
// replaces the hook keeps the rules.

export type MapChoice =
  | { kind: "loading" }
  /** Google's map, its load counted and ready. */
  | { kind: "google"; maps: typeof google.maps }
  /** The open package (the setting "open", or no Google keys): the free map. */
  | { kind: "open" }
  /** The google package, but Google's map refused or failed in this tab: the free map, with why. */
  | { kind: "free"; note: string };

/** Google's map is the one drawn: only then Google's pins, its road lines and snapped roads may go on it (rule 10). */
export const googleDrawn = (c: MapChoice) => c.kind === "google";

/**
 * May a route ask for snap to roads: on Google's map (Google's Roads API under the google package), or under the open
 * package (OSRM, when the setting names it). Never for the free map shown instead of Google's (its snapping would be
 * Google's, drawn on a map that is not Google's), and never before the choice is known: no Roads call is made for a line
 * that would not be drawn (Part 6).
 */
export const snapAllowed = (c: MapChoice) => c.kind === "google" || c.kind === "open";
