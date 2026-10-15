// Which map a page shows (Part 5): under the google package (me.map) the web asks for the tab's
// one Google map load; refused or failed, the page shows its lists without a map (never
// OpenFreeMap under the google package: its pages may carry Google content). The artifact and the
// open package keep their maps (the drawn map, MapLibre).
import { useEffect, useState } from "react";
import { useFleet } from "../../app/FleetContext";
import { type GoogleMapState, googleMapOnce, onGoogleAuthFailure } from "./googleMaps";

export type MapChoice = { kind: "open" } | { kind: "loading" } | ({ kind: "google" } & GoogleMapState);

export function useGoogleMap(): MapChoice {
  const { me, transport } = useFleet();
  const on = __BUILD__ === "web" && me.map?.package === "google";
  const [state, setState] = useState<GoogleMapState | null>(null);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    void googleMapOnce(transport).then((s) => { if (alive) setState(s); });
    onGoogleAuthFailure((note) => { if (alive) setState({ state: "failed", note }); });
    return () => {
      alive = false;
      onGoogleAuthFailure(null);
    };
  }, [on, transport]);
  if (!on) return { kind: "open" };
  return state ? { kind: "google", ...state } : { kind: "loading" };
}
