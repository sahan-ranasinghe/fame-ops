// Fuel videos (Phase 6, Part 3). The files live in the private bucket
// fuel-videos under <employee_id>/<day>/<fuel log id>.mp4; the office gets
// 1-hour signed links through the tools, never the files. The monthly prune
// (fleet-jobs) removes files older than 12 months and marks the rows.

import type { Db, Row } from "./db.ts";
import { unwrap } from "./db.ts";
import { type ChecklistItem, loadSettings } from "./settings.ts";

export const VIDEO_BUCKET = "fuel-videos";
const ONE_HOUR_SECONDS = 60 * 60;
export const VIDEO_LINK_NOTE = "Video links work for 1 hour.";
/** Videos are kept this long by default, then pruned (the row keeps its path, status pruned); the setting fuel_video_keep_months decides. */
export const VIDEO_KEEP_MONTHS = 12;
export const PRUNE_BATCH = 100;

export type FuelLog = Row<"fuel_logs">;
export type VideoStatus =
  | "none"
  | "recorded"
  | "uploading"
  | "uploaded"
  | "failed"
  | "pruned";

/** One piece of a recording that was interrupted (a call, the app sent to the back): up to three per fill. */
export interface VideoSegment {
  path: string;
  duration_s?: number;
  bytes?: number;
}

/** One step the driver ticked while recording, at this second of the fill: a bookmark for the office. */
export interface VideoMark {
  key: string;
  /** The step's short word (the setting's `short`, else its English text, else the key). */
  label: string;
  at_s: number;
  /** "0:04" */
  clock: string;
}

export interface VideoCard {
  status: VideoStatus;
  /** The whole fill's length and size (every piece). */
  duration_s?: number;
  bytes?: number;
  /** A 1-hour signed link to the first piece, only while the file is there (uploaded). */
  url?: string;
  /** Every piece in order with its link (one piece for an uninterrupted recording). */
  segments?: { url?: string; duration_s?: number; bytes?: number }[];
  /** The recording was interrupted and continued: the office should expect a break between the pieces. */
  interrupted?: boolean;
  /** The keys of the steps ticked, in order. */
  checklist?: string[];
  /** The steps with the second of each (rows written since the steps became a sequence): bookmarks. */
  marks?: VideoMark[];
  /** "Plate 0:04 · Zero 0:11 · Pumping 0:15 · Final 3:52" */
  timeline?: string;
  uploaded_at?: string;
  /** "Uploading on the phone", "No video", "Pruned after 12 months", … */
  note?: string;
}

/** The pieces of a fill's video: the stored list, or the one path. */
export function segmentsOf(
  log: Pick<
    FuelLog,
    "video_path" | "video_segments" | "video_duration_s" | "video_bytes"
  >,
): VideoSegment[] {
  const list = Array.isArray(log.video_segments)
    ? (log.video_segments as unknown[])
    : [];
  const parsed = list.flatMap((x) => {
    const seg = x as Partial<VideoSegment> | null;
    return seg && typeof seg.path === "string"
      ? [{
        path: seg.path,
        duration_s: seg.duration_s ?? undefined,
        bytes: seg.bytes ?? undefined,
      }]
      : [];
  });
  if (parsed.length > 0) return parsed;
  return log.video_path
    ? [{
      path: log.video_path,
      duration_s: log.video_duration_s ?? undefined,
      bytes: log.video_bytes ?? undefined,
    }]
    : [];
}

/** The steps the driver ticked: the stored [{key, at_s}], or the keys alone from an older row. */
export function marksOf(
  log: Pick<FuelLog, "video_checklist">,
): { key: string; at_s?: number }[] {
  const list = Array.isArray(log.video_checklist)
    ? (log.video_checklist as unknown[])
    : [];
  return list.flatMap((x) => {
    if (typeof x === "string") return [{ key: x }];
    const m = x as { key?: unknown; at_s?: unknown } | null;
    if (!m || typeof m.key !== "string") return [];
    const at =
      typeof m.at_s === "number" && Number.isFinite(m.at_s) && m.at_s >= 0
        ? Math.round(m.at_s)
        : undefined;
    return [{ key: m.key, at_s: at }];
  });
}

