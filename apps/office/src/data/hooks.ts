import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useFleet } from "../app/FleetContext";
import type { Driver, Place, Vehicle } from "./types";
import { mayRetry } from "../transport/retryRule";
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

/** The three list loads, by store key. */
const LIST_TOOLS: Record<string, [tool: string, args: Record<string, unknown>]> = {
  "lists.drivers": ["list_drivers", {}],
  "lists.vehicles": ["list_vehicles", { filter: "all" }],
  "lists.places": ["list_places", {}],
};
/** The lists are reads: under the retry rule (transport/retryRule.ts mayRetry) a dropped load is tried again, twice. */
const RETRY_AFTER_MS = [1500, 5000];
/** Retries made per key since the last success, per store. */
const retriesByStore = new WeakMap<object, Map<string, number>>();
const retriesOf = (store: object) => {
  let m = retriesByStore.get(store);
  if (!m) retriesByStore.set(store, (m = new Map()));
  return m;
};

/** Drivers, vehicles and places for the forms: loaded once, kept in the store; a dropped load is retried, then shown. */
export function useLists(enabled = true): Lists {
  const { store, me } = useFleet();
  const d = useEntry<{ drivers: Driver[] }>("lists.drivers");
  const v = useEntry<{ vehicles: Vehicle[] }>("lists.vehicles");
  const p = useEntry<{ places: Place[] }>("lists.places");
  const can = (tool: string) => me.tools.includes(tool);
  const retries = retriesOf(store);
  const load = (key: string) => {
    const [tool, args] = LIST_TOOLS[key];
    if (!can(tool)) return;
    void store.load(key, tool, args).then((data) => {
      if (data) retries.delete(key);
    });
  };
  const reload = useCallback(() => {
    retries.clear();
    Object.keys(LIST_TOOLS).forEach(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, me.tools.join(",")]);
  useEffect(() => {
    if (!enabled) return;
    if (!d.data && !d.loading) load("lists.drivers");
    if (!v.data && !v.loading) load("lists.vehicles");
    if (!p.data && !p.loading) load("lists.places");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, store]);
  // A list that failed on a dropped connection is tried again by itself, twice, before the person is told.
  useEffect(() => {
    if (!enabled) return;
    const timers: number[] = [];
    const entries: [string, Entry<unknown>][] = [["lists.drivers", d], ["lists.vehicles", v], ["lists.places", p]];
    for (const [key, e] of entries) {
      if (e.data || e.loading || !e.err || !mayRetry(LIST_TOOLS[key][0], e.err)) continue;
      const n = retries.get(key) ?? 0;
      if (n >= RETRY_AFTER_MS.length) continue;
      retries.set(key, n + 1);
      timers.push(window.setTimeout(() => load(key), RETRY_AFTER_MS[n]));
    }
    return () => timers.forEach((t) => clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, d.err, v.err, p.err, d.loading, v.loading, p.loading]);
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
