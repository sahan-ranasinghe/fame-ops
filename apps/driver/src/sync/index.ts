// The offline queue wired to the phone: SQLite store, photo upload from disk,
// and a way for screens to hear that something changed.

import { File, UploadType } from 'expo-file-system';

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';
import { ApiError } from '../lib/api';
import { getJson, KEYS, setJson } from '../lib/kv';
import { supabase } from '../lib/supabase';
import type { Employee } from '../lib/types';
import { createSync, type FlushResult, type Op } from './engine';
import { addOp, queueStore, replaceOp } from './store';

const PHOTO_BUCKET = 'driver-photos';

/**
 * Sends a photo straight from disk. A file that is already there counts as
 * sent, so the same photo can be uploaded early (for the odometer reader) and
 * again by the queue.
 */
export async function uploadPhotoFile(localUri: string, storagePath: string): Promise<void> {
  const file = new File(localUri);
  if (!file.exists) throw new ApiError('photo: the file is no longer on the phone', true);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError('photo: not signed in', false);

  let status: number;
  let body: string;
  try {
    const result = await file.upload(`${SUPABASE_URL}/storage/v1/object/${PHOTO_BUCKET}/${storagePath}`, {
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
  throw new ApiError(`photo: upload refused (${status})`, refused);
}

function removeFile(localUri: string): void {
  try {
    const file = new File(localUri);
    if (file.exists) file.delete();
  } catch {
    // A leftover file only costs a little space.
  }
}

const sync = createSync({
  client: supabase,
  store: queueStore,
  employeeId: () => getJson<Employee>(KEYS.me)?.id ?? null,
  uploadFile: uploadPhotoFile,
  removeFile,
});

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

/** Puts something in the queue. It is on the phone from this moment, whatever the connection. */
export function enqueue(...ops: Op[]): void {
  for (const op of ops) addOp(op);
  changed();
}

/** Puts something in the queue of which only the newest matters (a heartbeat): older waiting ones are dropped. */
export function enqueueLatest(op: Op): void {
  replaceOp(op);
  changed();
}

/** Sends what is waiting, if signed in. Safe to call often. */
export async function flushNow(): Promise<FlushResult> {
  setJson(KEYS.lastFlush, Date.now());
  const { data } = await supabase.auth.getSession();
  if (!data.session) return { sent: 0, failed: 0, offline: true };
  try {
    return await sync.flush();
  } finally {
    changed();
  }
}
