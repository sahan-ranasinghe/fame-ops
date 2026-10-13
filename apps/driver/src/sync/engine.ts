// The offline queue. Everything the driver does that must reach the office is
// first written to the phone (the store) and then sent from here, in order,
// whenever there is a connection. Nothing here is phone-specific: the store
// and the file upload are passed in, so the tests run this very code.
//
//   ops     start/stop sharing, task and stop changes, photos, odometer and
//           fuel logs, vehicle reports. Sent strictly in the order they happened.
//   points  location points. Sent in batches once no op is waiting, so the
//           sharing period they belong to is already on the server.

import * as api from '../lib/api';
import { ApiError, type Client } from '../lib/api';
import type { Json } from '../lib/database.types';
import type { Language, PhotoKind } from '../lib/types';

export type Op =
  | { kind: 'session_start'; id: string; employee_id: string; vehicle_id: string | null; started_at: string; device_info: Json }
  | { kind: 'session_end'; id: string; ended_at: string; end_reason: 'driver' | 'auto' }
  | { kind: 'task_patch'; id: string; patch: api.TaskPatch }
  | { kind: 'stop_patch'; id: string; patch: api.StopPatch }
  | {
    kind: 'photo';
    id: string;
    employee_id: string;
    photo_kind: PhotoKind;
    storage_path: string;
    local_uri: string;
    taken_at: string;
    lat: number | null;
    lng: number | null;
    vehicle_report_id: string | null;
  }
  | { kind: 'odometer_log'; row: api.OdometerInsert }
  | { kind: 'fuel_log'; row: api.FuelInsert }
  | { kind: 'report'; row: api.ReportInsert }
  | { kind: 'employee_patch'; id: string; patch: { current_vehicle_id?: string | null; language?: Language } }
  /** Only the newest one matters: the store keeps one waiting heartbeat at a time (replaceOp). */
  | { kind: 'heartbeat'; row: api.HeartbeatRow };

export interface StoredOp {
  seq: number;
  op: Op;
}

export interface StoredPoint {
  seq: number;
  session_id: string;
  recorded_at: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  heading: number | null;
  battery_pct: number | null;
  is_mock: boolean;
}

/** Where the queue lives. SQLite on the phone (sync/store.ts), memory in tests. */
export interface QueueStore {
  /** Waiting ops, oldest first. Failed ones are not returned. */
  nextOps(limit: number): StoredOp[];
  removeOp(seq: number): void;
  /** The server refused it for good. It is kept for the driver to see and not tried again. */
  failOp(seq: number, error: string): void;
  nextPoints(limit: number): StoredPoint[];
  removePoints(seqs: number[]): void;
}

export interface SyncDeps {
  client: Client;
  store: QueueStore;
  employeeId: () => string | null;
  /** Sends a photo file to storage. "Already there" counts as success. Throws ApiError. */
  uploadFile: (localUri: string, storagePath: string) => Promise<void>;
  /** Frees the phone's copy once the photo is safely uploaded. */
  removeFile: (localUri: string) => void;
}

export interface FlushResult {
  sent: number;
  failed: number;
  /** true when sending stopped because there was no usable connection. */
  offline: boolean;
}

const ORDER = ['assigned', 'in_progress', 'completed'];

