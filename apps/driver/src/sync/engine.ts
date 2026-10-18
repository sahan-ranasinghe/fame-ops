// The offline queue. Everything the driver does that must reach the office is
// first written to the phone (the store) and then sent from here, in order,
// whenever there is a connection. Nothing here is phone-specific: the store,
// the file upload and the clock are passed in, so the tests run this very code.
//
//   ops         start/stop sharing, task and stop changes, photos, odometer and
//               fuel logs, vehicle reports, the driver_latest heartbeat, a
//               vehicle's first photo (Phase 7 §6), a trip the driver started
//               or a stop added to it with no connection (Phase 7 §13: sent to
//               driver-api before the Start task that follows it), and the
//               fuel videos (one resumable upload each, sent a chunk at a time
//               with the offset kept after every chunk). Sent strictly in the
//               order they happened; a video waiting for Wi-Fi is stepped over
//               so it never blocks the rest. Hotfix 2 (J): the vehicle the
//               driver confirmed for a task made without one (task_vehicle),
//               put in the queue before that task's start, so the server has
//               the vehicle when the start arrives (it refuses a start
//               without one).
//   points      location points. Sent in batches of up to 500, oldest first,
//               once no op is waiting, so the sharing period they belong to is
//               already on the server. A batch that gets no answer is sent
//               again later (the server ignores a point it already has). A
//               batch the server refuses for good is kept, marked rejected with
//               the answer, and tried again later; it never blocks the rest.
//   heartbeats  the heartbeat history, in batches of up to 500 after the points.
//               A batch the server refuses for good is kept and marked rejected
//               like points (tried again later), never dropped.
//
// After a failed connection the next attempt waits. While the vehicle moves:
// 5 s, 15 s, 30 s, then every 30 s (BACKOFF_MOVING_MS). While it stands (or
// nothing is recorded): 5 s, 15 s, 30 s, 1 min, 2 min, then every 5 min
// (BACKOFF_PARKED_MS). A forced flush (the driver pulled to refresh, the app
// came to the front) ignores the wait; when the phone reports the network is
// back, sync/index.ts resets the ladder and flushes at once. A success starts
// the ladder again from the bottom. A batch that fails is the first one sent
// next time: what went before it is already off the phone.

import * as realApi from '../lib/api';
import { ApiError, type Client } from '../lib/api';
import type { Json } from '../lib/database.types';
import type { TripsApi } from '../lib/driverApi';
import { vehiclePhotoDone } from '../lib/photoRules';
import type { TripAnswer, TripCreateOp, TripStopOp } from '../lib/trips';
import type { Language, PhotoKind } from '../lib/types';
import { CHUNK_BYTES, type VideoStore } from '../lib/videoStore';

export type Op =
  | { kind: 'session_start'; id: string; employee_id: string; vehicle_id: string | null; started_at: string; device_info: Json }
  | { kind: 'session_end'; id: string; ended_at: string; end_reason: 'driver' | 'auto' }
  | { kind: 'task_patch'; id: string; patch: realApi.TaskPatch }
  /** Accept / decline go through RPCs that answer a word; an 'already_*' answer is done, not an error. */
  | { kind: 'task_accept'; id: string; at: string }
  | { kind: 'task_decline'; id: string; reason: realApi.DeclineReason; note: string | null; at: string }
  /**
   * Hotfix 2 (J): the vehicle confirmed for a task made without one (confirm_task_vehicle), when Start task found no
   * connection; id = the task. 'ok' (or 'started': the task is under way) is done; any other answer is a refusal, kept.
   */
  | { kind: 'task_vehicle'; id: string; vehicle_id: string; at: string }
  | { kind: 'stop_patch'; id: string; patch: realApi.StopPatch }
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
  | { kind: 'odometer_log'; row: realApi.OdometerInsert }
  | { kind: 'fuel_log'; row: realApi.FuelInsert }
  | { kind: 'report'; row: realApi.ReportInsert }
  | { kind: 'employee_patch'; id: string; patch: { current_vehicle_id?: string | null; language?: Language } }
  /** Phase 7: Change vehicle (null = no vehicle) at the phone's time; id = the phone's id, so a resend changes nothing. */
  | { kind: 'vehicle_change'; id: string; vehicle_id: string | null; at: string }
  /** Only the newest one matters for driver_latest: the store keeps one waiting heartbeat at a time (replaceOp). */
  | { kind: 'heartbeat'; row: realApi.HeartbeatRow }
  /** Phase 7 §6: a vehicle's first photo from this phone, both files to vehicle-photos, then the RPC. */
  | VehiclePhotoOp
  /** A fuel video: the file on the phone, its place in the bucket, and how far the upload got (url + offset, kept after every chunk). */
  | VideoUploadOp
  /** Phase 7 §13: a trip started with no connection (POST /trips, idempotent by its id); the Start task follows it in the queue. */
  | TripCreateOp
  /** Phase 7 §13: a stop added on the way with no connection (POST /trips/:id/stops, idempotent by the stop's id). */
  | TripStopOp;

