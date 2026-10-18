// The offline queue wired to the phone: SQLite store, photo upload from disk,
// the backoff state in the phone's small store, and a way for screens to hear
// that something changed.

import { File, UploadType } from 'expo-file-system';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import * as Network from 'expo-network';

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';
import { type AcceptAnswer, ApiError, type HeartbeatAnswer, type HeartbeatRow } from '../lib/api';
import { driverApi } from '../lib/driverApiClient';
import { getJson, KEYS, setJson } from '../lib/kv';
import { supabase } from '../lib/supabase';
import { currentTrack, setWatched } from '../lib/tracking';
import { rememberStopId, type TripAnswer } from '../lib/trips';
import type { Employee } from '../lib/types';
import { base64Decode, SupabaseTusStore } from '../lib/videoStore';
import { type BackoffState, type Connection, createSync, type FlushResult, type Op, type TripCreateOp, type TripStopOp } from './engine';
import { addHeartbeatLog, addOp, queueCounts, queueStore, replaceOp, retryRejectedHeartbeats, retryRejectedPoints } from './store';

const PHOTO_BUCKET = 'driver-photos';
/** Refused points are put back in line once a day (and after an app update, and on pull to refresh). */
export const REJECTED_RETRY_EVERY_MS = 24 * 3600_000;

/**
 * Sends a photo straight from disk (to driver-photos unless another bucket is
 * named: vehicle-photos for a vehicle's photo). A file that is already there
 * counts as sent, so the same photo can be uploaded early (for the odometer
 * reader) and again by the queue.
 */
export async function uploadPhotoFile(localUri: string, storagePath: string, bucket: string = PHOTO_BUCKET): Promise<void> {
  const file = new File(localUri);
  if (!file.exists) throw new ApiError('photo: the file is no longer on the phone', true);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError('photo: not signed in', false);

  let status: number;
  let body: string;
  try {
    const result = await file.upload(`${SUPABASE_URL}/storage/v1/object/${bucket}/${storagePath}`, {
      httpMethod: 'POST',
      uploadType: UploadType.BINARY_CONTENT,
      mimeType: 'image/jpeg',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'image/jpeg',
        'x-upsert': 'false',
      },
    });
    status = result.status;
    body = result.body;
  } catch (error) {
    throw new ApiError(`photo: ${error instanceof Error ? error.message : 'upload failed'}`, false);
  }
  if (status >= 200 && status < 300) return;
  if (status === 409 || /duplicate|already exists/i.test(body)) return;
  const refused = status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
  throw new ApiError(`photo: upload refused (${status})`, refused, undefined, status);
}

function removeFile(localUri: string): void {
  try {
    const file = new File(localUri);
    if (file.exists) file.delete();
  } catch {
    // A leftover file only costs a little space.
  }
}

/** `length` bytes of a file at `offset`, read as base64 by the legacy file API (the only one that reads at a position). */
async function readChunk(localUri: string, offset: number, length: number): Promise<Uint8Array> {
  const text = await readAsStringAsync(localUri, { encoding: EncodingType.Base64, position: offset, length });
  return base64Decode(text);
}

function fileSize(localUri: string): number | null {
  try {
    const file = new File(localUri);
    return file.exists ? file.size ?? null : null;
  } catch {
    return null;
  }
}

/** What the phone is connected through, as Android reports it. */
export async function connectionKind(): Promise<Connection> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (state.isConnected === false) return 'none';
    if (state.type === Network.NetworkStateType.WIFI || state.type === Network.NetworkStateType.ETHERNET) return 'wifi';
    if (state.type === Network.NetworkStateType.CELLULAR) return 'cellular';
    return state.isConnected ? 'unknown' : 'none';
  } catch {
    return 'unknown';
  }
}

/** The driver's "Upload videos on Wi-Fi only" switch (Me tab). */
export const wifiOnly = () => getJson<boolean>(KEYS.videoWifiOnly) === true;

type AnswerListener = (op: Op, answer: AcceptAnswer) => void;
const answerListeners = new Set<AnswerListener>();

/** Hears the server's answer to an accept or decline ('accepted', 'declined', or an 'already_*' word). */
export function onAnswer(listener: AnswerListener): () => void {
  answerListeners.add(listener);
  return () => {
    answerListeners.delete(listener);
  };
}

type HeartbeatListener = (answer: HeartbeatAnswer) => void;
const heartbeatListeners = new Set<HeartbeatListener>();

/** Hears every heartbeat answer (Phase 7: lib/duty.ts stops location when the server has the driver off duty). */
export function onHeartbeatAnswer(listener: HeartbeatListener): () => void {
  heartbeatListeners.add(listener);
  return () => {
    heartbeatListeners.delete(listener);
  };
}

type VehiclePhotoListener = (vehicleId: string, answer: 'ok' | 'has_photo') => void;
const vehiclePhotoListeners = new Set<VehiclePhotoListener>();

/** Hears when a queued vehicle photo is done: 'ok', or 'has_photo' when another photo got there first (Phase 7 §6). */
export function onVehiclePhotoAnswer(listener: VehiclePhotoListener): () => void {
  vehiclePhotoListeners.add(listener);
  return () => {
    vehiclePhotoListeners.delete(listener);
  };
}

type TripListener = (op: TripCreateOp | TripStopOp, answer: TripAnswer) => void;
const tripListeners = new Set<TripListener>();