/** "0:04", "3:52" */
export function clockOf(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The step's word on the timeline: the setting's short, else its English text, else the key in words ("fuel_cap" → "Fuel cap"). */
export function markLabel(
  key: string,
  items: ChecklistItem[] | undefined,
): string {
  const item = items?.find((i) => i.key === key);
  if (item) return item.short || item.en;
  const words = key.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/** The bookmarks of a fill with their words, or none when the row has only keys (older rows). */
export function marksWithLabels(
  log: Pick<FuelLog, "video_checklist">,
  items: ChecklistItem[] | undefined,
): VideoMark[] | undefined {
  const marks = marksOf(log).flatMap((m) =>
    m.at_s === undefined ? [] : [{
      key: m.key,
      label: markLabel(m.key, items),
      at_s: m.at_s,
      clock: clockOf(m.at_s),
    }]
  );
  return marks.length > 0 ? marks : undefined;
}

/** "Plate 0:04 · Zero 0:11 · Pumping 0:15 · Final 3:52" */
export function timelineOf(marks: VideoMark[] | undefined): string | undefined {
  return marks?.length
    ? marks.map((m) => `${m.label} ${m.clock}`).join(" · ")
    : undefined;
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

type VideoLog = Pick<
  FuelLog,
  | "id"
  | "video_path"
  | "video_status"
  | "video_duration_s"
  | "video_bytes"
  | "video_checklist"
  | "video_uploaded_at"
  | "video_segments"
  | "video_interrupted"
>;

/** The video part of a fuel entry, with its links when there are any. Pure given the links (path → url) and the steps setting (the words). */
export function videoCard(
  log: VideoLog,
  links: Map<string, string> | undefined,
  uploadedAt?: string,
  items?: ChecklistItem[],
): VideoCard {
  const status = videoStatusOf(log);
  const pieces = segmentsOf(log);
  const first = pieces[0]?.path ? links?.get(pieces[0].path) : undefined;
  const keys = marksOf(log).map((m) => m.key);
  const marks = marksWithLabels(log, items);
  return {
    status,
    duration_s: log.video_duration_s ?? undefined,
    bytes: log.video_bytes ?? undefined,
    url: status === "uploaded" ? first : undefined,
    segments: status === "uploaded" && pieces.length > 0
      ? pieces.map((p) => ({
        url: links?.get(p.path),
        duration_s: p.duration_s,
        bytes: p.bytes,
      }))
      : undefined,
    interrupted: log.video_interrupted || pieces.length > 1 ? true : undefined,
    checklist: keys.length > 0 ? keys : undefined,
    marks,
    timeline: timelineOf(marks),
    uploaded_at: uploadedAt,
    note: status === "uploaded" && !first
      ? "The file is not in storage (not uploaded yet, or removed)"
      : NOTE[status],
  };
}

/** 1-hour signed links for every piece of the uploaded videos among these logs, by path. */
export async function videoLinks(
  db: Db,
  logs: Pick<
    FuelLog,
    | "id"
    | "video_path"
    | "video_status"
    | "video_segments"
    | "video_duration_s"
    | "video_bytes"
  >[],
): Promise<Map<string, string>> {
  const byPath = new Map<string, string>();
  const paths = [
    ...new Set(
      logs.filter((l) => videoStatusOf(l) === "uploaded").flatMap((l) =>
        segmentsOf(l).map((p) => p.path)
      ),
    ),
  ];
  if (paths.length === 0) return byPath;
  const { data, error } = await db.storage.from(VIDEO_BUCKET).createSignedUrls(
    paths,
    ONE_HOUR_SECONDS,
  );
  if (error) throw new Error(`video links: ${error.message}`);
  for (const item of data) {
    if (item.path && item.signedUrl) byPath.set(item.path, item.signedUrl);
  }
  return byPath;
}

/** The rows whose uploaded video is older than the keep time, oldest first, at most a batch. Pure. */
export function pruneDue<
  T extends Pick<
    FuelLog,
    "id" | "video_path" | "video_status" | "video_uploaded_at" | "logged_at"
  >,
>(
  rows: T[],
  now: Date,
  batch = PRUNE_BATCH,
  keepMonths = VIDEO_KEEP_MONTHS,
): T[] {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - keepMonths);
  return rows
    .filter((r) =>
      r.video_path && videoStatusOf(r) === "uploaded" &&
      new Date(r.video_uploaded_at ?? r.logged_at) < cutoff
    )
    .sort((a, b) =>
      (a.video_uploaded_at ?? a.logged_at).localeCompare(
        b.video_uploaded_at ?? b.logged_at,
      )
    )
    .slice(0, batch);
}

/** Removes the files (every piece) of the videos due for pruning and marks their rows. Returns the counts. */
export async function pruneFuelVideos(
  db: Db,
  now: Date,
): Promise<
  { checked: number; pruned: number; failed: number; keep_months: number }
> {
  const keepMonths = (await loadSettings(db)).fuel_video_keep_months;
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - keepMonths);
  const rows = unwrap(
    await db.from("fuel_logs").select(
      "id, video_path, video_status, video_uploaded_at, logged_at, video_segments, video_duration_s, video_bytes",
    )
      .eq("video_status", "uploaded").lt(
        "video_uploaded_at",
        cutoff.toISOString(),
      ).order("video_uploaded_at").limit(PRUNE_BATCH * 5),
    "fuel logs",
  );
  const due = pruneDue(rows, now, PRUNE_BATCH * 5, keepMonths);
  let pruned = 0;
  let failed = 0;
  for (let i = 0; i < due.length; i += PRUNE_BATCH) {
    const slice = due.slice(i, i + PRUNE_BATCH);
    const { error } = await db.storage.from(VIDEO_BUCKET).remove(
      slice.flatMap((r) => segmentsOf(r).map((p) => p.path)),
    );
    if (error) {
      console.error(`prune fuel videos: ${error.message}`);
      failed += slice.length;
      continue;
    }
    // A file already gone counts as pruned: the row is what matters now.
    const ids = slice.map((r) => r.id);
    const { error: markError } = await db.from("fuel_logs").update({
      video_status: "pruned",
    }).in("id", ids);
    if (markError) {
      console.error(`prune fuel videos (mark): ${markError.message}`);
      failed += ids.length;
    } else pruned += ids.length;
  }
  return { checked: rows.length, pruned, failed, keep_months: keepMonths };
}
