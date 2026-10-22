// Taking photos: always the camera (never the gallery) -> shrink to at most
// 1600 px, JPEG ~0.7 -> keep a copy in the app's own folder until it has been
// uploaded. The odometer number comes from the server (lib/odometerAi.ts);
// the phone's own reader here is only the pre-check and the offline fallback.
// Phase 7 Part 3: the driver's own photo may also come from the gallery
// (cropped square, 512 × 512), and a vehicle's first photo is made in two
// sizes (1600 and 256 px) for the vehicle-photos bucket.

import TextRecognition from '@react-native-ml-kit/text-recognition';
import { Asset } from 'expo-asset';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { type Action, manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { enqueue } from '../sync';
import type { VehiclePhotoOp } from '../sync/engine';
import { odometerFromText } from './format';
import { fileExists } from './localFile';
import { lastPosition } from './location';
import {
  fitWithin,
  type PhotoLinks,
  photoOp,
  photoStoragePath,
  PROFILE_QUALITY,
  PROFILE_SIDE,
  squareCrop,
  VEHICLE_PHOTO_SIDE,
  VEHICLE_THUMB_SIDE,
  vehiclePhotoPaths,
} from './photoRules';
import type { PhotoKind } from './types';

export { photoStoragePath };

const MAX_SIDE = 1600;

/** The app's own folder for photos that wait to be uploaded. */
function photoFolder(name = 'photos'): Directory {
  const folder = new Directory(Paths.document, name);
  if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
  return folder;
}

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
  const kept = new File(photoFolder(), `${id}.jpg`);
  await new File(small.uri).move(kept);

  const position = await lastPosition();
  return { id, uri: kept.uri, takenAt: new Date().toISOString(), lat: position?.lat ?? null, lng: position?.lng ?? null };
}

/** The driver's own photo (Phase 7 §5), on the phone until it is saved; its id is also its photos row's. */
export interface LocalProfilePhoto {
  id: string;
  uri: string;
  takenAt: string;
}

/**
 * "Add your photo" and Change photo: the front camera or the gallery, both with the square crop screen, then 512 × 512
 * JPEG (0.8). null = the driver cancelled; 'denied' = the camera is not allowed. The gallery needs no permission (the
 * system photo picker).
 */
export async function pickProfilePhoto(source: 'camera' | 'gallery'): Promise<LocalProfilePhoto | null | 'denied'> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 };
  let picked: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return 'denied';
    picked = await ImagePicker.launchCameraAsync({ ...options, cameraType: ImagePicker.CameraType.front });
  } else {
    picked = await ImagePicker.launchImageLibraryAsync(options);
  }
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  if (!asset) return null;

  const crop = squareCrop(asset.width, asset.height);
  const actions: Action[] = [...(crop ? [{ crop }] : []), { resize: { width: PROFILE_SIDE, height: PROFILE_SIDE } }];
  const square = await manipulateAsync(asset.uri, actions, { compress: PROFILE_QUALITY, format: SaveFormat.JPEG });
  const id = Crypto.randomUUID();
  const kept = new File(photoFolder('profile'), `${id}.jpg`);
  await new File(square.uri).move(kept);
  return { id, uri: kept.uri, takenAt: new Date().toISOString() };
}

/**
 * A vehicle's first photo (Phase 7 §6, from the vehicle picker): the camera only, then the photo (1600 px on the long
 * side) and its thumbnail (256 px), both kept in the app's folder until the queue has sent them. Returns the queue op
 * (not queued yet), null when the driver cancelled, 'denied' when the camera is not allowed.
 */
export async function takeVehiclePhoto(vehicleId: string): Promise<VehiclePhotoOp | null | 'denied'> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return 'denied';
  const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  if (shot.canceled) return null;
  const asset = shot.assets[0];
  if (!asset) return null;

  const sized = (max: number) => {
    const resize = fitWithin(asset.width, asset.height, max);
    return manipulateAsync(asset.uri, resize ? [{ resize }] : [], { compress: 0.7, format: SaveFormat.JPEG });
  };
  const [photo, thumb] = [await sized(VEHICLE_PHOTO_SIDE), await sized(VEHICLE_THUMB_SIDE)];
  const id = Crypto.randomUUID();
  const folder = photoFolder();
  const keptPhoto = new File(folder, `${id}.jpg`);
  const keptThumb = new File(folder, `${id}-thumb.jpg`);
  await new File(photo.uri).move(keptPhoto);
  await new File(thumb.uri).move(keptThumb);
  const { path, thumbPath } = vehiclePhotoPaths(vehicleId, id);
  return {
    kind: 'vehicle_photo',
    id,
    vehicle_id: vehicleId,
    path,
    thumb_path: thumbPath,
    local_uri: keptPhoto.uri,
    thumb_uri: keptThumb.uri,
    taken_at: new Date().toISOString(),
  };
}

/** Whether a file the app kept is still on the phone (lib/localFile.ts: Photos.tsx reads it without the queue). */
export { fileExists };

/** Removes a file the app kept (a photo the driver decided not to use, an old profile photo). */
export function removeFile(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Nothing to clean up.
  }
}

/** Removes a photo the driver decided not to use. */
export function discardPhoto(photo: LocalPhoto): void {
  removeFile(photo.uri);
}

/**
 * Puts a photo in the queue: the file is uploaded and its record saved when there is a connection. `links`: the report it
 * belongs to, or (Round 4–7) the vehicle check and the side (lib/photoRules.ts photoOp).
 */
export function queuePhoto(photo: LocalPhoto, kind: PhotoKind, employeeId: string, links: PhotoLinks = {}): void {
  enqueue(photoOp(photo, kind, employeeId, links));
}

export interface PhotoScan {
  /** All text the phone's reader found; null when the reader could not run (not ready, no model yet). */
  text: string | null;
  /** The number that looks most like an odometer reading, if any. */
  candidate: number | null;
}

/**
 * What the phone's own text reader (Google ML Kit) sees in a photo. It is the
 * pre-check before the server is asked (a photo with text but no digits
 * cannot show an odometer) and the fallback when the server cannot be reached
 * (lib/odometerAi.ts); with an expected reading, the number closest to it
 * wins. If the reader is not available in this build, it simply finds nothing.
 */
export async function scanPhotoDigits(uri: string, expectedKm: number | null): Promise<PhotoScan> {
  try {
    const result = await TextRecognition.recognize(uri);
    return { text: result.text ?? '', candidate: odometerFromText(result.text ?? '', expectedKm) };
  } catch {
    return { text: null, candidate: null };
  }
}

/**
 * Runs the reader once on a small picture that ships with the app. In builds
 * that use Google Play services for reading (the preview build), this makes
 * Play services fetch its model now, so it is ready before the first odometer
 * photo. Any failure is ignored.
 */
export async function prepareOdometerReader(): Promise<void> {
  try {
    const sample = Asset.fromModule(require('../../assets/notification-icon.png'));
    await sample.downloadAsync();
    if (sample.localUri) await TextRecognition.recognize(sample.localUri);
  } catch {
    // Not ready yet, or no connection: the driver types the number.
  }
}
