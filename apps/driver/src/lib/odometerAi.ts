// Reading the odometer from a photo.
//
// First choice: the Edge Function read-odometer. The photo is uploaded right
// away (to the same place the queue would put it later) and the function asks
// Gemini for the main odometer total, checked against the expected range
// (last reading + km driven since, by GPS). Second choice, when there is no
// connection or the function fails: the text reader on the phone (ML Kit),
// taking the number closest to the expected one. The driver always checks.

import { uploadPhotoFile } from '../sync';
import { supabase } from './supabase';
import { type LocalPhoto, photoStoragePath, readOdometerOnPhone } from './photos';

const AI_TIMEOUT_MS = 25_000;

export type OdometerSource = 'ai' | 'phone' | 'none';
export type OdometerRejection = 'below_last' | 'far_above' | 'unreadable';

export interface OdometerReading {
  /** The number to put in the field, or null when nothing usable was read. */
  km: number | null;
  /** 0..1 from the AI; null from the phone reader. */
  confidence: number | null;
  source: OdometerSource;
  /** Set when the AI read a number that does not fit the vehicle's last reading. */
  rejected: OdometerRejection | null;
  /** What the AI read before the range check, for the message to the driver. */
  rawKm: number | null;
}

export interface OdometerContext {
  employeeId: string;
  vehicleId: string | null;
  /** The vehicle's last known reading. */
  lastKm: number | null;
  /** Km driven since that reading, by GPS. */
  gpsKm: number | null;
}

interface AiReply {
  reading_km: number | null;
  raw_reading_km: number | null;
  confidence: number | null;
  rejected: OdometerRejection | null;
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

async function readWithAi(photo: LocalPhoto, ctx: OdometerContext): Promise<OdometerReading | null> {
  const path = photoStoragePath(photo, ctx.employeeId);
  await uploadPhotoFile(photo.uri, path);
  const { data, error } = await supabase.functions.invoke<AiReply>('read-odometer', {
    body: { path, vehicle_id: ctx.vehicleId, last_km: ctx.lastKm, gps_km: ctx.gpsKm },
  });
  if (error || !data) return null;
  return {
    km: data.reading_km,
    confidence: data.confidence,
    source: 'ai',
    rejected: data.rejected ?? null,
    rawKm: data.raw_reading_km,
  };
}

/** The odometer number in a photo: from the AI when possible, otherwise read on the phone. */
export async function readOdometerPhoto(photo: LocalPhoto, ctx: OdometerContext): Promise<OdometerReading> {
  const ai = await withTimeout(readWithAi(photo, ctx), AI_TIMEOUT_MS).catch(() => null);
  if (ai) return ai;

  const expected = ctx.lastKm !== null ? ctx.lastKm + Math.round(ctx.gpsKm ?? 0) : null;
  const km = await readOdometerOnPhone(photo.uri, expected);
  return { km, confidence: null, source: km === null ? 'none' : 'phone', rejected: null, rawKm: km };
}