export type { TripCreateOp, TripStopOp };

export interface VideoUploadOp {
  kind: 'video_upload';
  fuel_log_id: string;
  bucket: string;
  path: string;
  local_uri: string;
  bytes: number;
  /** The upload URL once created; null = not started (or expired: a new one is made). */
  url: string | null;
  /** Bytes the server had after the last chunk. */
  offset: number;
  content_type: string;
  /** Which piece of the fill this is (1-based) and how many there are; the row is marked uploaded after the last. */
  segment?: number;
  segments?: number;
}

/**
 * A vehicle photo taken in the picker: the photo (1600 px) and its thumbnail (256 px) wait on the phone, go up to
 * vehicle-photos at `path` and `thumb_path`, then set_vehicle_photo_from_driver. Someone else's photo got there
 * first ('has_photo', or the bucket refusing the files because the vehicle has a photo by then): done, not an error.
 */
export interface VehiclePhotoOp {
  kind: 'vehicle_photo';
  id: string;
  vehicle_id: string;
  path: string;
  thumb_path: string;
  local_uri: string;
  thumb_uri: string;
  taken_at: string;
}

export type Connection = 'wifi' | 'cellular' | 'none' | 'unknown';

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

export interface StoredHeartbeat {
  seq: number;
  row: realApi.HeartbeatRow;
}

/** Where the queue lives. SQLite on the phone (sync/store.ts), memory in tests. */
export interface QueueStore {
  /** Waiting ops, oldest first. Failed ones are not returned. */
  nextOps(limit: number): StoredOp[];
  removeOp(seq: number): void;
  /** Replaces an op in place (a video upload keeps its URL and offset after every chunk). */
  updateOp(seq: number, op: Op): void;
  /** The server refused it for good. It is kept for the driver to see and not tried again. */
  failOp(seq: number, error: string): void;
  /** Waiting points, oldest first. Rejected ones are not returned until they are put back in line. */
  nextPoints(limit: number): StoredPoint[];
  removePoints(seqs: number[]): void;
  /** The server refused these for good: kept, marked, tried again later. */
  rejectPoints(seqs: number[], status: number | undefined, error: string): void;
  /** Waiting history rows, oldest first. Rejected ones are not returned until they are put back in line. */
  nextHeartbeats(limit: number): StoredHeartbeat[];
  removeHeartbeats(seqs: number[]): void;
  /** The server refused these for good: kept, marked, tried again later (never dropped: the office's "app not running" depends on them). */
  rejectHeartbeats(seqs: number[], status: number | undefined, error: string): void;
}

export interface BackoffState {
  /** Failed attempts in a row. */
  failures: number;
  /** No attempt before this time (ms), unless forced. */
  nextTryAt: number;
}

