// Taking photos: camera -> shrink to at most 1600 px, JPEG ~0.7 -> keep a copy
// in the app's own folder until it has been uploaded. Reading the odometer
// number from a photo is only ever a suggestion.

import TextRecognition from '@react-native-ml-kit/text-recognition';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { enqueue } from '../sync';
import { odometerFromText } from './format';
import { lastPosition } from './location';
import { colomboDate } from './time';
import type { PhotoKind } from './types';

const MAX_SIDE = 1600;

export interface LocalPhoto {
  /** Also the id of its row in the photos table. */
  id: string;
  uri: string;
  takenAt: string;
  lat: number | null;
  lng: number | null;
}

/** Opens the camera. null = the driver cancelled; 'denied' = camera not allowed. */
export async function takePhoto(): Promise<LocalPhoto | null | 'denied'> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return 'denied';

  const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  if (shot.canceled) return null;
  const asset = shot.assets[0];
  if (!asset) return null;

  const tooBig = Math.max(asset.width, asset.height) > MAX_SIDE;
  const resize = asset.width >= asset.height ? { width: MAX_SIDE } : { height: MAX_SIDE };
  const small = await manipulateAsync(asset.uri, tooBig ? [{ resize }] : [], { compress: 0.7, format: SaveFormat.JPEG });

  const id = Crypto.randomUUID();
  const folder = new Directory(Paths.document, 'photos');
  if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
  const kept = new File(folder, `${id}.jpg`);
  await new File(small.uri).move(kept);

  const position = await lastPosition();
  return { id, uri: kept.uri, takenAt: new Date().toISOString(), lat: position?.lat ?? null, lng: position?.lng ?? null };
}

/** Removes a photo the driver decided not to use. */
export function discardPhoto(photo: LocalPhoto): void {
  try {
    const file = new File(photo.uri);
    if (file.exists) file.delete();
  } catch {
    // Nothing to clean up.
  }
}

/** Puts a photo in the queue: the file is uploaded and its record saved when there is a connection. */
export function queuePhoto(photo: LocalPhoto, kind: PhotoKind, employeeId: string, vehicleReportId: string | null = null): void {
  enqueue({
    kind: 'photo',
    id: photo.id,
    employee_id: employeeId,
    photo_kind: kind,
    storage_path: `${employeeId}/${colomboDate(photo.takenAt)}/${photo.id}.jpg`,
    local_uri: photo.uri,
    taken_at: photo.takenAt,
    lat: photo.lat,
    lng: photo.lng,
    vehicle_report_id: vehicleReportId,
  });
}

/**
 * The odometer number the phone can read in a photo, or null. Runs on the
 * phone (Google ML Kit). If the reader is not available in this build, it
 * simply finds nothing and the driver types the number.
 */
export async function readOdometer(uri: string, lastKnownKm: number | null): Promise<number | null> {
  try {
    const result = await TextRecognition.recognize(uri);
    return odometerFromText(result.text, lastKnownKm);
  } catch {
    return null;
  }
}
