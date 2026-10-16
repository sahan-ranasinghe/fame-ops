// One pattern for the operational screens (Phase 7, §10): a tool's answer for
// a set of arguments, kept in the store under the tool and those arguments.
// - The answer is keyed by its arguments: a changed filter never shows another
//   filter's rows as its own. With `keep`, the last answer shown stays on
//   screen (marked `stale`) while the new arguments load, so a panel never
//   collapses into a Loading block.
// - `updating` is true while a fetch the person asked for runs (new arguments,
//   a refetch): a small "Updating…" beside the title. Background refreshes
//   (`every`) are quiet, and an answer deep-equal to the last one re-renders
//   nothing (the store keeps the old object).
// - `debounce` waits for typed input to settle before fetching.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useFleet } from "../app/FleetContext";
import type { FleetError } from "../transport/types";

export interface QueryOptions {
  /** Fetch again (quietly) this often while on screen, ms. */
  every?: number;
  /** Wait this long after the arguments last changed, ms. */
  debounce?: number;
  /** false = no fetch (a missing permission); the answer is undefined. */
  enabled?: boolean;
  /** Keep the last answer on screen while new arguments load (marked stale). */
  keep?: boolean;
  /** false = not fetched again after a write (a plan preview: every call may count against a cap). Default true. */
  onWrite?: boolean;
}

export interface Query<T> {
  /** The answer for these arguments, or (keep) the last one shown while they load. */
  data: T | undefined;
  err: FleetError | undefined;
  /** Nothing to show yet: the first load. */
  loading: boolean;
  /** A fetch the person caused runs (or waits for the input to settle) while an answer is shown. */
  updating: boolean;
  /** `data` belongs to earlier arguments (keep). */
  stale: boolean;
  /** A fetch is on its way now (not merely waiting for the input to settle). */
  fetching: boolean;
  refetch: () => void;
}

/** The arguments as a key: the same arguments in any key order give the same key. */
export function argsKey(args: unknown): string {
  return JSON.stringify(args, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)))
      : v);
}

export const queryKey = (key: string, args: unknown) => `q:${key}:${argsKey(args)}`;

/** A tool's answer for `args` (null = not known yet, nothing is fetched). */
export function useQuery<T>(key: string, tool: string, args: Record<string, unknown> | null, opts: QueryOptions = {}): Query<T> {
  const { store } = useFleet();
  const { every, debounce = 0, enabled = true, keep = false, onWrite = true } = opts;
  const on = enabled && args !== null;
  const ak = argsKey(args);
  const sk = on ? queryKey(key, args) : "";
  const entry = useSyncExternalStore(
    useCallback((l: () => void) => store.subscribe(l), [store]),
    () => store.get<T>(sk),
    () => store.get<T>(sk),
  );
  // Waiting for typed input to settle: the key whose fetch has not started yet.
  const [pending, setPending] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!on) return;
    const a = JSON.parse(ak) as Record<string, unknown>;
    store.retain(sk, tool, a, onWrite);
    const has = store.get(sk).data !== undefined;
    if (debounce > 0 && !has) {
      setPending(sk);
      const scheduled = Date.now();
      timer.current = setTimeout(() => {
        timer.current = undefined;
        setPending((p) => (p === sk ? null : p));
        // Another panel on the same answer fetched it meanwhile: no second call.
        const e = store.get(sk);
        if (e.at !== undefined && e.at >= scheduled) return;
        void store.fetch(sk, tool, a);
      }, debounce);
    } else {
      // An answer already held (another panel shows it): refresh it quietly.
      void store.fetch(sk, tool, a, has);
    }
    const tick = every
      ? setInterval(() => {
        const e = store.get(sk);
        // Two panels on the same answer: one refresh between them.
        if (e.at && Date.now() - e.at < every / 2) return;
        void store.fetch(sk, tool, a, true);
      }, every)
      : undefined;
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = undefined;
      if (tick) clearInterval(tick);
      store.release(sk);
    };
  }, [store, sk, tool, ak, on, debounce, every, onWrite]);

  // The last answer shown, for `keep` while new arguments load.
  const last = useRef<{ sk: string; data: T } | null>(null);
  if (on && entry.data !== undefined && (last.current?.sk !== sk || last.current.data !== entry.data)) last.current = { sk, data: entry.data };
  if (!on) last.current = null;

  /** Fetches now (Plan now): a fetch still waiting for the input to settle goes at once instead. */
  const refetch = useCallback(() => {
    if (!on) return;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = undefined;
      setPending((p) => (p === sk ? null : p));
    }
    void store.fetch(sk, tool, JSON.parse(ak) as Record<string, unknown>);
  }, [store, sk, tool, ak, on]);

  const own = entry.data;
  const shown = own !== undefined ? own : keep && last.current ? last.current.data : undefined;
  const waiting = pending === sk || (on && own === undefined && !entry.err);
  return {
    data: shown,
    err: on ? entry.err : undefined,
    loading: on && shown === undefined && !entry.err,
    updating: on && shown !== undefined && (entry.loading || waiting),
    stale: on && own === undefined && shown !== undefined,
    fetching: on && entry.loading,
    refetch,
  };
}