export interface SyncDeps {
  client: Client;
  store: QueueStore;
  employeeId: () => string | null;
  /** Sends a photo file to storage (driver-photos unless a bucket is named). "Already there" counts as success. Throws ApiError. */
  uploadFile: (localUri: string, storagePath: string, bucket?: string) => Promise<void>;
  /** Frees the phone's copy once the photo is safely uploaded. */
  removeFile: (localUri: string) => void;
  /** Hears the server's answer to an accept or decline (the screen tells the driver about an 'already_*' one). */
  onAnswer?: (op: Op, answer: realApi.AcceptAnswer) => void;
  /** The server calls (the real module unless a test passes its own). */
  api?: typeof realApi;
  /** The clock (ms). */
  now?: () => number;
  /** Where the backoff state lives between runs (memory when not given). */
  backoff?: { load(): BackoffState | null; save(state: BackoffState): void };
  /** Where the fuel videos go (sync/index.ts: Supabase's resumable upload). Without it video ops wait. */
  video?: VideoStore;
  /** Reads `length` bytes of the file at `offset` (the phone reads the file at a position; tests hand over memory). */
  readChunk?: (localUri: string, offset: number, length: number) => Promise<Uint8Array>;
  /** The file's size now, or null when it is gone from the phone. */
  fileSize?: (localUri: string) => number | null;
  /** The driver's "Upload videos on Wi-Fi only" switch. */
  wifiOnly?: () => boolean;
  /** What the phone is connected through right now. */
  connection?: () => Promise<Connection>;
  /** A chunk went up: the screens show the new offset. */
  onProgress?: (op: VideoUploadOp) => void;
  /** Whether the vehicle is moving right now (the recording rules' last word): picks the retry ladder. */
  moving?: () => boolean;
  /** The server answered a heartbeat: whether the office is watching this driver (watched mode). */
  onHeartbeat?: (answer: realApi.HeartbeatAnswer) => void;
  /** A vehicle photo is done: 'ok' (it is the vehicle's photo now) or 'has_photo' (another one was there first). */
  onVehiclePhoto?: (op: VehiclePhotoOp, answer: 'ok' | 'has_photo') => void;
  /** driver-api's trips (Phase 7 §13). Without it trip ops wait. */
  trips?: TripsApi;
  /**
   * The first stop of a trip made from the queue: the server names it, the phone's copy had its own id. Kept here so
   * a stop change queued with the phone's id (Arrived, Done, Skip) goes to the server's stop. Memory when not given.
   */
  stopIds?: { get(localId: string): string | null; set(localId: string, serverId: string): void };
  /** A trip or its stop reached the server: its answer (the phone's copy takes the server's ids). */
  onTrip?: (op: TripCreateOp | TripStopOp, answer: TripAnswer) => void;
  /** The server refused an op for good (it is kept, failed): the screens tell the driver about a trip. */
  onRefused?: (op: Op, message: string) => void;
}

export interface FlushResult {
  sent: number;
  failed: number;
  /** Points the server refused in this run (kept on the phone). */
  rejected: number;
  /** true when sending stopped because there was no usable connection. */
  offline: boolean;
  /** true when nothing was tried because the backoff wait is not over. */
  skipped: boolean;
  /** Videos stepped over because they wait for Wi-Fi. */
  deferred: number;
}

export const POINT_BATCH = 500;
export const HEARTBEAT_BATCH = 500;
/** The wait after 1, 2, 3 … failed attempts in a row while the vehicle moves; the last one repeats (never more than 30 s). */
export const BACKOFF_MOVING_MS = [5_000, 15_000, 30_000];
/** … while it stands still, or nothing is being recorded: up to 5 minutes. */
export const BACKOFF_PARKED_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];
/** The old name: the parked ladder. */
export const BACKOFF_MS = BACKOFF_PARKED_MS;

const ORDER = ['assigned', 'in_progress', 'completed'];

