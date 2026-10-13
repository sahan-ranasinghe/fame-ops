// The live drivers for a screen: the tool watched every 30 s, Realtime rows
// from driver_latest moving the cards at once (web build), the statuses ageing
// every 30 s. Shared by the Live locations page and the driver page.
import { useEffect, useRef, useState } from "react";
import { useFleet } from "../app/FleetContext";
import { useWatch } from "./hooks";
import { applyLatest, type LatestRow, refreshStates } from "./live";
import type { Entry } from "./store";
import type { LiveDrivers } from "./types";

export type RealtimeState = "none" | "connecting" | "live" | "error";

export function useLiveDrivers(onRow?: (row: LatestRow) => void): { live: Entry<LiveDrivers>; rt: RealtimeState } {
  const { store, noConnector, realtime } = useFleet();
  const [rt, setRt] = useState<RealtimeState>(realtime ? "connecting" : "none");
  const live = useWatch<LiveDrivers>("live", "live_drivers", { filter: "all" }, 30000, !noConnector);
  const handler = useRef(onRow);
  handler.current = onRow;

  useEffect(() => {
    // Only this subscription's status reaches the screen: a subscription that was torn
    // down (React runs effects twice in development) must not report "live".
    let alive = true;
    const stop = realtime?.driverLatest((row) => {
      store.patch<LiveDrivers>("live", (data) => {
        const drivers = applyLatest(data.drivers, row, new Date());
        return drivers === data.drivers ? data : { ...data, drivers };
      });
      handler.current?.(row);
    }, (s) => { if (alive) setRt(s); });
    const tick = setInterval(() => store.patch<LiveDrivers>("live", (data) => {
      const drivers = refreshStates(data.drivers, new Date());
      return drivers === data.drivers ? data : { ...data, drivers };
    }), 30000);
    return () => { alive = false; stop?.(); clearInterval(tick); };
  }, [realtime, store]);

  return { live, rt };
}
