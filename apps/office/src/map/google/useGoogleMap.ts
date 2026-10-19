// Which map a page shows (Part 5; Part 6, Sahan 19 October: like the phones). Under the google package (me.map) the web
// asks for the tab's one Google map load: Google's map when it is ready; refused (the map-load cap, the counter) or failed
// (Google refused the key: gm_authFailure; the script not ready within its time limit) the page shows the free map
// (MapLibre with OpenFreeMap), never no map, and never Google's content on it (rule 10: Google's road line, snapped roads,
// a Google place's pin). The open package always shows the free map. The artifact keeps its drawn map.
import { useEffect, useState } from "react";
import { useFleet } from "../../app/FleetContext";
import { type GoogleMapsApi, type GoogleMapState, googleMapOnce, onGoogleMapFailure } from "./googleMaps";

export type MapChoice =
  | { kind: "loading" }
  /** Google's map, its load counted and ready. */
  | { kind: "google"; maps: GoogleMapsApi }
  /** The open package (the setting "open", or no Google keys): the free map. */
  | { kind: "open" }
  /** The google package, but Google's map refused or failed in this tab: the free map, with why. */
  | { kind: "free"; note: string };

export function useGoogleMap(): MapChoice {
  const { me, transport } = useFleet();
  const on = __BUILD__ === "web" && me.map?.package === "google";
  const [state, setState] = useState<GoogleMapState | null>(null);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    void googleMapOnce(transport).then((s) => { if (alive) setState(s); });
    const stop = onGoogleMapFailure((note) => { if (alive) setState({ state: "failed", note }); });
    return () => {
      alive = false;
      stop();
    };
  }, [on, transport]);
  if (!on) return { kind: "open" };
  if (!state) return { kind: "loading" };
  return state.state === "ready" ? { kind: "google", maps: state.maps } : { kind: "free", note: state.note };
}

/** Google's map is the one drawn: only then Google's pins, its road lines and snapped roads may go on it (rule 10). */
export const googleDrawn = (c: MapChoice) => c.kind === "google";

/**
 * May a route ask for snap to roads: on Google's map (Google's Roads API under the google package), or under the open
 * package (OSRM, when the setting names it). Never for the free map shown instead of Google's (its snapping would be
 * Google's, drawn on a map that is not Google's), and never before the choice is known: no Roads call is made for a line
 * that would not be drawn (Part 6).
 */
export const snapAllowed = (c: MapChoice) => c.kind === "google" || c.kind === "open";