export function createSync(deps: SyncDeps) {
  const { client, store } = deps;
  let running: Promise<FlushResult> | null = null;

  async function send(op: Op): Promise<void> {
    switch (op.kind) {
      case 'session_start': {
        const { kind: _kind, ...session } = op;
        return api.startSession(client, session);
      }
      case 'session_end':
        return api.endSession(client, op.id, op.ended_at, op.end_reason);
      case 'task_patch':
        return sendTaskPatch(op.id, op.patch);
      case 'stop_patch':
        return api.patchStop(client, op.id, op.patch);
      case 'employee_patch':
        return api.patchEmployee(client, op.id, op.patch);
      case 'photo': {
        await deps.uploadFile(op.local_uri, op.storage_path);
        await api.insertPhoto(client, {
          id: op.id,
          employee_id: op.employee_id,
          kind: op.photo_kind,
          storage_path: op.storage_path,
          taken_at: op.taken_at,
          lat: op.lat,
          lng: op.lng,
          vehicle_report_id: op.vehicle_report_id,
        });
        deps.removeFile(op.local_uri);
        return;
      }
      case 'odometer_log':
        // The reading matters more than its photo: if the photo never made it, save the reading without it.
        return withoutPhotoIfNeeded(op.row.photo_id != null, () => api.insertOdometerLog(client, op.row), () =>
          api.insertOdometerLog(client, { ...op.row, photo_id: null }));
      case 'fuel_log':
        return withoutPhotoIfNeeded(op.row.receipt_photo_id != null, () => api.insertFuelLog(client, op.row), () =>
          api.insertFuelLog(client, { ...op.row, receipt_photo_id: null }));
      case 'report':
        return api.insertReport(client, op.row);
      case 'heartbeat':
        return api.sendHeartbeat(client, op.row);
    }
  }

  async function withoutPhotoIfNeeded(hasPhoto: boolean, first: () => Promise<void>, fallback: () => Promise<void>) {
    try {
      await first();
    } catch (error) {
      if (!(error instanceof ApiError) || !error.permanent || !hasPhoto) throw error;
      await fallback();
    }
  }

  async function sendTaskPatch(id: string, patch: api.TaskPatch): Promise<void> {
    try {
      await api.patchTask(client, id, patch);
    } catch (error) {
      if (!(error instanceof ApiError) || !error.permanent) throw error;
      // "Seen" on a task that has since moved to someone else: nothing to do.
      if (patch.status === undefined) return;
      // The answer to an earlier try may have been lost: if the task is already
      // where this change wanted it (or further), the change did arrive.
      const now = await api.fetchTaskStatus(client, id);
      if (now !== null && ORDER.indexOf(now) >= ORDER.indexOf(patch.status ?? '') && ORDER.includes(now)) return;
      throw error;
    }
  }

  async function sendPoints(batch: StoredPoint[], employeeId: string): Promise<void> {
    const rows = batch.map(({ seq: _seq, ...point }) => ({ ...point, employee_id: employeeId }));
    try {
      await api.insertPoints(client, rows);
    } catch (error) {
      if (!(error instanceof ApiError) || !error.permanent) throw error;
      // Most likely the sharing period itself never reached the server.
      // Register it as a finished period, then try the points once more.
      const sessions = new Map<string, { first: string; last: string }>();
      for (const p of batch) {
        const seen = sessions.get(p.session_id);
        sessions.set(p.session_id, {
          first: seen && seen.first < p.recorded_at ? seen.first : p.recorded_at,
          last: seen && seen.last > p.recorded_at ? seen.last : p.recorded_at,
        });
      }
      for (const [id, span] of sessions) {
        await api.insertClosedSession(client, { id, employee_id: employeeId, started_at: span.first, ended_at: span.last });
      }
      await api.insertPoints(client, rows);
    }
  }

  async function run(): Promise<FlushResult> {
    const result: FlushResult = { sent: 0, failed: 0, offline: false };

    for (;;) {
      const [next] = store.nextOps(1);
      if (!next) break;
      try {
        await send(next.op);
        store.removeOp(next.seq);
        result.sent += 1;
      } catch (error) {
        if (error instanceof ApiError && error.permanent) {
          store.failOp(next.seq, error.message);
          result.failed += 1;
          continue;
        }
        result.offline = true; // keep the order: stop here and try again later
        return result;
      }
    }

    for (;;) {
      const employeeId = deps.employeeId();
      const batch = employeeId ? store.nextPoints(200) : [];
      if (!employeeId || batch.length === 0) break;
      const seqs = batch.map((p) => p.seq);
      try {
        await sendPoints(batch, employeeId);
        store.removePoints(seqs);
        result.sent += batch.length;
      } catch (error) {
        if (error instanceof ApiError && error.permanent) {
          // Refused twice: these points can never be stored. Drop them rather than block everything behind them.
          store.removePoints(seqs);
          result.failed += batch.length;
          continue;
        }
        result.offline = true;
        return result;
      }
    }
    return result;
  }

  return {
    /** Sends what is waiting. Calls made while one is running share its result. */
    flush(): Promise<FlushResult> {
      running ??= run().finally(() => {
        running = null;
      });
      return running;
    },
  };
}

export type Sync = ReturnType<typeof createSync>;
