// Office mode (Stage 1, O3 item 5): a photo for a driver, a vehicle, a licence or a vehicle's document, from the camera or
// the phone's photos (the system photo picker: no permission), made at its size (office/mediaLogic.ts) and sent straight
// to Storage through the one-time signed upload a tool handed out. Nothing waits in a queue: the office person is online
// and sees the outcome at once (Try again on a failure). Modules already in the 1.3.0 build (expo-image-picker,
// expo-image-manipulator, expo-file-system): an EAS update, no build.

import { File, UploadType } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';
import { centredSquare, fitLongSide, JPEG_QUALITY, LONG_SIDE, PROFILE_PX, type PhotoUse, signedUploadUrl, THUMB_PX, type UploadTicket } from './mediaLogic';
import type { FleetError } from './types';
import { withTimeout } from '@/lib/patterns/listLogic';

export interface ShotFile {
  uri: string;
  bytes: number;
  width: number;
  height: number;
}

export interface Shot {
  photo: ShotFile;
  /** A vehicle's photo only: the 256 px thumbnail. */
  thumb?: ShotFile;
}

/** The camera or the phone's photos. null = cancelled; 'denied' = the camera is not allowed. */
export async function pickPhoto(use: PhotoUse, source: 'camera' | 'library'): Promise<Shot | null | 'denied'> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, ...(use === 'driver_profile' ? { allowsEditing: true, aspect: [1, 1] as [number, number] } : {}) };
  let picked: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return 'denied';
    picked = await ImagePicker.launchCameraAsync(options);
  } else {
    picked = await ImagePicker.launchImageLibraryAsync(options);
  }
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  if (!asset) return null;

  const make = async (actions: Parameters<typeof manipulateAsync>[1]): Promise<ShotFile> => {
    const out = await manipulateAsync(asset.uri, actions, { compress: JPEG_QUALITY, format: SaveFormat.JPEG });
    return { uri: out.uri, width: out.width, height: out.height, bytes: new File(out.uri).size ?? 0 };
  };
  if (use === 'driver_profile') {
    const crop = centredSquare(asset.width, asset.height);
    return { photo: await make([...(crop ? [{ crop }] : []), { resize: { width: PROFILE_PX, height: PROFILE_PX } }]) };
  }
  const sized = (max: number) => {
    const resize = fitLongSide(asset.width, asset.height, max);
    return make(resize ? [{ resize }] : []);
  };
  const photo = await sized(LONG_SIDE[use]);
  return use === 'vehicle' ? { photo, thumb: await sized(THUMB_PX) } : { photo };
}

/** Sends a file to its signed upload. Throws a FleetError with a sentence (the screens show it with Try again). */
/** One photo's upload: at most a minute. */
export const UPLOAD_TIMEOUT_MS = 60_000;

export async function uploadToTicket(ticket: UploadTicket, uri: string, contentType: string): Promise<void> {
  let status: number;
  let body = '';
  try {
    // Every call has a time limit (docs/ui-patterns.md §5): 60 s for one photo of at most 1600 px.
    const result = await withTimeout(new File(uri).upload(signedUploadUrl(SUPABASE_URL, ticket), {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      mimeType: contentType,
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': contentType, 'x-upsert': 'false' },
    }), UPLOAD_TIMEOUT_MS);
    status = result.status;
    body = result.body;
  } catch {
    throw { code: 'upload_failed', message: 'No connection: the photo did not go up. Try again.' } satisfies FleetError;
  }
  if (status >= 200 && status < 300) return;
  throw { code: /expired/i.test(body) ? 'upload_expired' : 'upload_failed', message: `The photo did not go up (${status}).` } satisfies FleetError;
}
