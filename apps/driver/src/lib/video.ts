// Fuel videos on the phone (Phase 6, Part 3 and 3b): a recording covers the
// whole fill, from the first frame to the pump stopping, with the office's
// steps ticked in order (the second of each tick is kept: the office's
// bookmarks). A recording the phone interrupted (a call, the app sent to the
// back, the camera taken away) is kept as a piece; the driver may continue in
// another piece, up to three; the pieces go up as one fill marked interrupted.
// Each piece lives in the app's own folder until the queue has uploaded it,
// then it is deleted. The recording screen hands its result back through a
// small in-memory holder.

import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import { enqueue } from '../sync';
import { colomboDate } from './time';

export const VIDEO_BUCKET = 'fuel-videos';
export const VIDEO_CONTENT_TYPE = 'video/mp4';
/** The longest one piece can be (seconds): a whole fill, with the countdown in the last 30 s. */
export const MAX_VIDEO_SECONDS = 12 * 60;
/** The countdown shows when this much is left. */
export const COUNTDOWN_SECONDS = 30;
/** A fill shorter than this is not a recording (Stop opens at 30 s, after the last step). */
export const MIN_VIDEO_SECONDS = 30;
/** A piece shorter than this is nothing (the camera stopped at once): not kept. */
export const MIN_PIECE_SECONDS = 1;
/** An interrupted fill may be continued this many times in all. */
export const MAX_SEGMENTS = 3;

export type VideoQuality = '480p' | '720p';
/** About 1.0 Mbps at 480p (a 5-minute fill is about 38 MB), about 1.5 Mbps at 720p. */
export const VIDEO_BITRATE: Record<VideoQuality, number> = { '480p': 1_000_000, '720p': 1_500_000 };

export interface VideoSegment {
  /** The file on the phone. */
  uri: string;
  durationS: number;
  bytes: number;
}

/** One step ticked while recording, at this second of the fill (across the pieces). A type, not an interface: it is stored as Json. */
export type VideoMark = {
  key: string;
  at_s: number;
};

export interface RecordedVideo {
  /** Also the id of the fuel log it belongs to, once saved. */
  id: string;
  /** The pieces in order (one for an uninterrupted recording). */
  segments: VideoSegment[];
  /** The whole fill. */
  durationS: number;
  bytes: number;
  recordedAt: string;
  /** The recording was interrupted and continued (more than one piece). */
  interrupted: boolean;
  /** The steps the driver ticked while recording, in order, with the second of each. */
  marks: VideoMark[];
}

function videosFolder(): Directory {
  const folder = new Directory(Paths.document, 'videos');
  if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
  return folder;
}

/** Moves a piece the camera made into the app's folder. */
export function keepSegment(tempUri: string, durationS: number): VideoSegment {
  const kept = new File(videosFolder(), `${Crypto.randomUUID()}.mp4`);
  new File(tempUri).move(kept);
  return { uri: kept.uri, durationS: Math.round(durationS), bytes: kept.size ?? 0 };
}

/** The pieces as one recording. */
export function assembleVideo(segments: VideoSegment[], marks: VideoMark[]): RecordedVideo {
  return {
    id: Crypto.randomUUID(),
    segments,
    durationS: segments.reduce((sum, s) => sum + s.durationS, 0),
    bytes: segments.reduce((sum, s) => sum + s.bytes, 0),
    recordedAt: new Date().toISOString(),
    interrupted: segments.length > 1,
    marks,
  };
}

/** Removes a recording the driver decided not to use. */
export function discardVideo(video: RecordedVideo | null): void {
  if (!video) return;
  for (const segment of video.segments) discardSegment(segment);
}

export function discardSegment(segment: VideoSegment | { uri: string }): void {
  try {
    const file = new File(segment.uri);
    if (file.exists) file.delete();
  } catch {
    // Nothing to clean up.
  }
}

/** Where a piece lives in the private bucket: <employee>/<day>/<fuel log id>.mp4, then -2.mp4, -3.mp4. */
export function videoStoragePath(employeeId: string, fuelLogId: string, recordedAt: string, segment = 1): string {
  return `${employeeId}/${colomboDate(recordedAt)}/${fuelLogId}${segment > 1 ? `-${segment}` : ''}.mp4`;
}

/** The pieces as the fuel log row stores them (paths in the bucket, lengths, sizes). */
export function videoSegmentRows(video: RecordedVideo, fuelLogId: string, employeeId: string): { path: string; duration_s: number; bytes: number }[] {
  return video.segments.map((s, i) => ({ path: videoStoragePath(employeeId, fuelLogId, video.recordedAt, i + 1), duration_s: s.durationS, bytes: s.bytes }));
}

/** Puts the uploads in the queue, one per piece, after the fuel log row they belong to. */
export function queueVideoUpload(video: RecordedVideo, fuelLogId: string, employeeId: string): string[] {
  const paths = videoSegmentRows(video, fuelLogId, employeeId).map((r) => r.path);
  video.segments.forEach((segment, i) => {
    enqueue({
      kind: 'video_upload',
      fuel_log_id: fuelLogId,
      bucket: VIDEO_BUCKET,
      path: paths[i],
      local_uri: segment.uri,
      bytes: segment.bytes,
      url: null,
      offset: 0,
      content_type: VIDEO_CONTENT_TYPE,
      segment: i + 1,
      segments: video.segments.length,
    });
  });
  return paths;
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

/** "0:47", "5:12", "12:00" */
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
