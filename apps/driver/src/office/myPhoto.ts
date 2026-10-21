// An office person's own photo in Office mode and /m/ (Round 1 item 7b, 21 October 2026): My profile shows it (the
// initials until there is one) with Change photo (camera or gallery, the driver's square crop). Nothing new on the
// server: the same calls as a driver's photo, which any signed-in person may make for themselves — their own employee
// id (current_employee_id), their own row's photo_id, their own <employee id>/profile/ folder in driver-photos, a
// photos row of kind profile and set_my_photo. The photo next to office people on other screens (and the site's own
// Change photo) needs the server's photo_url for them: that waits for its go.

import { useCallback, useEffect, useState } from 'react';

import * as api from '../lib/api';
import { profilePhotoPath } from '../lib/photoRules';
import type { LocalProfilePhoto } from '../lib/photos';
import { supabase } from '../lib/supabase';

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
  const path = await api.fetchPhotoPath(supabase, photoId);
  if (!path) return null;
  const signed = await supabase.storage.from('driver-photos').createSignedUrl(path, LINK_SECONDS);
  return signed.data?.signedUrl ?? null;
}

/** The camera or the gallery with the square crop (the driver's picker; loaded when used, like the upload). */
export async function pickMyPhoto(source: 'camera' | 'gallery'): Promise<LocalProfilePhoto | null | 'denied'> {
  const { pickProfilePhoto } = await import('../lib/photos');
  return pickProfilePhoto(source);
}

export type SaveOutcome = 'ok' | 'failed' | 'network';

/** Saves a picked photo as mine: the file, its photos row, then set_my_photo (each step safe to repeat). */
export async function saveMyOfficePhoto(photo: LocalProfilePhoto): Promise<SaveOutcome> {
  try {
    const id = await myEmployeeId();
    if (!id) return 'failed';
    // Loaded when used: the upload lives with the driver's queue (its database opens on import).
    const { uploadPhotoFile } = await import('../sync');
    const answer = await api.saveProfilePhoto(
      supabase,
      { id: photo.id, employee_id: id, storage_path: profilePhotoPath(id, photo.id), taken_at: photo.takenAt },
      (path) => uploadPhotoFile(photo.uri, path),
    );
    return answer === 'ok' ? 'ok' : 'failed';
  } catch (error) {
    return error instanceof api.ApiError && error.permanent ? 'failed' : 'network';
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
