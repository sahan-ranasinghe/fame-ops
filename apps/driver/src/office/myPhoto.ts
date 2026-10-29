// An office person's own photo in Office mode and /m/ (Round 1 item 7b, 21 October 2026): My profile shows it (the
// initials until there is one) with Change photo (camera or gallery, the driver's square crop). Nothing new on the
// server: the same calls as a driver's photo, which any signed-in person may make for themselves — their own employee
// id (current_employee_id), their own row's photo_id, their own <employee id>/profile/ folder in driver-photos, a
// photos row of kind profile and set_my_photo. Round 3: the server answers photo_url for office people (/me, the users
// list, the requester on a request, an issue's assignee); those screens show it, and My profile shows /me's until this
// phone's own link is there. Round 4–7 (feature 4): one upload for every own photo (uploadOwnPhoto: the id of the new
// photos row of a kind), also a no-app trip's photos (saveMyTripPhoto).

import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';

/** Where my profile photo goes in driver-photos (the driver's rule, lib/photoRules.ts profilePhotoPath). */
const profilePhotoPath = (employeeId: string, id: string) => `${employeeId}/profile/${id}.jpg`;
import { licencePhotoPath, type LicenceSide } from '../lib/profile';
import { supabase } from '../lib/supabase';
import { pickPhoto, uploadToTicket } from './media';

const LINK_SECONDS = 3600;

async function myEmployeeId(): Promise<string | null> {
  const res = await supabase.rpc('current_employee_id');
  return typeof res.data === 'string' ? res.data : null;
}

/** A 1-hour link to my photo, or null (no photo, or not reachable now). */
async function myPhotoLink(): Promise<string | null> {
  const id = await myEmployeeId();
  if (!id) return null;
  const row = await supabase.from('employees').select('photo_id').eq('id', id).maybeSingle();
  const photoId = (row.data as { photo_id?: string | null } | null)?.photo_id;
  if (!photoId) return null;
  const photoRow = await supabase.from('photos').select('storage_path').eq('id', photoId).maybeSingle();
  const path = (photoRow.data as { storage_path?: string } | null)?.storage_path;
  if (!path) return null;
  const signed = await supabase.storage.from('driver-photos').createSignedUrl(path, LINK_SECONDS);
  return signed.data?.signedUrl ?? null;
}

/** A picked and squared photo of me, ready to save. */
export interface MyPhoto {
  uri: string;
}

/** The camera or the gallery with the square crop (Office mode's picker, office/media.ts: it works on /m/ too). */
export async function pickMyPhoto(source: 'camera' | 'gallery'): Promise<MyPhoto | null | 'denied'> {
  const shot = await pickPhoto('driver_profile', source === 'gallery' ? 'library' : 'camera');
  return shot && shot !== 'denied' ? { uri: shot.photo.uri } : shot;
}

export type SaveOutcome = 'ok' | 'failed' | 'network';

/** The kinds of my own photos Office mode uploads (the photos table's kinds a person writes for themselves). */
export type OwnPhotoKind = 'profile' | 'licence' | 'vehicle_report' | 'vehicle_check' | 'odometer' | 'fuel_receipt';

/**
 * One of my own photos into my own folder of driver-photos (the own-folder insert policy allows it) through a signed
 * upload, then its photos row of `kind`: the new photo's id, or 'network' (it did not go up) / 'failed' (the server said
 * no). No queue (and none of the driver app's offline store, which the web build cannot carry).
 */
