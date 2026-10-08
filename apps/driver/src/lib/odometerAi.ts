// Reading the odometer from a photo.
//
// 1. The phone's own text reader (ML Kit) looks first. If it finds text with
//    no digits at all, the photo cannot show an odometer: the app says so at
//    once, without the server.
// 2. Otherwise the photo is uploaded right away (to the same place the queue
//    puts it later) and the Edge Function read-odometer asks Gemini for the
//    total odometer only, checked against the expected range (last reading +
//    km driven since, by GPS). The server's answer is a status; only "ok"
//    carries a number, and that number is what the driver confirms.
// 3. With no connection (or the daily limit reached) the phone's own reading
//    is offered for typing, and the server checks the photo later.

import { uploadPhotoFile } from '../sync';
import { supabase } from './supabase';
import { type LocalPhoto, photoStoragePath, scanPhotoDigits } from './photos';

const AI_TIMEOUT_MS = 25_000;

export type ReadStatus =
  | 'ok'
  | 'no_odometer'
  | 'trip_meter_only'
  | 'blurry'
  | 'covered_or_dark'
  | 'not_dashboard'
  | 'unsure'
  | 'out_of_range';

export type OdometerRead =
  | {
    kind: 'read';
    status: ReadStatus;
    /** The number to confirm (ok only). */
    km: number | null;
    /** What the server read before the range check, if anything. */
    rawKm: number | null;
    confidence: number | null;
    lastKm: number | null;
    /** What the phone's own reader found, for the record (ocr_value). */
    ocrKm: number | null;
  }
  | {
    /** The server could not be reached: the phone's own reading, to be typed and checked later. */
    kind: 'offline';
    km: number | null;
    ocrKm: number | null;
  };

export interface OdometerContext {
  employeeId: string;
  vehicleId: string | null;
  /** The reading the new one follows (the vehicle's last, or the task's start reading). */
  lastKm: number | null;
  /** Km driven since that reading, by GPS. */
  gpsKm: number | null;
}

interface AiReply {
  status: ReadStatus;
  reading_km: number | null;
  raw_reading_km: number | null;
  confidence: number | null;
  last_km: number | null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function askServer(photo: LocalPhoto, ctx: OdometerContext): Promise<AiReply | null> {
  const path = photoStoragePath(photo, ctx.employeeId);
  await uploadPhotoFile(photo.uri, path);
  const { data, error } = await supabase.functions.invoke<AiReply>('read-odometer', {
    body: { path, vehicle_id: ctx.vehicleId, last_km: ctx.lastKm, gps_km: ctx.gpsKm },
  });
  if (error || !data || typeof data.status !== 'string') return null;
  return data;
}

/** What a photo shows, from the server when it can be reached. */
export async function readOdometerPhoto(photo: LocalPhoto, ctx: OdometerContext): Promise<OdometerRead> {
  const expected = ctx.lastKm !== null ? ctx.lastKm + Math.round(ctx.gpsKm ?? 0) : null;
  const scan = await scanPhotoDigits(photo.uri, expected);

  // Text was read and holds no digit at all: not an odometer. No need to ask the server.
  if (scan.text !== null && scan.text.trim() !== '' && !/\d/.test(scan.text)) {
    return { kind: 'read', status: 'no_odometer', km: null, rawKm: null, confidence: null, lastKm: ctx.lastKm, ocrKm: null };
  }

  const reply = await withTimeout(askServer(photo, ctx), AI_TIMEOUT_MS).catch(() => null);
  if (!reply) return { kind: 'offline', km: scan.candidate, ocrKm: scan.candidate };
  return {
    kind: 'read',
    status: reply.status,
    km: reply.status === 'ok' ? reply.reading_km : null,
    rawKm: reply.raw_reading_km,
    confidence: reply.confidence,
    lastKm: reply.last_km ?? ctx.lastKm,
    ocrKm: scan.candidate,
  };
}
