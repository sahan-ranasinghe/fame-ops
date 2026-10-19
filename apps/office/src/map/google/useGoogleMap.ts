// Which map a page shows (Part 5; Part 6, Sahan 19 October: like the phones). Under the google package (me.map) the web
// asks for the tab's one Google map load: Google's map when it is ready; refused (the map-load cap, the counter) or failed
// (Google refused the key: gm_authFailure; the script not ready within its time limit) the page shows the free map
// (MapLibre with OpenFreeMap), never no map, and never Google's content on it (rule 10: Google's road line, snapped roads,
// a Google place's pin). The open package always shows the free map. The artifact keeps its drawn map.
import { useEffect, useState } from "react";
import { useFleet } from "../../app/FleetContext";
import type { MapChoice } from "../mapChoice";
import { type GoogleMapState, googleMapOnce, onGoogleMapFailure } from "./googleMaps";

export type { MapChoice };

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