export async function uploadOwnPhoto(kind: OwnPhotoKind, pathOf: (employeeId: string, id: string) => string, uri: string): Promise<{ id: string } | Exclude<SaveOutcome, 'ok'>> {
  try {
    const id = await myEmployeeId();
    if (!id) return 'failed';
    const photoId = Crypto.randomUUID();
    const path = pathOf(id, photoId);
    const signed = await supabase.storage.from('driver-photos').createSignedUploadUrl(path);
    if (signed.error || !signed.data) return 'network';
    await uploadToTicket({ bucket: 'driver-photos', path, token: signed.data.token }, uri, 'image/jpeg');
    const row = await supabase.from('photos').insert({
      id: photoId, employee_id: id, kind, storage_path: path, taken_at: new Date().toISOString(),
    });
    if (row.error) return 'failed';
    return { id: photoId };
  } catch {
    // uploadToTicket throws with its own sentence on a dropped connection.
    return 'network';
  }
}

/** An uploaded photo made mine by the database function `set` ('ok' when it says ok). */
async function setOwnPhoto(up: { id: string } | Exclude<SaveOutcome, 'ok'>, set: (photoId: string) => PromiseLike<{ data: unknown; error: unknown }>): Promise<SaveOutcome> {
  if (typeof up === 'string') return up;
  try {
    const done = await set(up.id);
    return done.error ? 'network' : done.data === 'ok' ? 'ok' : 'failed';
  } catch {
    return 'network';
  }
}

/** Saves a picked photo as mine: the upload and its photos row of kind profile, then set_my_photo. */
export async function saveMyOfficePhoto(photo: MyPhoto): Promise<SaveOutcome> {
  return setOwnPhoto(await uploadOwnPhoto('profile', profilePhotoPath, photo.uri), (photoId) => supabase.rpc('set_my_photo', { p_photo_id: photoId }));
}

/**
 * Round 3 Part A5: a side of my driving licence, as the driver's own (Me → Edit, lib/api.ts saveLicencePhoto): the file
 * into my <employee id>/licence/ folder through a signed upload, its photos row of kind licence, then set_my_licence_photo
 * (which checks the folder and the kind). The picture comes made at the licence's size (office/media.ts, driver_licence).
 */
export async function saveMyLicencePhoto(side: LicenceSide, uri: string): Promise<SaveOutcome> {
  return setOwnPhoto(await uploadOwnPhoto('licence', licencePhotoPath, uri), (photoId) => supabase.rpc('set_my_licence_photo', { p_side: side, p_photo_id: photoId }));
}

/** Where a trip's photo goes in driver-photos: the driver's rule, <employee id>/<yyyy-mm-dd Colombo>/<uuid>.jpg. */
export const tripPhotoPath = (employeeId: string, id: string, now = new Date()): string =>
  `${employeeId}/${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(now)}/${id}.jpg`;

/** Round 50 (§37.5): fuel_receipt too, for the fuel at the finish of a trip driven on /m/. */
export type TripPhotoKind = 'vehicle_report' | 'vehicle_check' | 'odometer' | 'fuel_receipt';

/**
 * Round 4–7 (feature 4): a photo for my own no-app trip (a problem found by the vehicle check: vehicle_report; a side of
 * the vehicle: vehicle_check; the odometer at the end: odometer), into my own <employee id>/<day>/ folder: the new
 * photo's id (my_trip_check / finish_my_trip check it is mine, of that kind and unused), or 'failed' / 'network'. The
 * picture comes made at 1600 px (office/media.ts, use 'check').
 */
export function saveMyTripPhoto(kind: TripPhotoKind, uri: string): Promise<{ id: string } | Exclude<SaveOutcome, 'ok'>> {
  return uploadOwnPhoto(kind, (employeeId, id) => tripPhotoPath(employeeId, id), uri);
}

/** My photo's link (null until there is one, or while it loads), and `shown` to put a just-saved photo up at once. */
export function useMyOfficePhoto(): { uri: string | null; shown: (uri: string) => void; reload: () => void } {
  const [uri, setUri] = useState<string | null>(null);
  const reload = useCallback(() => {
    void myPhotoLink().then((u) => { if (u) setUri(u); }).catch(() => undefined);
  }, []);
  useEffect(reload, [reload]);
  return { uri, shown: setUri, reload };
}
