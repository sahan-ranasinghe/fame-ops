// An office person's own photo in Office mode and /m/ (Round 1 item 7b, 21 October 2026): My profile shows it (the
// initials until there is one) with Change photo (camera or gallery, the driver's square crop). Nothing new on the
// server: the same calls as a driver's photo, which any signed-in person may make for themselves — their own employee
// id (current_employee_id), their own row's photo_id, their own <employee id>/profile/ folder in driver-photos, a
// photos row of kind profile and set_my_photo. The photo next to office people on other screens (and the site's own
// Change photo) needs the server's photo_url for them: that waits for its go.

import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';

/** Where my profile photo goes in driver-photos (the driver's rule, lib/photoRules.ts profilePhotoPath). */
const profilePhotoPath = (employeeId: string, id: string) => `${employeeId}/profile/${id}.jpg`;
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

/**
 * Saves a picked photo as mine: a signed upload into my own folder (the own-folder insert policy allows it), its photos
 * row, then set_my_photo. No queue (and none of the driver app's offline store, which the web build cannot carry).
 */
export async function saveMyOfficePhoto(photo: MyPhoto): Promise<SaveOutcome> {
  try {
    const id = await myEmployeeId();
    if (!id) return 'failed';
    const photoId = Crypto.randomUUID();
    const path = profilePhotoPath(id, photoId);
    const signed = await supabase.storage.from('driver-photos').createSignedUploadUrl(path);
    if (signed.error || !signed.data) return 'network';
    await uploadToTicket({ bucket: 'driver-photos', path, token: signed.data.token }, photo.uri, 'image/jpeg');
    const row = await supabase.from('photos').insert({
      id: photoId, employee_id: id, kind: 'profile', storage_path: path, taken_at: new Date().toISOString(),
    });
    if (row.error) return 'failed';
    const set = await supabase.rpc('set_my_photo', { p_photo_id: photoId });
    return set.error ? 'network' : set.data === 'ok' ? 'ok' : 'failed';
  } catch {
    // uploadToTicket throws with its own sentence on a dropped connection.
    return 'network';
  }
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
