// Links to photos and documents for the office (Phase 7, §5, §6, §28). A file's link is signed for two hours and
// handed out again while it has over an hour left (media_links), so a page refreshing every 30 seconds keeps the
// same picture link (nothing reloads or flickers) and every link handed out works for at least an hour.

import type { Db } from "./db.ts";
import { unwrap } from "./db.ts";

export type MediaBucket = "driver-photos" | "vehicle-photos" | "vehicle-docs";

/** How long a new link is signed for, seconds. */
export const LINK_SECONDS = 2 * 60 * 60;
/** A kept link is handed out only while it has at least this long left, ms. */
export const KEEP_MS = 60 * 60 * 1000;

/** The links of these files (path → link); a file not uploaded yet has none. */
export async function mediaLinks(
  db: Db,
  bucket: MediaBucket,
  paths: readonly (string | null | undefined)[],
  now = new Date(),
): Promise<Map<string, string>> {
  const want = [...new Set(paths.filter((p): p is string => !!p))];
  const out = new Map<string, string>();
  if (want.length === 0) return out;
  const kept = unwrap(
    await db.from("media_links").select("path, url").eq("bucket", bucket).in("path", want)
      .gt("expires_at", new Date(now.getTime() + KEEP_MS).toISOString()),
    "media links",
  );
  for (const k of kept) out.set(k.path, k.url);
  const missing = want.filter((p) => !out.has(p));
  if (missing.length === 0) return out;
  const { data, error } = await db.storage.from(bucket).createSignedUrls(missing, LINK_SECONDS);
  if (error) {
    console.error(`media links (${bucket}): ${error.message}`);
    return out;
  }
  const expires = new Date(now.getTime() + LINK_SECONDS * 1000).toISOString();
  const fresh = (data ?? []).flatMap((d) =>
    d.path && d.signedUrl && !d.error ? [{ bucket, path: d.path, url: d.signedUrl, expires_at: expires }] : []
  );
  for (const f of fresh) out.set(f.path, f.url);
  if (fresh.length > 0) {
    const { error: saveError } = await db.from("media_links").upsert(fresh, { onConflict: "bucket,path" });
    if (saveError) console.error(`media links (${bucket}) not kept: ${saveError.message}`);
  }
  return out;
}

/** The profile photo's file of each of these employees (employee id → storage path). */
export async function profilePaths(db: Db, people: readonly { id: string; photo_id: string | null }[]): Promise<Map<string, string>> {
  const ids = [...new Set(people.flatMap((p) => p.photo_id ? [p.photo_id] : []))];
  if (ids.length === 0) return new Map();
  const rows = unwrap(await db.from("photos").select("id, storage_path").in("id", ids), "photos");
  const byPhoto = new Map(rows.map((r) => [r.id, r.storage_path]));
  return new Map(people.flatMap((p) => (p.photo_id && byPhoto.has(p.photo_id) ? [[p.id, byPhoto.get(p.photo_id)!]] : [])));
}

/** The profile photo links of these employees (employee id → link), in one batch. */
export async function driverPhotoLinks(
  db: Db,
  people: readonly { id: string; photo_id: string | null }[],
  now = new Date(),
): Promise<Map<string, string>> {
  const paths = await profilePaths(db, people);
  const links = await mediaLinks(db, "driver-photos", [...paths.values()], now);
  return new Map([...paths].flatMap(([id, path]) => (links.has(path) ? [[id, links.get(path)!]] : [])));
}

/** Round 3 (A5): photos by their own id (a person's licence front and back) → a signed link, in one batch. */
export async function photoLinksById(db: Db, ids: readonly (string | null)[], now = new Date()): Promise<Map<string, string>> {
  const wanted = ids.filter((x): x is string => !!x);
  if (!wanted.length) return new Map();
  const { data, error } = await db.from("photos").select("id, storage_path").in("id", wanted);
  if (error || !data) return new Map();
  const links = await mediaLinks(db, "driver-photos", data.map((p) => p.storage_path), now);
  return new Map(data.flatMap((p) => (links.has(p.storage_path) ? [[p.id, links.get(p.storage_path)!]] : [])));
}

/** The vehicles' photo links (vehicle id → { photo, thumb }), in one batch. */
export async function vehiclePhotoLinks(
  db: Db,
  vehicles: readonly { id: string; photo_path: string | null; photo_thumb_path: string | null }[],
  now = new Date(),
): Promise<Map<string, { photo?: string; thumb?: string }>> {
  const links = await mediaLinks(db, "vehicle-photos", vehicles.flatMap((v) => [v.photo_path, v.photo_thumb_path]), now);
  return new Map(
    vehicles.filter((v) => v.photo_path).map((v) => [
      v.id,
      {
        photo: v.photo_path ? links.get(v.photo_path) : undefined,
        thumb: v.photo_thumb_path ? links.get(v.photo_thumb_path) : undefined,
      },
    ]),
  );
}