/** Hears when a queued trip or stop reached the server (Phase 7 §13): the phone's copy takes the server's ids. */
export function onTripSent(listener: TripListener): () => void {
  tripListeners.add(listener);
  return () => {
    tripListeners.delete(listener);
  };
}

type RefusedListener = (op: Op, message: string) => void;
const refusedListeners = new Set<RefusedListener>();

/** Hears when the server refused an op for good (kept, failed): Today tells the driver about a trip. */
export function onOpRefused(listener: RefusedListener): () => void {
  refusedListeners.add(listener);
  return () => {
    refusedListeners.delete(listener);
  };
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Screens call this to hear when the queue changed (something was added or sent). */
export function onQueueChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function changed(): void {
  for (const listener of listeners) listener();
}

const sync = createSync({
  client: supabase,
  store: queueStore,
  employeeId: () => getJson<Employee>(KEYS.me)?.id ?? null,
  uploadFile: uploadPhotoFile,
  removeFile,
  onAnswer: (op, answer) => {
    for (const listener of answerListeners) listener(op, answer);
  },
  backoff: {
    load: () => getJson<BackoffState>(KEYS.backoff),
    save: (state) => setJson(KEYS.backoff, state),
  },
  video: new SupabaseTusStore(SUPABASE_URL, {
    apiKey: SUPABASE_PUBLISHABLE_KEY,
    token: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
  }),
  readChunk,
  fileSize,
  wifiOnly,
  connection: connectionKind,
  onProgress: () => changed(),
  moving: () => currentTrack().moving === true,
  onHeartbeat: (answer) => {
    setWatched(answer.watched);
    for (const listener of heartbeatListeners) listener(answer);
  },
  onVehiclePhoto: (op, answer) => {
    for (const listener of vehiclePhotoListeners) listener(op.vehicle_id, answer);
  },
  trips: driverApi,
  stopIds: {
    get: (localId) => getJson<Record<string, string>>(KEYS.tripStopIds)?.[localId] ?? null,
    set: (localId, serverId) => setJson(KEYS.tripStopIds, rememberStopId(getJson<Record<string, string>>(KEYS.tripStopIds) ?? {}, localId, serverId)),
  },
  onTrip: (op, answer) => {
    for (const listener of tripListeners) listener(op, answer);
  },
  onRefused: (op, message) => {
    for (const listener of refusedListeners) listener(op, message);
  },
});

// The phone says the network is back: the ladder starts again and what waits goes at once (no waiting for a timer).
let wasConnected: boolean | null = null;
try {
  Network.addNetworkStateListener((state) => {
    const connected = state.isConnected === true && state.isInternetReachable !== false;
    if (connected && wasConnected === false) {
      sync.resetBackoff();
      void flushNow(true);
    }
    wasConnected = connected;
  });
} catch {
  // No listener on this runtime: the timers alone.
}


/** Puts something in the queue. It is on the phone from this moment, whatever the connection. */
export function enqueue(...ops: Op[]): void {
  for (const op of ops) addOp(op);
  changed();
}

/** Puts something in the queue of which only the newest matters (the driver_latest heartbeat): older waiting ones are dropped. */
export function enqueueLatest(op: Op): void {
  replaceOp(op);
  changed();
}

/** Appends a heartbeat to the history that is uploaded in batches (also after an outage). */
export function logHeartbeat(row: HeartbeatRow): void {
  addHeartbeatLog(row);
  changed();
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Sends what is waiting, if signed in. Safe to call often: after a failed
 * connection the next attempt waits (5 s, 15 s, 30 s, then every 30 s while
 * the vehicle moves; up to 5 min while it stands) unless forced (pull to
 * refresh, the app coming to the front, the network coming back). A failed
 * attempt also books the next one itself.
 */
export async function flushNow(force = false): Promise<FlushResult> {
  setJson(KEYS.lastFlush, Date.now());
  const { data } = await supabase.auth.getSession();
  if (!data.session) return { sent: 0, failed: 0, rejected: 0, offline: true, skipped: false, deferred: 0 };
  try {
    const result = await sync.flush({ force });
    if (result.offline && !result.skipped) {
      const wait = Math.max(1000, sync.backoff().nextTryAt - Date.now());
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (queueCounts().ops + queueCounts().points + queueCounts().heartbeats > 0) void flushNow();
      }, wait);
    }
    return result;
  } finally {
    changed();
  }
}

/**
 * Puts the refused points back in line when it is time: on pull to refresh
 * (force), after an app update (a new update id), or once a day. Returns how
 * many were put back.
 */
export function maybeRetryRejected(reason: 'refresh' | 'start', updateId: string | null = null): number {
  const counts = queueCounts();
  if (counts.rejected + counts.rejectedHeartbeats === 0) return 0;
  const last = getJson<number>(KEYS.rejectedRetryAt) ?? 0;
  const lastUpdate = getJson<string>(KEYS.rejectedRetryUpdate);
  const due = reason === 'refresh' || (updateId !== null && updateId !== lastUpdate) || Date.now() - last >= REJECTED_RETRY_EVERY_MS;
  if (!due) return 0;
  setJson(KEYS.rejectedRetryAt, Date.now());
  if (updateId !== null) setJson(KEYS.rejectedRetryUpdate, updateId);
  const n = retryRejectedPoints() + retryRejectedHeartbeats();
  changed();
  return n;
}

export { opsBeforeTrip, pendingFuelLogs, pendingVehiclePhotos, queueCounts, retryVideo, videoUploads } from './store';
