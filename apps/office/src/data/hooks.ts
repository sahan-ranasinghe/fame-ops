import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useFleet } from "../app/FleetContext";
import type { Driver, Place, Vehicle } from "./types";
import type { Entry } from "./store";

export function useEntry<T>(key: string): Entry<T> {
  const { store } = useFleet();
  return useSyncExternalStore(
    useCallback((l: () => void) => store.subscribe(l), [store]),
    () => store.get<T>(key),
    () => store.get<T>(key),
  );
}

/** Watches a tool while the component is on screen. `args` is compared by JSON. */
export function useWatch<T>(key: string, tool: string, args: Record<string, unknown>, intervalMs: number, enabled = true): Entry<T> {
  const { store } = useFleet();
  const argsKey = JSON.stringify(args);
  useEffect(() => {
    if (!enabled) return;
    store.watch(key, tool, JSON.parse(argsKey) as Record<string, unknown>, intervalMs);
    return () => store.unwatch(key);
  }, [store, key, tool, argsKey, intervalMs, enabled]);
  return useEntry<T>(key);
}

export interface Lists {
  drivers?: Driver[];
  vehicles?: Vehicle[];
  places?: Place[];
  loading: boolean;
  error?: string;
  reload: () => void;
}

/** Drivers, vehicles and places for the forms: loaded once, kept in the store. */
export function useLists(enabled = true): Lists {
  const { store, me } = useFleet();
  const d = useEntry<{ drivers: Driver[] }>("lists.drivers");
  const v = useEntry<{ vehicles: Vehicle[] }>("lists.vehicles");
  const p = useEntry<{ places: Place[] }>("lists.places");
  const can = (tool: string) => me.tools.includes(tool);
  const reload = useCallback(() => {
    if (can("list_drivers")) void store.load("lists.drivers", "list_drivers", {});
    if (can("list_vehicles")) void store.load("lists.vehicles", "list_vehicles", { filter: "all" });
    if (can("list_places")) void store.load("lists.places", "list_places", {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, me.tools.join(",")]);
  useEffect(() => {
    if (!enabled) return;
    if (!d.data && !d.loading && can("list_drivers")) void store.load("lists.drivers", "list_drivers", {});
    if (!v.data && !v.loading && can("list_vehicles")) void store.load("lists.vehicles", "list_vehicles", { filter: "all" });
    if (!p.data && !p.loading && can("list_places")) void store.load("lists.places", "list_places", {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, store]);
  const firstErr = d.err ?? v.err;
  return {
    drivers: d.data?.drivers,
    vehicles: v.data?.vehicles,
    places: p.data?.places,
    loading: d.loading || v.loading || p.loading,
    error: firstErr?.message,
    reload,
  };
}
