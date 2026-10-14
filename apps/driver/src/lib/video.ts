// Fuel videos on the phone (Phase 6, Part 3): a recording made by the camera
// screen is kept in the app's own folder until the queue has uploaded it,
// then deleted. The recording screen hands its result back through a small
// in-memory holder (the fuel form reads it when it is focused again).

import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import { enqueue } from '../sync';
import { colomboDate } from './time';

export const VIDEO_BUCKET = 'fuel-videos';
export const VIDEO_CONTENT_TYPE = 'video/mp4';
/** The longest a fill's video can be (seconds). */
export const MAX_VIDEO_SECONDS = 90;

export interface RecordedVideo {
  /** Also the name of the file and, once saved, the fuel log it belongs to. */
  id: string;
  uri: string;
  durationS: number;
  bytes: number;
  recordedAt: string;
  /** The checklist items the driver ticked while recording. */
  checklist: string[];
}

function videosFolder(): Directory {
  const folder = new Directory(Paths.document, 'videos');
  if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
  return folder;
}

/** Moves a recording the camera made into the app's folder, named by its id. */
export function keepRecording(tempUri: string, durationS: number, checklist: string[]): RecordedVideo {
  const id = Crypto.randomUUID();
  const kept = new File(videosFolder(), `${id}.mp4`);
  const temp = new File(tempUri);
  temp.move(kept);
  return { id, uri: kept.uri, durationS: Math.round(durationS), bytes: kept.size ?? 0, recordedAt: new Date().toISOString(), checklist };
}

/** Removes a recording the driver decided not to use. */
export function discardVideo(video: RecordedVideo | null): void {
  if (!video) return;
  try {
    const file = new File(video.uri);
    if (file.exists) file.delete();
  } catch {
    // Nothing to clean up.
  }
}

/** Where the video lives in the private bucket: <employee>/<day>/<fuel log id>.mp4. */
export function videoStoragePath(employeeId: string, fuelLogId: string, recordedAt: string): string {
  return `${employeeId}/${colomboDate(recordedAt)}/${fuelLogId}.mp4`;
}

/** Puts the upload in the queue, after the fuel log row it belongs to. */
export function queueVideoUpload(video: RecordedVideo, fuelLogId: string, employeeId: string): string {
  const path = videoStoragePath(employeeId, fuelLogId, video.recordedAt);
  enqueue({
    kind: 'video_upload',
    fuel_log_id: fuelLogId,
    bucket: VIDEO_BUCKET,
    path,
    local_uri: video.uri,
    bytes: video.bytes,
    url: null,
    offset: 0,
    content_type: VIDEO_CONTENT_TYPE,
  });
  return path;
}

// --- the recording screen's answer -------------------------------------------
let pending: RecordedVideo | null = null;

/** The recording screen leaves its result here for the form that opened it. */
export function setPendingVideo(video: RecordedVideo): void {
  pending = video;
}

/** The form takes the recording (once). */
export function takePendingVideo(): RecordedVideo | null {
  const video = pending;
  pending = null;
  return video;
}

/** "0:47" */
export function clockOf(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "16 MB" (one decimal under 10 MB). */
export function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Upload progress as a whole percentage. */
export function percentOf(offset: number, bytes: number): number {
  return bytes > 0 ? Math.min(100, Math.floor((offset / bytes) * 100)) : 0;
}
