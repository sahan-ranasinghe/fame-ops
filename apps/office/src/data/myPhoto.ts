// Web build only (Round 3, docs/phase8-plan.md §30, 5a): an office person's own photo from My profile, the same calls as
// Office mode's (apps/driver/src/office/myPhoto.ts) and a driver's own photo, which any signed-in person may make for
// themselves: their own employee id (current_employee_id), a signed upload into their own <employee id>/profile/ folder of
// driver-photos (the own-folder policy), a photos row of kind profile, then set_my_photo. The picture is made by the page
// (imageCanvas.profilePhoto: the centred square at 512 × 512). WebApp passes this in the context (`myPhoto`), so the
// artifact has no Supabase code and no Change photo.
import { supabase } from "../auth/supabase";

export type MyPhotoOutcome = "ok" | "failed" | "network";

/** Where my profile photo goes in driver-photos (the driver's rule, lib/photoRules.ts profilePhotoPath). */
export const profilePhotoPath = (employeeId: string, id: string) => `${employeeId}/profile/${id}.jpg`;

/** Saves a made photo as mine. "network" = it did not go up (no connection); "failed" = the server said no. */
export async function saveMyPhoto(jpeg: Blob): Promise<MyPhotoOutcome> {
  if (!supabase) return "failed";
  try {
    const me = await supabase.rpc("current_employee_id");
    const id = typeof me.data === "string" ? me.data : null;
    if (!id) return me.error ? "network" : "failed";
    const photoId = crypto.randomUUID();
    const path = profilePhotoPath(id, photoId);
    const bucket = supabase.storage.from("driver-photos");
    const signed = await bucket.createSignedUploadUrl(path);
    if (signed.error || !signed.data) return "network";
    const up = await bucket.uploadToSignedUrl(path, signed.data.token, jpeg, { contentType: "image/jpeg" });
    if (up.error) return "network";
    const row = await supabase.from("photos").insert({
      id: photoId, employee_id: id, kind: "profile", storage_path: path, taken_at: new Date().toISOString(),
    });
    if (row.error) return "failed";
    const set = await supabase.rpc("set_my_photo", { p_photo_id: photoId });
    return set.error ? "network" : set.data === "ok" ? "ok" : "failed";
  } catch {
    return "network";
  }
}
