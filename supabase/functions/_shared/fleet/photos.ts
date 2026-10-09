// Photos live in the private bucket driver-photos. The office never gets the
// files themselves, only links that stop working after one hour.

import type { Db, Row } from "./db.ts";
import { unwrap } from "./db.ts";

const BUCKET = "driver-photos";
const ONE_HOUR_SECONDS = 60 * 60;
export const PHOTO_LINK_NOTE = "Photo links work for 1 hour.";

type Photo = Pick<Row<"photos">, "id" | "storage_path" | "vehicle_report_id">;

export interface PhotoLinks {
  /** photo id -> link */
  byId: Map<string, string>;
  /** vehicle report id -> links of its photos */
  byReport: Map<string, string[]>;
}

/** 1-hour signed links for photos picked by id and/or by vehicle report. */
export async function photoLinks(db: Db, pick: { ids?: string[]; reportIds?: string[] }): Promise<PhotoLinks> {
  const ids = [...new Set(pick.ids ?? [])];
  const reportIds = [...new Set(pick.reportIds ?? [])];
  const columns = "id, storage_path, vehicle_report_id";
  const [byIds, byReports] = await Promise.all([
    ids.length > 0 ? db.from("photos").select(columns).in("id", ids) : { data: [] as Photo[], error: null },
    reportIds.length > 0
      ? db.from("photos").select(columns).in("vehicle_report_id", reportIds).order("taken_at")
      : { data: [] as Photo[], error: null },
  ]);
  const photos = [...unwrap(byIds, "photos"), ...unwrap(byReports, "photos")];
  const links: PhotoLinks = { byId: new Map(), byReport: new Map() };
  if (photos.length === 0) return links;

  const { data, error } = await db.storage.from(BUCKET).createSignedUrls(photos.map((p) => p.storage_path), ONE_HOUR_SECONDS);
  if (error) throw new Error(`photo links: ${error.message}`);
  const urlByPath = new Map<string, string>();
  for (const item of data) {
    // A photo whose file has not finished uploading from the phone has no link yet.
    if (item.path && item.signedUrl) urlByPath.set(item.path, item.signedUrl);
  }

  for (const photo of photos) {
    const url = urlByPath.get(photo.storage_path);
    if (!url) continue;
    links.byId.set(photo.id, url);
    if (photo.vehicle_report_id) {
      const list = links.byReport.get(photo.vehicle_report_id) ?? [];
      if (!list.includes(url)) list.push(url);
      links.byReport.set(photo.vehicle_report_id, list);
    }
  }
  return links;
}

/** What to show for a photo that a log points at. */
export function photoOrNote(links: PhotoLinks, photoId: string | null): string | undefined {
  if (!photoId) return undefined;
  return links.byId.get(photoId) ?? "not uploaded yet";
}
