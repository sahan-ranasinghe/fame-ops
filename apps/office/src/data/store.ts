// What the screens show: one entry per key (overview, board, reqs…), filled
// by a one-off load or a watch (the connector's watchTool in the artifact,
// polling through office-api on the web). Screens subscribe with useEntry.
import type { FleetError, Transport } from "../transport/types";
import { AUTHZ } from "../transport/errors";

export interface Entry<T = unknown> {
  data?: T;
  err?: FleetError;
  at?: number;
  loading: boolean;
}

const EMPTY: Entry = { loading: false };

export class FleetStore {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private watches = new Map<string, () => void>();

  constructor(public readonly transport: Transport) {}

  get<T>(key: string): Entry<T> {
    return (this.entries.get(key) ?? EMPTY) as Entry<T>;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(key: string, patch: Partial<Entry>) {
    this.entries.set(key, { ...this.get(key), ...patch });
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

  /** After a write: everything watched fetches again. */
  invalidate(): Promise<void> {
    return this.transport.invalidate();
  }
}
