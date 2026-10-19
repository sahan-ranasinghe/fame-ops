// What the screens show: one entry per key (overview, board, reqs…), filled
// by a one-off load or a watch (the connector's watchTool in the artifact,
// polling through office-api on the web). Screens subscribe with useEntry.
// An answer deep-equal to the one already held keeps the old object and
// notifies nobody (Phase 7, §10: a refresh with the same data re-renders
// nothing). useQuery's entries (one per tool and arguments) are fetched with
// `fetch`, kept while someone shows them (`retain` / `release`) and fetched
// again quietly after a write (`invalidate`).
import type { FleetError, Transport } from "../transport/types";
import { AUTHZ } from "../transport/errors";
import { callWithRetry } from "../transport/retryRule";

export interface Entry<T = unknown> {
  data?: T;
  err?: FleetError;
  /** When the answer shown was fetched (a refresh with the same answer moves it without a re-render). */
  at?: number;
  loading: boolean;
}

const EMPTY: Entry = { loading: false };

/** Deep equality for JSON answers (objects, arrays, strings, numbers, booleans, null). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], bb[i])) return false;
    return true;
  }
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

interface ActiveQuery {
  tool: string;
  args: Record<string, unknown>;
  users: number;
  /** Fetched again after a write. */
  onWrite: boolean;
  /** Folds a fresh answer into the one shown (Who's available keeps its order while the arguments stay). */
  merge?: (prev: unknown, next: unknown) => unknown;
}

export class FleetStore {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private watches = new Map<string, () => void>();
  /** useQuery's entries on screen: who shows them, and how to fetch them again. */
  private queries = new Map<string, ActiveQuery>();
  /** One fetch per key at a time (two panels showing the same answer share it). */
  private inflight = new Map<string, Promise<unknown>>();

  constructor(public readonly transport: Transport) {}

  get<T>(key: string): Entry<T> {
    return (this.entries.get(key) ?? EMPTY) as Entry<T>;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(key: string, patch: Partial<Entry>) {
    const prev = this.get(key);
    const next: Entry = { ...prev, ...patch };
    // The same answer again: keep the object the screens already hold.
    if ("data" in patch && prev.data !== undefined && deepEqual(prev.data, patch.data)) next.data = prev.data;
    if ("err" in patch && prev.err && patch.err && deepEqual(prev.err, patch.err)) next.err = prev.err;
    const same = this.entries.has(key) && next.data === prev.data && next.err === prev.err && next.loading === prev.loading;
    if (same) {
      // Nothing a screen shows changed: note the time in place and re-render nobody.
      if (next.at !== undefined) (prev as Entry).at = next.at;
      return;
    }
    this.entries.set(key, next);
    this.listeners.forEach((l) => l());
  }

  private fail(key: string, err: FleetError) {
    this.set(key, { err, loading: false, ...(AUTHZ.has(err.code) ? { data: undefined } : {}) });
  }

  /** Fetches once; the entry keeps the last data while it loads again. */
  async load<T>(key: string, tool: string, args: Record<string, unknown> = {}): Promise<T | undefined> {
    this.set(key, { loading: true });
    try {
      const data = await this.transport.call<T>(tool, args);
      this.set(key, { data, at: Date.now(), err: undefined, loading: false });
      return data;
    } catch (e) {
      this.fail(key, e as FleetError);
      return undefined;
    }
  }

  /**
   * Fetches into an entry and keeps what it shows until the answer comes (useQuery). `quiet`: a
   * background refresh, the entry is not marked loading (no "Updating…"). A fetch already running
   * for the key is shared.
   */
  fetch<T>(key: string, tool: string, args: Record<string, unknown>, quiet = false): Promise<T | undefined> {
    const running = this.inflight.get(key);
    if (running) {
      if (!quiet && !this.get(key).loading) this.set(key, { loading: true });
      return running as Promise<T | undefined>;
    }
    if (!quiet) this.set(key, { loading: true });
    const p = (async () => {
      try {
        // The retry rule (transport/retryRule.ts): a dropped read is asked again once before the entry shows the error.
        const fresh = await callWithRetry<T>(this.transport, tool, args);
        const prev = this.get<T>(key).data;
        const merge = this.queries.get(key)?.merge;
        const data = merge && prev !== undefined ? merge(prev, fresh) as T : fresh;
        this.set(key, { data, at: Date.now(), err: undefined, loading: false });
        return data;
      } catch (e) {
        this.fail(key, e as FleetError);
        return undefined;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  /**
   * A screen shows this query's entry: it is fetched again after a write (invalidate) unless `onWrite` is false;
   * `merge` folds each later answer into the one shown.
   */
  retain(key: string, tool: string, args: Record<string, unknown>, onWrite = true, merge?: (prev: unknown, next: unknown) => unknown): void {
    const q = this.queries.get(key);
    if (q) {
      q.users++;
      q.onWrite ||= onWrite;
      q.merge ??= merge;
    } else this.queries.set(key, { tool, args, users: 1, onWrite, merge });
  }

  /** Nobody shows it any more: the entry is forgotten (a query entry is never read by key elsewhere). */
  release(key: string): void {
    const q = this.queries.get(key);
    if (!q) return;
    if (--q.users > 0) return;
    this.queries.delete(key);
    this.entries.delete(key);
  }

  /** Fetches now and every intervalMs until unwatch(key). A second watch on the same key is ignored. */
  watch(key: string, tool: string, args: Record<string, unknown>, intervalMs: number): void {
    if (this.watches.has(key)) return;
    if (!this.get(key).data) this.set(key, { loading: true });
    const stop = this.transport.watch(tool, args, (ev) => {
      if (ev.type === "data") this.set(key, { data: ev.data, at: ev.at, err: undefined, loading: false });
      else this.fail(key, ev.error);
    }, intervalMs);
    this.watches.set(key, stop);
  }

  unwatch(key: string): void {
    const stop = this.watches.get(key);
    if (stop) {
      stop();
      this.watches.delete(key);
    }
  }

  isWatching(key: string): boolean {
    return this.watches.has(key);
  }

  /** Forgets an entry (for example the task board when the day changes). */
  reset(key: string): void {
    this.unwatch(key);
    if (this.entries.has(key)) {
      this.entries.delete(key);
      this.listeners.forEach((l) => l());
    }
  }

  /** Changes an entry's data in place (a Realtime row, the clock ticking); nothing is fetched. */
  patch<T>(key: string, fn: (data: T) => T): void {
    const e = this.get<T>(key);
    if (e.data === undefined) return;
    const next = fn(e.data);
    if (next !== e.data) this.set(key, { data: next });
  }

  /** After a write: everything watched fetches again, and every query on screen (quietly). */
  invalidate(): Promise<void> {
    for (const [key, q] of this.queries) if (q.onWrite) void this.fetch(key, q.tool, q.args, true);
    return this.transport.invalidate();
  }
}