export function createSync(deps: SyncDeps) {
  const { client, store } = deps;
  const api = deps.api ?? realApi;
  const now = deps.now ?? (() => Date.now());
  let memory: BackoffState = { failures: 0, nextTryAt: 0 };
  const backoff = {
    get: (): BackoffState => deps.backoff?.load() ?? memory,
    set: (state: BackoffState) => {
      memory = state;
      deps.backoff?.save(state);
    },
  };
  let running: Promise<FlushResult> | null = null;
  const stopMemory = new Map<string, string>();
  const stopIds = deps.stopIds ?? {
    get: (id: string) => stopMemory.get(id) ?? null,
    set: (localId: string, serverId: string) => void stopMemory.set(localId, serverId),
  };

  /**
   * A trip or a stop from the queue. The same id again is harmless (the server answers what it made). Our place
   * refused (removed while the trip waited on the phone): once more with its pin or its words, so the trip is not lost.
   */
  async function sendTrip(op: TripCreateOp | TripStopOp): Promise<void> {
    const trips = deps.trips;
    if (!trips) throw new ApiError('trip: no driver-api client', false);
    // queued: the trip has happened already and its records follow it here, so the server notes its start-time rules
    // (personal trips off, a task under way, the vehicle) instead of refusing it and failing everything behind it.
    const call = (destination: TripCreateOp['request']['destination']) =>
      op.kind === 'trip_create'
        ? trips.createTrip({ ...op.request, destination, queued: true })
        : trips.addTripStop(op.task_id, { id: op.id, destination, queued: true });
    const first = op.kind === 'trip_create' ? op.request.destination : op.destination;
    let answer: TripAnswer;
    try {
      answer = await call(first);
    } catch (error) {
      if (!(error instanceof ApiError) || !error.permanent || error.code !== 'refused' || !op.fallback) throw error;
      answer = await call(op.fallback);
    }
    if (op.kind === 'trip_create') {
      const server = answer.trip.stops[0]?.stop_id;
      if (server && server !== op.local_stop_id) stopIds.set(op.local_stop_id, server);
    }
    deps.onTrip?.(op, answer);
  }

  /**
   * One video, chunk by chunk, keeping the server's offset in the op after
   * each chunk. A lost connection throws (the ladder); an expired upload URL
   * starts again from 0; a file gone from the phone marks the row failed.
   */
  async function sendVideo(seq: number, op: VideoUploadOp): Promise<void> {
    if (!deps.video || !deps.readChunk) throw new ApiError('video: no upload store', false);
    const size = deps.fileSize ? deps.fileSize(op.local_uri) : op.bytes;
    if (size === null) {
      await api.patchFuelVideo(client, op.fuel_log_id, { video_status: 'failed' }).catch(() => undefined);
      throw new ApiError('video: the file is no longer on the phone', true, 'gone');
    }
    let current: VideoUploadOp = size !== op.bytes ? { ...op, bytes: size } : op;
    // Where the server is: the stored offset is a hint, the server's answer is the truth.
    if (current.url) {
      try {
        const offset = await deps.video.offset(current.url);
        current = { ...current, offset };
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'gone') throw error;
        current = { ...current, url: null, offset: 0 };
      }
    }
    if (!current.url) {
      let url: string;
      try {
        ({ url } = await deps.video.createUpload({ bucket: current.bucket, path: current.path, contentType: current.content_type, bytes: current.bytes }));
      } catch (error) {
        // The file is already in the bucket (an earlier run finished, its answer was lost): that counts as uploaded, as with photos.
        if (!(error instanceof ApiError) || error.code !== 'exists') throw error;
        await finishSegment(op, current.bytes);
        deps.removeFile(op.local_uri);
        return;
      }
      current = { ...current, url, offset: 0 };
      store.updateOp(seq, current);
      // The first piece says the fill is uploading; a later piece leaves the row alone (it may say failed by then).
      if (!op.segment || op.segment === 1) await api.patchFuelVideo(client, op.fuel_log_id, { video_status: 'uploading' }).catch(() => undefined);
    }
    while (current.offset < current.bytes) {
      const length = Math.min(CHUNK_BYTES, current.bytes - current.offset);
      const bytes = await deps.readChunk(current.local_uri, current.offset, length);
      let next: number;
      try {
        next = await deps.video.sendChunk(current.url!, current.offset, bytes);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'gone') {
          // The upload expired between chunks: start again next time.
          store.updateOp(seq, { ...current, url: null, offset: 0 });
        }
        if (error instanceof ApiError && error.code === 'offset') {
          // The server is elsewhere: ask it and go on from there next time.
          store.updateOp(seq, { ...current, offset: await deps.video.offset(current.url!) });
          throw new ApiError('video: offset corrected, continuing', false);
        }
        throw error;
      }
      current = { ...current, offset: next };
      store.updateOp(seq, current);
      deps.onProgress?.(current);
    }
    await finishSegment(op, current.bytes);
    deps.removeFile(op.local_uri);
  }

  /**
   * After a piece: the row is marked uploaded after the last piece of the fill
   * (the pieces go up in order), unless an earlier piece failed for good, in
   * which case the row stays failed and the office sees that.
   */
  async function finishSegment(op: VideoUploadOp, bytes: number): Promise<void> {
    const last = !op.segments || (op.segment ?? 1) >= op.segments;
    if (!last) return;
    if (op.segments && op.segments > 1) {
      const status = await api.fetchFuelVideoStatus(client, op.fuel_log_id).catch(() => null);
      if (status === 'failed') return;
    }
    const patch: realApi.FuelVideoPatch = { video_status: 'uploaded', video_uploaded_at: new Date(now()).toISOString() };
    if (!op.segments || op.segments === 1) patch.video_bytes = bytes;
    await api.patchFuelVideo(client, op.fuel_log_id, patch);
  }

  /**
   * A vehicle photo: both files, then the RPC. The bucket takes a driver's file only while the vehicle has no photo,
   * so a refused file is looked into: a photo there by now (someone else's, or this one after a lost answer), or a
   * vehicle that is gone, means there is nothing left to do.
   */
  async function sendVehiclePhoto(op: VehiclePhotoOp): Promise<void> {
    const done = (answer: 'ok' | 'has_photo') => {
      deps.removeFile(op.local_uri);
      deps.removeFile(op.thumb_uri);
      deps.onVehiclePhoto?.(op, answer);
    };
    try {
      await deps.uploadFile(op.local_uri, op.path, realApi.BUCKETS.vehiclePhotos);
      await deps.uploadFile(op.thumb_uri, op.thumb_path, realApi.BUCKETS.vehiclePhotos);
    } catch (error) {
      if (!(error instanceof ApiError) || !error.permanent) throw error;
      const now = await api.fetchVehiclePhoto(client, op.vehicle_id);
      if (!now.active || now.path !== null) return done(now.path === op.path ? 'ok' : 'has_photo');
      throw error;
    }
    const answer = await api.setVehiclePhotoFromDriver(client, op.vehicle_id, op.path, op.thumb_path);
    if (!vehiclePhotoDone(answer)) throw new ApiError(`vehicle photo: ${answer}`, true, answer);
    done(answer as 'ok' | 'has_photo');
  }

  async function send(op: Op, seq: number): Promise<void> {
    switch (op.kind) {
      case 'session_start': {
        const { kind: _kind, ...session } = op;
        return api.startSession(client, session);
      }
      case 'session_end':
        return api.endSession(client, op.id, op.ended_at, op.end_reason);
      case 'task_patch':
        return sendTaskPatch(op.id, op.patch);
      case 'task_accept': {
        const answer = await api.acceptTask(client, op.id, op.at);
        deps.onAnswer?.(op, answer);
        return;
      }
      case 'task_decline': {
        const answer = await api.declineTask(client, op.id, op.reason, op.note, op.at);
        deps.onAnswer?.(op, answer);
        return;
      }
      case 'task_vehicle': {
        const answer = await api.confirmTaskVehicle(client, op.id, op.vehicle_id);
        if (answer === 'ok' || answer === 'started') return;
        throw new ApiError(`task vehicle: ${answer || 'no answer'}`, true, answer);
      }
      case 'stop_patch':
        // A trip's first stop made from the queue has the server's id now (sendTrip).
        return api.patchStop(client, stopIds.get(op.id) ?? op.id, op.patch);
      case 'employee_patch':
        return api.patchEmployee(client, op.id, op.patch);
      case 'vehicle_change':
        await api.changeVehicle(client, op.vehicle_id, op.at, op.id);
        return;
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
      case 'heartbeat': {
        const answer = await api.sendHeartbeat(client, op.row);
        deps.onHeartbeat?.({ watched: answer?.watched === true, on_duty: answer?.on_duty ?? null, duty_end: answer?.duty_end ?? null });
        return;
      }
      case 'video_upload':
        return sendVideo(seq, op);
      case 'vehicle_photo':
        return sendVehiclePhoto(op);
      case 'trip_create':
      case 'trip_stop':
        return sendTrip(op);
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

  async function sendTaskPatch(id: string, patch: realApi.TaskPatch): Promise<void> {
    try {
      await api.patchTask(client, id, patch);
    } catch (error) {
      if (!(error instanceof ApiError) || !error.permanent) throw error;
      // "Seen" on a task that has since moved to someone else: nothing to do.
      if (patch.status === undefined) return;
      // The answer to an earlier try may have been lost: if the task is already
      // where this change wanted it (or further), the change did arrive.
      const current = await api.fetchTaskStatus(client, id);
      if (current !== null && ORDER.indexOf(current) >= ORDER.indexOf(patch.status ?? '') && ORDER.includes(current)) return;
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
    const result: FlushResult = { sent: 0, failed: 0, rejected: 0, offline: false, skipped: false, deferred: 0 };
    const failedConnection = () => {
      const state = backoff.get();
      const failures = state.failures + 1;
      const ladder = deps.moving?.() ? BACKOFF_MOVING_MS : BACKOFF_PARKED_MS;
      backoff.set({ failures, nextTryAt: now() + ladder[Math.min(failures, ladder.length) - 1] });
      result.offline = true;
      return result;
    };

    // A video that must wait for Wi-Fi is stepped over, so the rest of the queue goes on.
    const deferred = new Set<number>();
    const waitForWifi = async (op: Op) => {
      if (op.kind !== 'video_upload' || !deps.wifiOnly?.()) return false;
      const kind = deps.connection ? await deps.connection() : 'unknown';
      return kind !== 'wifi';
    };
    for (;;) {
      const next = store.nextOps(50).find((item) => !deferred.has(item.seq));
      if (!next) break;
      if (await waitForWifi(next.op)) {
        deferred.add(next.seq);
        result.deferred += 1;
        continue;
      }
      try {
        await send(next.op, next.seq);
        store.removeOp(next.seq);
        result.sent += 1;
      } catch (error) {
        if (error instanceof ApiError && error.permanent) {
          store.failOp(next.seq, error.message);
          if (next.op.kind === 'video_upload') await api.patchFuelVideo(client, next.op.fuel_log_id, { video_status: 'failed' }).catch(() => undefined);
          deps.onRefused?.(next.op, error.message);
          result.failed += 1;
          continue;
        }
        return failedConnection(); // keep the order: stop here and try again later
      }
    }

    for (;;) {
      const employeeId = deps.employeeId();
      const batch = employeeId ? store.nextPoints(POINT_BATCH) : [];
      if (!employeeId || batch.length === 0) break;
      const seqs = batch.map((p) => p.seq);
      try {
        await sendPoints(batch, employeeId);
        store.removePoints(seqs);
        result.sent += batch.length;
      } catch (error) {
        if (error instanceof ApiError && error.permanent) {
          // Refused twice: kept on the phone with the answer, tried again later; the rest goes on.
          store.rejectPoints(seqs, error.status, error.message);
          result.rejected += batch.length;
          continue;
        }
        return failedConnection();
      }
    }

    for (;;) {
      const employeeId = deps.employeeId();
      const batch = employeeId ? store.nextHeartbeats(HEARTBEAT_BATCH) : [];
      if (!employeeId || batch.length === 0) break;
      const seqs = batch.map((h) => h.seq);
      try {
        await api.insertHeartbeats(client, employeeId, batch.map((h) => h.row));
        store.removeHeartbeats(seqs);
        result.sent += batch.length;
      } catch (error) {
        if (error instanceof ApiError && error.permanent) {
          // Refused for good (a column the server does not take yet, a rule): kept and marked, tried again later; the rest goes on.
          store.rejectHeartbeats(seqs, error.status, error.message);
          result.failed += batch.length;
          continue;
        }
        return failedConnection();
      }
    }

    backoff.set({ failures: 0, nextTryAt: 0 });
    return result;
  }

  return {
    /**
     * Sends what is waiting. Calls made while one is running share its result. Not forced, it does nothing
     * while the backoff wait after a failed connection is not over.
     */
    flush(opts: { force?: boolean } = {}): Promise<FlushResult> {
      if (running) return running;
      if (!opts.force && now() < backoff.get().nextTryAt) {
        return Promise.resolve({ sent: 0, failed: 0, rejected: 0, offline: true, skipped: true, deferred: 0 });
      }
      running = run().finally(() => {
        running = null;
      });
      return running;
    },
    /** The backoff state (for the screens and the tests). */
    backoff: () => backoff.get(),
    /** The network is back (the phone said so): the ladder starts again from the bottom. */
    resetBackoff: () => backoff.set({ failures: 0, nextTryAt: 0 }),
  };
}

export type Sync = ReturnType<typeof createSync>;
