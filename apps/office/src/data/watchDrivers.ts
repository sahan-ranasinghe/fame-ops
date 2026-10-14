// Watched mode: while the office looks at a driver (the driver page today, the
// driver selected on Live locations, every sharing driver while today's trails
// are on), the web tells the server every 30 s (watch_drivers, 90 s each time);
// the phone hears it in its next heartbeat and uploads every 10 s while moving
// instead of 20 s. Nothing happens when the person may not call the tool.
import { useEffect } from "react";
import { useFleet } from "../app/FleetContext";

export const WATCH_EVERY_MS = 30000;

export function useWatchDrivers(usernames: string[]): void {
  const { me, transport } = useFleet();
  const key = [...new Set(usernames.filter(Boolean))].sort().join(",");
  useEffect(() => {
    if (!key || !me.tools.includes("watch_drivers")) return;
    const drivers = key.split(",");
    const call = () => { void transport.call("watch_drivers", { drivers }).catch(() => undefined); };
    call();
    const timer = setInterval(call, WATCH_EVERY_MS);
    return () => clearInterval(timer);
  }, [key, me.tools, transport]);
}
