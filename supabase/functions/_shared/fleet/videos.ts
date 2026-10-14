// Fuel videos (Phase 6, Part 3). The files live in the private bucket
// fuel-videos under <employee_id>/<day>/<fuel log id>.mp4; the office gets
// 1-hour signed links through the tools, never the files. The monthly prune
// (fleet-jobs) removes files older than 12 months and marks the rows.

import type { Db, Row } from "./db.ts";
import { unwrap } from "./db.ts";

export const VIDEO_BUCKET = "fuel-videos";
const ONE_HOUR_SECONDS = 60 * 60;
export const VIDEO_LINK_NOTE = "Video links work for 1 hour.";
/** Videos are kept this long, then pruned (the row keeps its path, status pruned). */
export const VIDEO_KEEP_MONTHS = 12;
export const PRUNE_BATCH = 100;

export type FuelLog = Row<"fuel_logs">;
export type VideoStatus = "none" | "recorded" | "uploading" | "uploaded" | "failed" | "pruned";

export interface VideoCard {
  status: VideoStatus;
  duration_s?: number;
  bytes?: number;
  /** A 1-hour signed link, only while the file is there (uploaded). */
  url?: string;
  checklist?: string[];
  uploaded_at?: string;
  /** "Uploading on the phone", "No video", "Pruned after 12 months", … */
  note?: string;
}

const NOTE: Record<VideoStatus, string | undefined> = {
  none: "No video",
  recorded: "Recorded · the upload has not started on the phone",
  uploading: "Uploading on the phone",
  uploaded: undefined,
  failed: "The upload failed on the phone",
  pruned: `Pruned after ${VIDEO_KEEP_MONTHS} months`,
};

/** The status as stored, or none for an older row. */
export function videoStatusOf(log: Pick<FuelLog, "video_status">): VideoStatus {
  const s = log.video_status as VideoStatus | null | undefined;
  return s && s in NOTE ? s : "none";
}

/** The video part of a fuel entry, with its link when there is one. Pure given the link. */
export function videoCard(log: Pick<FuelLog, "video_status" | "video_duration_s" | "video_bytes" | "video_checklist" | "video_uploaded_at">, url: string | undefined, uploadedAt?: string): VideoCard {
  const status = videoStatusOf(log);
  return {
    status,
    duration_s: log.video_duration_s ?? undefined,
    bytes: log.video_bytes ?? undefined,
    url: status === "uploaded" ? url : undefined,
    checklist: Array.isArray(log.video_checklist) ? (log.video_checklist as unknown[]).filter((x): x is string => typeof x === "string") : undefined,
    uploaded_at: uploadedAt,
    note: status === "uploaded" && !url ? "The file is not in storage (not uploaded yet, or removed)" : NOTE[status],
  };
}

/** 1-hour signed links for the uploaded videos among these logs, by log id. */
export async function videoLinks(db: Db, logs: Pick<FuelLog, "id" | "video_path" | "video_status">[]): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  const paths = logs.filter((l) => l.video_path && videoStatusOf(l) === "uploaded").map((l) => l.video_path!);
  if (paths.length === 0) return links;
  const { data, error } = await db.storage.from(VIDEO_BUCKET).createSignedUrls([...new Set(paths)], ONE_HOUR_SECONDS);
  if (error) throw new Error(`video links: ${error.message}`);
  const byPath = new Map<string, string>();
  for (const item of data) if (item.path && item.signedUrl) byPath.set(item.path, item.signedUrl);
  for (const log of logs) {
    const url = log.video_path ? byPath.get(log.video_path) : undefined;
    if (url) links.set(log.id, url);
  }
  return links;
}

/** The rows whose uploaded video is older than the keep time, oldest first, at most a batch. Pure. */
export function pruneDue<T extends Pick<FuelLog, "id" | "video_path" | "video_status" | "video_uploaded_at" | "logged_at">>(rows: T[], now: Date, batch = PRUNE_BATCH): T[] {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - VIDEO_KEEP_MONTHS);
  return rows
    .filter((r) => r.video_path && videoStatusOf(r) === "uploaded" && new Date(r.video_uploaded_at ?? r.logged_at) < cutoff)
    .sort((a, b) => (a.video_uploaded_at ?? a.logged_at).localeCompare(b.video_uploaded_at ?? b.logged_at))
    .slice(0, batch);
}

/** Removes the files of the videos due for pruning and marks their rows. Returns the counts. */
export async function pruneFuelVideos(db: Db, now: Date): Promise<{ checked: number; pruned: number; failed: number }> {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - VIDEO_KEEP_MONTHS);
  const rows = unwrap(
    await db.from("fuel_logs").select("id, video_path, video_status, video_uploaded_at, logged_at")
      .eq("video_status", "uploaded").lt("video_uploaded_at", cutoff.toISOString()).order("video_uploaded_at").limit(PRUNE_BATCH * 5),
    "fuel logs",
  );
  const due = pruneDue(rows, now, PRUNE_BATCH * 5);
  let pruned = 0;
  let failed = 0;
  for (let i = 0; i < due.length; i += PRUNE_BATCH) {
    const slice = due.slice(i, i + PRUNE_BATCH);
    const { data, error } = await db.storage.from(VIDEO_BUCKET).remove(slice.map((r) => r.video_path!));
    if (error) {
      console.error(`prune fuel videos: ${error.message}`);
      failed += slice.length;
      continue;
    }
    // A file already gone counts as pruned: the row is what matters now.
    const removed = new Set((data ?? []).map((o) => o.name));
    const ids = slice.filter((r) => removed.has(r.video_path!) || true).map((r) => r.id);
    const { error: markError } = await db.from("fuel_logs").update({ video_status: "pruned" }).in("id", ids);
    if (markError) {
      console.error(`prune fuel videos (mark): ${markError.message}`);
      failed += ids.length;
    } else pruned += ids.length;
  }
  return { checked: rows.length, pruned, failed };
}
